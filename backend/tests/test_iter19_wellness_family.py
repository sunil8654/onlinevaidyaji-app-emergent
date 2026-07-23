"""
Iteration 19 — Wellness dashboard + Family Health + Phone-mandatory registration.

Tests:
1. POST /api/auth/register  — phone normalisation + validation
2. Wellness endpoints (log, history, dashboard, delete)
3. Family Health endpoints (CRUD + growth + vaccination + user-scoping)
4. Regression: login, GET /api/doctors, POST /api/appointments auth-guard
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
load_dotenv(FRONTEND_ENV)
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

TIMEOUT = 30


# ------------------------- Helpers -------------------------
def _unique_email(prefix: str = "wellness") -> str:
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"


def _register(name="TEST User", role="patient", phone="9876543210"):
    payload = {
        "name": name,
        "email": _unique_email(role),
        "password": "Passw0rd!123",
        "role": role,
        "phone": phone,
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=TIMEOUT)
    return r, payload


@pytest.fixture(scope="module")
def patient_a():
    r, payload = _register(role="patient", phone="9876543210")
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "email": payload["email"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


@pytest.fixture(scope="module")
def patient_b():
    r, payload = _register(role="patient", phone="9876543211")
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "email": payload["email"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


# ==================== 1. Registration phone tests ====================
class TestPhoneRegistration:
    def test_register_valid_10digit(self):
        r, _ = _register(phone="9876543210")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "user" in data
        assert data["user"]["phone"] == "9876543210"

    def test_register_with_plus91(self):
        r, _ = _register(phone="+919876543210")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["phone"] == "9876543210"

    def test_register_with_91_prefix(self):
        r, _ = _register(phone="919876543210")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["phone"] == "9876543210"

    def test_register_with_spaces_and_plus(self):
        r, _ = _register(phone="+91 98765 43210")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["phone"] == "9876543210"

    def test_register_missing_phone_returns_422(self):
        payload = {
            "name": "Missing Phone",
            "email": _unique_email("nophone"),
            "password": "Passw0rd!123",
        }
        r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=TIMEOUT)
        assert r.status_code == 422, r.text
        body = r.text.lower()
        assert "phone" in body and ("field required" in body or "required" in body)

    def test_register_short_phone_returns_422(self):
        r, _ = _register(phone="12345")
        assert r.status_code == 422
        assert "valid 10-digit indian mobile" in r.text.lower()

    def test_register_starts_with_1_returns_422(self):
        r, _ = _register(phone="1234567890")
        assert r.status_code == 422
        assert "valid 10-digit indian mobile" in r.text.lower()

    def test_register_starts_with_5_returns_422(self):
        r, _ = _register(phone="5876543210")
        assert r.status_code == 422
        assert "valid 10-digit indian mobile" in r.text.lower()


# ==================== 2. Wellness endpoints ====================
class TestWellnessLog:
    def test_bmi_computed_and_categorised(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "bmi", "height_cm": 170, "weight_kg": 68},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["value"] == 23.5
        assert d["category"] == "Normal"
        assert d["type"] == "bmi"
        assert "id" in d

    def test_bmi_missing_height_returns_400(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "bmi", "weight_kg": 68},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    @pytest.mark.parametrize("s,d,cat", [
        (118, 78, "Normal"),
        (125, 78, "Elevated"),
        (135, 85, "Stage 1"),
        (150, 95, "Stage 2"),
    ])
    def test_bp_categorisation(self, patient_a, s, d, cat):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "bp", "systolic": s, "diastolic": d},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["category"] == cat, f"expected {cat} got {j}"
        assert j["systolic"] == s and j["diastolic"] == d

    def test_bp_missing_diastolic_returns_400(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "bp", "systolic": 120},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    @pytest.mark.parametrize("fasting,cat", [
        (90, "Normal"),
        (110, "Pre-diabetic"),
        (130, "Diabetic"),
    ])
    def test_sugar_fasting_categorisation(self, patient_a, fasting, cat):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "sugar", "fasting": fasting},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["category"] == cat

    @pytest.mark.parametrize("t,val", [
        ("weight", 70.2),
        ("sleep", 7.5),
        ("steps", 8000),
        ("water", 8),
        ("mood", 4),
    ])
    def test_simple_types(self, patient_a, t, val):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": t, "value": val},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["value"] == val

    def test_simple_type_missing_value_returns_400(self, patient_a):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "sleep"},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    def test_auth_required(self):
        r = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "sleep", "value": 7},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 403)


class TestWellnessHistoryDashboardDelete:
    def test_history_scoped_to_user(self, patient_a, patient_b):
        # patient_a already has logs from TestWellnessLog. Add a BP log for patient_b.
        rb = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "bp", "systolic": 118, "diastolic": 78},
            headers=patient_b["headers"],
            timeout=TIMEOUT,
        )
        assert rb.status_code == 200

        # patient_a history?type=bp,days=30
        r = requests.get(
            f"{BASE_URL}/api/wellness/history?type=bp&days=30",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        assert all(i["type"] == "bp" for i in items)
        assert all(i["user_id"] == patient_a["user"]["id"] for i in items)

    def test_dashboard_shape(self, patient_a):
        r = requests.get(
            f"{BASE_URL}/api/wellness/dashboard",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "latest" in j and "weekly" in j and "health_score" in j
        for k in ["bmi", "weight", "sleep", "steps", "bp", "sugar", "mood", "water"]:
            assert k in j["latest"], f"missing {k}"
        assert isinstance(j["health_score"], int)
        assert 0 <= j["health_score"] <= 100

    def test_delete_log_and_second_call_404(self, patient_a):
        create = requests.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "water", "value": 6},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert create.status_code == 200
        log_id = create.json()["id"]

        d1 = requests.delete(
            f"{BASE_URL}/api/wellness/log/{log_id}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert d1.status_code == 200
        assert d1.json().get("deleted") is True

        d2 = requests.delete(
            f"{BASE_URL}/api/wellness/log/{log_id}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert d2.status_code == 404

    def test_dashboard_auth_required(self):
        r = requests.get(f"{BASE_URL}/api/wellness/dashboard", timeout=TIMEOUT)
        assert r.status_code in (401, 403)

    def test_history_auth_required(self):
        r = requests.get(f"{BASE_URL}/api/wellness/history?type=bp", timeout=TIMEOUT)
        assert r.status_code in (401, 403)


# ==================== 3. Family Health ====================
class TestFamilyMembersCRUD:
    def _create_member(self, patient_a, name="TEST_Kid"):
        r = requests.post(
            f"{BASE_URL}/api/family/members",
            json={
                "name": name,
                "relation": "Child",
                "dob": "2018-04-12",
                "gender": "male",
                "blood_group": "O+",
            },
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_create_member(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_Create")
        assert "id" in m
        assert m["growth"] == []
        assert m["vaccinations"] == []
        assert m["blood_group"] == "O+"

    def test_list_members(self, patient_a):
        r = requests.get(
            f"{BASE_URL}/api/family/members",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert "items" in r.json() and isinstance(r.json()["items"], list)

    def test_get_member(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_Get")
        r = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json()["id"] == m["id"]

    def test_update_member(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_Upd")
        r = requests.put(
            f"{BASE_URL}/api/family/members/{m['id']}",
            json={
                "name": "TEST_Kid_Updated",
                "relation": "Child",
                "dob": "2018-04-12",
                "gender": "male",
                "blood_group": "A+",
            },
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        # Verify persisted
        g = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        ).json()
        assert g["name"] == "TEST_Kid_Updated"
        assert g["blood_group"] == "A+"

    def test_growth_entry_with_bmi(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_Growth")
        r = requests.post(
            f"{BASE_URL}/api/family/members/{m['id']}/growth",
            json={"height_cm": 110, "weight_kg": 20},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        entry = r.json()
        assert "id" in entry
        # 20 / (1.1)^2 = 16.5289 → 16.5
        assert entry["bmi"] == 16.5
        assert entry["height_cm"] == 110
        # verify persisted on member
        g = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        ).json()
        assert any(e["id"] == entry["id"] for e in g["growth"])

    def test_vaccination_entry(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_Vacc")
        r = requests.post(
            f"{BASE_URL}/api/family/members/{m['id']}/vaccination",
            json={"vaccine": "MMR", "given_date": "2024-05-14"},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        entry = r.json()
        assert entry["vaccine"] == "MMR"
        assert entry["given_date"] == "2024-05-14"
        assert "id" in entry
        g = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        ).json()
        assert any(v["id"] == entry["id"] for v in g["vaccinations"])

    def test_delete_vaccination(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_DelV")
        e = requests.post(
            f"{BASE_URL}/api/family/members/{m['id']}/vaccination",
            json={"vaccine": "BCG", "given_date": "2018-04-13"},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        ).json()
        d = requests.delete(
            f"{BASE_URL}/api/family/members/{m['id']}/vaccination/{e['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert d.status_code == 200
        g = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        ).json()
        assert all(v["id"] != e["id"] for v in g["vaccinations"])

    def test_delete_growth(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_DelG")
        e = requests.post(
            f"{BASE_URL}/api/family/members/{m['id']}/growth",
            json={"height_cm": 100, "weight_kg": 18},
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        ).json()
        d = requests.delete(
            f"{BASE_URL}/api/family/members/{m['id']}/growth/{e['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert d.status_code == 200
        g = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        ).json()
        assert all(x["id"] != e["id"] for x in g["growth"])

    def test_delete_member(self, patient_a):
        m = self._create_member(patient_a, name="TEST_Kid_Del")
        d = requests.delete(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert d.status_code == 200
        g = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_a["headers"],
            timeout=TIMEOUT,
        )
        assert g.status_code == 404

    def test_user_scoping_cross_access_404(self, patient_a, patient_b):
        # patient_a creates a member; patient_b should not access it
        m = self._create_member(patient_a, name="TEST_Kid_Scope")
        r = requests.get(
            f"{BASE_URL}/api/family/members/{m['id']}",
            headers=patient_b["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 404

    def test_family_auth_required(self):
        r = requests.get(f"{BASE_URL}/api/family/members", timeout=TIMEOUT)
        assert r.status_code in (401, 403)
        r2 = requests.post(
            f"{BASE_URL}/api/family/members",
            json={"name": "x", "relation": "Child"},
            timeout=TIMEOUT,
        )
        assert r2.status_code in (401, 403)


# ==================== 4. Regression ====================
class TestRegression:
    def test_admin_login(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@vaidhyaji.com", "password": os.environ.get("ADMIN_PASSWORD", "Admin@123")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j
        assert j["user"]["email"] == "admin@vaidhyaji.com"

    def test_doctors_list_public(self):
        r = requests.get(f"{BASE_URL}/api/doctors", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        # Accept either list or {items: [...]}
        assert isinstance(data, (list, dict))

    def test_appointment_auth_guard(self):
        r = requests.post(
            f"{BASE_URL}/api/appointments",
            json={"doctor_id": "fake", "slot": "2026-02-01T10:00:00Z"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 403)

    def test_login_after_phone_registration(self):
        # Register a fresh user with phone, then login with same credentials.
        r, payload = _register(role="patient", phone="9876543299")
        assert r.status_code == 200
        r2 = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": payload["email"], "password": payload["password"]},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["user"]["phone"] == "9876543299"
