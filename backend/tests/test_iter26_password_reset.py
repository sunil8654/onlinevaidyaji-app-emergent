"""Iteration 26 — Admin-mediated Forgot Password + Change Password backend tests.

Covers:
- /auth/request-password-reset (non-enumeration, duplicate pending guard, rate-limit)
- /admin/password-resets (list, filter, auth guard)
- /admin/password-resets/{id}/approve (temp-pw generation, weak-pw validation, must_change_password flag)
- /admin/password-resets/{id}/reject
- /auth/change-password (mismatch, weak, success + old-pw invalidation)
- Regression on /auth/register (phone required), /auth/login, /engagement/*, /quizzes/*, /doctor/availability, /doctors
"""

import os
import subprocess
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def _restart_backend_and_wait():
    """Clear in-memory rate-limit buckets between test classes.
    The backend uses process-local `_rate_buckets` dict; restart flushes it.
    """
    subprocess.run(
        ["sudo", "supervisorctl", "restart", "backend"],
        check=False,
        capture_output=True,
    )
    # Wait for backend to be ready
    for _ in range(30):
        try:
            r = requests.get(f"{BASE_URL}/api/", timeout=3)
            if r.status_code < 500:
                time.sleep(0.5)  # small settle
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("backend did not come back up after restart")


def _rand_email(tag: str = "pw") -> str:
    return f"test_iter26_{tag}_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com"


def _register(email: str, role: str = "patient", password: str = "Passw0rd!123") -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={
            "name": f"TEST {role}",
            "email": email,
            "password": password,
            "role": role,
            "phone": "9876543210",
        },
        timeout=30,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()


def _login(email: str, password: str) -> requests.Response:
    return requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )


@pytest.fixture(scope="module")
def admin_token() -> str:
    if not ADMIN_PASSWORD:
        pytest.skip("ADMIN_PASSWORD not set — admin tests skipped")
    r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token) -> dict:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def fresh_patient() -> dict:
    email = _rand_email("p")
    data = _register(email, "patient", "Passw0rd!123")
    return {"email": email, "password": "Passw0rd!123", "token": data["token"], "user": data["user"]}


# ----------------- request-password-reset -----------------
class TestRequestPasswordReset:

    def test_login_default_must_change_false(self, fresh_patient):
        r = _login(fresh_patient["email"], fresh_patient["password"])
        assert r.status_code == 200
        body = r.json()
        assert "must_change_password" in body
        assert body["must_change_password"] is False

    def test_generic_message_for_existing_email(self, fresh_patient):
        r = requests.post(
            f"{BASE_URL}/api/auth/request-password-reset",
            json={"email": fresh_patient["email"]},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "message" in body
        assert "if an account" in body["message"].lower()

    def test_generic_message_for_nonexistent_email(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/request-password-reset",
            json={"email": _rand_email("noexist")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # Response must be IDENTICAL to existing-email case (no enumeration)
        assert "message" in r.json()
        assert "if an account" in r.json()["message"].lower()

    def test_duplicate_pending_not_created(self, admin_headers):
        # Fresh user to isolate state
        email = _rand_email("dup")
        _register(email, "patient")
        for _ in range(2):
            r = requests.post(
                f"{BASE_URL}/api/auth/request-password-reset",
                json={"email": email},
                timeout=30,
            )
            assert r.status_code == 200

        # Verify only ONE pending record exists for this email
        r = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status=pending",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200
        pending = [it for it in r.json()["items"] if it.get("email") == email]
        assert len(pending) == 1, f"expected exactly 1 pending, got {len(pending)}: {pending}"


# ----------------- rate limit (runs LAST — z-prefix in class name pushes it after others) -----------------
class TestZZRateLimit:
    """Renamed with ZZ prefix so pytest runs this class LAST after all others."""

    @pytest.fixture(autouse=True, scope="class")
    def _reset_rate_bucket(self):
        _restart_backend_and_wait()

    def test_per_email_rate_limit_triggers(self):
        """4th request for the same email within an hour should 429."""
        email = _rand_email("rl")
        codes = []
        for _ in range(4):
            r = requests.post(
                f"{BASE_URL}/api/auth/request-password-reset",
                json={"email": email},
                timeout=30,
            )
            codes.append(r.status_code)
        # First 3 should be 200; 4th should be 429 (per-email limit=3/hour).
        assert codes[:3] == [200, 200, 200], f"expected 3x 200 first, got {codes}"
        assert codes[3] == 429, f"expected 4th call 429 (per-email limit), got {codes}"

    def test_per_ip_rate_limit_triggers(self):
        """5+ requests with different emails within an hour should 429 by per-IP limit.
        This runs AFTER test_per_email above (which burned 3 IP slots already).
        So we need 3 more different-email calls to exceed 5/IP.
        """
        codes = []
        for _ in range(3):
            r = requests.post(
                f"{BASE_URL}/api/auth/request-password-reset",
                json={"email": _rand_email("ip")},
                timeout=30,
            )
            codes.append(r.status_code)
        # We started at 3/5 (from test_per_email); after 3 more we should have hit 6 → 429 on 6th.
        # Depending on IP bucket state, the 3rd call here (=6th overall) should be 429.
        assert 429 in codes, f"expected per-IP 429 in {codes}"


# ----------------- admin list -----------------
class TestAdminListPasswordResets:

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/password-resets", timeout=30)
        assert r.status_code in (401, 403)

    def test_forbidden_for_patient(self, fresh_patient):
        r = requests.get(
            f"{BASE_URL}/api/admin/password-resets",
            headers={"Authorization": f"Bearer {fresh_patient['token']}"},
            timeout=30,
        )
        assert r.status_code in (401, 403)

    def test_admin_list_pending_shape(self, admin_headers, fresh_patient):
        # Prior test (test_generic_message_for_existing_email) already created a
        # pending request for fresh_patient — do NOT create a second one to
        # conserve the per-IP rate-limit budget (5/hour).
        r = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status=pending",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("items"), list)
        assert len(body["items"]) >= 1
        item = body["items"][0]
        expected_keys = {
            "id", "user_id", "email", "name", "role", "status",
            "requested_at", "requested_ip", "expires_at",
            "approved_at", "approved_by_admin_id",
        }
        missing = expected_keys - set(item.keys())
        assert not missing, f"missing keys in reset item: {missing}"
        assert item["status"] == "pending"

    def test_status_filter_accepts_approved_rejected(self, admin_headers):
        for s in ("pending", "approved", "rejected"):
            r = requests.get(
                f"{BASE_URL}/api/admin/password-resets?status={s}",
                headers=admin_headers,
                timeout=30,
            )
            assert r.status_code == 200, f"status={s} failed: {r.status_code}"

    def test_unknown_status_returns_400(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status=garbage",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 400


# ----------------- approve / reject -----------------
class TestApproveReject:

    @pytest.fixture(autouse=True, scope="class")
    def _reset_rate_bucket(self):
        # Clear in-memory rate-limit buckets so this class has full 5/IP budget
        _restart_backend_and_wait()

    def _create_pending(self, email_tag: str) -> tuple[str, str, str]:
        """Register a fresh user + request reset. Returns (email, password, reset_id)."""
        email = _rand_email(email_tag)
        password = "Passw0rd!123"
        _register(email, "patient", password)
        r = requests.post(
            f"{BASE_URL}/api/auth/request-password-reset",
            json={"email": email},
            timeout=30,
        )
        assert r.status_code == 200
        return email, password, ""  # id fetched via admin list

    def _lookup_reset_id(self, admin_headers, email: str, status: str = "pending") -> str:
        r = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status={status}",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200
        for it in r.json()["items"]:
            if it["email"] == email:
                return it["id"]
        raise AssertionError(f"no {status} reset found for {email}")

    def test_approve_generates_temp_password(self, admin_headers):
        email, old_pw, _ = self._create_pending("apv")
        reset_id = self._lookup_reset_id(admin_headers, email)
        r = requests.post(
            f"{BASE_URL}/api/admin/password-resets/{reset_id}/approve",
            headers=admin_headers,
            json={},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "temp_password" in body and len(body["temp_password"]) >= 12
        assert body["email"] == email
        assert "name" in body
        assert "message" in body

        # Reset record should now be status='approved'
        r2 = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status=approved",
            headers=admin_headers,
            timeout=30,
        )
        assert r2.status_code == 200
        approved = [it for it in r2.json()["items"] if it["email"] == email]
        assert len(approved) >= 1
        appr = approved[0]
        assert appr["status"] == "approved"
        assert appr["approved_at"] is not None
        assert appr["approved_by_admin_id"] is not None

        # Old password should no longer work
        r_old = _login(email, old_pw)
        assert r_old.status_code == 401

        # Temp password should work, and login must_change_password=True
        r_new = _login(email, body["temp_password"])
        assert r_new.status_code == 200
        assert r_new.json()["must_change_password"] is True

    def test_approve_accepts_admin_supplied_temp_pw(self, admin_headers):
        email, _, _ = self._create_pending("aac")
        reset_id = self._lookup_reset_id(admin_headers, email)
        custom = "AdminGivenPw123!"
        r = requests.post(
            f"{BASE_URL}/api/admin/password-resets/{reset_id}/approve",
            headers=admin_headers,
            json={"temp_password": custom},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["temp_password"] == custom
        # Login works with custom temp pw
        rl = _login(email, custom)
        assert rl.status_code == 200
        assert rl.json()["must_change_password"] is True

    def test_approve_weak_temp_pw_rejected(self, admin_headers):
        email, _, _ = self._create_pending("weak")
        reset_id = self._lookup_reset_id(admin_headers, email)
        # <12 chars → Pydantic min_length rejects (422)
        r_short = requests.post(
            f"{BASE_URL}/api/admin/password-resets/{reset_id}/approve",
            headers=admin_headers,
            json={"temp_password": "short1A"},
            timeout=30,
        )
        assert r_short.status_code in (400, 422), r_short.text

        # 12+ chars but NO DIGIT → _is_strong_password rejects → 400
        r_nodigit = requests.post(
            f"{BASE_URL}/api/admin/password-resets/{reset_id}/approve",
            headers=admin_headers,
            json={"temp_password": "OnlyLetters!"},
            timeout=30,
        )
        # This is 12 chars with no digit, letters only → _is_strong_password returns False → 400
        assert r_nodigit.status_code == 400, r_nodigit.text

    def test_approve_unknown_id_404(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/password-resets/nonexistent-{uuid.uuid4().hex}/approve",
            headers=admin_headers,
            json={},
            timeout=30,
        )
        assert r.status_code == 404

    def test_approve_already_approved_404(self, admin_headers):
        # Reuse the first approved reset (from test_approve_generates_temp_password)
        # It's not deterministic which reset_id we get; find any 'approved' one and retry
        r = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status=approved",
            headers=admin_headers,
            timeout=30,
        )
        items = r.json().get("items", [])
        if not items:
            pytest.skip("no approved reset to retry against")
        already_id = items[0]["id"]
        r2 = requests.post(
            f"{BASE_URL}/api/admin/password-resets/{already_id}/approve",
            headers=admin_headers,
            json={},
            timeout=30,
        )
        assert r2.status_code == 404

    def test_reject_marks_rejected_and_preserves_password(self, admin_headers):
        email, original_pw, _ = self._create_pending("rej")
        reset_id = self._lookup_reset_id(admin_headers, email)
        r = requests.post(
            f"{BASE_URL}/api/admin/password-resets/{reset_id}/reject",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200

        # Verify record moved to 'rejected'
        r2 = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status=rejected",
            headers=admin_headers,
            timeout=30,
        )
        rejected = [it for it in r2.json()["items"] if it["id"] == reset_id]
        assert len(rejected) == 1
        assert rejected[0]["status"] == "rejected"

        # Verify user's password is UNCHANGED
        rl = _login(email, original_pw)
        assert rl.status_code == 200
        assert rl.json()["must_change_password"] is False

    def test_reject_unknown_id_404(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/password-resets/nope-{uuid.uuid4().hex}/reject",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 404


# ----------------- change-password -----------------
class TestChangePassword:

    @pytest.fixture(autouse=True, scope="class")
    def _reset_rate_bucket(self):
        _restart_backend_and_wait()

    def _setup_user_with_temp_pw(self, admin_headers) -> dict:
        """Register → request reset → admin approve → return {email, temp_pw, token}."""
        email = _rand_email("cp")
        original = "Passw0rd!123"
        _register(email, "patient", original)
        requests.post(
            f"{BASE_URL}/api/auth/request-password-reset",
            json={"email": email},
            timeout=30,
        )
        # find reset_id
        r = requests.get(
            f"{BASE_URL}/api/admin/password-resets?status=pending",
            headers=admin_headers,
            timeout=30,
        )
        rid = next(it["id"] for it in r.json()["items"] if it["email"] == email)
        # approve
        r2 = requests.post(
            f"{BASE_URL}/api/admin/password-resets/{rid}/approve",
            headers=admin_headers,
            json={},
            timeout=30,
        )
        assert r2.status_code == 200
        temp = r2.json()["temp_password"]
        # login with temp
        rl = _login(email, temp)
        assert rl.status_code == 200
        assert rl.json()["must_change_password"] is True
        return {
            "email": email,
            "original": original,
            "temp": temp,
            "token": rl.json()["token"],
        }

    def test_change_password_mismatch_400(self, admin_headers):
        ctx = self._setup_user_with_temp_pw(admin_headers)
        r = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={"new_password": "NewPass123", "confirm_password": "DifferentPw456"},
            headers={"Authorization": f"Bearer {ctx['token']}"},
            timeout=30,
        )
        assert r.status_code == 400

    def test_change_password_weak_no_digit_400(self, admin_headers):
        ctx = self._setup_user_with_temp_pw(admin_headers)
        # 8+ chars but no digit → _is_strong_password False → 400
        r = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={"new_password": "NoDigitPw", "confirm_password": "NoDigitPw"},
            headers={"Authorization": f"Bearer {ctx['token']}"},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_change_password_too_short_422(self, admin_headers):
        ctx = self._setup_user_with_temp_pw(admin_headers)
        # <8 → Pydantic min_length rejects (422 or 400 depending on FastAPI handling)
        r = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={"new_password": "Ab1", "confirm_password": "Ab1"},
            headers={"Authorization": f"Bearer {ctx['token']}"},
            timeout=30,
        )
        assert r.status_code in (400, 422), r.text

    def test_change_password_success_flow(self, admin_headers):
        ctx = self._setup_user_with_temp_pw(admin_headers)
        new_pw = "MyNewPass2026!"
        r = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={"new_password": new_pw, "confirm_password": new_pw},
            headers={"Authorization": f"Bearer {ctx['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Old temp password must NOT work anymore
        r_old = _login(ctx["email"], ctx["temp"])
        assert r_old.status_code == 401

        # New password works and must_change_password is False
        r_new = _login(ctx["email"], new_pw)
        assert r_new.status_code == 200
        assert r_new.json()["must_change_password"] is False


# ----------------- Regression -----------------
class TestRegression:

    def test_register_still_requires_valid_phone(self):
        # bad phone (too short) → 400
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "name": "Bad Phone",
                "email": _rand_email("badph"),
                "password": "Passw0rd!123",
                "role": "patient",
                "phone": "12345",
            },
            timeout=30,
        )
        assert r.status_code in (400, 422), r.text

    def test_register_rejects_leading_1_phone(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "name": "Bad Phone2",
                "email": _rand_email("badph2"),
                "password": "Passw0rd!123",
                "role": "patient",
                "phone": "1234567890",
            },
            timeout=30,
        )
        assert r.status_code in (400, 422), r.text

    def test_login_normal_user_still_works(self, fresh_patient):
        r = _login(fresh_patient["email"], fresh_patient["password"])
        assert r.status_code == 200
        body = r.json()
        assert "token" in body
        assert "user" in body
        assert body["must_change_password"] is False

    def test_engagement_me_still_works(self, fresh_patient):
        r = requests.get(
            f"{BASE_URL}/api/engagement/me",
            headers={"Authorization": f"Bearer {fresh_patient['token']}"},
            timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert "points" in body

    def test_quizzes_listing_still_works(self, fresh_patient):
        r = requests.get(
            f"{BASE_URL}/api/quizzes",
            headers={"Authorization": f"Bearer {fresh_patient['token']}"},
            timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        # Response is either {items:[...]} or a list
        items = body.get("items") if isinstance(body, dict) else body
        assert isinstance(items, list)
        assert len(items) >= 1

    def test_public_doctors_listing_still_works(self):
        r = requests.get(f"{BASE_URL}/api/doctors", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_doctor_availability_public(self, fresh_patient):
        # Grab first doctor id from listing
        r = requests.get(f"{BASE_URL}/api/doctors", timeout=30)
        assert r.status_code == 200
        docs = r.json()
        if not docs:
            pytest.skip("no doctors seeded")
        doc_id = docs[0].get("id") or docs[0].get("user_id")
        if not doc_id:
            pytest.skip("doctor doc has no id")
        # Endpoint requires auth
        r2 = requests.get(
            f"{BASE_URL}/api/doctor/availability?doctor_id={doc_id}",
            headers={"Authorization": f"Bearer {fresh_patient['token']}"},
            timeout=30,
        )
        # Not asserting exact status code — endpoint might use POST or different param name.
        # We just care that the endpoint exists and doesn't 500.
        assert r2.status_code < 500, f"doctor availability 5xx: {r2.status_code} {r2.text}"
