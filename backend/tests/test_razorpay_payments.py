"""Razorpay Payments backend tests (real Razorpay Test API — no mocks).

Covers:
- Create order (happy path + validation)
- Verify signature (valid HMAC, invalid, cross-user)
- Reference-id side effect (appointment.paid=true)
- Public checkout HTML page
- Regression: video session + admin patients aggregation
"""

import os
import hmac
import hashlib
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

# Load backend .env to get secret + Mongo access
BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(BACKEND_ENV)

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")


def _sign(order_id: str, payment_id: str, secret: str) -> str:
    body = f"{order_id}|{payment_id}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


async def _mongo_find_payment(order_id: str):
    client = AsyncIOMotorClient(MONGO_URL)
    doc = await client[DB_NAME].payments.find_one({"razorpay_order_id": order_id}, {"_id": 0})
    client.close()
    return doc


async def _mongo_find_appt(appt_id: str):
    client = AsyncIOMotorClient(MONGO_URL)
    doc = await client[DB_NAME].appointments.find_one({"id": appt_id}, {"_id": 0})
    client.close()
    return doc


# -------- Payment order creation --------
class TestCreateOrder:
    def test_create_order_happy_path(self, api_client, base_url, patient_ctx):
        r = api_client.post(
            f"{base_url}/api/payments/create-order",
            json={"amount": 20000, "purpose": "diet_plan", "description": "TEST diet plan"},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["order_id"].startswith("order_"), data
        assert data["amount"] == 20000
        assert data["currency"] == "INR"
        assert data["key_id"] == RAZORPAY_KEY_ID
        assert data["receipt"].startswith("vaidhya_diet_pla_"), data["receipt"]
        assert data["purpose"] == "diet_plan"

        # Verify Mongo persistence
        doc = asyncio.run(_mongo_find_payment(data["order_id"]))
        assert doc is not None, "payments doc not persisted"
        assert doc["status"] == "created"
        assert doc["amount"] == 20000
        assert doc["user_id"] == patient_ctx["user"]["id"]

    def test_amount_too_small(self, api_client, base_url, patient_ctx):
        r = api_client.post(
            f"{base_url}/api/payments/create-order",
            json={"amount": 50, "purpose": "custom"},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_currency_not_inr(self, api_client, base_url, patient_ctx):
        r = api_client.post(
            f"{base_url}/api/payments/create-order",
            json={"amount": 20000, "currency": "USD", "purpose": "custom"},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_auth_required(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/payments/create-order",
            json={"amount": 20000, "purpose": "custom"},
            timeout=30,
        )
        assert r.status_code in (401, 403), r.text


# -------- Verify signature --------
class TestVerifySignature:
    def _create(self, api_client, base_url, headers, purpose="custom", ref=None):
        payload = {"amount": 15000, "purpose": purpose}
        if ref:
            payload["reference_id"] = ref
        r = api_client.post(
            f"{base_url}/api/payments/create-order",
            json=payload,
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_valid_signature(self, api_client, base_url, patient_ctx):
        order = self._create(api_client, base_url, patient_ctx["headers"], purpose="custom")
        payment_id = "pay_TEST_" + uuid.uuid4().hex[:12]
        sig = _sign(order["order_id"], payment_id, RAZORPAY_KEY_SECRET)
        r = api_client.post(
            f"{base_url}/api/payments/verify",
            json={
                "razorpay_order_id": order["order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": sig,
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["success"] is True
        assert data["razorpay_payment_id"] == payment_id

        # Verify DB update
        doc = asyncio.run(_mongo_find_payment(order["order_id"]))
        assert doc["status"] == "paid"
        assert doc["razorpay_payment_id"] == payment_id
        assert doc["verified_at"] is not None

    def test_invalid_signature(self, api_client, base_url, patient_ctx):
        order = self._create(api_client, base_url, patient_ctx["headers"], purpose="custom")
        payment_id = "pay_TEST_" + uuid.uuid4().hex[:12]
        bad_sig = "0" * 64
        r = api_client.post(
            f"{base_url}/api/payments/verify",
            json={
                "razorpay_order_id": order["order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": bad_sig,
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 400
        assert "signature" in r.json().get("detail", "").lower()

        # Doc remains status=created
        doc = asyncio.run(_mongo_find_payment(order["order_id"]))
        assert doc["status"] == "created"

    def test_cross_user_forbidden(self, api_client, base_url, patient_ctx, doctor_ctx):
        # patient creates order; doctor (different user) tries to verify
        order = self._create(api_client, base_url, patient_ctx["headers"], purpose="custom")
        payment_id = "pay_TEST_" + uuid.uuid4().hex[:12]
        sig = _sign(order["order_id"], payment_id, RAZORPAY_KEY_SECRET)
        r = api_client.post(
            f"{base_url}/api/payments/verify",
            json={
                "razorpay_order_id": order["order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": sig,
            },
            headers=doctor_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 403, r.text

    def test_appointment_side_effect(self, api_client, base_url, patient_ctx):
        # 1. Find a doctor
        d = api_client.get(f"{base_url}/api/doctors", timeout=30)
        assert d.status_code == 200
        doctors = d.json()
        assert doctors, "no seeded doctors"
        doctor_id = doctors[0]["id"]

        # 2. Book appointment
        a = api_client.post(
            f"{base_url}/api/appointments",
            json={"doctor_id": doctor_id, "slot": "2030-01-15T10:00:00Z", "reason": "TEST"},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert a.status_code == 200, a.text
        appt = a.json()
        assert appt["paid"] is False

        # 3. Create order tied to appointment
        order = self._create(
            api_client, base_url, patient_ctx["headers"],
            purpose="appointment", ref=appt["id"],
        )
        payment_id = "pay_TEST_" + uuid.uuid4().hex[:12]
        sig = _sign(order["order_id"], payment_id, RAZORPAY_KEY_SECRET)

        # 4. Verify
        r = api_client.post(
            f"{base_url}/api/payments/verify",
            json={
                "razorpay_order_id": order["order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": sig,
            },
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text

        # 5. Appointment now paid
        appt_doc = asyncio.run(_mongo_find_appt(appt["id"]))
        assert appt_doc["paid"] is True
        assert appt_doc.get("razorpay_payment_id") == payment_id


# -------- My payments --------
class TestMyPayments:
    def test_list_mine(self, api_client, base_url, patient_ctx):
        r = api_client.get(f"{base_url}/api/payments/mine", headers=patient_ctx["headers"], timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # After previous tests, patient should have >=1
        assert len(data) >= 1
        assert all("razorpay_order_id" in p for p in data)


# -------- Checkout HTML --------
class TestCheckoutPage:
    def test_html_page(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/payments/checkout/order_TESTABC123?amount=20000&name=TestX&description=DescX",
            timeout=30,
        )
        assert r.status_code == 200
        html = r.text
        assert "checkout.razorpay.com/v1/checkout.js" in html
        assert "ReactNativeWebView.postMessage" in html
        assert "order_TESTABC123" in html
        assert RAZORPAY_KEY_ID in html

    def test_invalid_order_id(self, api_client, base_url):
        # All-special characters strip to empty -> 400
        r = api_client.get(
            f"{base_url}/api/payments/checkout/%21%40%23%24?amount=20000",
            timeout=30,
        )
        assert r.status_code == 400, r.text


# -------- Regression checks --------
class TestRegression:
    def test_admin_login_and_patients(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}
        p = api_client.get(f"{base_url}/api/admin/patients", headers=h, timeout=30)
        assert p.status_code == 200
        arr = p.json()
        assert isinstance(arr, list)
        if arr:
            # Aggregation adds "appointments" count
            assert "appointments" in arr[0]

    def test_video_session_creates(self, api_client, base_url, patient_ctx):
        # doctor list -> pick one for instant consult (Daily.co)
        d = api_client.get(f"{base_url}/api/doctors", timeout=30)
        assert d.status_code == 200
        doctors = d.json()
        assert doctors
        r = api_client.post(
            f"{base_url}/api/video/session",
            json={"doctor_id": doctors[0]["id"], "duration_minutes": 30},
            headers=patient_ctx["headers"],
            timeout=45,
        )
        # 200 if DAILY key valid; 502/503 if Daily unavailable — flag but not fail
        if r.status_code != 200:
            pytest.skip(f"Daily video session unavailable: {r.status_code} {r.text[:200]}")
        data = r.json()
        assert "room_url" in data
        assert "token" in data
        assert "embed_url" in data
