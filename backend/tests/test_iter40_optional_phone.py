"""Iter 40: phone is now truly optional for patient signup.

- Empty/omitted phone on `/auth/register` (role=patient) must succeed.
- Garbage phone still rejected with 422.
- Doctor registration still enforces a phone (via route-level check).
"""
import sys
import uuid
sys.path.insert(0, "/app/backend")

import requests

BASE = "http://localhost:8001"


class TestPatientPhoneOptional:
    def test_patient_no_phone(self):
        email = f"iter40-nophone-{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE}/api/auth/register", json={
            "name": "No Phone", "email": email,
            "password": "Aa1!aaaa", "role": "patient",
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["phone"] in (None, "")

    def test_patient_empty_phone(self):
        email = f"iter40-empty-{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE}/api/auth/register", json={
            "name": "Empty", "email": email, "password": "Aa1!aaaa",
            "role": "patient", "phone": "",
        }, timeout=15)
        assert r.status_code == 200, r.text

    def test_patient_null_phone(self):
        email = f"iter40-null-{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE}/api/auth/register", json={
            "name": "Null", "email": email, "password": "Aa1!aaaa",
            "role": "patient", "phone": None,
        }, timeout=15)
        assert r.status_code == 200, r.text

    def test_patient_valid_phone_still_normalised(self):
        email = f"iter40-good-{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE}/api/auth/register", json={
            "name": "Good", "email": email, "password": "Aa1!aaaa",
            "role": "patient", "phone": "+91 98765 43210",
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["phone"] == "9876543210"

    def test_patient_garbage_phone_still_rejected(self):
        email = f"iter40-bad-{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE}/api/auth/register", json={
            "name": "Bad", "email": email, "password": "Aa1!aaaa",
            "role": "patient", "phone": "12345",
        }, timeout=15)
        assert r.status_code == 422


class TestDoctorPhoneStillRequired:
    def test_doctor_without_phone_400(self):
        email = f"iter40-doc-{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE}/api/auth/register", json={
            "name": "Dr No Phone", "email": email,
            "password": "Aa1!aaaa", "role": "doctor",
            "registration_number": "AYU-12345",
        }, timeout=15)
        assert r.status_code == 400
        assert "required" in r.text.lower() or "phone" in r.text.lower()
