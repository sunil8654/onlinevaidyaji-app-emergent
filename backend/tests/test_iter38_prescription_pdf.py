"""Regression tests for the Prescription PDF endpoint (Iteration 38).

These hit the running FastAPI backend over HTTP so Motor's async loop stays
happy (the TestClient path collides with Motor's cached loop).
"""
import os
import sys
import asyncio
import uuid
sys.path.insert(0, "/app/backend")

import pytest
import requests

BASE = "http://localhost:8001"
PDF_MAGIC = b"%PDF-"

from prescription_pdf import render_prescription_pdf  # noqa: E402
import server  # noqa: E402


# ─────────────────────────── Pure PDF renderer ─────────────────────────
class TestPdfRenderer:
    def test_render_rejects_empty_prescription(self):
        try:
            render_prescription_pdf({"id": "a", "prescription": None})
        except ValueError:
            return
        raise AssertionError("Empty prescription should raise")

    def test_render_structured_prescription(self):
        appt = {
            "id": "appt-xyz-1234",
            "doctor_id": "d1", "patient_id": "p1",
            "doctor_name": "Dr. Ayush Verma",
            "doctor_specialty": "Ayurveda",
            "patient_name": "Priya Sharma",
            "slot": "2026-08-21T10:00:00Z",
            "prescription": {
                "written_at": "2026-08-21T10:30:00Z",
                "author_id": "u-d1", "author_name": "Dr. Ayush Verma",
                "diagnosis": "Vata-Pitta imbalance.",
                "advice": "Sleep by 10pm.\nAvoid screens after 9pm.",
                "medicines_structured": [
                    {"name": "Ashwagandha 500mg", "dosage": "1 tab",
                     "frequency": "bedtime", "duration": "30 days",
                     "instructions": "with warm milk"},
                ],
            },
        }
        blob = render_prescription_pdf(appt)
        assert blob.startswith(PDF_MAGIC)
        assert len(blob) > 2_000
        assert b"%%EOF" in blob

    def test_render_freeform_medicines(self):
        appt = {
            "id": "appt-y", "prescription": {
                "diagnosis": "Common cold",
                "medicines": "1. Sitopaladi churna\n2. Tulsi tea",
                "written_at": "2026-08-21T10:00:00Z",
            },
        }
        blob = render_prescription_pdf(appt)
        assert blob.startswith(PDF_MAGIC)


# ─────────────────────────── HTTP endpoint ─────────────────────────
@pytest.fixture(scope="module")
def seeded():
    """Seed a doctor + patient + appointment with prescription. Return tokens."""
    pid = f"p-{uuid.uuid4().hex[:8]}"
    did = f"d-{uuid.uuid4().hex[:8]}"
    drow = f"drow-{uuid.uuid4().hex[:8]}"
    aid = f"a-{uuid.uuid4().hex[:8]}"

    async def _seed():
        await server.db.users.insert_one({
            "id": pid, "name": "Patient A", "email": f"{pid}@e.com",
            "role": "patient", "is_admin": False,
        })
        await server.db.users.insert_one({
            "id": did, "name": "Doctor B", "email": f"{did}@e.com",
            "role": "doctor", "is_admin": False,
        })
        await server.db.doctors.insert_one({
            "id": drow, "user_id": did, "name": "Dr. Doctor B",
            "specialty": "Ayurveda", "qualification": "BAMS",
            "verified": True, "consultation_fee": 499,
        })
        await server.db.appointments.insert_one({
            "id": aid, "patient_id": pid, "doctor_id": drow,
            "slot": "2026-08-21T10:00:00Z",
            "prescription": {
                "diagnosis": "Vata imbalance", "medicines": "Ashwagandha",
                "written_at": "2026-08-21T10:30:00Z",
                "author_id": did, "author_name": "Dr. Doctor B",
            },
        })
    asyncio.run(_seed())

    p_token = server.make_token(pid, "patient")
    d_token = server.make_token(did, "doctor")

    yield {
        "aid": aid, "pid": pid, "did": did, "drow": drow,
        "patient_hdr": {"Authorization": f"Bearer {p_token}"},
        "doctor_hdr": {"Authorization": f"Bearer {d_token}"},
    }

    async def _cleanup():
        await server.db.users.delete_many({"id": {"$in": [pid, did]}})
        await server.db.doctors.delete_many({"id": drow})
        await server.db.appointments.delete_many({"id": aid})
    try:
        asyncio.run(_cleanup())
    except Exception:
        pass


class TestPdfEndpoint:
    def test_patient_can_download(self, seeded):
        r = requests.get(
            f"{BASE}/api/prescriptions/{seeded['aid']}/pdf",
            headers=seeded["patient_hdr"], timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content.startswith(PDF_MAGIC)
        assert "inline" in r.headers.get("content-disposition", "").lower()

    def test_download_flag_forces_attachment(self, seeded):
        r = requests.get(
            f"{BASE}/api/prescriptions/{seeded['aid']}/pdf?download=1",
            headers=seeded["patient_hdr"], timeout=15,
        )
        assert r.status_code == 200
        assert "attachment" in r.headers["content-disposition"].lower()

    def test_doctor_can_download(self, seeded):
        r = requests.get(
            f"{BASE}/api/prescriptions/{seeded['aid']}/pdf",
            headers=seeded["doctor_hdr"], timeout=15,
        )
        assert r.status_code == 200
        assert r.content.startswith(PDF_MAGIC)

    def test_stranger_forbidden(self, seeded):
        # Create a real "stranger" user via HTTP so we reach the ACL check
        # (not the auth middleware). Use the register endpoint.
        email = f"stranger-{uuid.uuid4().hex[:6]}@example.com"
        rr = requests.post(
            f"{BASE}/api/auth/register",
            json={
                "name": "Stranger S", "email": email,
                "password": "Aa1!aaaa", "role": "patient",
                "phone": "+919888700000",
            }, timeout=15,
        )
        assert rr.status_code == 200, rr.text
        stranger_token = rr.json()["token"]
        r = requests.get(
            f"{BASE}/api/prescriptions/{seeded['aid']}/pdf",
            headers={"Authorization": f"Bearer {stranger_token}"}, timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_missing_returns_404(self, seeded):
        r = requests.get(
            f"{BASE}/api/prescriptions/no-such-id-xyz/pdf",
            headers=seeded["patient_hdr"], timeout=15,
        )
        assert r.status_code == 404

    def test_unauthenticated_rejected(self, seeded):
        r = requests.get(
            f"{BASE}/api/prescriptions/{seeded['aid']}/pdf", timeout=15,
        )
        assert r.status_code in (401, 403)
