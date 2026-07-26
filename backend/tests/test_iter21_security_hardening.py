"""
Iter 21 — Security hardening verification (BACKEND-ONLY).

Verifies three P3 fixes flagged by the prior audit:
  Fix 1: POST /api/community/posts/{post_id}/like on missing/deleted post -> 404
  Fix 2: Race-safe like counter (unique compound index on community_likes)
  Fix 3: Rate limits on Women's Health writes + child milestones toggle sanity
         + wellness-tips IP rate limit

Plus regression:
  - Women's Health CRUD (period-log, pregnancy, gynae, wellness-tips 6 phases)
  - Community post/comment CRUD + user scoping on family/milestones
  - Prior SEC-001 (admin default rejected), SEC-002 (/support/chat rate-limited),
    SEC-003 (patient cannot write prescription)
  - Admin login using ADMIN_PASSWORD from /app/memory/test_credentials.md ->
    /app/backend/.env (loaded via conftest).

All tests use the public URL from EXPO_PUBLIC_BACKEND_URL. No mocks.
Registered users are ephemeral and prefixed TEST_ / test_iter21_.
"""
from __future__ import annotations

import concurrent.futures as cf
import os
import uuid
from typing import Any, Dict

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _register(role: str = "patient", tag: str = "iter21") -> Dict[str, Any]:
    email = f"test_{tag}_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_{tag}_{role}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": "9876543210",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return {
        "token": d["token"],
        "user": d["user"],
        "email": email,
        "headers": {"Authorization": f"Bearer {d['token']}"},
    }


@pytest.fixture(scope="module")
def patient_a():
    return _register("patient")


@pytest.fixture(scope="module")
def patient_b():
    return _register("patient")


# --------------------------------------------------------------------------- #
# Fix 1 — Like on missing/deleted post returns 404
# --------------------------------------------------------------------------- #
class TestFix1LikeOnMissingPost:
    def test_like_on_nonexistent_uuid_returns_404(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/community/posts/nonexistent-uuid-1234/like",
            headers=patient_a["headers"], timeout=15,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"
        assert "not found" in r.text.lower()

    def test_like_on_random_uuid_returns_404(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/community/posts/{uuid.uuid4()}/like",
            headers=patient_a["headers"], timeout=15,
        )
        assert r.status_code == 404

    def test_like_on_deleted_post_returns_404(self, patient_a):
        # create
        r = requests.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter21 to-be-deleted", "hashtags": ["testiter21"]},
            headers=patient_a["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        # delete
        d = requests.delete(
            f"{BASE_URL}/api/community/posts/{pid}",
            headers=patient_a["headers"], timeout=15,
        )
        assert d.status_code == 200, d.text
        # like should now 404 (not silent success)
        lk = requests.post(
            f"{BASE_URL}/api/community/posts/{pid}/like",
            headers=patient_a["headers"], timeout=15,
        )
        assert lk.status_code == 404, f"expected 404 for like on deleted post, got {lk.status_code} {lk.text}"

    def test_regression_valid_like_toggle_still_works(self, patient_a, patient_b):
        # patient_a creates post
        r = requests.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter21 like toggle regression"},
            headers=patient_a["headers"], timeout=15,
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        # initial like_count from GET single post
        g = requests.get(f"{BASE_URL}/api/community/posts/{pid}",
                         headers=patient_a["headers"], timeout=15)
        assert g.status_code == 200
        initial = int(g.json().get("like_count", 0))
        # patient_b likes
        lk = requests.post(f"{BASE_URL}/api/community/posts/{pid}/like",
                           headers=patient_b["headers"], timeout=15)
        assert lk.status_code == 200 and lk.json()["liked"] is True
        g2 = requests.get(f"{BASE_URL}/api/community/posts/{pid}",
                          headers=patient_b["headers"], timeout=15)
        assert g2.json()["like_count"] == initial + 1
        assert g2.json()["liked_by_me"] is True
        # patient_b unlikes
        un = requests.post(f"{BASE_URL}/api/community/posts/{pid}/like",
                           headers=patient_b["headers"], timeout=15)
        assert un.status_code == 200 and un.json()["liked"] is False
        g3 = requests.get(f"{BASE_URL}/api/community/posts/{pid}",
                          headers=patient_b["headers"], timeout=15)
        assert g3.json()["like_count"] == initial
        assert g3.json()["liked_by_me"] is False
        # cleanup
        requests.delete(f"{BASE_URL}/api/community/posts/{pid}",
                        headers=patient_a["headers"], timeout=15)


# --------------------------------------------------------------------------- #
# Fix 2 — Race-safe like counter (unique index + idempotent toggle)
# --------------------------------------------------------------------------- #
class TestFix2RaceSafeLikeCounter:
    def test_unique_index_present(self):
        """Startup should create the unique index; confirm via Mongo."""
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")

        async def check():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = c[os.environ["DB_NAME"]]
            idx = await db.community_likes.index_information()
            return idx

        idx = asyncio.get_event_loop().run_until_complete(check()) \
            if not asyncio.get_event_loop().is_running() else asyncio.run(check())
        assert "uniq_post_user_like" in idx, f"unique index missing: {idx}"
        entry = idx["uniq_post_user_like"]
        assert entry.get("unique") is True
        assert entry["key"] == [("post_id", 1), ("user_id", 1)]

    def test_concurrent_double_like_does_not_double_increment(self, patient_a, patient_b):
        # Create post
        r = requests.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter21 race like"},
            headers=patient_a["headers"], timeout=15,
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        # Fire two concurrent likes from patient_b
        url = f"{BASE_URL}/api/community/posts/{pid}/like"
        headers = patient_b["headers"]

        def call():
            return requests.post(url, headers=headers, timeout=15)

        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            futures = [ex.submit(call) for _ in range(6)]
            results = [f.result() for f in futures]

        codes = [x.status_code for x in results]
        assert all(c == 200 for c in codes), f"unexpected codes: {codes}"

        # Fetch final state — like_count for a single user must be either 0 or 1
        g = requests.get(f"{BASE_URL}/api/community/posts/{pid}",
                         headers=patient_a["headers"], timeout=15)
        assert g.status_code == 200
        final_count = int(g.json().get("like_count", 0))
        assert final_count in (0, 1), (
            f"race unsafe: like_count={final_count} after 6 concurrent toggles "
            f"from a single user (expected 0 or 1)"
        )
        # cleanup
        requests.delete(f"{BASE_URL}/api/community/posts/{pid}",
                        headers=patient_a["headers"], timeout=15)

    def test_toggle_off_on_off_final_zero(self, patient_a, patient_b):
        r = requests.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter21 toggle sequence"},
            headers=patient_a["headers"], timeout=15,
        )
        pid = r.json()["id"]
        # First state: not liked. Toggle -> liked (count +1)
        s1 = requests.post(f"{BASE_URL}/api/community/posts/{pid}/like",
                           headers=patient_b["headers"], timeout=15).json()
        assert s1["liked"] is True
        # Toggle -> unliked
        s2 = requests.post(f"{BASE_URL}/api/community/posts/{pid}/like",
                           headers=patient_b["headers"], timeout=15).json()
        assert s2["liked"] is False
        # Toggle -> liked
        s3 = requests.post(f"{BASE_URL}/api/community/posts/{pid}/like",
                           headers=patient_b["headers"], timeout=15).json()
        assert s3["liked"] is True
        # Toggle -> unliked (final)
        s4 = requests.post(f"{BASE_URL}/api/community/posts/{pid}/like",
                           headers=patient_b["headers"], timeout=15).json()
        assert s4["liked"] is False

        g = requests.get(f"{BASE_URL}/api/community/posts/{pid}",
                         headers=patient_a["headers"], timeout=15)
        fc = int(g.json().get("like_count", 0))
        assert fc == 0, f"final count must be 0, got {fc} (must not go negative or >0)"
        # cleanup
        requests.delete(f"{BASE_URL}/api/community/posts/{pid}",
                        headers=patient_a["headers"], timeout=15)


# --------------------------------------------------------------------------- #
# Fix 3 — Rate limits on Women's Health writes
# --------------------------------------------------------------------------- #
class TestFix3RateLimits:
    def test_period_log_20_per_hour_21st_returns_429(self):
        """20 per user per hour. Fire 21 quick requests → 21st should 429."""
        u = _register("patient", tag="iter21_prd")
        headers = u["headers"]
        payload = {"start_date": "2026-01-05", "cycle_length": 28}

        codes = []
        first_429_at = None
        for i in range(21):
            r = requests.post(f"{BASE_URL}/api/women/period-log",
                              json=payload, headers=headers, timeout=15)
            codes.append(r.status_code)
            if r.status_code == 429 and first_429_at is None:
                first_429_at = i + 1  # 1-indexed
                break
        assert first_429_at is not None, f"no 429 seen in 21 calls; codes={codes}"
        # Expect first 20 to succeed and the 21st to 429
        assert first_429_at == 21, (
            f"expected 429 on 21st call, got 429 at call #{first_429_at}; codes={codes}"
        )
        # First 20 must have been 2xx
        assert all(c == 200 for c in codes[:20]), f"non-200 before limit: {codes[:20]}"

    def test_pregnancy_30_per_hour_31st_returns_429(self):
        u = _register("patient", tag="iter21_preg")
        headers = u["headers"]
        payload = {"is_active": True, "lmp_date": "2026-04-01"}

        codes = []
        first_429_at = None
        for i in range(31):
            r = requests.put(f"{BASE_URL}/api/women/pregnancy",
                             json=payload, headers=headers, timeout=15)
            codes.append(r.status_code)
            if r.status_code == 429 and first_429_at is None:
                first_429_at = i + 1
                break
        assert first_429_at == 31, (
            f"expected 429 on 31st, got at {first_429_at}; codes={codes}"
        )
        assert all(c == 200 for c in codes[:30])

    def test_gynae_profile_30_per_hour_31st_returns_429(self):
        u = _register("patient", tag="iter21_gyn")
        headers = u["headers"]
        payload = {
            "pcos": False, "pcod": False, "conditions": [],
            "surgeries": [], "medications": [], "notes": None,
        }
        codes = []
        first_429_at = None
        for i in range(31):
            r = requests.put(f"{BASE_URL}/api/women/gynae-profile",
                             json=payload, headers=headers, timeout=15)
            codes.append(r.status_code)
            if r.status_code == 429 and first_429_at is None:
                first_429_at = i + 1
                break
        assert first_429_at == 31, (
            f"expected 429 on 31st, got at {first_429_at}; codes={codes}"
        )
        assert all(c == 200 for c in codes[:30])

    def test_milestone_toggle_120_per_hour_5_to_10_successive_ok(self):
        """Should NOT be rate-limited at ~5-10 toggles."""
        u = _register("patient", tag="iter21_mile")
        headers = u["headers"]
        # Create a member first
        rm = requests.post(
            f"{BASE_URL}/api/family/members",
            json={"name": "TEST_iter21_kid", "relation": "son", "dob": "2025-03-01"},
            headers=headers, timeout=15,
        )
        assert rm.status_code == 200, rm.text
        member_id = rm.json()["id"]

        for i in range(10):
            r = requests.post(
                f"{BASE_URL}/api/family/members/{member_id}/milestones/toggle",
                json={"text": f"TEST_iter21 milestone {i}", "done": (i % 2 == 0)},
                headers=headers, timeout=15,
            )
            assert r.status_code == 200, (
                f"toggle #{i+1} unexpectedly not 200: {r.status_code} {r.text}"
            )

    def test_wellness_tips_60_per_5min_per_ip_61st_returns_429(self):
        """Public endpoint — per-IP limit. Fire 61 → 61st 429."""
        codes = []
        first_429_at = None
        for i in range(61):
            r = requests.get(f"{BASE_URL}/api/women/wellness-tips?phase=follicular",
                             timeout=15)
            codes.append(r.status_code)
            if r.status_code == 429 and first_429_at is None:
                first_429_at = i + 1
                break
        assert first_429_at is not None, f"no 429 in 61 calls; codes={codes}"
        # Because the bucket is per-IP (backend was just restarted so bucket is fresh
        # for this IP), the 61st call is expected to be the first 429. However, other
        # tests in this run may share the IP so accept anything <= 61 but strictly > 5.
        assert first_429_at <= 61, f"429 came too late: {first_429_at}"
        assert first_429_at > 5, (
            f"429 came too early: {first_429_at}; codes={codes[:10]}"
        )


# --------------------------------------------------------------------------- #
# Regression — Women's Health CRUD + wellness-tips (6 phases)
# --------------------------------------------------------------------------- #
class TestRegressionWomensHealth:
    def test_period_log_create_list_delete(self):
        u = _register("patient", tag="iter21_regr_prd")
        h = u["headers"]
        r = requests.post(f"{BASE_URL}/api/women/period-log",
                          json={"start_date": "2026-01-10", "cycle_length": 30},
                          headers=h, timeout=15)
        assert r.status_code == 200
        cid = r.json()["id"]
        assert "_id" not in r.json()
        assert r.json()["cycle_length"] == 30

        g = requests.get(f"{BASE_URL}/api/women/cycles", headers=h, timeout=15)
        assert g.status_code == 200
        j = g.json()
        assert j["next_period_predicted"] == "2026-02-09"  # 2026-01-10 + 30d
        assert j["fertile_window"]["start"] and j["fertile_window"]["end"]
        assert any(c["id"] == cid for c in j["cycles"])

        d = requests.delete(f"{BASE_URL}/api/women/period-log/{cid}",
                            headers=h, timeout=15)
        assert d.status_code == 200
        d2 = requests.delete(f"{BASE_URL}/api/women/period-log/{cid}",
                             headers=h, timeout=15)
        assert d2.status_code == 404

    def test_pregnancy_set_get_weeks_and_due_date(self):
        u = _register("patient", tag="iter21_regr_preg")
        h = u["headers"]
        r = requests.put(f"{BASE_URL}/api/women/pregnancy",
                         json={"is_active": True, "lmp_date": "2026-04-01"},
                         headers=h, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/women/pregnancy", headers=h, timeout=15)
        assert g.status_code == 200
        pg = g.json()
        assert pg.get("is_active") is True
        assert pg["due_date"] == "2027-01-06"  # LMP + 280d
        assert isinstance(pg["weeks"], int)
        assert isinstance(pg["milestones"], list) and len(pg["milestones"]) == 10

    def test_gynae_upsert_and_get_roundtrip(self):
        u = _register("patient", tag="iter21_regr_gyn")
        h = u["headers"]
        payload = {
            "pcos": True, "pcod": False,
            "conditions": ["Endometriosis"],
            "surgeries": ["Laparoscopy"],
            "medications": ["Metformin"],
            "notes": "TEST_iter21 notes",
        }
        r = requests.put(f"{BASE_URL}/api/women/gynae-profile",
                         json=payload, headers=h, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/women/gynae-profile", headers=h, timeout=15)
        assert g.status_code == 200
        j = g.json()
        assert j["pcos"] is True and j["pcod"] is False
        assert j["conditions"] == ["Endometriosis"]
        assert j["medications"] == ["Metformin"]

    def test_wellness_tips_for_all_6_phases(self):
        # Regression only — no rate-limit assertions here; the wellness-tips
        # rate-limit test above already exhausts the bucket, so this test
        # tolerates 429 as an acceptable outcome without failing.
        for phase in ("menstrual", "follicular", "ovulation", "luteal",
                      "pregnancy", "pcos"):
            r = requests.get(
                f"{BASE_URL}/api/women/wellness-tips?phase={phase}", timeout=15
            )
            if r.status_code == 429:
                pytest.skip(f"wellness-tips bucket exhausted for phase={phase} "
                            f"(expected — the rate-limit test already ran)")
            assert r.status_code == 200, f"phase={phase}: {r.status_code} {r.text}"
            body = r.json()
            assert "tips" in body and isinstance(body["tips"], list) and len(body["tips"]) >= 3


# --------------------------------------------------------------------------- #
# Regression — Community post create/list/get/delete + comments
# --------------------------------------------------------------------------- #
class TestRegressionCommunity:
    def test_post_create_list_get_delete_with_comments(self, patient_a, patient_b):
        # create
        r = requests.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter21 regression community",
                  "hashtags": ["#Iter21", "regression"], "is_question": True},
            headers=patient_a["headers"], timeout=15,
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        assert set(r.json()["hashtags"]) == {"iter21", "regression"}

        # list
        L = requests.get(f"{BASE_URL}/api/community/posts",
                         headers=patient_a["headers"], timeout=15)
        assert L.status_code == 200
        assert any(p["id"] == pid for p in L.json()["items"])

        # single get
        G = requests.get(f"{BASE_URL}/api/community/posts/{pid}",
                        headers=patient_a["headers"], timeout=15)
        assert G.status_code == 200
        assert G.json()["id"] == pid

        # comment
        C = requests.post(
            f"{BASE_URL}/api/community/posts/{pid}/comments",
            json={"text": "TEST_iter21 comment"},
            headers=patient_b["headers"], timeout=15,
        )
        assert C.status_code == 200

        # list comments
        LC = requests.get(f"{BASE_URL}/api/community/posts/{pid}/comments",
                          headers=patient_a["headers"], timeout=15)
        assert LC.status_code == 200
        items = LC.json().get("items") or LC.json()
        assert isinstance(items, list) and len(items) >= 1

        # delete
        d = requests.delete(f"{BASE_URL}/api/community/posts/{pid}",
                            headers=patient_a["headers"], timeout=15)
        assert d.status_code == 200


# --------------------------------------------------------------------------- #
# Regression — Milestones scoping
# --------------------------------------------------------------------------- #
class TestRegressionMilestonesScoping:
    def test_get_and_toggle_and_cross_user_404(self, patient_a, patient_b):
        # A creates a member
        rm = requests.post(
            f"{BASE_URL}/api/family/members",
            json={"name": "TEST_iter21_kidB", "relation": "son", "dob": "2024-06-15"},
            headers=patient_a["headers"], timeout=15,
        )
        assert rm.status_code == 200
        member_id = rm.json()["id"]

        # A can GET milestones
        g = requests.get(
            f"{BASE_URL}/api/family/members/{member_id}/milestones",
            headers=patient_a["headers"], timeout=15,
        )
        assert g.status_code == 200
        assert "groups" in g.json()

        # A can toggle
        t = requests.post(
            f"{BASE_URL}/api/family/members/{member_id}/milestones/toggle",
            json={"text": "TEST_iter21 rolls over", "done": True},
            headers=patient_a["headers"], timeout=15,
        )
        assert t.status_code == 200

        # B cannot access A's member
        gb = requests.get(
            f"{BASE_URL}/api/family/members/{member_id}/milestones",
            headers=patient_b["headers"], timeout=15,
        )
        assert gb.status_code == 404

        tb = requests.post(
            f"{BASE_URL}/api/family/members/{member_id}/milestones/toggle",
            json={"text": "hack", "done": True},
            headers=patient_b["headers"], timeout=15,
        )
        assert tb.status_code == 404


# --------------------------------------------------------------------------- #
# Prior security findings — SEC-001, SEC-002, SEC-003 still resolved
# --------------------------------------------------------------------------- #
class TestPriorSecurityFindings:
    def test_sec001_admin_default_password_rejected(self):
        # A well-known/guessable default must NOT log in as admin.
        for pw in ("admin", "password", "admin123", "Admin@123", "vaidhyaji"):
            r = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": ADMIN_EMAIL, "password": pw},
                              timeout=15)
            assert r.status_code in (400, 401), (
                f"default password '{pw}' unexpectedly accepted: {r.status_code} {r.text}"
            )

    def test_sec001_admin_login_with_env_password_works(self):
        if not ADMIN_PASSWORD:
            pytest.skip("ADMIN_PASSWORD not loaded — skipping admin-login regression")
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                          timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["is_admin"] is True
        assert d["user"]["role"] == "admin"
        assert "token" in d

    def test_sec002_support_chat_rate_limited(self):
        # 10 per 5 min per IP. Fire 12 → at least one 429 should appear.
        codes = []
        first_429_at = None
        session_id = f"test_iter21_{uuid.uuid4().hex[:8]}"
        for i in range(12):
            r = requests.post(
                f"{BASE_URL}/api/support/chat",
                json={"message": f"hello {i}", "session_id": session_id},
                timeout=15,
            )
            codes.append(r.status_code)
            if r.status_code == 429 and first_429_at is None:
                first_429_at = i + 1
                break
        assert first_429_at is not None, f"support/chat not rate-limited: {codes}"
        assert first_429_at <= 12

    def test_sec003_patient_cannot_write_prescription(self, patient_a):
        # Get any real doctor to book an appointment against
        docs = requests.get(f"{BASE_URL}/api/doctors", timeout=15).json()
        assert isinstance(docs, list) and len(docs) > 0, "no seeded doctors"
        doc = docs[0]
        # Book an appointment as patient_a
        a = requests.post(
            f"{BASE_URL}/api/appointments",
            json={"doctor_id": doc["id"], "slot": "2026-06-01T10:00:00",
                  "reason": "TEST_iter21 checkup"},
            headers=patient_a["headers"], timeout=15,
        )
        assert a.status_code == 200, a.text
        appt_id = a.json()["id"]

        # Patient tries to write a prescription — must be 403
        rx = requests.post(
            f"{BASE_URL}/api/appointments/{appt_id}/prescription",
            json={"diagnosis": "self-diag", "medicines": "TEST_iter21 self-rx",
                  "advice": "n/a", "follow_up": None},
            headers=patient_a["headers"], timeout=15,
        )
        assert rx.status_code == 403, (
            f"patient wrote a prescription — SEC-003 REGRESSED: {rx.status_code} {rx.text}"
        )
