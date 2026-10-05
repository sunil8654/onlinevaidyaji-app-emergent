"""Doctor self-service profile: read and write the website's real columns.

The website (Next.js + plain MySQL) is the source of truth for doctor profiles.
It reads `users.name/phone/image` and the real `doctors` columns, so the app
must write those same columns - otherwise a doctor editing in the app sees no
change on the site, and a website-registered doctor cannot edit at all.

These tests assert against raw SQL, not the app's `data` blob, because a value
that only round-trips through the blob is invisible to the website.
"""
import datetime
import sys
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import msdb  # noqa: E402
import server  # noqa: E402

pytestmark = pytest.mark.asyncio

DOC_ID = 9502
DOC_UID = 9502
OTHER_UID = 9503


def _doctor_user() -> dict:
    return {"id": DOC_UID, "role": "doctor", "name": "Website Registered",
            "email": "selfprofile@vaidhyaji.example.com", "phone": ""}


async def _reset() -> None:
    for table, col, val in (("reviews", "doctor_id", DOC_ID),
                            ("doctor_status", "doctor_id", DOC_ID),
                            ("doctor_specializations", "doctor_id", DOC_ID),
                            ("appointment_slots", "doctor_id", DOC_ID),
                            ("appointments", "doctor_id", DOC_ID),
                            ("doctors", "id", DOC_ID),
                            ("users", "id", DOC_UID),
                            ("users", "id", OTHER_UID)):
        await msdb._query("DELETE FROM `%s` WHERE %s=%%s" % (table, col), [val])


async def _seed() -> None:
    """A doctor created the way the WEBSITE creates them: real columns only,
    no `onboarded_at` in the data blob."""
    await _reset()
    await msdb._query(
        "INSERT INTO `users` (id,name,email,phone,role,password,created_at) "
        "VALUES (%s,'Website Registered','selfprofile@vaidhyaji.example.com','9990009502',"
        "'doctor','!x',NOW())", [DOC_UID])
    await msdb._query(
        "INSERT INTO `users` (id,name,email,phone,role,password,created_at) "
        "VALUES (%s,'Someone Else','other@vaidhyaji.example.com','9990009503',"
        "'patient','!x',NOW())", [OTHER_UID])
    await msdb._query(
        "INSERT INTO `doctors` (id,user_id,slug,system,gender,qualification,"
        "experience,consultation_fee,about,bio,languages,city,"
        "is_available_online,is_available_offline,rating,review_count,is_approved) "
        "VALUES (%s,%s,'dr-website-registered','ayurveda','female','BAMS',3,"
        "450.00,'About text','Bio text','Hindi, English','Pune',1,0,4.2,11,1)",
        [DOC_ID, DOC_UID])


@pytest_asyncio.fixture
async def doc():
    await _seed()
    yield DOC_ID
    await _reset()


async def _raw_doctor() -> dict:
    r = await msdb._query("SELECT * FROM `doctors` WHERE id=%s", [DOC_ID])
    return dict(r[0])


async def _raw_user() -> dict:
    r = await msdb._query("SELECT * FROM `users` WHERE id=%s", [DOC_UID])
    return dict(r[0])


# --------------------------------------------------------------------------- #
# Read: the doctor sees everything the website stores
# --------------------------------------------------------------------------- #
async def test_me_returns_every_website_column(doc):
    me = await server.doctor_me(_doctor_user())
    for key in ("id", "name", "email", "phone", "image", "qualification",
                "experience", "consultation_fee", "about", "bio", "languages",
                "city", "gender", "system", "specialty", "specialization_id",
                "is_available_online", "is_available_offline",
                "is_approved", "is_restricted", "restriction_reason",
                "rating", "review_count", "status", "slug"):
        assert key in me, f"missing {key}"
    assert me["about"] == "About text"
    assert me["bio"] == "Bio text"
    assert me["city"] == "Pune"
    assert me["gender"] == "female"
    assert me["consultation_fee"] == 450.0
    assert me["experience"] == 3
    assert me["is_available_online"] is True
    assert me["is_available_offline"] is False
    assert me["consultation_mode"] == "online"


async def test_me_never_leaks_the_password(doc):
    me = await server.doctor_me(_doctor_user())
    assert "password" not in me
    assert not any("password" in k for k in me)


async def test_me_reports_restriction_reason_when_restricted(doc):
    await msdb._query(
        "UPDATE `doctors` SET is_restricted=1, restriction_reason=%s WHERE id=%s",
        ["Under review", DOC_ID])
    me = await server.doctor_me(_doctor_user())
    assert me["is_restricted"] is True
    assert me["restriction_reason"] == "Under review"


async def test_me_lists_selected_specializations(doc):
    spec = await msdb._query("SELECT id FROM `specializations` ORDER BY id LIMIT 1")
    sid = spec[0]["id"]
    await msdb._query(
        "INSERT INTO `doctor_specializations` (doctor_id, specialization_id) VALUES (%s,%s)",
        [DOC_ID, sid])
    me = await server.doctor_me(_doctor_user())
    assert [s["id"] for s in me["specializations"]] == [sid]


# --------------------------------------------------------------------------- #
# Write: must land in the REAL columns the website reads
# --------------------------------------------------------------------------- #
async def test_website_doctor_can_edit_without_app_onboarding(doc):
    # Regression: this used to 404 with "Complete onboarding first" because it
    # required `onboarded_at`, which only the app's own onboarding ever set.
    raw = await _raw_doctor()
    assert not raw.get("data"), "fixture must look website-created (no data blob)"
    out = await server.doctor_update_profile(
        server.DoctorProfileUpdate(about="Updated about"), _doctor_user())
    assert out["about"] == "Updated about"


async def test_about_city_gender_land_in_real_columns(doc):
    await server.doctor_update_profile(server.DoctorProfileUpdate(
        about="New about", city="Delhi", gender="male",
        qualification="BAMS, MD", bio="New bio"), _doctor_user())
    row = await _raw_doctor()
    assert row["about"] == "New about"
    assert row["city"] == "Delhi"
    assert row["gender"] == "male"
    assert row["qualification"] == "BAMS, MD"
    assert row["bio"] == "New bio"


async def test_experience_writes_the_website_column(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(experience=17), _doctor_user())
    assert (await _raw_doctor())["experience"] == 17


async def test_legacy_experience_years_alias_maps_to_experience(doc):
    # Older app builds send `experience_years`; it must still reach the real
    # `experience` column rather than dying in the blob.
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(experience_years=9), _doctor_user())
    assert (await _raw_doctor())["experience"] == 9


async def test_specialty_alias_maps_to_system(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(specialty="Homeopathy"), _doctor_user())
    assert (await _raw_doctor())["system"] == "homeopathy"


async def test_system_writes_the_real_column(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(system="Unani"), _doctor_user())
    assert (await _raw_doctor())["system"] == "unani"


async def test_languages_are_stored_comma_separated(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(languages=["Hindi", "English", "Hindi"]), _doctor_user())
    row = await _raw_doctor()
    assert row["languages"] == "Hindi, English"


async def test_languages_accept_a_plain_string(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(languages="Tamil, Hindi"), _doctor_user())
    assert (await _raw_doctor())["languages"] == "Tamil, Hindi"


async def test_availability_flags_land_in_real_columns(doc):
    await server.doctor_update_profile(server.DoctorProfileUpdate(
        is_available_online=False, is_available_offline=True), _doctor_user())
    row = await _raw_doctor()
    assert row["is_available_online"] == 0
    assert row["is_available_offline"] == 1
    me = await server.doctor_me(_doctor_user())
    assert me["consultation_mode"] == "offline"


async def test_consultation_fee_accepts_a_fraction(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(consultation_fee=499.5), _doctor_user())
    assert float((await _raw_doctor())["consultation_fee"]) == 499.5


# --------------------------------------------------------------------------- #
# Write: identity columns live on `users`
# --------------------------------------------------------------------------- #
async def test_name_lands_in_the_users_row(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(name="  New Doctor Name  "), _doctor_user())
    assert (await _raw_user())["name"] == "New Doctor Name"


async def test_phone_lands_in_the_users_row(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(phone="+91 98765-43210"), _doctor_user())
    assert (await _raw_user())["phone"] == "919876543210"


async def test_phone_taken_by_someone_else_is_refused(doc):
    with pytest.raises(server.HTTPException) as exc:
        await server.doctor_update_profile(
            server.DoctorProfileUpdate(phone="9990009503"), _doctor_user())
    assert exc.value.status_code == 409


async def test_phone_clash_detected_despite_stored_formatting(doc):
    # Existing rows store phones with formatting ('+919999999999'). An exact
    # string match misses those, so a formatted duplicate would slip past the
    # UNIQUE index and let one number belong to two accounts.
    await msdb._query(
        "UPDATE `users` SET phone = %s WHERE id = %s", ["+919876543210", OTHER_UID])
    for attempt in ("+919876543210", "91 98765 43210", "919876543210"):
        with pytest.raises(server.HTTPException) as exc:
            await server.doctor_update_profile(
                server.DoctorProfileUpdate(phone=attempt), _doctor_user())
        assert exc.value.status_code == 409, attempt
    assert (await _raw_user())["phone"] == "9990009502"


async def test_invalid_phone_is_refused(doc):
    with pytest.raises(server.HTTPException) as exc:
        await server.doctor_update_profile(
            server.DoctorProfileUpdate(phone="123"), _doctor_user())
    assert exc.value.status_code == 400


async def test_photo_writes_both_users_image_and_avatar(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(image="https://cdn.example.com/a.jpg"), _doctor_user())
    assert (await _raw_user())["image"] == "https://cdn.example.com/a.jpg"
    me = await server.doctor_me(_doctor_user())
    assert me["image"] == "https://cdn.example.com/a.jpg"
    assert me["avatar_url"] == "https://cdn.example.com/a.jpg"


async def test_base64_photo_becomes_a_data_uri(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(avatar_base64="QUJD"), _doctor_user())
    stored = (await _raw_user())["image"]
    assert stored == "data:image/jpeg;base64,QUJD"


# --------------------------------------------------------------------------- #
# Slug, mirroring the website
# --------------------------------------------------------------------------- #
def test_slugify_matches_the_website():
    assert server._slugify_doctor("Dr. Sunil Singh", "Ayurveda") == "dr-sunil-singh-ayurveda"
    assert server._slugify_doctor("sunil singh", "") == "dr-sunil-singh"
    # The website's `return `dr-${raw}`` keeps the trailing dash when `raw`
    # normalises to nothing (a JS template literal does not drop it), so the app
    # must return "dr-" here rather than "dr" to stay in parity.
    assert server._slugify_doctor("", None) == "dr-"
    assert server._slugify_doctor("Dr", None) == "dr-"
    assert server._slugify_doctor("Dr Sunil", None) == "dr-sunil"


async def test_renaming_regenerates_the_slug(doc):
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(name="Kavita Rao"), _doctor_user())
    assert (await _raw_doctor())["slug"] == "dr-kavita-rao"


async def test_slug_collision_gets_the_id_suffix(doc):
    await msdb._query(
        "INSERT INTO `doctors` (id,user_id,slug,system,is_approved) VALUES (9504,%s,'dr-shared-name','ayurveda',1)",
        [OTHER_UID])
    try:
        await server.doctor_update_profile(
            server.DoctorProfileUpdate(name="Shared Name"), _doctor_user())
        assert (await _raw_doctor())["slug"] == f"dr-shared-name-{DOC_ID}"
    finally:
        await msdb._query("DELETE FROM `doctors` WHERE id=%s", [9504])


async def test_slug_not_touched_when_the_name_is_unchanged(doc):
    before = (await _raw_doctor())["slug"]
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(city="Jaipur"), _doctor_user())
    assert (await _raw_doctor())["slug"] == before


# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #
async def test_unknown_specialization_is_refused(doc):
    with pytest.raises(server.HTTPException) as exc:
        await server.doctor_update_profile(
            server.DoctorProfileUpdate(specialization_id=999999), _doctor_user())
    assert exc.value.status_code == 400


async def test_specialization_list_is_replaced(doc):
    specs = await msdb._query("SELECT id FROM `specializations` ORDER BY id LIMIT 2")
    ids = [s["id"] for s in specs]
    await server.doctor_update_profile(
        server.DoctorProfileUpdate(specializations=ids), _doctor_user())
    rows = await msdb._query(
        "SELECT specialization_id FROM `doctor_specializations` WHERE doctor_id=%s ORDER BY specialization_id",
        [DOC_ID])
    assert [r["specialization_id"] for r in rows] == sorted(ids)


async def test_empty_update_is_refused(doc):
    with pytest.raises(server.HTTPException) as exc:
        await server.doctor_update_profile(
            server.DoctorProfileUpdate(), _doctor_user())
    assert exc.value.status_code == 400


async def test_admin_owned_columns_cannot_be_self_set(doc):
    # The update model does not declare approval/rating, so a client posting them
    # has them dropped: they cannot elevate the doctor or rewrite their rating.
    await server.doctor_update_profile(
        server.DoctorProfileUpdate.model_validate(
            {"about": "ok", "is_approved": True, "rating": 5.0,
             "is_restricted": 0, "restriction_reason": "nope"}),
        _doctor_user())
    row = await _raw_doctor()
    assert row["about"] == "ok"
    assert float(row["rating"]) == 4.2
    assert row["is_approved"] == 1
    assert row["is_restricted"] == 0
    assert row["restriction_reason"] is None


async def test_patients_cannot_use_the_doctor_endpoints(doc):
    patient = {"id": OTHER_UID, "role": "patient"}
    with pytest.raises(server.HTTPException) as exc:
        await server.doctor_me(patient)
    assert exc.value.status_code == 403
    with pytest.raises(server.HTTPException) as exc:
        await server.doctor_update_profile(
            server.DoctorProfileUpdate(city="Delhi"), patient)
    assert exc.value.status_code == 403


async def test_doctor_without_a_profile_row_gets_404():
    with pytest.raises(server.HTTPException) as exc:
        await server.doctor_me({"id": 999999, "role": "doctor"})
    assert exc.value.status_code == 404