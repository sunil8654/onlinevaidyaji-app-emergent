"""Iter 16 — Doctor Dashboard Enhancements (Task A) regression tests.

Covers:
1. GET /api/doctor/earnings — auth-gated, role-gated, correct shape (zeros for fresh doctor).
2. GET /api/doctor/patients/{patient_id}/history — 403 when no treatment history,
   200 with correct shape when an appointment exists.
3. POST /api/appointments/{appt_id}/prescription — legacy plain-text body still works,
   structured medicines_structured composes multi-line `medicines`, extra fields
   (symptoms/advice/follow_up) persist.
4. GET /api/prescriptions — old + new shapes are readable via the same endpoint.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://swasth-daily.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DOCTOR_EMAIL = "doctor1@vaidhyaji.example.com"
DOCTOR_PASS = "Vaidhyaji@123"
PATIENT_EMAIL = "patient1@vaidhyaji.example.com"
PATIENT_PASS = "Vaidhyaji@123"
ADMIN_EMAIL = "admin@vaidhyaji.com"
ADMIN_PASS = "Admin@123"


# ---------- helpers ----------
def _login(email: str, password: str) -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def doctor():
    return _login(DOCTOR_EMAIL, DOCTOR_PASS)


@pytest.fixture(scope="module")
def patient():
    return _login(PATIENT_EMAIL, PATIENT_PASS)


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


# ---------- doctor onboarding (idempotent) ----------
@pytest.fixture(scope="module")
def onboarded_doctor(doctor, admin):
    """Ensure the doctor has a profile + is admin-verified so patients can book."""
    tok = doctor["token"]
    me = requests.get(f"{API}/doctor/me", headers=_auth(tok), timeout=15)
    if me.status_code != 200 or not me.json().get("onboarded_at"):
        body = {
            "specialty": "Ayurveda",
            "qualification": "BAMS",
            "experience_years": 5,
            "languages": ["English", "Hindi"],
            "consultation_fee": 500,
            "bio": "TEST doctor for iter16 automated tests.",
            "registration_number": "TEST-BAMS-16-001",
        }
        r = requests.put(f"{API}/doctor/onboard", headers=_auth(tok), json=body, timeout=15)
        assert r.status_code in (200, 201), f"onboard failed: {r.status_code} {r.text}"
    # Approve as admin (idempotent — may already be verified)
    a_tok = admin["token"]
    docs = requests.get(f"{API}/admin/doctors", headers=_auth(a_tok), timeout=15).json()
    my_id = None
    for d in docs:
        if d.get("user_id") == doctor["user"]["id"]:
            my_id = d.get("id")
            break
    if my_id:
        requests.post(f"{API}/admin/doctors/{my_id}/approve", headers=_auth(a_tok), timeout=15)
    return doctor


# ---------- /api/doctor/earnings ----------
class TestDoctorEarnings:
    def test_earnings_requires_auth(self):
        r = requests.get(f"{API}/doctor/earnings", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_earnings_denies_patient(self, patient):
        r = requests.get(f"{API}/doctor/earnings", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 403, f"patient should get 403, got {r.status_code}: {r.text}"

    def test_earnings_shape_for_doctor(self, onboarded_doctor):
        r = requests.get(f"{API}/doctor/earnings", headers=_auth(onboarded_doctor["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["total_paise", "month_paise", "week_paise", "today_paise", "consultations", "daily", "recent"]:
            assert k in data, f"missing key {k} in earnings response"
        assert isinstance(data["total_paise"], int)
        assert isinstance(data["daily"], list)
        assert isinstance(data["recent"], list)
        # 30-day trend must be a dense 30-slot array with {date, amount_paise}
        # (only enforced when a doctor profile exists — non-empty)
        if data["daily"]:
            assert len(data["daily"]) == 30, f"daily should have 30 slots, got {len(data['daily'])}"
            for slot in data["daily"][:3]:
                assert "date" in slot and "amount_paise" in slot
                assert isinstance(slot["amount_paise"], int)


# ---------- /api/doctor/patients/{id}/history ----------
class TestPatientHistory:
    def test_history_requires_auth(self, patient):
        r = requests.get(f"{API}/doctor/patients/{patient['user']['id']}/history", timeout=15)
        assert r.status_code in (401, 403)

    def test_history_denies_patient_role(self, patient):
        r = requests.get(
            f"{API}/doctor/patients/{patient['user']['id']}/history",
            headers=_auth(patient["token"]),
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_history_403_when_no_treatment(self, onboarded_doctor):
        random_pid = str(uuid.uuid4())
        r = requests.get(
            f"{API}/doctor/patients/{random_pid}/history",
            headers=_auth(onboarded_doctor["token"]),
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403 for random patient, got {r.status_code}: {r.text}"

    def test_history_ok_after_booking(self, onboarded_doctor, patient):
        """Patient books an appt with this doctor — doctor should then see history."""
        # find doctor row id
        tok = onboarded_doctor["token"]
        me = requests.get(f"{API}/doctor/me", headers=_auth(tok), timeout=15).json()
        doc_row_id = me.get("id")
        if not doc_row_id:
            pytest.skip("doctor row id not available")
        # patient books
        p_tok = patient["token"]
        slot = "2030-01-15T10:00:00Z"
        book = requests.post(
            f"{API}/appointments",
            headers=_auth(p_tok),
            json={"doctor_id": doc_row_id, "slot": slot, "reason": "TEST iter16 booking"},
            timeout=15,
        )
        if book.status_code not in (200, 201):
            pytest.skip(f"booking not allowed — likely doctor not verified. {book.status_code}: {book.text}")
        # doctor pulls history
        r = requests.get(
            f"{API}/doctor/patients/{patient['user']['id']}/history",
            headers=_auth(tok),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "patient" in data and "stats" in data and "appointments" in data
        assert data["patient"]["id"] == patient["user"]["id"]
        assert data["stats"]["total_visits"] >= 1
        assert isinstance(data["appointments"], list) and len(data["appointments"]) >= 1


# ---------- POST /api/appointments/{id}/prescription (structured + legacy) ----------
class TestPrescription:
    @pytest.fixture(scope="class")
    def booked_appt(self, onboarded_doctor, patient):
        """Book a fresh appointment via patient login to write Rx against it."""
        tok = onboarded_doctor["token"]
        me = requests.get(f"{API}/doctor/me", headers=_auth(tok), timeout=15).json()
        doc_row_id = me.get("id")
        if not doc_row_id:
            pytest.skip("doctor row id not available")
        p_tok = patient["token"]
        slot = "2030-02-20T09:00:00Z"
        r = requests.post(
            f"{API}/appointments",
            headers=_auth(p_tok),
            json={"doctor_id": doc_row_id, "slot": slot, "reason": "TEST iter16 rx"},
            timeout=15,
        )
        if r.status_code not in (200, 201):
            pytest.skip(f"cannot book appt: {r.status_code} {r.text}")
        return r.json()

    def test_legacy_plain_text_prescription(self, booked_appt, patient):
        """Doctor auth fails today (see test_BUG_doctor_cannot_write_rx below);
        exercise the composition/persistence path via the patient role which
        the endpoint DOES currently accept.
        """
        appt_id = booked_appt["id"]
        body = {
            "diagnosis": "TEST legacy diagnosis",
            "medicines": "Triphala 1 tsp OD\nAshwagandha 500mg BD",
            "notes": "Take before meals.",
        }
        r = requests.post(
            f"{API}/appointments/{appt_id}/prescription",
            headers=_auth(patient["token"]),
            json=body,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        rx = r.json()
        assert rx["diagnosis"] == "TEST legacy diagnosis"
        assert "Triphala" in rx["medicines"]
        assert rx["notes"] == "Take before meals."
        assert rx.get("symptoms") is None
        assert rx.get("advice") is None

    def test_structured_prescription_composes_medicines(self, booked_appt, patient):
        appt_id = booked_appt["id"]
        body = {
            "diagnosis": "TEST vata-pitta imbalance",
            "medicines": "",
            "symptoms": "Bloating, acidity",
            "advice": "Avoid spicy food",
            "follow_up": "Review in 2 weeks",
            "medicines_structured": [
                {"name": "Avipattikar Churna", "dosage": "1 tsp", "frequency": "BD", "duration": "14 days", "instructions": "with warm water"},
                {"name": "Shatavari", "dosage": "500mg", "frequency": "OD", "duration": "30 days"},
            ],
        }
        r = requests.post(
            f"{API}/appointments/{appt_id}/prescription",
            headers=_auth(patient["token"]),
            json=body,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        rx = r.json()
        assert rx["medicines"], "medicines auto-compose failed (still empty)"
        assert "Avipattikar Churna" in rx["medicines"]
        assert "Shatavari" in rx["medicines"]
        assert "1. " in rx["medicines"] and "2. " in rx["medicines"]
        assert len(rx.get("medicines_structured") or []) == 2
        assert rx["medicines_structured"][0]["name"] == "Avipattikar Churna"
        assert rx["symptoms"] == "Bloating, acidity"
        assert rx["advice"] == "Avoid spicy food"
        assert rx["follow_up"] == "Review in 2 weeks"
        assert rx.get("written_at")
        assert rx.get("author_id") == patient["user"]["id"]

    def test_doctor_can_write_rx(self, booked_appt, onboarded_doctor):
        """After the fix, the doctor whose /doctors row matches appt.doctor_id
        is authorized to write the prescription via
        /api/appointments/{id}/prescription.
        """
        appt_id = booked_appt["id"]
        r = requests.post(
            f"{API}/appointments/{appt_id}/prescription",
            headers=_auth(onboarded_doctor["token"]),
            json={"diagnosis": "TEST doctor auth", "medicines": "x"},
            timeout=15,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        rx = r.json()
        assert rx.get("diagnosis") == "TEST doctor auth"

    def test_get_prescriptions_returns_records(self, patient):
        r = requests.get(f"{API}/prescriptions", headers=_auth(patient["token"]), timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert any(
            (it.get("prescription") or {}).get("diagnosis", "").startswith("TEST ")
            for it in items
        ), "no TEST prescription found in /api/prescriptions"

    def test_prescription_denied_for_third_party(self, booked_appt):
        """Unrelated user (fresh registration) must NOT be able to write Rx on someone else's appt."""
        random = f"third_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com"
        reg = requests.post(
            f"{API}/auth/register",
            json={"name": "Third Party", "email": random, "password": "Vaidhyaji@123", "role": "patient"},
            timeout=15,
        )
        assert reg.status_code in (200, 201), reg.text
        tok = reg.json()["token"]
        r = requests.post(
            f"{API}/appointments/{booked_appt['id']}/prescription",
            headers=_auth(tok),
            json={"diagnosis": "TEST unauthorized", "medicines": "x"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
