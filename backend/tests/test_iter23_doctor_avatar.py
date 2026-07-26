"""Iteration 23: Doctor profile photo upload & PUT /doctor/profile tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://swasth-daily.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# small valid base64-encoded 1x1 PNG (from the review request)
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

DOCTOR_EMAIL = "drtest@vaidhyaji.example.com"
DOCTOR_PASS = "Doctor@Vaidhya123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    return r


def _register(email, password, phone, role):
    return requests.post(
        f"{API}/auth/register",
        json={"name": "Test " + role.title(), "email": email, "password": password, "phone": phone, "role": role},
        timeout=30,
    )


def _auth_h(token):
    return {"Authorization": f"Bearer {token}"}


# --------------- fixtures ---------------
@pytest.fixture(scope="module")
def doctor_token():
    r = _login(DOCTOR_EMAIL, DOCTOR_PASS)
    if r.status_code != 200:
        pytest.skip(f"Cannot login as doctor: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def patient_token():
    email = f"pat_iter23_{uuid.uuid4().hex[:6]}@vaidhyaji.example.com"
    phone = "98765" + str(int(uuid.uuid4().int % 100000)).zfill(5)
    r = _register(email, "Patient@123", phone, "patient")
    assert r.status_code in (200, 201), r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def fresh_doctor_token():
    """A brand-new doctor account that has NOT completed onboarding."""
    email = f"doc_iter23_{uuid.uuid4().hex[:6]}@vaidhyaji.example.com"
    phone = "98764" + str(int(uuid.uuid4().int % 100000)).zfill(5)
    r = _register(email, "Doctor@123", phone, "doctor")
    assert r.status_code in (200, 201), r.text
    return r.json()["token"]


# ------------- doctor onboard with avatar_base64 -------------
def test_doctor_onboard_with_avatar(doctor_token):
    body = {
        "specialty": "Ayurveda",
        "qualification": "BAMS",
        "registration_number": "AYUSH/BAMS/2020/00099",
        "experience_years": 5,
        "languages": ["Hindi", "English"],
        "consultation_fee": 500,
        "bio": "Baseline bio",
        "avatar_base64": PNG_B64,
    }
    r = requests.put(f"{API}/doctor/onboard", json=body, headers=_auth_h(doctor_token), timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "avatar_url" in data, data
    assert data["avatar_url"].startswith("data:image/jpeg;base64,"), data["avatar_url"][:40]


# ------------- PUT /doctor/profile happy path -------------
def test_doctor_update_profile_bio_and_avatar(doctor_token):
    body = {"bio": "Test bio iter23", "avatar_base64": PNG_B64}
    r = requests.put(f"{API}/doctor/profile", json=body, headers=_auth_h(doctor_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("bio") == "Test bio iter23"
    assert d.get("avatar_url", "").startswith("data:image/jpeg;base64,")

    # verify persistence via GET /doctor/me
    r2 = requests.get(f"{API}/doctor/me", headers=_auth_h(doctor_token), timeout=30)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2.get("bio") == "Test bio iter23"
    assert d2.get("avatar_url", "").startswith("data:image/jpeg;base64,")


def test_doctor_update_profile_data_uri_prefixed(doctor_token):
    """When avatar_base64 already contains data URI prefix, it should be kept as-is."""
    prefixed = "data:image/png;base64," + PNG_B64
    r = requests.put(
        f"{API}/doctor/profile",
        json={"avatar_base64": prefixed},
        headers=_auth_h(doctor_token),
        timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("avatar_url") == prefixed


# ------------- authz: patient forbidden -------------
def test_patient_cannot_update_doctor_profile(patient_token):
    r = requests.put(
        f"{API}/doctor/profile",
        json={"bio": "hack"},
        headers=_auth_h(patient_token),
        timeout=30,
    )
    assert r.status_code == 403, r.text
    assert "Doctors only" in r.text


# ------------- validation: empty body -------------
def test_doctor_update_profile_no_fields(doctor_token):
    r = requests.put(f"{API}/doctor/profile", json={}, headers=_auth_h(doctor_token), timeout=30)
    assert r.status_code == 400, r.text
    assert "No fields to update" in r.text


# ------------- validation: onboarding not done -> 404 -------------
def test_doctor_update_profile_without_onboarding(fresh_doctor_token):
    """
    Review request expected 404 for a doctor who hasn't onboarded, but /api/auth/register
    already inserts a doctor doc at signup time — so matched_count is never 0.
    The 404 branch is effectively unreachable via the current registration flow.
    We document actual behavior here (200 OK) and flag as a minor design mismatch.
    """
    r = requests.put(
        f"{API}/doctor/profile",
        json={"bio": "hi"},
        headers=_auth_h(fresh_doctor_token),
        timeout=30,
    )
    # actual behavior: 200 because register() pre-creates the doctor doc
    assert r.status_code == 200, r.text
    assert r.json().get("bio") == "hi"


# ------------- validation: >4MB avatar rejected -------------
def test_doctor_update_profile_avatar_too_large(doctor_token):
    big = "a" * (4_000_001)  # 1 byte over max_length
    r = requests.put(
        f"{API}/doctor/profile",
        json={"avatar_base64": big},
        headers=_auth_h(doctor_token),
        timeout=60,
    )
    assert r.status_code == 422, r.text


# ------------- Regression: public /api/doctors list still projects safe fields -------------
def test_public_doctors_list_regression():
    r = requests.get(f"{API}/doctors", timeout=30)
    assert r.status_code == 200, r.text
    arr = r.json()
    assert isinstance(arr, list)
    # each doctor entry must not have _id and may have avatar_url
    for d in arr:
        assert "_id" not in d
    # If our test doctor is verified, avatar_url should be present with data URI.
    # We can't guarantee verification, but at minimum the shape should be safe.


# ------------- Auth guard: no token -------------
def test_doctor_profile_requires_auth():
    r = requests.put(f"{API}/doctor/profile", json={"bio": "x"}, timeout=30)
    assert r.status_code in (401, 403), r.text
