"""HTTP smoke: doctor profile round-trip through the real ASGI stack.

Verifies GET /doctor/me returns the website's columns and PUT /doctor/profile
writes them into the shared MySQL rows, with a doctor who has no app onboarding.
Fixture ids are in the reserved 95xx smoke range and are removed at the end.
"""
import asyncio
import sys
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import msdb  # noqa: E402
import server  # noqa: E402

pytestmark = pytest.mark.asyncio

BASE = "http://127.0.0.1:8011"
UID = 9511
DID = 9511
PHONE = "919000009511"
PASSWORD = "Sm0kePass!42"


async def _cleanup() -> None:
    for table, col, val in (("reviews", "doctor_id", DID),
                            ("doctor_status", "doctor_id", DID),
                            ("doctor_specializations", "doctor_id", DID),
                            ("appointment_slots", "doctor_id", DID),
                            ("appointments", "doctor_id", DID),
                            ("doctors", "id", DID),
                            ("users", "id", UID)):
        await msdb._query("DELETE FROM `%s` WHERE %s=%%s" % (table, col), [val])


@pytest_asyncio.fixture
async def authed_client():
    await _cleanup()
    await msdb._query(
        "INSERT INTO `users` (id,name,email,phone,role,password,created_at) "
        "VALUES (%s,'Http Smoke Doctor','smoke@vaidhyaji.example.com',%s,'doctor',%s,NOW())",
        [UID, PHONE, server.hash_password(PASSWORD)])
    await msdb._query(
        "INSERT INTO `doctors` (id,user_id,slug,system,gender,qualification,experience,"
        "consultation_fee,about,bio,languages,city,is_available_online,is_available_offline,"
        "rating,review_count,is_approved) VALUES (%s,%s,'dr-http-smoke','ayurveda',"
        "'male','BAMS',2,350.00,'Smoke about','Smoke bio','Hindi, English','Delhi',1,0,4.5,7,1)",
        [DID, UID])

    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE) as c:
        r = await c.post("/api/auth/login",
                         json={"email": "smoke@vaidhyaji.example.com",
                               "password": PASSWORD})
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
        token = r.json().get("token") or r.json().get("access_token")
        c.headers["Authorization"] = f"Bearer {token}"
        yield c
    await _cleanup()


async def _raw(col_table: str, col: str, val: int) -> dict:
    r = await msdb._query(f"SELECT * FROM `{col_table}` WHERE {col}=%s", [val])
    return dict(r[0])


async def test_get_me_returns_website_columns(authed_client):
    r = await authed_client.get("/api/doctor/me")
    assert r.status_code == 200, r.text[:300]
    me = r.json()
    for key in ("name", "email", "phone", "about", "bio", "city", "gender",
                "system", "qualification", "experience", "consultation_fee",
                "languages", "is_available_online", "is_available_offline",
                "is_approved", "is_restricted", "rating", "review_count", "slug"):
        assert key in me, f"missing {key}"
    assert me["name"] == "Http Smoke Doctor"
    assert me["about"] == "Smoke about"
    assert me["languages"] == "Hindi, English"
    assert "password" not in me


async def test_put_writes_real_columns(authed_client):
    r = await authed_client.put("/api/doctor/profile", json={
        "name": "Smoke Renamed",
        "about": "Updated about",
        "bio": "Updated bio",
        "city": "Pune",
        "gender": "female",
        "system": "homeopathy",
        "qualification": "BHMS, MD",
        "experience": 11,
        "consultation_fee": 500.5,
        "languages": ["Tamil", "Hindi"],
        "is_available_online": True,
        "is_available_offline": False,
    })
    assert r.status_code == 200, r.text[:300]

    doc = await _raw("doctors", "id", DID)
    usr = await _raw("users", "id", UID)
    # every value the website renders must come from the real columns
    assert usr["name"] == "Smoke Renamed"
    assert doc["about"] == "Updated about"
    assert doc["bio"] == "Updated bio"
    assert doc["city"] == "Pune"
    assert doc["gender"] == "female"
    assert doc["system"] == "homeopathy"
    assert doc["qualification"] == "BHMS, MD"
    assert doc["experience"] == 11
    assert float(doc["consultation_fee"]) == 500.5
    assert doc["languages"] == "Tamil, Hindi"
    assert doc["is_available_online"] == 1
    assert doc["is_available_offline"] == 0
    assert doc["slug"] == "dr-smoke-renamed"


async def test_put_updates_phone_in_users(authed_client):
    r = await authed_client.put("/api/doctor/profile", json={"phone": "+91 90000 95112"})
    assert r.status_code == 200, r.text[:300]
    assert (await _raw("users", "id", UID))["phone"] == "919000095112"


async def test_put_rejects_phone_owned_by_someone_else(authed_client):
    other = await msdb._query("SELECT phone FROM `users` WHERE phone <> '' LIMIT 1")
    if not other:
        pytest.skip("no other phone on file")
    r = await authed_client.put("/api/doctor/profile", json={"phone": other[0]["phone"]})
    assert r.status_code == 409, r.text[:300]


async def test_put_rejects_bad_specialization(authed_client):
    r = await authed_client.put("/api/doctor/profile", json={"specialization_id": 999999})
    assert r.status_code == 400, r.text[:300]


async def test_put_with_no_fields_is_400(authed_client):
    r = await authed_client.put("/api/doctor/profile", json={})
    assert r.status_code == 400, r.text[:300]


async def test_admin_columns_ignored_over_http(authed_client):
    r = await authed_client.put("/api/doctor/profile", json={
        "city": "Jaipur", "is_approved": True, "rating": 5.0, "is_restricted": 1,
    })
    assert r.status_code == 200, r.text[:300]
    doc = await _raw("doctors", "id", DID)
    assert doc["city"] == "Jaipur"
    assert doc["is_approved"] == 1
    assert float(doc["rating"]) == 4.5
    assert doc["is_restricted"] == 0


async def test_specialization_round_trip(authed_client):
    ids = [r["id"] for r in await msdb._query(
        "SELECT id FROM `specializations` ORDER BY id LIMIT 2")]
    r = await authed_client.put("/api/doctor/profile", json={"specializations": ids})
    assert r.status_code == 200, r.text[:300]
    doc = await _raw("doctors", "id", DID)
    assert doc["specialization_id"] == ids[0]
    picked = [x["specialization_id"] for x in await msdb._query(
        "SELECT specialization_id FROM `doctor_specializations` WHERE doctor_id=%s ORDER BY specialization_id",
        [DID])]
    assert picked == sorted(ids)


async def test_public_taxonomy_endpoints(authed_client):
    tax = (await authed_client.get("/api/specializations")).json()
    assert tax["specializations"] and "ayurveda" in tax["systems"]
    cities = (await authed_client.get("/api/cities")).json()
    assert cities["cities"]


REG_UID = 9512
REG_EMAIL = "rolebug@vaidhyaji.example.com"
PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
       "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


async def _cleanup_reg() -> None:
    """Remove the probe account by EMAIL.

    Looking the row up first (rather than assuming a fixed id) means a rerun
    after a half-failed test still finds and clears the leftovers instead of
    colliding with a unique email. `audit_logs` and `notifications` both FK to
    users, so they have to go too - users.id is NOT freely deletable.
    """
    rows = await msdb._query("SELECT id FROM `users` WHERE email=%s", [REG_EMAIL])
    for u in rows:
        uid = u["id"]
        docs = await msdb._query("SELECT id FROM `doctors` WHERE user_id=%s", [uid])
        for d in docs:
            did = d["id"]
            for t in ("doctor_verifications", "appointment_slots",
                      "doctor_specializations", "doctor_status"):
                await msdb._query("DELETE FROM `%s` WHERE doctor_id=%%s" % t, [did])
            await msdb._query("DELETE FROM `doctors` WHERE id=%s", [did])
        for t in ("audit_logs", "notifications", "password_resets"):
            try:
                await msdb._query("DELETE FROM `%s` WHERE user_id=%%s" % t, [uid])
            except Exception:
                pass  # table/column absent in some schemas
        await msdb._query("DELETE FROM `users` WHERE id=%s", [uid])


@pytest.mark.asyncio
async def test_doctor_registration_persists_role_and_can_onboard():
    """`users.role` is ENUM, so msdb needs an explicit column-map entry.

    Regression: without `"users": {"role": [("role", _enum_val)]}` in
    COLUMN_MAPS the value fell into the `data` blob and the real column took its
    DEFAULT of 'patient'. Registration still answered `role: 'doctor'` and
    minted a doctor JWT, but every follow-up call was rejected 403 "Doctors
    only" - no doctor could ever finish onboarding from the app. Verified in
    production data: 14 of 15 doctors were linked to a 'patient' user.
    """
    await _cleanup_reg()
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE) as c:
        r = await c.post("/api/auth/register", json={
            "name": "Role Bug Doc", "email": REG_EMAIL,
            "password": "Sm0kePass!42", "role": "doctor",
            "phone": "919000009512",
        })
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:300]}"
        assert r.json()["user"]["role"] == "doctor"

        # the response was never proof - assert the COLUMN
        rows = await msdb._query("SELECT id, role FROM `users` WHERE email=%s",
                                 [REG_EMAIL])
        assert rows, "registered user row missing"
        assert rows[0]["role"] == "doctor", (
            f"users.role stored as {rows[0]['role']!r}: the ENUM column was not "
            "mirrored, so a real doctor was persisted as a patient"
        )

        # and the practical consequence: onboarding must not 403
        token = r.json()["token"]
        c.headers["Authorization"] = f"Bearer {token}"
        me = await c.get("/api/auth/me")
        assert me.status_code == 200, me.text[:300]
        assert me.json()["role"] == "doctor"

        ob = await c.put("/api/doctor/onboard", json={
            "specialty": "Ayurveda", "qualification": "BAMS",
            "registration_number": "AYUSH/BAMS/2020/ROLEBUG",
            "experience_years": 5, "languages": ["Hindi"],
            "consultation_fee": 400, "bio": "role regression probe",
            "avatar_base64": PNG,
        })
        assert ob.status_code == 200, f"onboard 403'd a real doctor: {ob.text[:300]}"
        assert ob.json().get("id")
    await _cleanup_reg()


async def test_public_doctor_profile_shows_the_edit(authed_client):
    """The patient-facing profile must reflect what the doctor just saved."""
    await authed_client.put("/api/doctor/profile", json={
        "name": "Visible Name", "about": "Visible about", "city": "Kochi",
        "experience": 13, "consultation_fee": 321,
    })
    r = await authed_client.get(f"/api/doctors/{DID}")
    assert r.status_code == 200, r.text[:300]
    pub = r.json()
    assert pub["name"] == "Visible Name"
    assert pub["about"] == "Visible about"
    assert pub["city"] == "Kochi"
    assert pub["experience"] == 13
    assert float(pub["consultation_fee"]) == 321.0
    # privacy: the public page must not expose contact details
    assert "email" not in pub and "phone" not in pub and "password" not in pub