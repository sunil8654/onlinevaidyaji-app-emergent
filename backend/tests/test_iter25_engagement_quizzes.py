"""
Iteration 25 — Backend tests for Phase 3 (Engagement) + Phase 4 (Quizzes) backend.

Covers:
- GET  /api/engagement/me shape (points, streak, level, badges, history)
- POST /api/engagement/checkin: first call awards +10, streak=1, grants 'first_step'
- POST /api/engagement/checkin: idempotent on same UTC day
- POST /api/engagement/checkin: consecutive day increments streak; broken chain resets to 1
- Points → Level mapping and progress_pct
- GET  /api/quizzes lists the 4 seeded quizzes with required fields
- GET  /api/quizzes/{id} does NOT leak `correct`; 404 for unknown
- POST /api/quizzes/{id}/submit: scoring math (5/correct + 30 bonus on 100%),
                                 400 on answer-count mismatch,
                                 grants 'quiz_master' on 100%,
                                 best_score reflected on subsequent GET /quizzes
- Auth guards: engagement + quiz endpoints reject unauth (401/403)
- Regression: /api/doctors public listing includes is_available + consultation_mode,
              /api/doctor/availability GET works for a doctor user.

Streak day-progression: we cannot fast-forward time. We mutate `db.user_engagement`
via pymongo directly to simulate yesterday / two-days-ago check-ins.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

QUIZ_IDS = ["quiz-dosha-basics", "quiz-sleep-hygiene", "quiz-gut-health", "quiz-stress-check"]


# --------------------------- fixtures ---------------------------
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    return c[DB_NAME]


def _register(http, role: str = "patient"):
    email = f"test_iter25_{role}_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_ITER25_{role}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": "9876500055",
    }
    r = http.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "email": email,
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


@pytest.fixture(scope="module")
def patient_a(http):
    """Fresh zero-state patient for engagement flow tests."""
    return _register(http, "patient")


@pytest.fixture(scope="module")
def patient_b(http):
    """Second patient — used for quiz submit tests (kept isolated so first patient's
    check-in doesn't affect quiz badge assertions and vice-versa)."""
    return _register(http, "patient")


@pytest.fixture(scope="module")
def patient_c(http):
    """Third patient — used for streak progression via direct mongo mutation."""
    return _register(http, "patient")


@pytest.fixture(scope="module")
def doctor_ctx(http):
    """Doctor user for /doctor/availability regression."""
    return _register(http, "doctor")


# --------------------------- Engagement /me ---------------------------
class TestEngagementMe:
    def test_shape_and_defaults(self, http, patient_a):
        r = http.get(f"{BASE_URL}/api/engagement/me", headers=patient_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()

        # Top-level keys
        for k in ("points", "streak_current", "streak_max", "level",
                  "badges", "badges_earned", "badges_total", "history"):
            assert k in data, f"missing key: {k}"

        # Zero-state defaults
        assert data["points"] == 0
        assert data["streak_current"] == 0
        assert data["streak_max"] == 0
        assert data["badges_earned"] == 0
        assert data["badges_total"] == 9  # BADGE_LIBRARY length
        assert isinstance(data["badges"], list) and len(data["badges"]) == 9
        for b in data["badges"]:
            for kk in ("key", "title", "earned"):
                assert kk in b
            # earned_at present (may be None on unearned)
            assert "earned_at" in b
            assert b["earned"] is False

        # Level at 0 points
        lvl = data["level"]
        assert lvl["level"] == 1
        assert lvl["title"] == "Seeker"
        assert lvl["next_at"] == 100
        assert lvl["next_title"] == "Explorer"
        assert 0 <= lvl["progress_pct"] <= 100

    def test_requires_auth(self, http):
        r = http.get(f"{BASE_URL}/api/engagement/me", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# --------------------------- Check-in ---------------------------
class TestEngagementCheckin:
    def test_first_checkin_awards_and_grants_first_step(self, http, patient_a):
        r = http.post(f"{BASE_URL}/api/engagement/checkin", headers=patient_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["already_checked_in"] is False
        assert data["points_awarded"] == 10
        assert data["streak_current"] == 1
        assert data["streak_max"] == 1

        # /engagement/me should now show +10 (checkin) + 20 (first_step badge bonus) = 30 points
        # and first_step badge earned=True.
        me = http.get(f"{BASE_URL}/api/engagement/me", headers=patient_a["headers"], timeout=15).json()
        assert me["points"] == 30, f"expected 30 pts got {me['points']}"
        assert me["streak_current"] == 1
        assert me["streak_max"] == 1
        first_step = next(b for b in me["badges"] if b["key"] == "first_step")
        assert first_step["earned"] is True
        assert first_step["earned_at"] is not None
        assert me["badges_earned"] == 1

    def test_second_checkin_same_day_is_idempotent(self, http, patient_a):
        r = http.post(f"{BASE_URL}/api/engagement/checkin", headers=patient_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["already_checked_in"] is True
        assert data["points_awarded"] == 0
        assert data["streak_current"] == 1

        # Points must NOT have increased from prior 30.
        me = http.get(f"{BASE_URL}/api/engagement/me", headers=patient_a["headers"], timeout=15).json()
        assert me["points"] == 30

    def test_requires_auth(self, http):
        r = http.post(f"{BASE_URL}/api/engagement/checkin", timeout=15)
        assert r.status_code in (401, 403)


# --------------------------- Streak progression (mongo-mutated) ---------------------------
class TestStreakProgression:
    def test_consecutive_day_increments_streak(self, http, patient_c, mongo):
        # First check-in today.
        r = http.post(f"{BASE_URL}/api/engagement/checkin", headers=patient_c["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json()["streak_current"] == 1

        # Rewrite streak_last_date to yesterday so the next check-in continues the streak.
        yesterday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        mongo.user_engagement.update_one(
            {"user_id": patient_c["user"]["id"]},
            {"$set": {"streak_last_date": yesterday}},
        )

        r2 = http.post(f"{BASE_URL}/api/engagement/checkin", headers=patient_c["headers"], timeout=15)
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["already_checked_in"] is False
        assert d2["streak_current"] == 2, f"expected streak 2 got {d2['streak_current']}"
        assert d2["streak_max"] >= 2

    def test_broken_chain_resets_streak_to_1(self, http, patient_c, mongo):
        # Simulate last check-in was 2 days ago (chain broken).
        two_days_ago = (datetime.now(timezone.utc).date() - timedelta(days=2)).isoformat()
        mongo.user_engagement.update_one(
            {"user_id": patient_c["user"]["id"]},
            {"$set": {"streak_last_date": two_days_ago}},
        )
        r = http.post(f"{BASE_URL}/api/engagement/checkin", headers=patient_c["headers"], timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["already_checked_in"] is False
        assert d["streak_current"] == 1, f"expected reset to 1 got {d['streak_current']}"
        # streak_max should be preserved (>=2 from the previous test)
        assert d["streak_max"] >= 2


# --------------------------- Level mapping ---------------------------
class TestLevelMapping:
    """Directly hit /engagement/me after setting `points` in mongo to probe the mapper."""
    CASES = [
        (0,     1, "Seeker",         100,   "Explorer"),
        (99,    1, "Seeker",         100,   "Explorer"),
        (100,   2, "Explorer",       300,   "Practitioner"),
        (299,   2, "Explorer",       300,   "Practitioner"),
        (300,   3, "Practitioner",   700,   "Sadhak"),
        (700,   4, "Sadhak",         1500,  "Adhikari"),
        (1500,  5, "Adhikari",       3000,  "Vaidhya Ratna"),
        (3000,  6, "Vaidhya Ratna",  None,  None),
    ]

    @pytest.mark.parametrize("pts,level,title,next_at,next_title", CASES)
    def test_levels(self, http, patient_a, mongo, pts, level, title, next_at, next_title):
        mongo.user_engagement.update_one(
            {"user_id": patient_a["user"]["id"]},
            {"$set": {"points": pts}},
        )
        me = http.get(f"{BASE_URL}/api/engagement/me", headers=patient_a["headers"], timeout=15).json()
        assert me["points"] == pts
        lvl = me["level"]
        assert lvl["level"] == level, f"pts={pts} expected L{level} got L{lvl['level']}"
        assert lvl["title"] == title
        assert lvl["next_at"] == next_at
        assert lvl["next_title"] == next_title
        assert 0 <= lvl["progress_pct"] <= 100


# --------------------------- Quizzes list + detail ---------------------------
class TestQuizzesCatalogue:
    def test_lists_four_seeded_quizzes(self, http, patient_b):
        r = http.get(f"{BASE_URL}/api/quizzes", headers=patient_b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        ids = [q["id"] for q in data]
        for qid in QUIZ_IDS:
            assert qid in ids, f"missing quiz {qid}; got {ids}"
        # Field shape
        for q in data:
            for k in ("id", "title", "category", "description", "image_url",
                      "duration_min", "points", "questions_count",
                      "best_score", "attempted"):
                assert k in q, f"quiz missing field {k}: {q}"
            assert q["questions_count"] >= 1
            assert q["best_score"] == 0
            assert q["attempted"] is False

    def test_get_quiz_does_not_leak_correct(self, http, patient_b):
        r = http.get(f"{BASE_URL}/api/quizzes/quiz-dosha-basics",
                     headers=patient_b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "questions" in data
        assert len(data["questions"]) >= 1
        for q in data["questions"]:
            assert "q" in q and "options" in q
            assert "correct" not in q, "SECURITY: `correct` leaked in GET /quizzes/{id}"

    def test_get_quiz_unknown_id_returns_404(self, http, patient_b):
        r = http.get(f"{BASE_URL}/api/quizzes/does-not-exist",
                     headers=patient_b["headers"], timeout=15)
        assert r.status_code == 404

    def test_requires_auth(self, http):
        assert http.get(f"{BASE_URL}/api/quizzes", timeout=15).status_code in (401, 403)
        assert http.get(f"{BASE_URL}/api/quizzes/quiz-dosha-basics", timeout=15).status_code in (401, 403)


# --------------------------- Quiz submit ---------------------------
class TestQuizSubmit:
    def _get_correct_answers(self, quiz_id: str):
        """Read seeded quizzes from server code — safest option since we cannot import server
        without triggering FastAPI startup. We know the correct answers from server.py:
        dosha: [0,1,2,0,1]; sleep: [2,2,2,2,2]; gut: [2,2,2,2,2]; stress: [2,2,2,2,2]"""
        return {
            "quiz-dosha-basics":  [0, 1, 2, 0, 1],
            "quiz-sleep-hygiene": [2, 2, 2, 2, 2],
            "quiz-gut-health":    [2, 2, 2, 2, 2],
            "quiz-stress-check":  [2, 2, 2, 2, 2],
        }[quiz_id]

    def test_wrong_answer_count_returns_400(self, http, patient_b):
        r = http.post(f"{BASE_URL}/api/quizzes/quiz-dosha-basics/submit",
                      headers=patient_b["headers"],
                      json={"answers": [0, 1]}, timeout=15)
        assert r.status_code == 400, r.text

    def test_perfect_score_awards_bonus_and_quiz_master(self, http, patient_b, mongo):
        # Zero out points/badges to make math clean.
        mongo.user_engagement.update_one(
            {"user_id": patient_b["user"]["id"]},
            {"$set": {"points": 0, "badges": [], "history": [],
                      "streak_current": 0, "streak_max": 0, "streak_last_date": None}},
            upsert=True,
        )
        mongo.quiz_attempts.delete_many({"user_id": patient_b["user"]["id"]})

        answers = self._get_correct_answers("quiz-dosha-basics")
        r = http.post(f"{BASE_URL}/api/quizzes/quiz-dosha-basics/submit",
                      headers=patient_b["headers"],
                      json={"answers": answers}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["score"] == 5
        assert d["total"] == 5
        assert d["pct"] == 100
        # 5 correct * 5 pts + 30 bonus = 55 pts
        assert d["points_awarded"] == 55, f"expected 55 got {d['points_awarded']}"
        assert "quiz_master" in d.get("new_badges", [])
        # details shape
        assert len(d["details"]) == 5
        for det in d["details"]:
            for k in ("q", "picked", "correct", "ok", "explain"):
                assert k in det
            assert det["ok"] is True

        # /engagement/me points = 55 (quiz) + 75 (quiz_master badge bonus) = 130
        me = http.get(f"{BASE_URL}/api/engagement/me",
                      headers=patient_b["headers"], timeout=15).json()
        assert me["points"] == 130, f"expected 130 pts (55+75) got {me['points']}"
        qm = next(b for b in me["badges"] if b["key"] == "quiz_master")
        assert qm["earned"] is True

    def test_best_score_reflected_in_listing(self, http, patient_b):
        r = http.get(f"{BASE_URL}/api/quizzes", headers=patient_b["headers"], timeout=15)
        assert r.status_code == 200
        by_id = {q["id"]: q for q in r.json()}
        dosha = by_id["quiz-dosha-basics"]
        assert dosha["attempted"] is True
        assert dosha["best_score"] == 5, f"expected best_score 5 got {dosha['best_score']}"

    def test_partial_score_no_bonus(self, http, patient_b, mongo):
        # Reset for a clean second attempt.
        mongo.user_engagement.update_one(
            {"user_id": patient_b["user"]["id"]},
            {"$set": {"points": 0, "badges": [], "history": []}},
            upsert=True,
        )
        # Submit sleep-hygiene with 1 correct answer only.
        r = http.post(f"{BASE_URL}/api/quizzes/quiz-sleep-hygiene/submit",
                      headers=patient_b["headers"],
                      json={"answers": [2, 0, 0, 0, 0]}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["score"] == 1
        assert d["pct"] == 20
        assert d["points_awarded"] == 5, f"expected 5 pts (1*5, no bonus) got {d['points_awarded']}"
        assert d.get("new_badges") == []

    def test_submit_unknown_quiz_returns_404(self, http, patient_b):
        r = http.post(f"{BASE_URL}/api/quizzes/does-not-exist/submit",
                      headers=patient_b["headers"],
                      json={"answers": [0, 0, 0, 0, 0]}, timeout=15)
        assert r.status_code == 404

    def test_requires_auth(self, http):
        r = http.post(f"{BASE_URL}/api/quizzes/quiz-dosha-basics/submit",
                      json={"answers": [0, 1, 2, 0, 1]}, timeout=15)
        assert r.status_code in (401, 403)


# --------------------------- Regression ---------------------------
class TestRegression:
    def test_public_doctors_listing_shape(self, http):
        r = http.get(f"{BASE_URL}/api/doctors", timeout=15)
        assert r.status_code == 200, r.text
        docs = r.json()
        assert isinstance(docs, list)
        if docs:
            d = docs[0]
            # Required regression fields
            assert "is_available" in d, "regression: doctors missing is_available"
            assert "consultation_mode" in d, "regression: doctors missing consultation_mode"
            # Personal fields must NOT be present
            for banned in ("phone", "email", "registration_number", "user_id"):
                assert banned not in d, f"security regression: {banned} leaked in /doctors"

    def test_doctor_availability_get_requires_doctor_role(self, http, patient_a):
        r = http.get(f"{BASE_URL}/api/doctor/availability",
                     headers=patient_a["headers"], timeout=15)
        assert r.status_code == 403, r.text

    def test_doctor_availability_get_for_doctor(self, http, doctor_ctx):
        r = http.get(f"{BASE_URL}/api/doctor/availability",
                     headers=doctor_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("is_available", "consultation_mode", "weekly_schedule",
                  "slot_duration_min", "notes"):
            assert k in data, f"missing field {k}"

    def test_auth_login_still_works(self, http, patient_a):
        # /engagement/me is our smoke-token check
        r = http.get(f"{BASE_URL}/api/engagement/me",
                     headers=patient_a["headers"], timeout=15)
        assert r.status_code == 200
