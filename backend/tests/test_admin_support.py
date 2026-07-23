"""Iteration 3 backend tests:
- Admin login + is_admin
- Admin stats / doctors / patients / activity / leads
- 403 for non-admin
- Doctor self-registration -> pending doctor in doctors collection
- Public /api/doctors hides unverified doctors
- Approve/reject/delete doctor
- Support chat (no-auth) + lead capture
- Support lead POST
"""
import uuid
import time
import pytest


ADMIN_EMAIL = "admin@vaidhyaji.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@123")


# --------------- Admin auth ---------------
@pytest.fixture(scope="session")
def admin_ctx(api_client, base_url):
    r = api_client.post(f"{base_url}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
    }, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


class TestAdminLogin:
    def test_admin_login_returns_is_admin_true(self, admin_ctx):
        u = admin_ctx["user"]
        assert admin_ctx["token"]
        assert u.get("is_admin") is True
        assert u.get("role") == "admin"
        assert u.get("email") == ADMIN_EMAIL
        assert "password" not in u
        assert "_id" not in u

    def test_admin_login_idempotent(self, api_client, base_url):
        # Second login should still succeed
        r1 = api_client.post(f"{base_url}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        }, timeout=15)
        r2 = api_client.post(f"{base_url}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        }, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json()["user"]["is_admin"] is True


# --------------- Admin stats ---------------
class TestAdminStats:
    def test_stats_returns_all_numeric_keys(self, api_client, base_url, admin_ctx):
        r = api_client.get(f"{base_url}/api/admin/stats",
                           headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["patients", "doctors", "verified_doctors", "pending_doctors",
                  "appointments", "consultations_today", "reminders", "leads"]:
            assert k in data, f"missing key {k}"
            assert isinstance(data[k], int), f"{k} not int: {type(data[k])}"

    def test_stats_forbidden_for_patient(self, api_client, base_url, patient_ctx):
        r = api_client.get(f"{base_url}/api/admin/stats",
                           headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 403

    def test_stats_forbidden_no_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/admin/stats",
                           headers={"Authorization": ""}, timeout=15)
        assert r.status_code == 401


# --------------- Admin doctors list/filter ---------------
class TestAdminDoctorsList:
    def test_list_all_doctors(self, api_client, base_url, admin_ctx):
        r = api_client.get(f"{base_url}/api/admin/doctors",
                           headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 6

    def test_filter_verified(self, api_client, base_url, admin_ctx):
        r = api_client.get(f"{base_url}/api/admin/doctors?verify_status=verified",
                           headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 200
        for d in r.json():
            assert d.get("verified") is True

    def test_filter_pending(self, api_client, base_url, admin_ctx):
        r = api_client.get(f"{base_url}/api/admin/doctors?verify_status=pending",
                           headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 200
        for d in r.json():
            assert d.get("verified") is False


# --------------- Admin CRUD doctor ---------------
class TestAdminDoctorCrud:
    def test_create_approve_reject_delete_doctor(
        self, api_client, base_url, admin_ctx
    ):
        # 1) Create
        body = {
            "name": "TEST_Dr_Admin_Created",
            "email": f"test_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com",
            "phone": "9998887777",
            "specialty": "Yoga",
            "qualification": "MSc Yoga",
            "experience_years": 3,
            "languages": ["Hindi", "English"],
            "consultation_fee": 299,
            "bio": "TEST doctor for admin CRUD",
            "verified": True,
        }
        c = api_client.post(f"{base_url}/api/admin/doctors", json=body,
                            headers=admin_ctx["headers"], timeout=15)
        assert c.status_code == 200, c.text
        created = c.json()
        did = created["id"]
        assert created["name"] == body["name"]
        assert created["specialty"] == "Yoga"
        assert "_id" not in created

        # 2) Reject -> verified False
        rj = api_client.post(f"{base_url}/api/admin/doctors/{did}/reject",
                             headers=admin_ctx["headers"], timeout=15)
        assert rj.status_code == 200
        lst = api_client.get(f"{base_url}/api/admin/doctors?verify_status=pending",
                             headers=admin_ctx["headers"], timeout=15).json()
        assert any(d["id"] == did and d["verified"] is False for d in lst)

        # 3) Approve -> verified True
        ap = api_client.post(f"{base_url}/api/admin/doctors/{did}/approve",
                             headers=admin_ctx["headers"], timeout=15)
        assert ap.status_code == 200
        lst = api_client.get(f"{base_url}/api/admin/doctors?verify_status=verified",
                             headers=admin_ctx["headers"], timeout=15).json()
        assert any(d["id"] == did and d["verified"] is True for d in lst)

        # 4) Delete
        d = api_client.delete(f"{base_url}/api/admin/doctors/{did}",
                              headers=admin_ctx["headers"], timeout=15)
        assert d.status_code == 200

        # verify gone
        all_docs = api_client.get(f"{base_url}/api/admin/doctors",
                                  headers=admin_ctx["headers"], timeout=15).json()
        assert all(x["id"] != did for x in all_docs)

    def test_approve_unknown_doctor_404(self, api_client, base_url, admin_ctx):
        r = api_client.post(f"{base_url}/api/admin/doctors/{uuid.uuid4()}/approve",
                            headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 404

    def test_delete_unknown_doctor_404(self, api_client, base_url, admin_ctx):
        r = api_client.delete(f"{base_url}/api/admin/doctors/{uuid.uuid4()}",
                              headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 404


# --------------- Doctor self-registration flow ---------------
class TestSelfRegDoctorFlow:
    def test_self_reg_doctor_creates_pending_doctor(
        self, api_client, base_url, admin_ctx
    ):
        email = f"test_selfdoc_{uuid.uuid4().hex[:8]}@vaidhyaji.example.com"
        payload = {
            "name": "TEST_SelfReg_Doctor",
            "email": email,
            "password": "Passw0rd!123",
            "role": "doctor",
            "phone": "9111000222",
            "registration_number": "MH-AY-2026-9999",
        }
        r = api_client.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
        assert r.status_code == 200, r.text

        # Admin sees pending doctor
        pending = api_client.get(f"{base_url}/api/admin/doctors?verify_status=pending",
                                 headers=admin_ctx["headers"], timeout=15).json()
        match = next((d for d in pending if d.get("email") == email), None)
        assert match is not None, f"self-reg doctor not in pending list; got {len(pending)} pending"
        assert match["verified"] is False
        assert match.get("registration_number") == "MH-AY-2026-9999"
        did = match["id"]

        # Public /api/doctors should NOT contain this doctor (unverified)
        public = api_client.get(f"{base_url}/api/doctors", timeout=15).json()
        assert all(d.get("email") != email for d in public), \
            "Unverified self-registered doctor should NOT appear in public /api/doctors"

        # Approve -> should now appear publicly
        ap = api_client.post(f"{base_url}/api/admin/doctors/{did}/approve",
                             headers=admin_ctx["headers"], timeout=15)
        assert ap.status_code == 200

        public2 = api_client.get(f"{base_url}/api/doctors", timeout=15).json()
        assert any(d.get("email") == email for d in public2), \
            "Approved doctor should now appear in public /api/doctors"

        # cleanup
        api_client.delete(f"{base_url}/api/admin/doctors/{did}",
                          headers=admin_ctx["headers"], timeout=15)

    def test_public_doctors_only_verified(self, api_client, base_url):
        docs = api_client.get(f"{base_url}/api/doctors", timeout=15).json()
        for d in docs:
            assert d.get("verified") is True


# --------------- Admin patients ---------------
class TestAdminPatients:
    def test_list_patients_has_appointments_count(
        self, api_client, base_url, admin_ctx, patient_ctx
    ):
        r = api_client.get(f"{base_url}/api/admin/patients",
                           headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        me = next((u for u in items if u["id"] == patient_ctx["user"]["id"]), None)
        assert me is not None, "patient_ctx not in admin patient list"
        assert "appointments" in me
        assert isinstance(me["appointments"], int)
        assert "password" not in me
        assert "_id" not in me

    def test_patient_appointments_by_id(
        self, api_client, base_url, admin_ctx, patient_ctx
    ):
        r = api_client.get(
            f"{base_url}/api/admin/patients/{patient_ctx['user']['id']}/appointments",
            headers=admin_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        for a in items:
            assert a.get("patient_id") == patient_ctx["user"]["id"]
            assert "_id" not in a


# --------------- Admin activity ---------------
class TestAdminActivity:
    def test_activity_contains_key_events(
        self, api_client, base_url, admin_ctx, patient_ctx, doctor_ctx
    ):
        # ensure at least one appointment_booked is logged — use admin verified list to be robust
        docs = api_client.get(
            f"{base_url}/api/admin/doctors?verify_status=verified",
            headers=admin_ctx["headers"], timeout=15,
        ).json()
        assert docs, "no verified doctors available for activity test"
        api_client.post(
            f"{base_url}/api/appointments",
            json={"doctor_id": docs[0]["id"], "slot": "2026-04-01T10:00:00Z",
                  "reason": "activity-log-test"},
            headers=patient_ctx["headers"], timeout=15,
        )
        r = api_client.get(f"{base_url}/api/admin/activity",
                           headers=admin_ctx["headers"], timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) > 0
        kinds = {i["kind"] for i in items}
        for expected in ["patient_registered", "doctor_enrolled", "appointment_booked"]:
            assert expected in kinds, f"activity kind '{expected}' missing; got {kinds}"
        for i in items:
            assert "_id" not in i
            assert i.get("at")


# --------------- Support chat + lead ---------------
class TestSupportChat:
    def test_support_chat_no_auth(self, api_client, base_url):
        sess = f"sup-{uuid.uuid4().hex[:8]}"
        r = api_client.post(
            f"{base_url}/api/support/chat",
            json={"session_id": sess, "message": "How do I book an Ayurveda doctor?"},
            headers={"Authorization": ""}, timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reply" in data and isinstance(data["reply"], str) and len(data["reply"]) > 5
        assert "lead_captured" in data
        assert isinstance(data["lead_captured"], bool)

    def test_support_chat_captures_lead_when_contact_shared(
        self, api_client, base_url
    ):
        sess = f"sup-{uuid.uuid4().hex[:8]}"
        # first message: ask something
        r1 = api_client.post(
            f"{base_url}/api/support/chat",
            json={"session_id": sess,
                  "message": "I need help with Ayurvedic consult for acidity."},
            timeout=90,
        )
        assert r1.status_code == 200, r1.text

        # second message: share name+phone
        r2 = api_client.post(
            f"{base_url}/api/support/chat",
            json={"session_id": sess,
                  "message": "My name is Ravi Kumar, phone 9812345678, "
                             "please have someone call me about the acidity consult."},
            timeout=90,
        )
        assert r2.status_code == 200, r2.text
        data = r2.json()
        # Either the LLM emits the marker or lead_captured is True
        assert data.get("lead_captured") is True or "LEAD_CAPTURED" in data.get("reply", ""), \
            f"expected lead_captured on contact share; got {data}"


class TestSupportLead:
    def test_create_lead_and_admin_visibility(
        self, api_client, base_url, admin_ctx
    ):
        body = {
            "name": "TEST_Lead_User",
            "contact": "9876543210",
            "goal": "TEST_Lead: Ayurveda consult for insomnia",
            "source": "support-chat",
        }
        r = api_client.post(f"{base_url}/api/support/lead", json=body, timeout=15)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead["name"] == body["name"]
        assert lead["contact"] == body["contact"]
        assert lead.get("id")
        assert lead.get("status") == "new"
        assert "_id" not in lead

        # admin sees it
        lst = api_client.get(f"{base_url}/api/admin/leads",
                             headers=admin_ctx["headers"], timeout=15)
        assert lst.status_code == 200
        items = lst.json()
        assert any(x["id"] == lead["id"] for x in items)

    def test_admin_leads_forbidden_for_patient(
        self, api_client, base_url, patient_ctx
    ):
        r = api_client.get(f"{base_url}/api/admin/leads",
                           headers=patient_ctx["headers"], timeout=15)
        assert r.status_code == 403
