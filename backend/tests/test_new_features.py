"""New feature backend tests (iteration 2):
- Doctor registration with registration_number field
- Appointment payment flow (mock pay)
- Prescription flow (patient add, third-party forbidden)
- Prescriptions listing
- Health records (reports) CRUD
"""
import uuid
import pytest


# ---------------- Doctor registration_number ----------------
class TestDoctorRegistrationNumber:
    def test_register_doctor_with_registration_number(self, api_client, base_url):
        email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
        payload = {
            "name": "TEST_Doctor_RegNum",
            "email": email,
            "password": "Passw0rd!123",
            "role": "doctor",
            "phone": "9999911111",
            "registration_number": "MH-AY-2026-0001",
        }
        r = api_client.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        u = data["user"]
        assert u["role"] == "doctor"
        assert u.get("registration_number") == "MH-AY-2026-0001"
        # verified flag exists and defaults to False
        assert u.get("verified") is False
        assert u.get("documents_uploaded") is True
        assert "password" not in u
        assert "_id" not in u

        # /auth/me should also reflect registration_number & verified
        me = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": f"Bearer {data['token']}"},
            timeout=15,
        )
        assert me.status_code == 200
        mu = me.json()
        assert mu["role"] == "doctor"
        assert mu.get("registration_number") == "MH-AY-2026-0001"
        assert mu.get("verified") is False


# ---------------- Appointment default fields ----------------
def _book_appt(api_client, base_url, patient_ctx):
    docs = api_client.get(f"{base_url}/api/doctors").json()
    doc = docs[0]
    slot = "2026-03-10T09:00:00Z"
    r = api_client.post(
        f"{base_url}/api/appointments",
        json={"doctor_id": doc["id"], "slot": slot, "reason": "consult"},
        headers=patient_ctx["headers"], timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json(), doc


class TestAppointmentDefaults:
    def test_new_appointment_has_paid_false_amount_and_null_prescription(
        self, api_client, base_url, patient_ctx
    ):
        appt, doc = _book_appt(api_client, base_url, patient_ctx)
        assert appt["paid"] is False
        assert appt["amount"] == doc.get("consultation_fee", 500)
        assert appt["prescription"] is None
        assert "_id" not in appt


# ---------------- Payment ----------------
class TestAppointmentPayment:
    def test_pay_appointment_marks_paid(self, api_client, base_url, patient_ctx):
        appt, _ = _book_appt(api_client, base_url, patient_ctx)
        r = api_client.post(
            f"{base_url}/api/appointments/{appt['id']}/pay",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["id"] == appt["id"]
        assert updated["paid"] is True
        assert updated.get("paid_at")
        assert "_id" not in updated

        # verify persisted via GET list
        lst = api_client.get(
            f"{base_url}/api/appointments",
            headers=patient_ctx["headers"], timeout=15,
        ).json()
        found = next(a for a in lst if a["id"] == appt["id"])
        assert found["paid"] is True
        assert found.get("paid_at")

    def test_pay_unknown_appt_404(self, api_client, base_url, patient_ctx):
        r = api_client.post(
            f"{base_url}/api/appointments/{uuid.uuid4()}/pay",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 404


# ---------------- Prescription ----------------
@pytest.fixture(scope="module")
def third_party_patient(api_client, base_url):
    """A separate patient user (module-scoped) used to test 403."""
    email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": "TEST_ThirdParty",
        "email": email,
        "password": "Passw0rd!123",
        "role": "patient",
    }
    r = api_client.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200
    data = r.json()
    return {"headers": {"Authorization": f"Bearer {data['token']}"}}


class TestPrescription:
    def test_patient_can_add_prescription(self, api_client, base_url, patient_ctx):
        appt, _ = _book_appt(api_client, base_url, patient_ctx)
        body = {
            "diagnosis": "Amla-vata (acidity)",
            "medicines": "Avipattikar churna 1 tsp bid\nAloe vera juice 20ml qd",
            "notes": "Avoid tea for 2 weeks.",
        }
        r = api_client.post(
            f"{base_url}/api/appointments/{appt['id']}/prescription",
            json=body,
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["diagnosis"] == body["diagnosis"]
        assert p["medicines"] == body["medicines"]
        assert p["notes"] == body["notes"]
        assert p.get("author_id") == patient_ctx["user"]["id"]
        assert p.get("author_name") == patient_ctx["user"]["name"]
        assert p.get("written_at")

        # verify stored inside appointment
        lst = api_client.get(
            f"{base_url}/api/appointments",
            headers=patient_ctx["headers"], timeout=15,
        ).json()
        found = next(a for a in lst if a["id"] == appt["id"])
        assert found["prescription"] is not None
        assert found["prescription"]["diagnosis"] == body["diagnosis"]
        assert found["prescription"]["author_id"] == patient_ctx["user"]["id"]

    def test_third_party_cannot_add_prescription(
        self, api_client, base_url, patient_ctx, third_party_patient
    ):
        # Book an appt as patient_ctx; then try as third_party
        appt, _ = _book_appt(api_client, base_url, patient_ctx)
        r = api_client.post(
            f"{base_url}/api/appointments/{appt['id']}/prescription",
            json={"diagnosis": "x", "medicines": "y", "notes": "z"},
            headers=third_party_patient["headers"], timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_prescription_unknown_appt_404(
        self, api_client, base_url, patient_ctx
    ):
        r = api_client.post(
            f"{base_url}/api/appointments/{uuid.uuid4()}/prescription",
            json={"diagnosis": "x", "medicines": "y"},
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 404


class TestListPrescriptions:
    def test_list_prescriptions_only_returns_appts_with_prescription(
        self, api_client, base_url, patient_ctx
    ):
        # Create a fresh appt without prescription
        appt_no_rx, _ = _book_appt(api_client, base_url, patient_ctx)
        # Create another appt WITH prescription
        appt_with_rx, _ = _book_appt(api_client, base_url, patient_ctx)
        api_client.post(
            f"{base_url}/api/appointments/{appt_with_rx['id']}/prescription",
            json={"diagnosis": "d", "medicines": "m", "notes": "n"},
            headers=patient_ctx["headers"], timeout=15,
        )
        r = api_client.get(
            f"{base_url}/api/prescriptions",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        items = r.json()
        ids = [a["id"] for a in items]
        assert appt_with_rx["id"] in ids
        assert appt_no_rx["id"] not in ids
        for a in items:
            assert a.get("prescription") is not None
            assert "_id" not in a


# ---------------- Reports (Health Records Vault) ----------------
class TestReports:
    def test_add_and_list_report(self, api_client, base_url, patient_ctx):
        payload = {
            "title": "TEST_CBC report Jan 2026",
            "kind": "lab",
            "notes": "Hb 13.5, WBC normal",
        }
        r = api_client.post(
            f"{base_url}/api/reports", json=payload,
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["title"] == payload["title"]
        assert doc["kind"] == "lab"
        assert doc["user_id"] == patient_ctx["user"]["id"]
        assert doc.get("id")
        assert doc.get("created_at")
        assert doc.get("date")  # auto-filled when not provided
        assert "_id" not in doc

        lst = api_client.get(
            f"{base_url}/api/reports",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert lst.status_code == 200
        items = lst.json()
        assert any(x["id"] == doc["id"] for x in items)
        for it in items:
            assert it["user_id"] == patient_ctx["user"]["id"]
            assert "_id" not in it

    def test_reports_are_scoped_to_user(
        self, api_client, base_url, patient_ctx, third_party_patient
    ):
        # patient_ctx creates a report
        payload = {"title": "TEST_Private report", "kind": "note", "notes": "priv"}
        c = api_client.post(
            f"{base_url}/api/reports", json=payload,
            headers=patient_ctx["headers"], timeout=15,
        )
        assert c.status_code == 200
        rid = c.json()["id"]

        # third_party sees an empty list (or at least does NOT see rid)
        lst = api_client.get(
            f"{base_url}/api/reports",
            headers=third_party_patient["headers"], timeout=15,
        )
        assert lst.status_code == 200
        assert all(x["id"] != rid for x in lst.json())

    def test_delete_report(self, api_client, base_url, patient_ctx):
        c = api_client.post(
            f"{base_url}/api/reports",
            json={"title": "TEST_to_delete", "kind": "lab"},
            headers=patient_ctx["headers"], timeout=15,
        )
        rid = c.json()["id"]
        d = api_client.delete(
            f"{base_url}/api/reports/{rid}",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert d.status_code == 200
        assert d.json().get("ok") is True

        # verify gone
        lst = api_client.get(
            f"{base_url}/api/reports",
            headers=patient_ctx["headers"], timeout=15,
        ).json()
        assert all(x["id"] != rid for x in lst)

    def test_delete_unknown_report_404(self, api_client, base_url, patient_ctx):
        r = api_client.delete(
            f"{base_url}/api/reports/{uuid.uuid4()}",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 404

    def test_reports_require_auth(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/reports",
            headers={"Authorization": ""}, timeout=15,
        )
        assert r.status_code == 401
