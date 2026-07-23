import os
"""Iteration 5 backend tests:
- Medicines shop (list/detail/order/orders-mine, category filter)
- Lab tests (list/detail/book/bookings-mine)
- Blogs (list/detail)
- AI Diet plan (Claude Sonnet 4.5 generation + persistence)
- Doctor onboarding (doctor/me, doctor/onboard, my-appointments, my-patients)
- Push notifications (register-push graceful with placeholder + admin broadcast)
"""
import uuid
import pytest


# ---------------- Admin login fixture ----------------
@pytest.fixture(scope="module")
def admin_ctx(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": "admin@vaidhyaji.com", "password": os.environ.get("ADMIN_PASSWORD", "Admin@123")},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


# ---------------- Medicines ----------------
class TestMedicines:
    def test_list_medicines_seeded_at_least_8(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/medicines", timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 8, f"expected >=8 medicines, got {len(items)}"
        for m in items:
            assert m.get("id") and m.get("name") and m.get("price") is not None
            assert "_id" not in m

    def test_list_medicines_category_filter(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/medicines?category=immunity", timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert all(m["category"] == "immunity" for m in items)

    def test_get_medicine_detail(self, api_client, base_url):
        lst = api_client.get(f"{base_url}/api/medicines", timeout=15).json()
        mid = lst[0]["id"]
        r = api_client.get(f"{base_url}/api/medicines/{mid}", timeout=15)
        assert r.status_code == 200
        m = r.json()
        assert m["id"] == mid
        assert "_id" not in m

    def test_get_medicine_unknown_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/medicines/{uuid.uuid4()}", timeout=15)
        assert r.status_code == 404

    def test_order_medicines_and_total(self, api_client, base_url, patient_ctx):
        meds = api_client.get(f"{base_url}/api/medicines", timeout=15).json()
        m1, m2 = meds[0], meds[1]
        items = [
            {"medicine_id": m1["id"], "qty": 2},
            {"medicine_id": m2["id"], "qty": 1},
        ]
        expected_total = 2 * m1["price"] + 1 * m2["price"]
        r = api_client.post(
            f"{base_url}/api/medicines/order",
            json={"items": items, "address": "TEST_Address 42"},
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["total"] == expected_total
        assert order["status"] == "paid"
        assert order["user_id"] == patient_ctx["user"]["id"]
        assert len(order["items"]) == 2
        assert "_id" not in order

    def test_my_medicine_orders_returns_created_order(
        self, api_client, base_url, patient_ctx
    ):
        # ensure at least one exists
        meds = api_client.get(f"{base_url}/api/medicines", timeout=15).json()
        c = api_client.post(
            f"{base_url}/api/medicines/order",
            json={"items": [{"medicine_id": meds[0]["id"], "qty": 1}]},
            headers=patient_ctx["headers"], timeout=15,
        )
        assert c.status_code == 200
        oid = c.json()["id"]

        lst = api_client.get(
            f"{base_url}/api/medicines/orders/mine",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert lst.status_code == 200
        assert any(o["id"] == oid for o in lst.json())


# ---------------- Lab tests ----------------
class TestLabTests:
    def test_list_lab_tests_seeded_at_least_5(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/lab-tests", timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 5
        for t in items:
            assert t.get("id") and t.get("name") and t.get("price") is not None
            assert "_id" not in t

    def test_get_lab_test_detail(self, api_client, base_url):
        lst = api_client.get(f"{base_url}/api/lab-tests", timeout=15).json()
        tid = lst[0]["id"]
        r = api_client.get(f"{base_url}/api/lab-tests/{tid}", timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == tid

    def test_get_lab_test_unknown_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/lab-tests/{uuid.uuid4()}", timeout=15)
        assert r.status_code == 404

    def test_book_lab_test(self, api_client, base_url, patient_ctx):
        lst = api_client.get(f"{base_url}/api/lab-tests", timeout=15).json()
        t = lst[0]
        slot = "2026-03-15T09:30:00Z"
        r = api_client.post(
            f"{base_url}/api/lab-tests/book",
            json={"lab_test_id": t["id"], "slot": slot, "address": "TEST_home"},
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["test_name"] == t["name"]
        assert b["price"] == t["price"]
        assert b["slot"] == slot
        assert b["user_id"] == patient_ctx["user"]["id"]
        assert b["status"] == "confirmed"
        assert "_id" not in b

    def test_my_lab_bookings(self, api_client, base_url, patient_ctx):
        r = api_client.get(
            f"{base_url}/api/lab-tests/bookings/mine",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1


# ---------------- Blogs ----------------
class TestBlogs:
    def test_list_blogs_seeded_at_least_4(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/blogs", timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 4
        for b in items:
            assert b.get("id") and b.get("title") and b.get("body")
            assert "_id" not in b

    def test_get_blog_returns_full_body(self, api_client, base_url):
        lst = api_client.get(f"{base_url}/api/blogs", timeout=15).json()
        bid = lst[0]["id"]
        r = api_client.get(f"{base_url}/api/blogs/{bid}", timeout=15)
        assert r.status_code == 200
        b = r.json()
        assert b["id"] == bid
        assert len(b["body"]) > 100  # substantial

    def test_get_blog_unknown_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/blogs/{uuid.uuid4()}", timeout=15)
        assert r.status_code == 404


# ---------------- AI Diet Plan ----------------
class TestDietPlan:
    def test_generate_diet_plan(self, api_client, base_url, patient_ctx):
        r = api_client.post(
            f"{base_url}/api/diet-plan",
            json={"goal": "boost immunity", "dosha": "Vata", "vegetarian": True},
            headers=patient_ctx["headers"], timeout=90,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("id")
        assert p["goal"] == "boost immunity"
        assert p.get("plan") and isinstance(p["plan"], str) and len(p["plan"].strip()) > 50
        assert p["user_id"] == patient_ctx["user"]["id"]
        assert "_id" not in p

    def test_my_diet_plans_returns_generated(self, api_client, base_url, patient_ctx):
        r = api_client.get(
            f"{base_url}/api/diet-plans",
            headers=patient_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 1
        assert all("plan" in x for x in items)


# ---------------- Doctor onboarding & workspace ----------------
class TestDoctorOnboarding:
    def test_doctor_me_pending(self, api_client, base_url, doctor_ctx):
        # doctor_ctx registered without registration_number in conftest — should have
        # a pending doctor entry created at register time.
        r = api_client.get(
            f"{base_url}/api/doctor/me",
            headers=doctor_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d, "expected pending doctor entry"
        assert d.get("verified") is False
        assert d.get("user_id") == doctor_ctx["user"]["id"]

    def test_doctor_onboard_updates_entry(self, api_client, base_url, doctor_ctx):
        payload = {
            "specialty": "Ayurveda",
            "qualification": "BAMS, MD",
            "registration_number": "MH-AY-2026-9999",
            "experience_years": 7,
            "languages": ["Hindi", "English"],
            "consultation_fee": 699,
            "bio": "TEST bio — onboarded via API",
            "documents": ["cert-front.png", "cert-back.png"],
        }
        r = api_client.put(
            f"{base_url}/api/doctor/onboard",
            json=payload,
            headers=doctor_ctx["headers"], timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["specialty"] == "Ayurveda"
        assert d["qualification"] == "BAMS, MD"
        assert d["registration_number"] == "MH-AY-2026-9999"
        assert d["consultation_fee"] == 699
        assert d.get("onboarded_at")
        assert d.get("documents_uploaded") is True

    def test_doctor_my_appointments_initially_empty_then_visible_after_admin_approve(
        self, api_client, base_url, doctor_ctx, patient_ctx, admin_ctx
    ):
        # initially empty
        r = api_client.get(
            f"{base_url}/api/doctor/my-appointments",
            headers=doctor_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200
        assert r.json() == []

        # admin approves the doctor so patients can see & book them
        d = api_client.get(
            f"{base_url}/api/doctor/me",
            headers=doctor_ctx["headers"], timeout=15,
        ).json()
        doctor_id = d["id"]

        ap = api_client.post(
            f"{base_url}/api/admin/doctors/{doctor_id}/approve",
            headers=admin_ctx["headers"], timeout=15,
        )
        assert ap.status_code == 200, ap.text

        # patient books
        book = api_client.post(
            f"{base_url}/api/appointments",
            json={"doctor_id": doctor_id, "slot": "2026-04-01T10:00:00Z", "reason": "TEST consult"},
            headers=patient_ctx["headers"], timeout=15,
        )
        assert book.status_code == 200, book.text

        # doctor now sees appointment
        r2 = api_client.get(
            f"{base_url}/api/doctor/my-appointments",
            headers=doctor_ctx["headers"], timeout=15,
        )
        assert r2.status_code == 200
        appts = r2.json()
        assert len(appts) >= 1
        assert appts[0]["doctor_id"] == doctor_id
        assert appts[0]["patient_id"] == patient_ctx["user"]["id"]

    def test_doctor_my_patients_dedup(self, api_client, base_url, doctor_ctx, patient_ctx):
        # book another appt for same patient to test dedup
        d = api_client.get(
            f"{base_url}/api/doctor/me",
            headers=doctor_ctx["headers"], timeout=15,
        ).json()
        api_client.post(
            f"{base_url}/api/appointments",
            json={"doctor_id": d["id"], "slot": "2026-04-05T11:00:00Z"},
            headers=patient_ctx["headers"], timeout=15,
        )
        r = api_client.get(
            f"{base_url}/api/doctor/my-patients",
            headers=doctor_ctx["headers"], timeout=15,
        )
        assert r.status_code == 200
        pts = r.json()
        assert isinstance(pts, list) and len(pts) >= 1
        row = next(p for p in pts if p["patient_id"] == patient_ctx["user"]["id"])
        assert row["visits"] >= 2
        assert row.get("patient_name")


# ---------------- Push notifications ----------------
class TestPush:
    def test_register_push_graceful_with_placeholder_key(self, api_client, base_url):
        # Anyone can register (no auth on this endpoint). With placeholder key,
        # upstream returns 401 — endpoint must NOT crash; must respond with
        # a 201 + status field.
        r = api_client.post(
            f"{base_url}/api/register-push",
            json={
                "user_id": str(uuid.uuid4()),
                "platform": "ios",
                "device_token": "TEST_dummy_token_1234567890",
            },
            timeout=20,
        )
        # Endpoint should not error out — 201 declared on decorator.
        assert r.status_code == 201, r.text
        data = r.json()
        assert data.get("status") in ("pending", "registered", "unavailable")

    def test_admin_broadcast_returns_sent_count(self, api_client, base_url, admin_ctx):
        r = api_client.post(
            f"{base_url}/api/admin/broadcast",
            json={
                "title": "TEST Broadcast",
                "message": "Hello from tests",
                "audience": "all_patients",
            },
            headers=admin_ctx["headers"], timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "sent_to" in d
        assert isinstance(d["sent_to"], int)
        assert d["sent_to"] >= 1  # at least our patient_ctx exists
