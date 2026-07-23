"""Iter 13 regression smoke test — verify no backend regressions after removing
`googleServicesFile` from frontend/app.json. Covers:
  1. GET /api/                      -> 200 with expected payload
  2. POST /api/auth/login (admin)   -> 200 + JWT
  3. POST /api/register-push        -> handles placeholder key gracefully
  4. POST /api/appointments         -> creates and returns 200/201 (non-blocking push)
  5. POST /api/payments/create-order (Razorpay)
  6. POST /api/video/session        (Daily.co)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://swasth-daily.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@vaidhyaji.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@123")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["token"]
    return data["token"]


@pytest.fixture(scope="module")
def patient(s):
    email = f"test_iter13_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com"
    payload = {"email": email, "password": "Vaidhyaji@123", "name": "TEST Iter13 Patient", "role": "patient"}
    r = s.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d["token"], "user": d["user"], "email": email}


# ---------- 1. Health ----------
def test_root(s):
    r = s.get(f"{BASE_URL}/api/", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert j.get("message") == "Online Vaidhyaji API"
    assert j.get("version") == "1.0"


# ---------- 2. Admin login ----------
def test_admin_login(admin_token):
    assert admin_token
    assert isinstance(admin_token, str) and len(admin_token) > 20


# ---------- 3. register-push placeholder handling ----------
def test_register_push_endpoint(s, patient):
    headers = {"Authorization": f"Bearer {patient['token']}"}
    r = s.post(
        f"{BASE_URL}/api/register-push",
        json={"user_id": patient["user"]["id"], "device_token": "ExponentPushToken[TEST_iter13_xxx]", "platform": "android"},
        headers=headers,
        timeout=15,
    )
    # Must not 500 — endpoint should degrade to pending/ok when upstream key is placeholder.
    assert r.status_code in (200, 201), f"register-push returned {r.status_code}: {r.text}"
    j = r.json()
    assert "status" in j
    # pending or ok are both acceptable outcomes given placeholder upstream key.
    assert j["status"] in ("pending", "ok", "unavailable"), f"unexpected status: {j}"


# ---------- 4. appointments non-blocking ----------
def test_create_appointment_non_blocking(s, patient, admin_token):
    # Need an approved doctor to book. Query doctors list.
    r = s.get(f"{BASE_URL}/api/doctors", timeout=15)
    assert r.status_code == 200
    doctors = r.json()
    if not doctors:
        pytest.skip("no doctors seeded — skipping appointment smoke test")
    doc = doctors[0]
    doc_id = doc.get("id") or doc.get("_id")
    assert doc_id
    headers = {"Authorization": f"Bearer {patient['token']}"}
    payload = {
        "doctor_id": doc_id,
        "slot": "2030-01-15T10:00:00Z",
        "reason": "TEST iter13 regression",
        "mode": "video",
    }
    r = s.post(f"{BASE_URL}/api/appointments", json=payload, headers=headers, timeout=20)
    assert r.status_code in (200, 201), f"appointment create returned {r.status_code}: {r.text}"
    j = r.json()
    assert j.get("id") or j.get("_id")


# ---------- 5. Razorpay create-order ----------
def test_razorpay_create_order(s, patient):
    headers = {"Authorization": f"Bearer {patient['token']}"}
    r = s.post(
        f"{BASE_URL}/api/payments/create-order",
        json={"amount": 199, "purpose": "appointment"},
        headers=headers,
        timeout=20,
    )
    assert r.status_code == 200, f"create-order returned {r.status_code}: {r.text}"
    j = r.json()
    assert j.get("order_id") or j.get("id"), f"missing order id: {j}"
    assert j.get("amount") in (19900, 199) or "amount" in j


# ---------- 6. Daily.co video session ----------
def test_video_session_create(s, patient, admin_token):
    # First create an appointment we own
    r = s.get(f"{BASE_URL}/api/doctors", timeout=15)
    if r.status_code != 200 or not r.json():
        pytest.skip("no doctors — skip video test")
    doc = r.json()[0]
    doc_id = doc.get("id") or doc.get("_id")
    headers = {"Authorization": f"Bearer {patient['token']}"}
    apt = s.post(
        f"{BASE_URL}/api/appointments",
        json={"doctor_id": doc_id, "slot": "2030-02-20T10:00:00Z", "reason": "TEST video iter13", "mode": "video"},
        headers=headers,
        timeout=20,
    )
    if apt.status_code not in (200, 201):
        pytest.skip(f"appointment prereq failed: {apt.status_code}")
    apt_id = apt.json().get("id")
    r = s.post(
        f"{BASE_URL}/api/video/session",
        json={"appointment_id": apt_id},
        headers=headers,
        timeout=30,
    )
    # Accept 200 or graceful degradation (e.g. 503 if Daily key placeholder)
    assert r.status_code in (200, 201, 503), f"video session returned {r.status_code}: {r.text}"
    if r.status_code == 200:
        j = r.json()
        assert "url" in j or "room_url" in j or "roomUrl" in j, f"missing room url: {j}"
