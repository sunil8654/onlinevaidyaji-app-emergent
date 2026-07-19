"""
Iter 8 verification tests:
1. Rejoin flow: patient joins twice + doctor joins after → all get the SAME persisted room
   (validates the Daily 400 "already exists" fix in _daily_create_room).
2. Smoke tests for critical unrelated endpoints (/api/, login, doctors list, appointments list).
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://swasth-daily.preview.emergentagent.com",
).rstrip("/")


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
    assert r.status_code == 200, f"register {role} failed: {r.status_code} {r.text}"
    d = r.json()
    return {
        "token": d["token"],
        "user": d["user"],
        "headers": {"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"},
    }


def _admin_headers() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
        timeout=30,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


# ---------- Rejoin flow ----------
class TestScheduledRejoinPersistsSameRoom:
    """Regression for room-already-exists 400 handling.

    Patient books an appointment, joins video twice (2nd call must NOT 502 and must
    return the SAME room_name). Then a doctor (owner of that appointment) also joins
    and MUST get the exact same room_name — proving the persisted room is reused."""

    def test_rejoin_patient_twice_same_room(self):
        """Core validation of the 400 'already exists' fix — patient join #2 must
        NOT 502 and must return the SAME room_name/url as join #1."""
        patient = _register("patient")

        # Pick a real doctor from listing (owned by some registered doctor user)
        r = requests.get(f"{BASE_URL}/api/doctors", timeout=30)
        assert r.status_code == 200
        docs = r.json()
        assert docs, "no doctors seeded"

        # We need a doctor we can *login as* — try registering a fresh doctor user
        # so we control their credentials. Doctors created via /api/auth/register with
        # role=doctor become listable doctor accounts on this backend.
        doctor = _register("doctor")

        # Refetch doctor list & find our newly registered doctor (server may enrich
        # /api/doctors with those registered accounts). Fallback: any doctor whose
        # id matches the doctor user id.
        r2 = requests.get(f"{BASE_URL}/api/doctors", timeout=30)
        assert r2.status_code == 200
        docs2 = r2.json()
        target_doc = next(
            (d for d in docs2 if d.get("id") == doctor["user"]["id"]
             or d.get("user_id") == doctor["user"]["id"]),
            None,
        )
        if not target_doc:
            # Backend may not auto-list newly-registered doctors; fall back to first
            # doctor and skip the "doctor joins" leg if we can't authenticate as them.
            target_doc = docs2[0]

        # Book appointment as patient with target_doc
        slot = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        rb = requests.post(
            f"{BASE_URL}/api/appointments",
            json={"doctor_id": target_doc["id"], "slot": slot, "reason": "TEST_rejoin"},
            headers=patient["headers"],
            timeout=30,
        )
        assert rb.status_code == 200, f"book appt: {rb.status_code} {rb.text}"
        appt_id = rb.json()["id"]

        # Patient join #1 (creates room in Daily.co)
        r1 = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"appointment_id": appt_id},
            headers=patient["headers"],
            timeout=45,
        )
        assert r1.status_code == 200, f"patient join1: {r1.status_code} {r1.text}"
        room1 = r1.json()["room_name"]
        url1 = r1.json()["room_url"]

        # Patient join #2 – Daily will return 400 "already exists"; server MUST
        # gracefully GET the existing room and return the same name/url (not 502).
        r2p = requests.post(
            f"{BASE_URL}/api/video/session",
            json={"appointment_id": appt_id},
            headers=patient["headers"],
            timeout=45,
        )
        assert r2p.status_code == 200, (
            f"patient join2 (rejoin) MUST NOT 502 – got {r2p.status_code} {r2p.text}. "
            "The Daily 400 'already exists' handling is broken."
        )
        room2 = r2p.json()["room_name"]
        url2 = r2p.json()["room_url"]
        assert room2 == room1, f"rejoin returned different room: {room1} vs {room2}"
        assert url2 == url1, f"rejoin returned different url: {url1} vs {url2}"

        # Doctor join – only meaningful if the doctor listing includes the doctor we
        # registered (so we can auth as owner). Otherwise, log and continue.
        if target_doc.get("id") == doctor["user"]["id"] or target_doc.get("user_id") == doctor["user"]["id"]:
            r3 = requests.post(
                f"{BASE_URL}/api/video/session",
                json={"appointment_id": appt_id},
                headers=doctor["headers"],
                timeout=45,
            )
            assert r3.status_code == 200, f"doctor join: {r3.status_code} {r3.text}"
            room3 = r3.json()["room_name"]
            assert room3 == room1, f"doctor got different room: {room1} vs {room3}"
            assert r3.json()["is_owner"] is True, "doctor must be owner"
        else:
            print(
                "\n[INFO] Registered doctor not exposed via /api/doctors; "
                "doctor-owner join leg not asserted. Patient-rejoin leg validated."
            )

        # Verify persisted room_name on the appointment doc
        rl = requests.get(f"{BASE_URL}/api/appointments", headers=patient["headers"], timeout=30)
        assert rl.status_code == 200
        appt = next((a for a in rl.json() if a["id"] == appt_id), None)
        assert appt is not None
        assert appt.get("daily_room_name") == room1


# ---------- Smoke tests for unrelated critical endpoints ----------
class TestBackendSmoke:
    def test_health_check(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200, f"health: {r.status_code} {r.text}"
        # response body is not strictly specified – accept any JSON / text 200

    def test_admin_login(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@vaidhyaji.com", "password": "Admin@123"},
            timeout=30,
        )
        assert r.status_code == 200
        d = r.json()
        assert "token" in d and "user" in d
        assert d["user"].get("is_admin") is True or d["user"].get("role") == "admin"

    def test_list_doctors(self):
        r = requests.get(f"{BASE_URL}/api/doctors", timeout=30)
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        if docs:
            assert "id" in docs[0]
            assert "_id" not in docs[0], "_id leaked in /api/doctors"

    def test_list_appointments_authed(self):
        headers = _admin_headers()
        r = requests.get(f"{BASE_URL}/api/appointments", headers=headers, timeout=30)
        # admin listing may be empty for admin user but must not error
        assert r.status_code == 200, f"list appts: {r.status_code} {r.text}"
        appts = r.json()
        assert isinstance(appts, list)
        if appts:
            assert "_id" not in appts[0], "_id leaked in /api/appointments"
