"""Iter 18 — AI Yoga library backend regression tests.

Covers Task B endpoints:
  - GET /api/yoga/library  (auth, filters, dosha recommended, doctor role)
  - GET /api/yoga/sessions/{id}  (full pose payload, 404 on unknown)
  - POST /api/yoga/log  (persistence, validation errors)
  - GET /api/yoga/mine  (stats — streak_days, total_minutes, total_sessions)
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
API = f"{BASE_URL}/api"

DOCTOR_EMAIL = "doctor1@vaidhyaji.example.com"
DOCTOR_PASS = "Vaidhyaji@123"
PATIENT_EMAIL = "patient1@vaidhyaji.example.com"
PATIENT_PASS = "Vaidhyaji@123"

EXPECTED_CATEGORIES = {"Morning", "Therapy", "Women", "Sleep", "Detox", "Cooling", "Quick", "Breath"}
EXPECTED_TOTAL = 8


# ---------- helpers ----------
def _login(email: str, password: str) -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _register(role: str) -> dict:
    email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_{role.capitalize()}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": "9999999999",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=20)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    d["_email"] = email
    return d


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def patient():
    return _login(PATIENT_EMAIL, PATIENT_PASS)


@pytest.fixture(scope="module")
def doctor():
    return _login(DOCTOR_EMAIL, DOCTOR_PASS)


@pytest.fixture(scope="module")
def fresh_patient():
    """Freshly-registered patient with no prior yoga logs (for /yoga/mine streak checks)."""
    return _register("patient")


# ---------- 1. Auth gating ----------
class TestAuthGating:
    def test_library_requires_auth(self):
        r = requests.get(f"{API}/yoga/library", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_session_detail_requires_auth(self):
        r = requests.get(f"{API}/yoga/sessions/morning-energy-20", timeout=15)
        assert r.status_code in (401, 403)

    def test_log_requires_auth(self):
        r = requests.post(f"{API}/yoga/log", json={"session_id": "morning-energy-20"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_mine_requires_auth(self):
        r = requests.get(f"{API}/yoga/mine", timeout=15)
        assert r.status_code in (401, 403)


# ---------- 2. Library shape ----------
class TestLibraryShape:
    def test_library_full_shape(self, patient):
        r = requests.get(f"{API}/yoga/library", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("items", "categories", "levels", "recommended", "dosha", "total"):
            assert k in d, f"missing key {k} in response"
        assert d["total"] == EXPECTED_TOTAL, f"expected 8 items, got {d['total']}"
        assert len(d["items"]) == EXPECTED_TOTAL
        cats = {i["category"] for i in d["items"]}
        assert cats == EXPECTED_CATEGORIES, f"unexpected categories: {cats}"
        # "All" + 8 categories in the chip list
        assert d["categories"][0] == "All"
        assert set(d["categories"][1:]) == EXPECTED_CATEGORIES
        # each item shape
        for i in d["items"]:
            for k in ("id", "title", "category", "level", "duration_min",
                      "dosha_target", "thumbnail", "instructor", "premium"):
                assert k in i, f"item missing key {k}: {i}"
            assert i["premium"] is False
            assert isinstance(i["duration_min"], int)
            assert isinstance(i["dosha_target"], list) and len(i["dosha_target"]) >= 1

    def test_filter_by_category(self, patient):
        r = requests.get(f"{API}/yoga/library?category=Morning", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["items"]) >= 1
        assert all(i["category"] == "Morning" for i in d["items"])

    def test_filter_by_dosha(self, patient):
        r = requests.get(f"{API}/yoga/library?dosha=Vata", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["items"]) >= 1
        assert all("Vata" in i["dosha_target"] for i in d["items"])

    def test_invalid_category_returns_empty_but_200(self, patient):
        r = requests.get(f"{API}/yoga/library?category=NopeCat", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["items"] == []


# ---------- 3. Dosha recommended ----------
class TestRecommended:
    def test_patient_with_saved_dosha_gets_recommended(self, patient):
        """patient1 has a saved Prakriti (Vata from iter17). Recommended should
        contain up to 6 items whose dosha_target includes the dominant dosha."""
        r = requests.get(f"{API}/yoga/library", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        # dosha is the dominant token (split on hyphen)
        assert d["dosha"] is not None, f"expected saved dosha for patient1, got {d['dosha']}"
        assert d["dosha"] in ("Vata", "Pitta", "Kapha"), f"unexpected dominant dosha: {d['dosha']}"
        assert isinstance(d["recommended"], list)
        assert len(d["recommended"]) <= 6
        # Look up each recommended in items to check dosha_target contains dominant
        item_map = {i["id"]: i for i in d["items"]}
        for rec in d["recommended"]:
            assert d["dosha"] in item_map[rec["id"]]["dosha_target"], (
                f"recommended {rec['id']} doesn't include dosha {d['dosha']}"
            )

    def test_doctor_role_gets_null_dosha_empty_recommended(self, doctor):
        r = requests.get(f"{API}/yoga/library", headers=_auth(doctor["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["dosha"] is None
        assert d["recommended"] == []


# ---------- 4. Session detail ----------
class TestSessionDetail:
    def test_session_detail_full_payload(self, patient):
        r = requests.get(f"{API}/yoga/sessions/morning-energy-20", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == "morning-energy-20"
        assert "poses" in d and isinstance(d["poses"], list) and len(d["poses"]) >= 3
        for p in d["poses"]:
            assert set(p.keys()) >= {"name", "duration_sec", "cue"}
            assert isinstance(p["duration_sec"], int) and p["duration_sec"] > 0
        assert "youtube_id" in d and d["youtube_id"]

    def test_session_detail_unknown_404(self, patient):
        r = requests.get(f"{API}/yoga/sessions/nope-nope-nope", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 404


# ---------- 5. Log endpoint ----------
class TestLog:
    def test_log_unknown_session_404(self, patient):
        r = requests.post(
            f"{API}/yoga/log",
            json={"session_id": "nope-nope", "completed_seconds": 60, "total_seconds": 60, "completed_poses": 1},
            headers=_auth(patient["token"]),
            timeout=15,
        )
        assert r.status_code == 404

    def test_log_missing_session_id_422(self, patient):
        r = requests.post(
            f"{API}/yoga/log",
            json={"completed_seconds": 60},
            headers=_auth(patient["token"]),
            timeout=15,
        )
        assert r.status_code == 422

    def test_log_success_writes_entry(self, patient):
        body = {
            "session_id": "quick-desk-10",
            "completed_seconds": 300,
            "total_seconds": 600,
            "completed_poses": 4,
        }
        r = requests.post(f"{API}/yoga/log", json=body, headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["session_id"] == "quick-desk-10"
        assert d["completed_seconds"] == 300
        assert "logged_at" in d
        assert "_id" not in d  # Mongo ObjectId excluded
        assert d.get("session_title") and d.get("category")


# ---------- 6. Mine / stats ----------
class TestMine:
    def test_mine_fresh_patient_zero_stats(self, fresh_patient):
        r = requests.get(f"{API}/yoga/mine", headers=_auth(fresh_patient["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d == {"sessions": [], "streak_days": 0, "total_minutes": 0, "total_sessions": 0}

    def test_mine_after_single_log(self, fresh_patient):
        body = {
            "session_id": "pranayama-basics-15",
            "completed_seconds": 300,   # 5 min
            "total_seconds": 900,
            "completed_poses": 3,
        }
        r = requests.post(f"{API}/yoga/log", json=body, headers=_auth(fresh_patient["token"]), timeout=15)
        assert r.status_code == 200, r.text

        r = requests.get(f"{API}/yoga/mine", headers=_auth(fresh_patient["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["total_sessions"] == 1
        assert d["total_minutes"] == 5, f"expected 5 min (300s/60), got {d['total_minutes']}"
        assert d["streak_days"] == 1, f"today's log should give streak=1, got {d['streak_days']}"
        assert len(d["sessions"]) == 1
        assert d["sessions"][0]["session_id"] == "pranayama-basics-15"
        assert "_id" not in d["sessions"][0]
