"""
Iteration 32 — Focused retest of the two Phase 1b CRITICAL bugs reported in iter31.

Bug 1  (GET /api/admin/presales/leads)
  Legacy rows with tz-aware `created_at` (e.g. '2026-01-01T00:00:00+00:00') caused
  a 500 TypeError: can't subtract offset-naive and offset-aware datetimes.
  Fix must make the endpoint return 200 for such rows AND still expose sla_breached=True
  for a lead older than CALLBACK_SLA_MINUTES.

Bug 2  (PATCH /api/admin/presales/leads/{id}/status  with body.status='consult_done')
  a) find_one projection dropped user_id, so `lead.get('user_id')` was always None.
  b) A fallback `db.users.update_one({}, {...})` matched ALL users and silently
     corrupted an arbitrary user record.
  Fix must:
    - When lead HAS user_id: only that user's free_consult_used flips True.
    - When lead HAS NO user_id: NO other user document is mutated.
  In BOTH scenarios a canary user (distinctive email) must remain untouched.

Regression re-run: /api/documents/upload, /api/documents/mine,
/api/admin/documents/pending, /api/admin/documents/{id}/review.
"""
from __future__ import annotations

import io
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import pytest
import requests
from pymongo import MongoClient

# ── Mongo (direct) for seeding legacy rows + assertions ───────────
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
_mc = MongoClient(MONGO_URL)
_db = _mc[DB_NAME]

BLOOD = "blood_test"
CANARY_TAG = "TEST_CANARY_iter32"


# ── Payload helpers ───────────────────────────────────────────────
def _make_jpg_bytes() -> bytes:
    try:
        from PIL import Image
    except Exception:
        pytest.skip("Pillow not installed — cannot generate JPEG payload")
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color=(80, 160, 220)).save(buf, format="JPEG", quality=70)
    return buf.getvalue()


_JPG_BYTES = _make_jpg_bytes()


def _rand_phone() -> str:
    import random
    return random.choice("6789") + "".join(random.choices("0123456789", k=9))


def _register(base_url: str, role: str = "patient", email_prefix: str = "test") -> Dict[str, Any]:
    email = f"{email_prefix}_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_{role.capitalize()}_{uuid.uuid4().hex[:6]}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": _rand_phone(),
    }
    r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register {role} failed: {r.status_code} {r.text}"
    d = r.json()
    return {
        "token": d["token"],
        "user": d["user"],
        "email": payload["email"],
        "headers": {"Authorization": f"Bearer {d['token']}"},
    }


def _admin_login(base_url: str) -> Dict[str, Any]:
    email = os.environ["ADMIN_EMAIL"]
    pwd = os.environ["ADMIN_PASSWORD"]
    r = requests.post(f"{base_url}/api/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d["token"], "headers": {"Authorization": f"Bearer {d['token']}"}, "user": d["user"]}


# ── Fixtures ──────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def admin_ctx(base_url):
    return _admin_login(base_url)


@pytest.fixture(scope="module")
def linked_user(base_url):
    """A real user we intentionally link to a lead → consult_done should flip THIS user only."""
    ctx = _register(base_url, "patient", email_prefix="linked")
    yield ctx
    _db.presales_leads.delete_many({"user_id": ctx["user"]["id"]})
    _db.users.delete_many({"id": ctx["user"]["id"]})


@pytest.fixture(scope="module")
def canary_user(base_url):
    """
    Canary — MUST remain untouched after any consult_done PATCH.
    The empty-filter bug (Bug #2) previously mutated whichever user Mongo returned first,
    so we register the canary EARLY (before other test users) to maximize the chance it
    would have been the victim under the old buggy code.
    """
    email = f"canary_iter32_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com"
    payload = {
        "name": CANARY_TAG,
        "email": email,
        "password": "Passw0rd!123",
        "role": "patient",
        "phone": _rand_phone(),
    }
    r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"canary register failed: {r.text}"
    d = r.json()
    ctx = {"token": d["token"], "user": d["user"], "email": email,
           "headers": {"Authorization": f"Bearer {d['token']}"}}
    # Sanity: fresh users should have free_consult_used=False (or absent)
    doc = _db.users.find_one({"id": ctx["user"]["id"]}, {"_id": 0})
    assert doc is not None, "canary user not in DB after register"
    yield ctx
    _db.users.delete_many({"id": ctx["user"]["id"]})


def _canary_still_pristine(canary_user_id: str) -> Dict[str, Any]:
    """Return the canary doc and assert its consult flags are untouched."""
    doc = _db.users.find_one({"id": canary_user_id}, {"_id": 0})
    assert doc is not None, "canary user disappeared from DB"
    # free_consult_used may be absent (default False) OR explicitly False
    assert doc.get("free_consult_used", False) is False, (
        f"CANARY CORRUPTED: free_consult_used={doc.get('free_consult_used')!r}"
    )
    # free_consult_available may be absent (default True) OR explicitly True
    assert doc.get("free_consult_available", True) is True, (
        f"CANARY CORRUPTED: free_consult_available={doc.get('free_consult_available')!r}"
    )
    return doc


# ══════════════════════════ BUG 1: TZ-MISMATCH ═════════════════════
class TestBug1_TzAwareListing:
    """Regression for the tz-aware/naive datetime subtraction 500."""

    def test_list_leads_200_with_tz_aware_legacy_row(self, base_url, admin_ctx):
        """Insert a legacy-style row with tz-aware +00:00 offset — endpoint MUST return 200."""
        lid = f"tz_legacy_{uuid.uuid4().hex}"
        legacy_ts = "2026-01-01T00:00:00+00:00"  # tz-AWARE, no 'Z'
        _db.presales_leads.insert_one({
            "id": lid, "user_id": None,
            "name": "TEST_TZ_LEGACY", "phone": "9876500111",
            "email": None,
            "status": "not_contacted",
            "status_history": [{"status": "not_contacted", "timestamp": legacy_ts}],
            "documents_uploaded": 0,
            "created_at": legacy_ts, "updated_at": legacy_ts,
            "_test_": True,
        })
        try:
            r = requests.get(f"{base_url}/api/admin/presales/leads",
                             headers=admin_ctx["headers"], timeout=30)
            assert r.status_code == 200, (
                f"BUG #1 still present — legacy tz-aware row causes {r.status_code}: {r.text[:400]}"
            )
            body = r.json()
            assert "items" in body and isinstance(body["items"], list)
            assert "stats" in body and isinstance(body["stats"], dict)
            match = next((it for it in body["items"] if it.get("id") == lid), None)
            assert match is not None, "seeded tz-aware lead not returned"
            # Row must have sla_breached (bool) — very old row that's still not_contacted
            assert isinstance(match["sla_breached"], bool)
            assert match["sla_breached"] is True, "20-day-old not_contacted lead should breach SLA"
        finally:
            _db.presales_leads.delete_one({"id": lid})

    def test_sla_breach_flag_after_20_minutes(self, base_url, admin_ctx):
        """Fresh lead created 20 min ago with tz-naive Z timestamp → sla_breached True."""
        lid = f"sla_{uuid.uuid4().hex}"
        old_z = (datetime.utcnow() - timedelta(minutes=20)).isoformat() + "Z"
        _db.presales_leads.insert_one({
            "id": lid, "user_id": None,
            "name": "TEST_SLA_iter32", "phone": "9876500222",
            "status": "not_contacted",
            "status_history": [{"status": "not_contacted", "timestamp": old_z}],
            "documents_uploaded": 0,
            "created_at": old_z, "updated_at": old_z,
            "_test_": True,
        })
        try:
            r = requests.get(f"{base_url}/api/admin/presales/leads?status=not_contacted",
                             headers=admin_ctx["headers"], timeout=30)
            assert r.status_code == 200, r.text[:300]
            match = next((it for it in r.json()["items"] if it.get("id") == lid), None)
            assert match is not None, "seeded SLA lead not returned"
            assert match["sla_breached"] is True
            assert match["age_seconds"] > 600
            assert match["tel_link"] == "tel:9876500222"
        finally:
            _db.presales_leads.delete_one({"id": lid})

    def test_stats_shape_and_sla_minutes(self, base_url, admin_ctx):
        r = requests.get(f"{base_url}/api/admin/presales/leads",
                         headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text[:300]
        s = r.json()["stats"]
        for k in ("today_signups", "pending_calls", "consults_booked_today",
                  "pending_documents", "sla_minutes"):
            assert k in s, f"missing stat {k}"
        assert s["sla_minutes"] == 10


# ══════════════════════════ BUG 2: EMPTY-FILTER USER CORRUPTION ═════
class TestBug2_ConsultDoneEmptyFilter:
    """Regression for the empty-filter user corruption."""

    def test_status_history_appends_not_replaces(self, base_url, admin_ctx, linked_user):
        """PATCH transitions push new entries onto status_history (1 more per call)."""
        lid = f"hist_{uuid.uuid4().hex}"
        _db.presales_leads.insert_one({
            "id": lid, "user_id": linked_user["user"]["id"],
            "name": "TEST_HIST", "phone": "9800000123",
            "email": linked_user["email"],
            "status": "not_contacted",
            "status_history": [{"status": "not_contacted",
                                "timestamp": datetime.utcnow().isoformat() + "Z"}],
            "created_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "_test_": True,
        })
        try:
            before = len(_db.presales_leads.find_one({"id": lid})["status_history"])
            for status in ("contacted", "consult_booked"):
                r = requests.patch(
                    f"{base_url}/api/admin/presales/leads/{lid}/status",
                    headers={**admin_ctx["headers"], "Content-Type": "application/json"},
                    json={"status": status, "note": f"TEST_{status}"},
                    timeout=30,
                )
                assert r.status_code == 200, f"{status}: {r.status_code} {r.text}"
            after = _db.presales_leads.find_one({"id": lid})["status_history"]
            assert len(after) == before + 2, (
                f"status_history should grow by 2, got {before}→{len(after)}"
            )
            assert [h["status"] for h in after][-2:] == ["contacted", "consult_booked"]
        finally:
            _db.presales_leads.delete_one({"id": lid})

    def test_consult_done_with_user_id_flips_only_that_user(
        self, base_url, admin_ctx, linked_user, canary_user
    ):
        """
        Positive path — lead HAS user_id.
        Only the linked user's free_consult_used flips True. Canary is untouched.
        """
        # Sanity — canary is pristine BEFORE the PATCH
        _canary_still_pristine(canary_user["user"]["id"])

        lid = f"linked_{uuid.uuid4().hex}"
        _db.presales_leads.insert_one({
            "id": lid, "user_id": linked_user["user"]["id"],
            "name": "TEST_CONSULT_LINKED", "phone": "9800000456",
            "email": linked_user["email"],
            "status": "consult_booked",
            "status_history": [{"status": "consult_booked",
                                "timestamp": datetime.utcnow().isoformat() + "Z"}],
            "created_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "_test_": True,
        })
        try:
            r = requests.patch(
                f"{base_url}/api/admin/presales/leads/{lid}/status",
                headers={**admin_ctx["headers"], "Content-Type": "application/json"},
                json={"status": "consult_done", "note": "TEST_consult_done_linked"},
                timeout=30,
            )
            assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"

            # Linked user MUST have free_consult_used=True and available=False
            linked_doc = _db.users.find_one({"id": linked_user["user"]["id"]}, {"_id": 0})
            assert linked_doc.get("free_consult_used") is True, (
                f"linked user free_consult_used should be True, got {linked_doc.get('free_consult_used')!r}"
            )
            assert linked_doc.get("free_consult_available") is False, (
                f"linked user free_consult_available should be False, got {linked_doc.get('free_consult_available')!r}"
            )

            # Lead itself gets free_consult_available=False + status consult_done
            lead = _db.presales_leads.find_one({"id": lid}, {"_id": 0})
            assert lead["status"] == "consult_done"
            assert lead.get("free_consult_available") is False

            # Canary UNTOUCHED
            _canary_still_pristine(canary_user["user"]["id"])
        finally:
            _db.presales_leads.delete_one({"id": lid})

    def test_consult_done_without_user_id_does_not_mutate_any_user(
        self, base_url, admin_ctx, canary_user
    ):
        """
        Core Bug #2 proof — lead has NO user_id (missing/None).
        The endpoint MUST NOT call db.users.update_one({}, ...).
        Assertion: earliest-created OTHER user in the collection still has
        free_consult_available=True and free_consult_used=False.
        Canary is also untouched.
        """
        # Snapshot canary state BEFORE
        _canary_still_pristine(canary_user["user"]["id"])

        # Find the earliest-created *other* user in the collection.
        # Under the old bug, update_one({}, ...) would have hit whichever user Mongo returned
        # first (often the oldest). We assert that user is still pristine after PATCH.
        earliest_other = _db.users.find_one(
            {"id": {"$ne": canary_user["user"]["id"]},
             "free_consult_used": {"$ne": True}},
            sort=[("created_at", 1)],
            projection={"_id": 0, "id": 1, "email": 1, "free_consult_used": 1,
                        "free_consult_available": 1, "created_at": 1},
        )
        # It's OK if this is None (empty DB) — we still assert canary is safe.
        earliest_snapshot_before = dict(earliest_other) if earliest_other else None

        lid = f"nolink_{uuid.uuid4().hex}"
        _db.presales_leads.insert_one({
            "id": lid,  # NO user_id key at all → this is the empty-filter trigger
            "name": "TEST_CONSULT_NOLINK", "phone": "9800000789",
            "email": None,
            "status": "consult_booked",
            "status_history": [{"status": "consult_booked",
                                "timestamp": datetime.utcnow().isoformat() + "Z"}],
            "created_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "_test_": True,
        })
        try:
            r = requests.patch(
                f"{base_url}/api/admin/presales/leads/{lid}/status",
                headers={**admin_ctx["headers"], "Content-Type": "application/json"},
                json={"status": "consult_done", "note": "TEST_no_user_id"},
                timeout=30,
            )
            assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"

            # Lead itself must be updated normally
            lead = _db.presales_leads.find_one({"id": lid}, {"_id": 0})
            assert lead["status"] == "consult_done"
            assert lead.get("free_consult_available") is False
            # status_history got the new entry
            assert lead["status_history"][-1]["status"] == "consult_done"

            # ---- The critical assertions ----
            # 1) Canary is still untouched.
            _canary_still_pristine(canary_user["user"]["id"])

            # 2) The earliest-created OTHER user we snapshotted is still pristine.
            if earliest_snapshot_before is not None:
                after_doc = _db.users.find_one(
                    {"id": earliest_snapshot_before["id"]},
                    {"_id": 0, "id": 1, "free_consult_used": 1, "free_consult_available": 1},
                )
                assert after_doc is not None, "earliest-other user vanished"
                assert after_doc.get("free_consult_used", False) is False, (
                    f"BUG #2 STILL PRESENT: earliest user {after_doc['id']} was mutated! "
                    f"free_consult_used={after_doc.get('free_consult_used')!r} "
                    f"(before={earliest_snapshot_before.get('free_consult_used')!r})"
                )
                assert after_doc.get("free_consult_available", True) is True, (
                    f"BUG #2 STILL PRESENT: earliest user {after_doc['id']} free_consult_available "
                    f"={after_doc.get('free_consult_available')!r} "
                    f"(before={earliest_snapshot_before.get('free_consult_available')!r})"
                )
        finally:
            _db.presales_leads.delete_one({"id": lid})

    def test_consult_done_with_null_user_id_also_safe(
        self, base_url, admin_ctx, canary_user
    ):
        """Same as above but user_id is explicitly None (not missing)."""
        _canary_still_pristine(canary_user["user"]["id"])
        lid = f"nulluid_{uuid.uuid4().hex}"
        _db.presales_leads.insert_one({
            "id": lid, "user_id": None,   # explicit None
            "name": "TEST_CONSULT_NULLUID", "phone": "9800000790",
            "email": None,
            "status": "consult_booked",
            "status_history": [{"status": "consult_booked",
                                "timestamp": datetime.utcnow().isoformat() + "Z"}],
            "created_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "_test_": True,
        })
        try:
            r = requests.patch(
                f"{base_url}/api/admin/presales/leads/{lid}/status",
                headers={**admin_ctx["headers"], "Content-Type": "application/json"},
                json={"status": "consult_done"},
                timeout=30,
            )
            assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"
            _canary_still_pristine(canary_user["user"]["id"])
        finally:
            _db.presales_leads.delete_one({"id": lid})


# ══════════════════════════ REGRESSION: DOCUMENTS ══════════════════
class TestRegressionDocuments:
    """Ensure the document endpoints still work after the presales fixes landed."""

    @pytest.fixture(scope="class")
    def patient(self, base_url):
        ctx = _register(base_url, "patient", email_prefix="doc_reg")
        # Seed a presales lead so upload documents_uploaded inc has a target
        _db.presales_leads.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": ctx["user"]["id"],
            "name": ctx["user"]["name"],
            "phone": ctx["user"].get("phone"),
            "email": ctx["email"],
            "status": "not_contacted",
            "status_history": [{"status": "not_contacted",
                                "timestamp": datetime.utcnow().isoformat() + "Z"}],
            "documents_uploaded": 0,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "_test_": True,
        })
        yield ctx
        _db.presales_leads.delete_many({"user_id": ctx["user"]["id"]})
        _db.health_documents.delete_many({"user_id": ctx["user"]["id"]})
        _db.users.delete_many({"id": ctx["user"]["id"]})

    def test_upload_and_mine(self, base_url, patient):
        files = {"file": ("regression.jpg", _JPG_BYTES, "image/jpeg")}
        data = {"doc_type": BLOOD, "user_note": "TEST_regression"}
        r = requests.post(f"{base_url}/api/documents/upload",
                          headers=patient["headers"], files=files, data=data, timeout=120)
        if r.status_code >= 500:
            time.sleep(2)
            r = requests.post(f"{base_url}/api/documents/upload",
                              headers=patient["headers"], files=files, data=data, timeout=120)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:400]}"
        doc = r.json()
        assert "id" in doc and doc.get("doc_type") == BLOOD
        did = doc["id"]

        # /api/documents/mine
        r2 = requests.get(f"{base_url}/api/documents/mine",
                          headers=patient["headers"], timeout=30)
        assert r2.status_code == 200, r2.text[:200]
        payload = r2.json()
        items = payload.get("items", payload) if isinstance(payload, dict) else payload
        assert any(it.get("id") == did for it in items), "just-uploaded doc missing from /mine"

    def test_admin_pending_and_review_reupload(self, base_url, admin_ctx, patient):
        # Fresh upload (isolated from previous test)
        files = {"file": ("regression2.jpg", _JPG_BYTES, "image/jpeg")}
        data = {"doc_type": BLOOD}
        r = requests.post(f"{base_url}/api/documents/upload",
                          headers=patient["headers"], files=files, data=data, timeout=120)
        assert r.status_code == 200, r.text[:400]
        did = r.json()["id"]

        # /api/admin/documents/pending should list it
        rp = requests.get(f"{base_url}/api/admin/documents/pending",
                          headers=admin_ctx["headers"], timeout=30)
        assert rp.status_code == 200, rp.text[:200]
        items = rp.json()["items"]
        assert any(it.get("id") == did for it in items), "uploaded doc not in pending queue"

        # Review → reupload
        rr = requests.patch(
            f"{base_url}/api/admin/documents/{did}/review",
            headers={**admin_ctx["headers"], "Content-Type": "application/json"},
            json={"decision": "reupload", "review_note": "TEST_iter32_retake"},
            timeout=30,
        )
        assert rr.status_code == 200, rr.text[:200]
        assert rr.json().get("status") == "reupload_requested"
