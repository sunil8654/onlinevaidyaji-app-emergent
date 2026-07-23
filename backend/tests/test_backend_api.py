"""Comprehensive backend API tests for Online Vaidhyaji."""
import uuid
import pytest


# --------------- Health ---------------
class TestHealth:
    def test_root_health(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("message") == "Online Vaidhyaji API"
        assert "version" in body


# --------------- Auth ---------------
class TestAuth:
    def test_register_patient(self, patient_ctx):
        assert patient_ctx["token"]
        u = patient_ctx["user"]
        assert u["role"] == "patient"
        assert u["email"].startswith("test_") or u["email"].startswith("TEST_".lower())
        assert "password" not in u
        assert "_id" not in u
        assert "id" in u and u["id"]

    def test_register_doctor(self, doctor_ctx):
        assert doctor_ctx["token"]
        assert doctor_ctx["user"]["role"] == "doctor"

    def test_register_duplicate_email(self, api_client, base_url, patient_ctx):
        r = api_client.post(f"{base_url}/api/auth/register", json={
            "name": "Dup",
            "email": patient_ctx["email"],
            "password": "whatever",
            "role": "patient",
            "phone": "9999999998",
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_login_valid(self, api_client, base_url, patient_ctx):
        r = api_client.post(f"{base_url}/api/auth/login", json={
            "email": patient_ctx["email"],
            "password": patient_ctx["password"],
        }, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and data["token"]
        assert data["user"]["email"] == patient_ctx["email"]
        assert "password" not in data["user"]
        assert "_id" not in data["user"]

    def test_login_invalid(self, api_client, base_url, patient_ctx):
        r = api_client.post(f"{base_url}/api/auth/login", json={
            "email": patient_ctx["email"], "password": "wrongpass"
        }, timeout=15)
        assert r.status_code == 401

    def test_me_with_bearer(self, api_client, base_url, patient_ctx):
        r = api_client.get(f"{base_url}/api/auth/me",
                           headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == patient_ctx["email"]
        assert "password" not in body

    def test_me_without_bearer(self, api_client, base_url):
        # Use bare Session (no auth header) but requests may not add cookies
        r = api_client.get(f"{base_url}/api/auth/me", timeout=15,
                           headers={"Authorization": ""})
        assert r.status_code == 401


# --------------- Patient Profile ---------------
class TestPatientProfile:
    def test_put_and_get_profile(self, api_client, base_url, patient_ctx):
        body = {
            "age": 30, "gender": "female", "dosha": "Pitta",
            "conditions": ["acidity", "insomnia"], "lifestyle": "sedentary"
        }
        r = api_client.put(f"{base_url}/api/patient/profile",
                           json=body, headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["dosha"] == "Pitta"
        assert saved["age"] == 30

        g = api_client.get(f"{base_url}/api/patient/profile",
                           headers=patient_ctx["headers"], timeout=15)
        assert g.status_code == 200
        data = g.json()
        assert data["dosha"] == "Pitta"
        assert data["conditions"] == ["acidity", "insomnia"]
        assert data["age"] == 30
        assert data["gender"] == "female"

    def test_doctor_cannot_update_patient_profile(self, api_client, base_url, doctor_ctx):
        r = api_client.put(f"{base_url}/api/patient/profile",
                           json={"dosha": "Vata"},
                           headers=doctor_ctx["headers"], timeout=15)
        assert r.status_code == 403


# --------------- Doctors ---------------
class TestDoctors:
    def test_list_doctors(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/doctors", timeout=15)
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        assert len(docs) >= 5
        for d in docs:
            assert "id" in d and "name" in d and "specialty" in d
            assert "_id" not in d

    def test_filter_by_specialty(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/doctors?specialty=Ayurveda", timeout=15)
        assert r.status_code == 200
        docs = r.json()
        assert all(d["specialty"] == "Ayurveda" for d in docs)
        assert len(docs) >= 1

    def test_get_doctor_by_id(self, api_client, base_url):
        docs = api_client.get(f"{base_url}/api/doctors", timeout=15).json()
        first = docs[0]
        r = api_client.get(f"{base_url}/api/doctors/{first['id']}", timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == first["id"]

    def test_get_doctor_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/doctors/{uuid.uuid4()}", timeout=15)
        assert r.status_code == 404


# --------------- Appointments ---------------
class TestAppointments:
    def test_book_appointment_and_list(self, api_client, base_url, patient_ctx):
        docs = api_client.get(f"{base_url}/api/doctors?specialty=Ayurveda").json()
        doc = docs[0]
        slot = "2026-02-15T10:00:00Z"
        r = api_client.post(f"{base_url}/api/appointments",
                            json={"doctor_id": doc["id"], "slot": slot,
                                  "reason": "acidity consult"},
                            headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        appt = r.json()
        assert appt["doctor_name"] == doc["name"]
        assert appt["doctor_specialty"] == doc["specialty"]
        assert appt["slot"] == slot
        assert appt["status"] == "confirmed"
        assert "_id" not in appt

        lst = api_client.get(f"{base_url}/api/appointments",
                             headers=patient_ctx["headers"], timeout=15)
        assert lst.status_code == 200
        items = lst.json()
        assert any(a["id"] == appt["id"] for a in items)

    def test_book_appointment_bad_doctor(self, api_client, base_url, patient_ctx):
        r = api_client.post(f"{base_url}/api/appointments",
                            json={"doctor_id": str(uuid.uuid4()),
                                  "slot": "2026-02-15T10:00:00Z"},
                            headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 404


# --------------- Feed & Daily Tip ---------------
class TestFeed:
    def test_feed(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/feed", timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 3
        for it in items:
            assert "title" in it and "body" in it
            assert "_id" not in it

    def test_daily_tip(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/daily-tip", timeout=15)
        assert r.status_code == 200
        tip = r.json()
        assert "title" in tip and "body" in tip


# --------------- Reminders CRUD ---------------
class TestReminders:
    def test_reminder_crud(self, api_client, base_url, patient_ctx):
        payload = {"medicine_name": "Ashwagandha", "dosage": "1 tab",
                   "times": ["08:00", "20:00"], "notes": "post-meal"}
        c = api_client.post(f"{base_url}/api/reminders", json=payload,
                            headers=patient_ctx["headers"], timeout=15)
        assert c.status_code == 200, c.text
        rem = c.json()
        rid = rem["id"]
        assert rem["medicine_name"] == "Ashwagandha"
        assert rem["active"] is True
        assert "_id" not in rem

        lst = api_client.get(f"{base_url}/api/reminders",
                             headers=patient_ctx["headers"], timeout=15).json()
        assert any(r["id"] == rid for r in lst)

        d = api_client.delete(f"{base_url}/api/reminders/{rid}",
                              headers=patient_ctx["headers"], timeout=15)
        assert d.status_code == 200
        assert d.json().get("ok") is True

        lst2 = api_client.get(f"{base_url}/api/reminders",
                              headers=patient_ctx["headers"], timeout=15).json()
        assert all(r["id"] != rid for r in lst2)

    def test_delete_unknown_reminder_404(self, api_client, base_url, patient_ctx):
        r = api_client.delete(f"{base_url}/api/reminders/{uuid.uuid4()}",
                              headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 404


# --------------- Challenges ---------------
class TestChallenges:
    def test_list_and_join(self, api_client, base_url, patient_ctx):
        lst = api_client.get(f"{base_url}/api/challenges",
                             headers=patient_ctx["headers"], timeout=15)
        assert lst.status_code == 200
        challenges = lst.json()
        assert isinstance(challenges, list) and len(challenges) >= 1
        first = challenges[0]
        assert "joined" in first and "streak" in first

        j = api_client.post(f"{base_url}/api/challenges/join",
                            json={"challenge_id": first["id"]},
                            headers=patient_ctx["headers"], timeout=15)
        assert j.status_code == 200
        assert j.json().get("streak") == 1

        lst2 = api_client.get(f"{base_url}/api/challenges",
                              headers=patient_ctx["headers"], timeout=15).json()
        joined = next(c for c in lst2 if c["id"] == first["id"])
        assert joined["joined"] is True
        assert joined["streak"] == 1

    def test_join_unknown_challenge(self, api_client, base_url, patient_ctx):
        r = api_client.post(f"{base_url}/api/challenges/join",
                            json={"challenge_id": str(uuid.uuid4())},
                            headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 404


# --------------- AI Chat ---------------
class TestChat:
    def test_chat_message_and_history(self, api_client, base_url, patient_ctx):
        session_id = f"test-{uuid.uuid4().hex[:8]}"
        r = api_client.post(f"{base_url}/api/chat/message",
                            json={"session_id": session_id,
                                  "message": "I have mild indigestion after lunch."},
                            headers=patient_ctx["headers"], timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reply" in data and isinstance(data["reply"], str) and len(data["reply"]) > 5

        h = api_client.get(f"{base_url}/api/chat/history/{session_id}",
                           headers=patient_ctx["headers"], timeout=30)
        assert h.status_code == 200
        msgs = h.json()
        assert isinstance(msgs, list) and len(msgs) >= 2
        roles = [m["role"] for m in msgs]
        assert "user" in roles and "assistant" in roles


# --------------- Analytics ---------------
class TestAnalytics:
    def test_track_event(self, api_client, base_url, patient_ctx):
        r = api_client.post(f"{base_url}/api/analytics",
                            json={"event": "screen_view",
                                  "props": {"screen": "home"}},
                            headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_analytics_requires_auth(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/analytics",
                            json={"event": "x"},
                            headers={"Authorization": ""}, timeout=15)
        assert r.status_code == 401
