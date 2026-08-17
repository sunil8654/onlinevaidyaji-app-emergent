"""
Iteration 31 — Health Documents Upload (Emergent Object Storage) +
Pre-Sales Admin Queue with SLA (server.py block starting near line 6265).

Endpoints under test
-  POST   /api/documents/upload                (multipart)
-  GET    /api/documents/mine
-  GET    /api/documents/{id}
-  DELETE /api/documents/{id}
-  GET    /api/files/{doc_id}                  (Bearer OR ?token=)
-  GET    /api/admin/presales/leads            (SLA breach flag)
-  PATCH  /api/admin/presales/leads/{id}/status
-  GET    /api/admin/presales/leads.csv
-  GET    /api/admin/documents/pending
-  PATCH  /api/admin/documents/{id}/review
-  Regression: /api/auth/login, /api/admin/patients, /api/admin/doctors, /api/quiz/submit

BASE_URL comes from EXPO_PUBLIC_BACKEND_URL via conftest.
Uploads use raw `requests.post` (NOT the JSON-headers session in conftest).
"""
from __future__ import annotations

import io
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

import pytest
import requests
from pymongo import MongoClient

# ── Test constants ────────────────────────────────────────────────
MOCK_OTP = "123456"
BLOOD = "blood_test"


def _make_jpg_bytes() -> bytes:
    """Build a real ~2 KB JPEG using PIL so backend sees a valid image/jpeg body."""
    try:
        from PIL import Image
    except Exception:
        pytest.skip("Pillow not installed — cannot generate JPEG payload")
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color=(200, 120, 40)).save(buf, format="JPEG", quality=70)
    return buf.getvalue()


_JPG_BYTES = _make_jpg_bytes()

# ── Direct Mongo connection (needed for SLA breach fixture) ───────
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
_mc = MongoClient(MONGO_URL)
_db = _mc[DB_NAME]


# ── Helpers ───────────────────────────────────────────────────────
def _rand_phone() -> str:
    import random
    return random.choice("6789") + "".join(random.choices("0123456789", k=9))


def _register(base_url: str, role: str = "patient") -> Dict[str, Any]:
    """Register a fresh patient/doctor via /api/auth/register (returns token+user)."""
    email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_{role.capitalize()}_{uuid.uuid4().hex[:6]}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": _rand_phone(),
    }
    r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register {role} failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "email": payload["email"],
        "password": payload["password"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


def _admin_login(base_url: str) -> Dict[str, Any]:
    email = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
    pwd = os.environ.get("ADMIN_PASSWORD", "")
    assert pwd, "ADMIN_PASSWORD not set — cannot run admin tests"
    r = requests.post(f"{base_url}/api/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["token"], "headers": {"Authorization": f"Bearer {data['token']}"}, "user": data["user"]}


def _upload(base_url: str, headers: Dict[str, str], *,
            filename: str = "report.jpg",
            content: bytes = _JPG_BYTES,
            mime: str = "image/jpeg",
            doc_type: str = BLOOD,
            user_note: Optional[str] = "TEST_note",
            retry_on_500: bool = True) -> requests.Response:
    files = {"file": (filename, content, mime)}
    data: Dict[str, str] = {"doc_type": doc_type}
    if user_note is not None:
        data["user_note"] = user_note
    r = requests.post(f"{base_url}/api/documents/upload",
                      headers=headers, files=files, data=data, timeout=120)
    if r.status_code >= 500 and retry_on_500:
        time.sleep(2)
        r = requests.post(f"{base_url}/api/documents/upload",
                          headers=headers, files=files, data=data, timeout=120)
    return r


# ══════════════════════════ Fixtures ══════════════════════════════
@pytest.fixture(scope="module")
def patient_a(base_url):
    ctx = _register(base_url, "patient")
    # Seed a presales_lead for this user so upload counter/inc + admin queue work.
    _db.presales_leads.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": ctx["user"]["id"],
        "name": ctx["user"]["name"],
        "phone": ctx["user"].get("phone"),
        "email": ctx["email"],
        "status": "not_contacted",
        "status_history": [{"status": "not_contacted", "timestamp": datetime.utcnow().isoformat() + "Z"}],
        "documents_uploaded": 0,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "_test_": True,
    })
    yield ctx
    # cleanup
    _db.presales_leads.delete_many({"user_id": ctx["user"]["id"]})
    _db.health_documents.delete_many({"user_id": ctx["user"]["id"]})
    _db.users.delete_many({"id": ctx["user"]["id"]})


@pytest.fixture(scope="module")
def patient_b(base_url):
    ctx = _register(base_url, "patient")
    yield ctx
    _db.presales_leads.delete_many({"user_id": ctx["user"]["id"]})
    _db.health_documents.delete_many({"user_id": ctx["user"]["id"]})
    _db.users.delete_many({"id": ctx["user"]["id"]})


@pytest.fixture(scope="module")
def doctor_ctx(base_url):
    ctx = _register(base_url, "doctor")
    yield ctx
    _db.doctors.delete_many({"user_id": ctx["user"]["id"]})
    _db.users.delete_many({"id": ctx["user"]["id"]})


@pytest.fixture(scope="module")
def admin_ctx(base_url):
    return _admin_login(base_url)


# ══════════════════════════ 1. UPLOAD ═════════════════════════════
class TestDocumentUpload:
    def test_upload_success_jpg(self, base_url, patient_a):
        r = _upload(base_url, patient_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user_id"] == patient_a["user"]["id"]
        assert d["doc_type"] == BLOOD
        assert d["content_type"] == "image/jpeg"
        assert d["size_bytes"] == len(_JPG_BYTES)
        assert d["status"] == "pending_review"
        assert "id" in d and "uploaded_at" in d
        # verify presales_leads.documents_uploaded incremented
        lead = _db.presales_leads.find_one({"user_id": patient_a["user"]["id"]})
        assert lead is not None and lead.get("documents_uploaded", 0) >= 1
        patient_a["last_doc_id"] = d["id"]

    def test_upload_pdf_success(self, base_url, patient_a):
        pdf = b"%PDF-1.4\n%dummy test pdf\n%%EOF"
        r = _upload(base_url, patient_a["headers"],
                    filename="rx.pdf", content=pdf, mime="application/pdf",
                    doc_type="prescription")
        assert r.status_code == 200, r.text
        assert r.json()["doc_type"] == "prescription"

    def test_upload_rejects_invalid_mime(self, base_url, patient_a):
        r = _upload(base_url, patient_a["headers"],
                    filename="notes.txt", content=b"hello", mime="text/plain")
        assert r.status_code == 400, r.text
        assert "type" in r.text.lower()

    def test_upload_rejects_invalid_doc_type(self, base_url, patient_a):
        r = _upload(base_url, patient_a["headers"], doc_type="random_stuff")
        assert r.status_code == 400, r.text
        assert "doc_type" in r.text.lower() or "invalid" in r.text.lower()

    def test_upload_rejects_empty_file(self, base_url, patient_a):
        r = _upload(base_url, patient_a["headers"],
                    filename="empty.jpg", content=b"", mime="image/jpeg")
        assert r.status_code == 400, r.text
        assert "empty" in r.text.lower()

    def test_upload_rejects_oversize(self, base_url, patient_a):
        big = b"\x00" * (10 * 1024 * 1024 + 100)  # >10 MB
        r = _upload(base_url, patient_a["headers"],
                    filename="big.png", content=big, mime="image/png",
                    retry_on_500=False)
        assert r.status_code == 400, r.text
        assert "large" in r.text.lower() or "10" in r.text

    def test_upload_unauth(self, base_url):
        r = _upload(base_url, {})
        assert r.status_code == 401, r.text


# ══════════════════════════ 2. LIST + META + DELETE ═══════════════
class TestListMetaDelete:
    def test_list_mine(self, base_url, patient_a):
        r = requests.get(f"{base_url}/api/documents/mine", headers=patient_a["headers"], timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body and body["total"] >= 1
        first = body["items"][0]
        assert "download_token" in first
        assert "storage_path" not in first  # excluded per spec

    def test_get_doc_meta_owner_ok(self, base_url, patient_a):
        doc_id = patient_a.get("last_doc_id")
        assert doc_id, "prior upload test must have populated last_doc_id"
        r = requests.get(f"{base_url}/api/documents/{doc_id}", headers=patient_a["headers"], timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] == doc_id
        assert "download_token" in d
        assert "storage_path" not in d

    def test_get_doc_meta_other_patient_forbidden(self, base_url, patient_a, patient_b):
        doc_id = patient_a["last_doc_id"]
        r = requests.get(f"{base_url}/api/documents/{doc_id}", headers=patient_b["headers"], timeout=30)
        assert r.status_code == 403, r.text

    def test_get_doc_meta_missing_404(self, base_url, patient_a):
        r = requests.get(f"{base_url}/api/documents/{uuid.uuid4()}", headers=patient_a["headers"], timeout=30)
        assert r.status_code == 404, r.text

    def test_delete_by_non_owner_forbidden(self, base_url, patient_a, patient_b):
        doc_id = patient_a["last_doc_id"]
        r = requests.delete(f"{base_url}/api/documents/{doc_id}", headers=patient_b["headers"], timeout=30)
        assert r.status_code == 403, r.text

    def test_delete_owner_pending_ok(self, base_url, patient_a):
        # Upload a fresh doc to delete
        r = _upload(base_url, patient_a["headers"], filename="del.jpg")
        assert r.status_code == 200, r.text
        did = r.json()["id"]
        rd = requests.delete(f"{base_url}/api/documents/{did}", headers=patient_a["headers"], timeout=30)
        assert rd.status_code == 200, rd.text
        assert rd.json().get("deleted") is True
        # Confirm soft-deleted (deleted=True in DB)
        soft = _db.health_documents.find_one({"id": did}, {"_id": 0})
        assert soft and soft.get("deleted") is True

    def test_delete_after_review_rejected(self, base_url, patient_a):
        # Upload a doc, then flip status directly in DB to sent_to_doctor, then try delete
        r = _upload(base_url, patient_a["headers"])
        assert r.status_code == 200, r.text
        did = r.json()["id"]
        _db.health_documents.update_one({"id": did}, {"$set": {"status": "sent_to_doctor"}})
        rd = requests.delete(f"{base_url}/api/documents/{did}", headers=patient_a["headers"], timeout=30)
        assert rd.status_code == 400, rd.text


# ══════════════════════════ 3. FILE DOWNLOAD ══════════════════════
class TestFileDownload:
    def test_download_bearer_owner(self, base_url, patient_a):
        did = patient_a["last_doc_id"]
        r = requests.get(f"{base_url}/api/files/{did}", headers=patient_a["headers"], timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("image/")
        assert len(r.content) == len(_JPG_BYTES)

    def test_download_query_token_owner(self, base_url, patient_a):
        # Fresh token via /documents/{id}
        m = requests.get(f"{base_url}/api/documents/{patient_a['last_doc_id']}",
                         headers=patient_a["headers"], timeout=30).json()
        tok = m["download_token"]
        r = requests.get(f"{base_url}/api/files/{patient_a['last_doc_id']}?token={tok}", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert len(r.content) == len(_JPG_BYTES)

    def test_download_no_auth_401(self, base_url, patient_a):
        r = requests.get(f"{base_url}/api/files/{patient_a['last_doc_id']}", timeout=30)
        assert r.status_code == 401, r.text

    def test_download_wrong_owner_403(self, base_url, patient_a, patient_b):
        r = requests.get(f"{base_url}/api/files/{patient_a['last_doc_id']}",
                         headers=patient_b["headers"], timeout=30)
        assert r.status_code == 403, r.text

    def test_download_admin_ok(self, base_url, patient_a, admin_ctx):
        r = requests.get(f"{base_url}/api/files/{patient_a['last_doc_id']}",
                         headers=admin_ctx["headers"], timeout=60)
        assert r.status_code == 200, r.text[:200]

    def test_download_assigned_doctor_ok(self, base_url, patient_a, doctor_ctx):
        # Assign this doctor to the doc directly for the read-path check
        _db.health_documents.update_one(
            {"id": patient_a["last_doc_id"]},
            {"$set": {"assigned_doctor_id": doctor_ctx["user"]["id"]}}
        )
        r = requests.get(f"{base_url}/api/files/{patient_a['last_doc_id']}",
                         headers=doctor_ctx["headers"], timeout=60)
        assert r.status_code == 200, r.text[:200]
        # Clean up
        _db.health_documents.update_one(
            {"id": patient_a["last_doc_id"]},
            {"$set": {"assigned_doctor_id": None}}
        )


# ══════════════════════════ 4. PRESALES QUEUE ═════════════════════
class TestPresalesQueue:
    def test_leads_forbidden_for_patient(self, base_url, patient_a):
        r = requests.get(f"{base_url}/api/admin/presales/leads",
                         headers=patient_a["headers"], timeout=30)
        assert r.status_code == 403, r.text

    def test_leads_admin_ok_with_stats(self, base_url, admin_ctx):
        r = requests.get(f"{base_url}/api/admin/presales/leads",
                         headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body and "stats" in body
        s = body["stats"]
        for k in ("today_signups", "pending_calls", "consults_booked_today",
                  "pending_documents", "sla_minutes"):
            assert k in s, f"missing stat {k}"
        assert s["sla_minutes"] == 10

    def test_sla_breach_flag_set_after_11_minutes(self, base_url, admin_ctx):
        """Insert a lead with created_at 20 min ago, then verify sla_breached=True."""
        lid = str(uuid.uuid4())
        old_created = (datetime.utcnow() - timedelta(minutes=20)).isoformat() + "Z"
        _db.presales_leads.insert_one({
            "id": lid, "user_id": None,
            "name": "TEST_SLA_LEAD", "phone": "9876500999",
            "email": None,
            "status": "not_contacted",
            "status_history": [{"status": "not_contacted", "timestamp": old_created}],
            "documents_uploaded": 0,
            "created_at": old_created, "updated_at": old_created,
            "_test_": True,
        })
        try:
            r = requests.get(f"{base_url}/api/admin/presales/leads?status=not_contacted",
                             headers=admin_ctx["headers"], timeout=30)
            assert r.status_code == 200, r.text
            match = next((it for it in r.json()["items"] if it.get("id") == lid), None)
            assert match is not None, "seeded lead not returned"
            assert match["sla_breached"] is True
            assert match["age_seconds"] > 600
            assert match["tel_link"] == "tel:9876500999"
        finally:
            _db.presales_leads.delete_one({"id": lid})

    def test_lead_status_transitions_and_history(self, base_url, admin_ctx, patient_b):
        # Insert a fresh lead linked to patient_b
        lid = str(uuid.uuid4())
        _db.presales_leads.insert_one({
            "id": lid, "user_id": patient_b["user"]["id"],
            "name": "TEST_STATUS", "phone": "9800000123",
            "email": patient_b["email"],
            "status": "not_contacted",
            "status_history": [{"status": "not_contacted",
                                "timestamp": datetime.utcnow().isoformat() + "Z"}],
            "created_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "_test_": True,
        })
        try:
            for status in ("contacted", "consult_booked", "consult_done"):
                r = requests.patch(
                    f"{base_url}/api/admin/presales/leads/{lid}/status",
                    headers={**admin_ctx["headers"], "Content-Type": "application/json"},
                    json={"status": status, "note": f"TEST_{status}"},
                    timeout=30,
                )
                assert r.status_code == 200, f"{status}: {r.status_code} {r.text}"
            # history must be appended, not replaced
            lead = _db.presales_leads.find_one({"id": lid}, {"_id": 0})
            hist_statuses = [h["status"] for h in lead["status_history"]]
            assert hist_statuses == ["not_contacted", "contacted", "consult_booked", "consult_done"], hist_statuses
            assert lead["status"] == "consult_done"
            # consult_done side effect on user
            u = _db.users.find_one({"id": patient_b["user"]["id"]}, {"_id": 0})
            assert u.get("free_consult_used") is True
            assert u.get("free_consult_available") is False
        finally:
            _db.presales_leads.delete_one({"id": lid})

    def test_csv_export(self, base_url, admin_ctx):
        r = requests.get(f"{base_url}/api/admin/presales/leads.csv",
                         headers=admin_ctx["headers"], timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers["content-type"].startswith("text/csv"), r.headers.get("content-type")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        header_line = r.text.splitlines()[0].lower()
        for col in ("created_at", "name", "phone", "status", "documents_uploaded"):
            assert col in header_line, f"missing column {col} in CSV header: {header_line}"


# ══════════════════════════ 5. ADMIN DOC REVIEW ═══════════════════
class TestAdminDocReview:
    def test_admin_pending_docs_lists_and_hydrates(self, base_url, admin_ctx, patient_a):
        r = requests.get(f"{base_url}/api/admin/documents/pending",
                         headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # At least the uploads from patient_a earlier should be present in pending_review
        mine = [it for it in items if it.get("user_id") == patient_a["user"]["id"]]
        assert mine, "no pending docs for patient_a — was upload rolled back?"
        sample = mine[0]
        assert "download_token" in sample
        assert "user" in sample and sample["user"].get("name")
        assert "storage_path" not in sample

    def test_admin_pending_docs_forbidden_for_patient(self, base_url, patient_a):
        r = requests.get(f"{base_url}/api/admin/documents/pending",
                         headers=patient_a["headers"], timeout=30)
        assert r.status_code == 403, r.text

    def test_admin_review_approve_requires_doctor_id(self, base_url, admin_ctx, patient_a):
        # Fresh upload to review
        u = _upload(base_url, patient_a["headers"], filename="review_me.jpg")
        assert u.status_code == 200, u.text
        did = u.json()["id"]
        r = requests.patch(
            f"{base_url}/api/admin/documents/{did}/review",
            headers={**admin_ctx["headers"], "Content-Type": "application/json"},
            json={"decision": "approve"},
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "doctor" in r.text.lower()

    def test_admin_review_approve_sets_sent_to_doctor(self, base_url, admin_ctx, patient_a, doctor_ctx):
        u = _upload(base_url, patient_a["headers"], filename="review_ok.jpg")
        assert u.status_code == 200, u.text
        did = u.json()["id"]
        r = requests.patch(
            f"{base_url}/api/admin/documents/{did}/review",
            headers={**admin_ctx["headers"], "Content-Type": "application/json"},
            json={"decision": "approve",
                  "assigned_doctor_id": doctor_ctx["user"]["id"],
                  "review_note": "TEST_looks-good"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "sent_to_doctor"
        # Verify DB
        doc = _db.health_documents.find_one({"id": did}, {"_id": 0})
        assert doc["status"] == "sent_to_doctor"
        assert doc["assigned_doctor_id"] == doctor_ctx["user"]["id"]
        assert doc["review_note"] == "TEST_looks-good"

    def test_admin_review_reupload(self, base_url, admin_ctx, patient_a):
        u = _upload(base_url, patient_a["headers"], filename="blurry.jpg")
        assert u.status_code == 200, u.text
        did = u.json()["id"]
        r = requests.patch(
            f"{base_url}/api/admin/documents/{did}/review",
            headers={**admin_ctx["headers"], "Content-Type": "application/json"},
            json={"decision": "reupload", "review_note": "TEST_please retake"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "reupload_requested"


# ══════════════════════════ 6. REGRESSION ═════════════════════════
class TestRegression:
    def test_admin_login_ok(self, base_url, admin_ctx):
        assert admin_ctx["token"]
        assert admin_ctx["user"].get("is_admin") is True or admin_ctx["user"].get("role") == "admin"

    def test_admin_patients(self, base_url, admin_ctx):
        r = requests.get(f"{base_url}/api/admin/patients",
                         headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), (list, dict))

    def test_admin_doctors(self, base_url, admin_ctx):
        r = requests.get(f"{base_url}/api/admin/doctors",
                         headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text

    def test_quiz_submit(self, base_url, patient_b):
        payload = {
            "answers": {f"q{i}": "A" for i in range(1, 9)},
            "health_concern": "gut_vaidya",
            "age_group": "26-35",
        }
        r = requests.post(f"{base_url}/api/quiz/submit",
                          headers={**patient_b["headers"], "Content-Type": "application/json"},
                          json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["prakriti"].lower().startswith("vata")
        assert d["recommended_kit"]["id"] == "gut_vaidya"
