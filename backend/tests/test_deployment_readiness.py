"""
Regression tests for deployment readiness changes:
- CORS reads from CORS_ORIGINS env var
- /api/admin/patients refactored to aggregation pipeline ($lookup) with appointments count
Also checks core auth + admin flows: health, admin login, admin/stats, admin/doctors, register.
"""
import uuid
import pytest


# ---------- Health check ----------
class TestHealth:
    def test_root_health(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("message") == "Online Vaidhyaji API"
        assert "version" in data


# ---------- CORS headers ----------
class TestCORS:
    def test_cors_preflight_allow_origin(self, api_client, base_url):
        # Preflight OPTIONS request should return CORS headers
        r = api_client.options(
            f"{base_url}/api/",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
            timeout=30,
        )
        # Starlette responds with 200 for successful preflight
        assert r.status_code in (200, 204), f"unexpected preflight: {r.status_code} {r.text}"
        allow_origin = r.headers.get("access-control-allow-origin")
        assert allow_origin is not None, f"missing Access-Control-Allow-Origin. headers={dict(r.headers)}"
        # CORS_ORIGINS="*" — expect wildcard or reflected origin
        assert allow_origin in ("*", "https://example.com"), f"unexpected origin: {allow_origin}"

    def test_cors_simple_get_has_header(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/",
            headers={"Origin": "https://example.com"},
            timeout=30,
        )
        assert r.status_code == 200
        allow_origin = r.headers.get("access-control-allow-origin")
        assert allow_origin is not None, "missing CORS header on simple GET"


# ---------- Admin auth ----------
class TestAdminAuth:
    def test_admin_login_returns_jwt_and_flag(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
        assert "user" in data
        user = data["user"]
        assert user.get("is_admin") is True
        assert user.get("role") == "admin"
        assert user.get("email") == "admin@vaidhyaji.com"


@pytest.fixture(scope="module")
def admin_ctx(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
        timeout=30,
    )
    assert r.status_code == 200, f"admin login failed: {r.text}"
    d = r.json()
    return {
        "token": d["token"],
        "user": d["user"],
        "headers": {"Authorization": f"Bearer {d['token']}"},
    }


# ---------- Register (regression) ----------
class TestRegister:
    def test_register_new_patient(self, api_client, base_url):
        email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
        payload = {
            "name": "TEST_Patient_Deploy",
            "email": email,
            "password": "Passw0rd!123",
            "role": "patient",
            "phone": "9999900001",
        }
        r = api_client.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data
        assert data["user"]["email"] == email
        assert data["user"]["role"] == "patient"
        assert data["user"].get("is_admin") in (False, None)


# ---------- Admin endpoints ----------
class TestAdminEndpoints:
    def test_admin_stats(self, api_client, base_url, admin_ctx):
        r = api_client.get(f"{base_url}/api/admin/stats", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        # Should contain some counts (best-effort structural check)
        assert len(data) > 0

    def test_admin_doctors_list(self, api_client, base_url, admin_ctx):
        r = api_client.get(f"{base_url}/api/admin/doctors", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_admin_patients_aggregation(self, api_client, base_url, admin_ctx):
        """CRITICAL: refactored aggregation endpoint returns patients with appointments count."""
        # Ensure at least one patient exists so we can validate the shape
        email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
        reg = api_client.post(
            f"{base_url}/api/auth/register",
            json={
                "name": "TEST_Patient_Agg",
                "email": email,
                "password": "Passw0rd!123",
                "role": "patient",
                "phone": "9999900002",
            },
            timeout=30,
        )
        assert reg.status_code == 200, reg.text

        r = api_client.get(
            f"{base_url}/api/admin/patients", headers=admin_ctx["headers"], timeout=30
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list), f"expected list, got {type(data)}"
        assert len(data) >= 1, "expected at least one patient"

        # No leaked _id or password
        for u in data:
            assert "_id" not in u, "MongoDB _id leaked in response"
            assert "password" not in u, "password leaked in response"
            assert u.get("role") == "patient"
            assert "appointments" in u, f"missing appointments count field: keys={list(u.keys())}"
            assert isinstance(u["appointments"], int), f"appointments must be int, got {type(u['appointments'])}"
            assert u["appointments"] >= 0

        # Ensure our newly registered patient appears with appointments==0
        target = next((u for u in data if u.get("email") == email), None)
        assert target is not None, "newly registered patient not found in admin list"
        assert target["appointments"] == 0

    def test_admin_patients_appointments_count_increments(self, api_client, base_url, admin_ctx):
        """Verify $lookup+$size correctly counts appointments per patient."""
        # 1) Register a new patient
        email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
        reg = api_client.post(
            f"{base_url}/api/auth/register",
            json={
                "name": "TEST_Patient_Count",
                "email": email,
                "password": "Passw0rd!123",
                "role": "patient",
                "phone": "9999900004",
            },
            timeout=30,
        )
        assert reg.status_code == 200, reg.text
        patient_token = reg.json()["token"]
        patient_headers = {"Authorization": f"Bearer {patient_token}"}

        # 2) Get an available doctor from public listing
        docs_resp = api_client.get(f"{base_url}/api/doctors", timeout=30)
        assert docs_resp.status_code == 200, docs_resp.text
        doctors = docs_resp.json()
        if not doctors:
            pytest.skip("No doctors seeded to book appointments")
        doctor_id = doctors[0]["id"]

        # 3) Book 2 appointments
        for i in range(2):
            appt = api_client.post(
                f"{base_url}/api/appointments",
                headers=patient_headers,
                json={
                    "doctor_id": doctor_id,
                    "slot": f"2026-06-15T1{i}:00:00Z",
                    "reason": "TEST_regression_check",
                },
                timeout=30,
            )
            assert appt.status_code == 200, appt.text

        # 4) Fetch admin patients list and validate count
        r = api_client.get(
            f"{base_url}/api/admin/patients", headers=admin_ctx["headers"], timeout=30
        )
        assert r.status_code == 200, r.text
        data = r.json()
        target = next((u for u in data if u.get("email") == email), None)
        assert target is not None, "patient missing from admin list"
        assert target["appointments"] == 2, (
            f"expected 2 appointments from $lookup+$size, got {target['appointments']}"
        )

    def test_admin_patients_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/admin/patients", timeout=30)
        assert r.status_code in (401, 403), f"expected auth error, got {r.status_code}"

    def test_admin_patients_forbidden_for_patient(self, api_client, base_url):
        # Register a plain patient and confirm they cannot access admin endpoint
        email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
        reg = api_client.post(
            f"{base_url}/api/auth/register",
            json={
                "name": "TEST_NoAdmin",
                "email": email,
                "password": "Passw0rd!123",
                "role": "patient",
                "phone": "9999900003",
            },
            timeout=30,
        )
        assert reg.status_code == 200
        token = reg.json()["token"]
        r = api_client.get(
            f"{base_url}/api/admin/patients",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        assert r.status_code in (401, 403), f"expected forbidden, got {r.status_code} {r.text}"
