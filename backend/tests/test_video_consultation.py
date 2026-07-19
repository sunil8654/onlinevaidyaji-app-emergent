"""
Tests for Daily.co video consultation endpoints + regression checks
- POST /api/video/session (instant / scheduled / auth / error paths)
- GET  /api/video/embed/{room_name} (HTML response)
- Regression: POST /api/appointments inserts exactly ONE document (dead-code removed)
- Regression: Admin login + /api/admin/patients aggregation still works
"""
import os
import uuid
import re
from datetime import datetime, timedelta, timezone
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://swasth-daily.preview.emergentagent.com",
).rstrip("/")


# ---------- Fixtures ----------
def _register(role: str) -> dict:
    email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_{role.capitalize()}_{uuid.uuid4().hex[:4]}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": "9999999999",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "email": payload["email"],
        "headers": {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"},
    }


@pytest.fixture(scope="module")
def patient_a():
    return _register("patient")


@pytest.fixture(scope="module")
def patient_b():
    return _register("patient")


@pytest.fixture(scope="module")
def a_doctor():
    r = requests.get(f"{BASE_URL}/api/doctors", timeout=30)
    assert r.status_code == 200
    docs = r.json()
    assert len(docs) >= 1
    return docs[0]


@pytest.fixture(scope="module")
def booked_appointment(patient_a, a_doctor):
    slot = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/appointments",
        json={"doctor_id": a_doctor["id"], "slot": slot, "reason": "TEST_video_flow"},
        headers=patient_a["headers"],
        timeout=30,
    )
    assert r.status_code == 200, f"book appt: {r.status_code} {r.text}"
    return r.json()


# ---------- POST /api/video/session ----------
class TestVideoSession:
    def test_instant_consult_returns_full_payload(self, patient_a, a_doctor):
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"doctor_id": a_doctor["id"], "duration_minutes": 30},
            headers=patient_a["headers"],
            timeout=45,
        )
        assert r.status_code == 200, f"instant session: {r.status_code} {r.text}"
        d = r.json()
        # All required keys present
        for k in ("room_url", "room_name", "token", "embed_url", "is_owner", "exp", "user_name"):
            assert k in d, f"missing key {k} in {d}"
        # Types / shape
        assert d["room_url"].startswith("https://") and ".daily.co/" in d["room_url"]
        assert isinstance(d["room_name"], str) and len(d["room_name"]) > 0
        assert isinstance(d["token"], str) and len(d["token"]) > 20
        assert d["embed_url"].startswith("/api/video/embed/")
        assert d["is_owner"] is False  # patient is not owner
        assert isinstance(d["exp"], int) and d["exp"] > int(datetime.now(timezone.utc).timestamp())

    def test_scheduled_appointment_success(self, patient_a, booked_appointment):
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"appointment_id": booked_appointment["id"]},
            headers=patient_a["headers"],
            timeout=45,
        )
        assert r.status_code == 200, f"scheduled session: {r.status_code} {r.text}"
        d = r.json()
        assert d["room_name"].startswith("vaidhya-appt-") or booked_appointment["id"] in d["room_name"]
        assert d["is_owner"] is False  # patient booked; not doctor => not owner
        assert d["room_url"].startswith("https://") and ".daily.co/" in d["room_url"]

    def test_scheduled_appointment_persists_room_on_doc(self, patient_a, booked_appointment):
        # Trigger creation
        r1 = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"appointment_id": booked_appointment["id"]},
            headers=patient_a["headers"],
            timeout=45,
        )
        assert r1.status_code == 200
        room_name_1 = r1.json()["room_name"]

        # Fetch appointment via list — should have same room_name persisted
        r2 = requests.get(f"{BASE_URL}/api/appointments", headers=patient_a["headers"], timeout=30)
        assert r2.status_code == 200
        appts = r2.json()
        target = next((a for a in appts if a["id"] == booked_appointment["id"]), None)
        assert target is not None
        # Field name from server.py — daily_room_name
        assert target.get("daily_room_name") == room_name_1

    def test_no_body_returns_400(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={},
            headers=patient_a["headers"],
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"

    def test_appointment_not_owned_by_caller_returns_403(self, patient_b, booked_appointment):
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"appointment_id": booked_appointment["id"]},
            headers=patient_b["headers"],
            timeout=30,
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"

    def test_unauth_returns_401_or_403(self, a_doctor):
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"doctor_id": a_doctor["id"]},
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code} {r.text}"

    def test_invalid_appointment_id_returns_404(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"appointment_id": "nonexistent-appointment-id-xxx"},
            headers=patient_a["headers"],
            timeout=30,
        )
        assert r.status_code == 404, f"expected 404 got {r.status_code} {r.text}"

    def test_invalid_doctor_id_returns_404(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"doctor_id": "nonexistent-doctor-id-xxx"},
            headers=patient_a["headers"],
            timeout=30,
        )
        assert r.status_code == 404, f"expected 404 got {r.status_code} {r.text}"


# ---------- GET /api/video/embed/{room_name} ----------
class TestVideoEmbed:
    def test_embed_html_returned(self, patient_a, a_doctor):
        # Create a real room first so we have a valid name
        r = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"doctor_id": a_doctor["id"]},
            headers=patient_a["headers"],
            timeout=45,
        )
        assert r.status_code == 200
        room_name = r.json()["room_name"]

        # Now fetch embed page (public)
        r2 = requests.get(
            f"{BASE_URL}/api/video/embed/{room_name}",
            params={"token": "dummy-token", "user_name": "Test User", "domain": "onlinevaidya"},
            timeout=30,
        )
        assert r2.status_code == 200, f"embed HTTP {r2.status_code}: {r2.text[:200]}"
        assert "text/html" in r2.headers.get("content-type", "").lower()
        body = r2.text
        assert "daily-js" in body, "daily-js script tag not found in embed HTML"
        assert "DailyIframe" in body or "createFrame" in body
        # Room URL constructed inside script
        assert "daily.co" in body

    def test_embed_invalid_room_returns_400(self):
        r = requests.get(f"{BASE_URL}/api/video/embed/!!!", timeout=30)
        # Server sanitizes and returns 400 if empty after sanitization
        assert r.status_code in (400, 404), f"expected 400/404 got {r.status_code}"


# ---------- Regression: /api/appointments no duplicate insert ----------
class TestAppointmentNoDuplicateInsert:
    def test_single_booking_creates_exactly_one(self, patient_a, a_doctor):
        # Snapshot count before
        r0 = requests.get(f"{BASE_URL}/api/appointments", headers=patient_a["headers"], timeout=30)
        assert r0.status_code == 200
        before = len(r0.json())

        slot = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        r = requests.post(
            f"{BASE_URL}/api/appointments",
            json={"doctor_id": a_doctor["id"], "slot": slot, "reason": "TEST_no_dup"},
            headers=patient_a["headers"],
            timeout=30,
        )
        assert r.status_code == 200
        new_id = r.json()["id"]

        # Snapshot after
        r1 = requests.get(f"{BASE_URL}/api/appointments", headers=patient_a["headers"], timeout=30)
        assert r1.status_code == 200
        after = r1.json()
        assert len(after) == before + 1, (
            f"expected +1 appointment (before={before}, after={len(after)}). "
            "Dead-code duplicate insert may still be present."
        )
        # Ensure exactly one match for the new id
        matches = [a for a in after if a["id"] == new_id]
        assert len(matches) == 1, f"duplicate insert detected: {len(matches)} rows"


# ---------- Regression: admin flow ----------
class TestAdminRegression:
    def test_admin_login_and_patients_aggregation(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
            timeout=30,
        )
        assert r.status_code == 200, f"admin login: {r.status_code} {r.text}"
        d = r.json()
        assert d["user"].get("is_admin") is True or d["user"].get("role") == "admin"
        token = d["token"]

        r2 = requests.get(
            f"{BASE_URL}/api/admin/patients",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        assert r2.status_code == 200, f"admin/patients: {r2.status_code} {r2.text}"
        patients = r2.json()
        assert isinstance(patients, list)
        if patients:
            p = patients[0]
            # Guarantees from aggregation
            assert "_id" not in p, "_id leaked in admin/patients response"
            assert "password" not in p, "password leaked in admin/patients response"
            assert "appointments" in p and isinstance(p["appointments"], int)
