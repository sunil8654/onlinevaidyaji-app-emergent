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