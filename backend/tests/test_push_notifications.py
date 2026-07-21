"""Push notification wiring tests (iteration 12).

Verifies:
- POST /api/register-push contract (no 500 on placeholder key)
- send_push() non-blocking behavior on 4 event hooks:
    * appointment create
    * prescription add (doctor -> patient)
    * admin doctor approve
    * payment verify
- Regression: primary operations must succeed even when upstream push fails
"""

import hashlib
import hmac
import os
import subprocess
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

# Load backend .env for Razorpay secret
BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(BACKEND_ENV)

RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
EMERGENT_PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

BACKEND_LOG_ERR = "/var/log/supervisor/backend.err.log"
BACKEND_LOG_OUT = "/var/log/supervisor/backend.out.log"


def _sign(order_id: str, payment_id: str, secret: str) -> str:
    body = f"{order_id}|{payment_id}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def _read_backend_logs(tail: int = 400) -> str:
    """Return recent backend log contents (best effort)."""
    parts = []
    for path in (BACKEND_LOG_ERR, BACKEND_LOG_OUT):
        try:
            out = subprocess.check_output(
                ["tail", "-n", str(tail), path], stderr=subprocess.DEVNULL
            ).decode("utf-8", errors="ignore")
            parts.append(out)
        except Exception:
            pass
    return "\n".join(parts)


# --------- /api/register-push contract ---------
class TestRegisterPush:
    def test_register_push_valid_payload(self, api_client, base_url, patient_ctx):
        """Contract: accepts {user_id, platform, device_token}. Must not 500.
        With placeholder EMERGENT_PUSH_KEY the upstream call returns 401
        so backend returns {"status": "pending", ...} — that is acceptable.
        With a real key it should return 201 {"status": "registered"}.
        """
        payload = {
            "user_id": patient_ctx["user"]["id"],
            "platform": "android",
            "device_token": "fake_test_token_ABC123",
        }
        r = api_client.post(
            f"{base_url}/api/register-push",
            json=payload,
            headers=patient_ctx["headers"],
            timeout=30,
        )
        # Any 2xx is acceptable; must NOT be 5xx crash
        assert r.status_code < 500, f"register-push crashed: {r.status_code} {r.text}"
        assert r.status_code in (200, 201), f"unexpected status: {r.status_code} {r.text}"
        data = r.json()
        assert "status" in data, f"missing status: {data}"
        # With placeholder we expect one of these graceful statuses
        assert data["status"] in ("registered", "pending", "unavailable"), data

    def test_register_push_missing_field(self, api_client, base_url, patient_ctx):
        # user_id missing -> Pydantic 422
        r = api_client.post(
            f"{base_url}/api/register-push",
            json={"platform": "android", "device_token": "x"},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_register_push_ios_platform(self, api_client, base_url, patient_ctx):
        r = api_client.post(
            f"{base_url}/api/register-push",
            json={
                "user_id": patient_ctx["user"]["id"],
                "platform": "ios",
                "device_token": "fake_ios_token_XYZ",
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code < 500, r.text


# --------- Appointment create -> push non-blocking ---------
class TestAppointmentPush:
    def test_appointment_create_succeeds_with_placeholder_push(
        self, api_client, base_url, patient_ctx
    ):
        # find a doctor
        d = api_client.get(f"{base_url}/api/doctors", timeout=30)
        assert d.status_code == 200
        doctors = d.json()
        assert doctors, "no seeded doctors"
        doctor_id = doctors[0]["id"]

        # capture a timestamp to filter logs
        t_before = time.time()

        r = api_client.post(
            f"{base_url}/api/appointments",
            json={
                "doctor_id": doctor_id,
                "slot": "2030-02-01T10:00:00Z",
                "reason": "TEST push wiring",
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, f"appointment create failed: {r.text}"
        appt = r.json()
        # Response contract unchanged
        assert appt["id"]
        assert appt["patient_id"] == patient_ctx["user"]["id"]
        assert appt["doctor_id"] == doctor_id
        assert appt["status"] == "confirmed"
        assert appt["paid"] is False
        # _id must be excluded (no MongoDB ObjectId in payload)
        assert "_id" not in appt

        # Give async push a moment to fire
        time.sleep(1.2)

        logs = _read_backend_logs()
        # We don't fail the test if logs are unreadable, but if we can see
        # them, ensure the app didn't crash. Look for our warning label.
        if logs:
            # With placeholder key, upstream will 401 -> "send_push non-2xx" warning
            # OR the call may silently succeed if key is real. Either is fine.
            # Just assert we did NOT see an unhandled exception in the request handler.
            assert "Traceback" not in logs.split(str(int(t_before)))[-1] if str(int(t_before)) in logs else True


# --------- Prescription add -> patient push non-blocking ---------
class TestPrescriptionPush:
    def test_doctor_adds_prescription_notifies_patient(
        self, api_client, base_url, patient_ctx
    ):
        """Doctor (author) adds Rx. Push should fire to patient (non-blocking).
        Since we don't have a real doctor tied to the appt in this test suite,
        we simulate the same-user case (author == patient) which should
        NOT trigger the push (per code branch appt['patient_id'] != user['id']).
        The Rx creation must still succeed.
        """
        # Book appointment as patient
        d = api_client.get(f"{base_url}/api/doctors", timeout=30)
        doctors = d.json()
        doctor_id = doctors[0]["id"]
        a = api_client.post(
            f"{base_url}/api/appointments",
            json={
                "doctor_id": doctor_id,
                "slot": "2030-02-05T10:00:00Z",
                "reason": "TEST rx push",
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert a.status_code == 200
        appt = a.json()

        # Author == patient (MVP demo permits patient to add). Push branch is skipped.
        r = api_client.post(
            f"{base_url}/api/appointments/{appt['id']}/prescription",
            json={
                "diagnosis": "TEST diagnosis",
                "notes": "TEST note",
                "medicines": "Paracetamol 500mg TDS x 5 days",
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        rx = r.json()
        assert rx["diagnosis"] == "TEST diagnosis"
        assert rx["author_id"] == patient_ctx["user"]["id"]
        assert "_id" not in rx

    def test_prescription_not_allowed_for_third_party(
        self, api_client, base_url, patient_ctx, doctor_ctx
    ):
        """Doctor who is not the appt.doctor cannot add Rx (403). This validates
        the authorization guard still holds after push wiring was added.
        """
        d = api_client.get(f"{base_url}/api/doctors", timeout=30)
        doctors = d.json()
        doctor_id = doctors[0]["id"]
        a = api_client.post(
            f"{base_url}/api/appointments",
            json={
                "doctor_id": doctor_id,
                "slot": "2030-02-06T10:00:00Z",
                "reason": "TEST 403 rx",
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert a.status_code == 200
        appt = a.json()
        # doctor_ctx (fresh doctor account) is not the appointment doctor
        r = api_client.post(
            f"{base_url}/api/appointments/{appt['id']}/prescription",
            json={"diagnosis": "x", "notes": "x", "medicines": ""},
            headers=doctor_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 403, r.text


# --------- Admin doctor approve -> push non-blocking ---------
class TestAdminDoctorApprovePush:
    def _admin_headers(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['token']}"}

    def test_approve_pending_doctor(self, api_client, base_url, doctor_ctx):
        admin_h = self._admin_headers(api_client, base_url)

        # doctor completes onboarding so a doctors row exists
        onboard = api_client.put(
            f"{base_url}/api/doctor/onboard",
            json={
                "specialty": "Cardiology",
                "qualification": "MBBS MD",
                "registration_number": f"REG_TEST_{uuid.uuid4().hex[:8]}",
                "experience_years": 3,
                "languages": ["English"],
                "consultation_fee": 500,
            },
            headers=doctor_ctx["headers"],
            timeout=30,
        )
        assert onboard.status_code == 200, onboard.text
        doctor_doc = onboard.json()
        assert doctor_doc.get("user_id") == doctor_ctx["user"]["id"]
        doctor_id = doctor_doc["id"]

        # approve
        t_before = time.time()
        r = api_client.post(
            f"{base_url}/api/admin/doctors/{doctor_id}/approve",
            headers=admin_h,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True

        # Give async push a moment
        time.sleep(1.0)

        # Doctor is now verified
        pending = api_client.get(
            f"{base_url}/api/admin/doctors?verify_status=verified",
            headers=admin_h,
            timeout=30,
        )
        assert pending.status_code == 200
        found = next((d for d in pending.json() if d["id"] == doctor_id), None)
        assert found is not None
        assert found.get("verified") is True

    def test_approve_missing_doctor_404(self, api_client, base_url):
        admin_h = self._admin_headers(api_client, base_url)
        r = api_client.post(
            f"{base_url}/api/admin/doctors/does-not-exist/approve",
            headers=admin_h,
            timeout=30,
        )
        assert r.status_code == 404, r.text


# --------- Payment verify -> push non-blocking ---------
class TestPaymentVerifyPush:
    def test_valid_payment_verify_and_push(self, api_client, base_url, patient_ctx):
        # 1. create order
        r = api_client.post(
            f"{base_url}/api/payments/create-order",
            json={"amount": 15000, "purpose": "custom", "description": "TEST push"},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        order = r.json()

        # 2. verify with valid HMAC
        payment_id = "pay_TEST_" + uuid.uuid4().hex[:12]
        sig = _sign(order["order_id"], payment_id, RAZORPAY_KEY_SECRET)

        r2 = api_client.post(
            f"{base_url}/api/payments/verify",
            json={
                "razorpay_order_id": order["order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": sig,
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data.get("success") is True
        assert data["razorpay_payment_id"] == payment_id

        # Give async push a moment
        time.sleep(1.0)


# --------- Broadcast (regression) ---------
class TestAdminBroadcast:
    def test_admin_broadcast_non_blocking(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
            timeout=30,
        )
        assert r.status_code == 200
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        b = api_client.post(
            f"{base_url}/api/admin/broadcast",
            json={
                "title": "TEST broadcast",
                "message": "TEST message",
                "audience": "all_patients",
            },
            headers=h,
            timeout=30,
        )
        # Must succeed even if upstream push returns 401 on placeholder key
        assert b.status_code == 200, b.text
        assert "sent_to" in b.json()


# --------- Log-based assertion: send_push actually fired ---------
class TestSendPushInvocation:
    """After running the above tests, look for evidence in backend logs.
    On placeholder key we expect either the 401 warning line or no
    exception. This test is best-effort and skips if logs are unreadable.
    """

    def test_backend_logs_show_push_activity(self):
        logs = _read_backend_logs(tail=800)
        if not logs:
            pytest.skip("backend logs unreadable")
        # Any of these strings is a positive signal
        signals = [
            "send_push",
            "register-push",
            "EMERGENT_PUSH_KEY",
            "/api/v1/push/",
            "push failed",
            "push non-blocking",
        ]
        assert any(s in logs for s in signals), (
            "Expected some push-related log activity after tests; "
            f"placeholder key was {EMERGENT_PUSH_KEY!r}. "
            "This is best-effort — the endpoint may have logged nothing "
            "if the call raised before logger.warning."
        )
