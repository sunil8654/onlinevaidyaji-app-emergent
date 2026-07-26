"""Iteration 24: Doctor availability calendar / online-offline toggle tests.

Covers:
- GET /api/doctor/availability -> shape + defaults
- PUT /api/doctor/availability happy path (is_available, consultation_mode,
  weekly_schedule, slot_duration_min, notes)
- Validation: consultation_mode enum, slot_duration_min range, notes length,
  weekly_schedule sanitisation (invalid keys/values dropped, dup removed,
  sorted, capped at 24)
- Auth: patient forbidden (403), missing token (401/403)
- Onboarding gate: 404 "Complete onboarding first" when doctor has not onboarded
- Public projection: GET /api/doctors surfaces is_available + consultation_mode
  after a verified doctor toggles them
- Regression: /doctor/me, /doctor/my-appointments, /doctor/my-patients,
  /doctor/earnings, PUT /doctor/profile, /doctor/onboard still work
- Regression: /api/auth/register still enforces phone; /api/wellness/mood,
  /api/family/members, /api/community/questions still reachable
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load frontend .env for EXPO_PUBLIC_BACKEND_URL + backend .env for ADMIN_PASSWORD
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def _auth(t: str):
    return {"Authorization": f"Bearer {t}"}


def _register(role: str, email: str | None = None, phone: str | None = None):
    email = email or f"iter24_{role}_{uuid.uuid4().hex[:6]}@vaidhyaji.example.com"
    phone = phone or ("9" + str(uuid.uuid4().int)[-9:])
    r = requests.post(
        f"{API}/auth/register",
        json={
            "name": f"TEST_{role.title()}",
            "email": email,
            "password": "Passw0rd!123",
            "role": role,
            "phone": phone,
        },
        timeout=30,
    )
    return r, email


def _login(email: str, password: str):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)


# ────────────────── fixtures ──────────────────
@pytest.fixture(scope="module")
def patient_token():
    r, _ = _register("patient")
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def fresh_doctor_token():
    """Doctor registered but NOT onboarded."""
    r, _ = _register("doctor")
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def onboarded_doctor():
    """Register + onboard a doctor (not yet admin-verified)."""
    r, email = _register("doctor")
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    body = {
        "specialty": "Ayurveda",
        "qualification": "BAMS",
        "registration_number": f"AYUSH/BAMS/2020/{uuid.uuid4().hex[:6].upper()}",
        "experience_years": 7,
        "languages": ["Hindi", "English"],
        "consultation_fee": 600,
        "bio": "Iter24 test doctor",
        "avatar_base64": PNG_B64,
    }
    ob = requests.put(f"{API}/doctor/onboard", json=body, headers=_auth(token), timeout=30)
    assert ob.status_code == 200, ob.text
    return {"token": token, "email": email, "doctor_id": ob.json().get("id")}


@pytest.fixture(scope="module")
def admin_token():
    if not ADMIN_PASSWORD:
        pytest.skip("ADMIN_PASSWORD env not set")
    r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def verified_doctor(onboarded_doctor, admin_token):
    """Admin-approves the onboarded doctor so they appear in /api/doctors."""
    doctor_id = onboarded_doctor.get("doctor_id")
    assert doctor_id, "onboarded_doctor missing id"
    r = requests.post(f"{API}/admin/doctors/{doctor_id}/approve", headers=_auth(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    return {**onboarded_doctor}


# ────────────────── GET /doctor/availability ──────────────────
class TestGetAvailability:
    def test_get_default_shape(self, onboarded_doctor):
        r = requests.get(f"{API}/doctor/availability", headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("is_available", "consultation_mode", "weekly_schedule", "slot_duration_min", "notes"):
            assert k in d, f"missing key {k}: {d}"
        assert isinstance(d["is_available"], bool)
        assert d["consultation_mode"] in ("online", "offline", "both")
        assert isinstance(d["weekly_schedule"], dict)
        assert isinstance(d["slot_duration_min"], int)
        assert isinstance(d["notes"], str)

    def test_get_forbidden_for_patient(self, patient_token):
        r = requests.get(f"{API}/doctor/availability", headers=_auth(patient_token), timeout=30)
        assert r.status_code == 403, r.text

    def test_get_requires_auth(self):
        r = requests.get(f"{API}/doctor/availability", timeout=30)
        assert r.status_code in (401, 403), r.text


# ────────────────── PUT /doctor/availability ──────────────────
class TestPutAvailability:
    def test_put_happy_path_full_payload(self, onboarded_doctor):
        body = {
            "is_available": True,
            "consultation_mode": "both",
            "weekly_schedule": {
                "0": ["09:00", "09:30", "10:00"],
                "1": ["11:00"],
                "6": ["18:00", "18:30"],
            },
            "slot_duration_min": 30,
            "notes": "Available Mon-Sat, closed Sun evening.",
        }
        r = requests.put(f"{API}/doctor/availability", json=body, headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_available"] is True
        assert d["consultation_mode"] == "both"
        assert d["slot_duration_min"] == 30
        assert d["notes"] == body["notes"]
        assert d["weekly_schedule"]["0"] == ["09:00", "09:30", "10:00"]
        assert d["weekly_schedule"]["1"] == ["11:00"]
        assert d["weekly_schedule"]["6"] == ["18:00", "18:30"]

        # GET should reflect changes
        g = requests.get(f"{API}/doctor/availability", headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert g.status_code == 200
        gd = g.json()
        assert gd["is_available"] is True
        assert gd["consultation_mode"] == "both"
        assert gd["weekly_schedule"]["0"] == ["09:00", "09:30", "10:00"]
        assert gd["notes"] == body["notes"]

    def test_put_offline_toggle(self, onboarded_doctor):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"is_available": False, "consultation_mode": "offline"},
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_available"] is False
        assert d["consultation_mode"] == "offline"

    def test_put_online_toggle(self, onboarded_doctor):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"is_available": True, "consultation_mode": "online"},
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["consultation_mode"] == "online"

    def test_put_invalid_consultation_mode(self, onboarded_doctor):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"consultation_mode": "hybrid"},
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_put_slot_duration_below_min(self, onboarded_doctor):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"slot_duration_min": 4},
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_put_slot_duration_above_max(self, onboarded_doctor):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"slot_duration_min": 121},
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_put_notes_too_long(self, onboarded_doctor):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"notes": "x" * 301},
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_put_weekly_schedule_sanitisation(self, onboarded_doctor):
        """
        - invalid day key '7' must be dropped
        - invalid HH:MM entries ('25:00', 'garbage', '9:00' wrong format) stripped
        - duplicates removed, sorted
        - capped at 24 slots
        """
        many = [f"{h:02d}:{m:02d}" for h in range(0, 24) for m in (0, 30)]  # 48 slots
        payload = {
            "weekly_schedule": {
                "0": ["10:00", "09:00", "09:00", "25:00", "garbage", "9:00", "12:60"],
                "3": many,
                "7": ["11:00"],  # invalid key
            }
        }
        r = requests.put(
            f"{API}/doctor/availability",
            json=payload,
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ws = r.json()["weekly_schedule"]
        # Day "7" should not appear
        assert "7" not in ws
        # Day "0" cleaned + sorted + deduped
        assert ws["0"] == ["09:00", "10:00"]
        # Day "3" capped at 24
        assert len(ws["3"]) == 24
        assert ws["3"] == sorted(ws["3"])
        # Missing days that were not provided are present as empty lists (sanitiser fills all 7)
        for day in [str(i) for i in range(7)]:
            assert day in ws
            assert isinstance(ws[day], list)

    def test_put_empty_body_rejected(self, onboarded_doctor):
        r = requests.put(f"{API}/doctor/availability", json={}, headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert r.status_code == 400, r.text
        assert "No fields to update" in r.text

    def test_put_forbidden_for_patient(self, patient_token):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"is_available": True},
            headers=_auth(patient_token),
            timeout=30,
        )
        assert r.status_code == 403, r.text
        assert "Doctors only" in r.text

    def test_put_requires_auth(self):
        r = requests.put(f"{API}/doctor/availability", json={"is_available": True}, timeout=30)
        assert r.status_code in (401, 403), r.text

    def test_put_before_onboarding_returns_404(self, fresh_doctor_token):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"is_available": True},
            headers=_auth(fresh_doctor_token),
            timeout=30,
        )
        assert r.status_code == 404, r.text
        assert "Complete onboarding first" in r.text


# ────────────────── Public directory reflects toggles ──────────────────
class TestPublicDoctorsExposesAvailability:
    def test_public_list_includes_availability_fields(self, verified_doctor):
        # Toggle: offline + is_available=False so we can verify the surfaced values
        r = requests.put(
            f"{API}/doctor/availability",
            json={"is_available": False, "consultation_mode": "offline"},
            headers=_auth(verified_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text

        pub = requests.get(f"{API}/doctors", timeout=30)
        assert pub.status_code == 200, pub.text
        docs = pub.json()
        assert isinstance(docs, list) and len(docs) > 0
        # Every doc must not leak _id, and at least our doctor should carry the fields
        mine = next((d for d in docs if d.get("id") == verified_doctor.get("doctor_id")), None)
        assert mine is not None, "verified test doctor not present in public list"
        assert "_id" not in mine
        assert mine.get("is_available") is False
        assert mine.get("consultation_mode") == "offline"

        # Also verify GET /api/doctors/{id} single-doctor endpoint carries fields
        one = requests.get(f"{API}/doctors/{verified_doctor['doctor_id']}", timeout=30)
        assert one.status_code == 200, one.text
        od = one.json()
        assert od.get("is_available") is False
        assert od.get("consultation_mode") == "offline"

    def test_toggle_online_reflects_publicly(self, verified_doctor):
        r = requests.put(
            f"{API}/doctor/availability",
            json={"is_available": True, "consultation_mode": "online"},
            headers=_auth(verified_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 200
        one = requests.get(f"{API}/doctors/{verified_doctor['doctor_id']}", timeout=30)
        assert one.status_code == 200
        assert one.json().get("is_available") is True
        assert one.json().get("consultation_mode") == "online"


# ────────────────── Regression: other doctor endpoints ──────────────────
class TestDoctorRegression:
    def test_doctor_me(self, onboarded_doctor):
        r = requests.get(f"{API}/doctor/me", headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "_id" not in d
        assert d.get("specialty") == "Ayurveda"

    def test_my_appointments_returns_list(self, onboarded_doctor):
        r = requests.get(f"{API}/doctor/my-appointments", headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_my_patients_returns_list(self, onboarded_doctor):
        r = requests.get(f"{API}/doctor/my-patients", headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_earnings_returns_dict(self, onboarded_doctor):
        r = requests.get(f"{API}/doctor/earnings", headers=_auth(onboarded_doctor["token"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, dict)

    def test_profile_update_still_works(self, onboarded_doctor):
        r = requests.put(
            f"{API}/doctor/profile",
            json={"bio": "Regression check iter24"},
            headers=_auth(onboarded_doctor["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("bio") == "Regression check iter24"


# ────────────────── Regression: patient/community/wellness/family ──────────────────
class TestPlatformRegression:
    def test_register_requires_phone(self):
        r = requests.post(
            f"{API}/auth/register",
            json={
                "name": "NoPhone",
                "email": f"nophone_{uuid.uuid4().hex[:6]}@vaidhyaji.example.com",
                "password": "Passw0rd!123",
                "role": "patient",
            },
            timeout=30,
        )
        # phone is mandatory -> 422 (pydantic) or 400
        assert r.status_code in (400, 422), r.text

    def test_register_invalid_phone(self):
        r = requests.post(
            f"{API}/auth/register",
            json={
                "name": "BadPhone",
                "email": f"badphone_{uuid.uuid4().hex[:6]}@vaidhyaji.example.com",
                "password": "Passw0rd!123",
                "role": "patient",
                "phone": "1234567890",  # starts with 1 -> invalid
            },
            timeout=30,
        )
        assert r.status_code in (400, 422), r.text

    def test_wellness_history_endpoint(self, patient_token):
        r = requests.get(f"{API}/wellness/history", headers=_auth(patient_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict) and "items" in body and isinstance(body["items"], list)

    def test_family_members_list(self, patient_token):
        r = requests.get(f"{API}/family/members", headers=_auth(patient_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, dict) and "items" in body and isinstance(body["items"], list)

    def test_community_posts_list(self, patient_token):
        r = requests.get(f"{API}/community/posts", headers=_auth(patient_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, dict) and "items" in body and isinstance(body["items"], list)
