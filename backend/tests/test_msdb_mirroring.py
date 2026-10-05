"""msdb mirroring invariants.

`split_doc` decides whether a field becomes a REAL column or is buried in the
JSON `data` blob. Two properties matter:

1. An alias (e.g. doctors.verified -> is_approved) must beat a stale raw column
   in the same write, otherwise a read-modify-write silently reverts it.
2. A real column written directly (e.g. doctors.experience) must still reach the
   column. It previously did not, because the alias's target was always treated
   as "exclusively managed", so the value went to the blob and the website - the
   surface that reads the columns - never changed.
"""
import sys
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import msdb  # noqa: E402

pytestmark = pytest.mark.asyncio

DID = 9521
UID = 9521


@pytest_asyncio.fixture
async def doctor_row():
    for table, col, val in (("doctors", "id", DID), ("users", "id", UID)):
        await msdb._query("DELETE FROM `%s` WHERE %s=%%s" % (table, col), [val])
    await msdb._query(
        "INSERT INTO `users` (id,name,email,phone,role,password,created_at) "
        "VALUES (%s,'Mirror Doctor','mirror@vaidhyaji.example.com','99210009521',"
        "'doctor','!x',NOW())", [UID])
    await msdb._query(
        "INSERT INTO `doctors` (id,user_id,slug,system,experience,is_approved,"
        "is_available_online,is_available_offline,rating,review_count,languages) "
        "VALUES (%s,%s,'dr-mirror','ayurveda',5,0,0,0,4.0,3,'Hindi')", [DID, UID])
    yield DID
    for table, col, val in (("doctors", "id", DID), ("users", "id", UID)):
        await msdb._query("DELETE FROM `%s` WHERE %s=%%s" % (table, col), [val])


async def _col(name: str):
    r = await msdb._query(f"SELECT `{name}` v FROM `doctors` WHERE id=%s", [DID])
    return r[0]["v"]


async def test_alias_beats_stale_raw_column(doctor_row):
    # Property 1: admin approval sends `verified`, but row_to_doc also carries the
    # real is_approved it just read. The alias must win.
    await msdb.db.doctors.update_one(
        {"id": DID}, {"$set": {"verified": True, "is_approved": False}})
    assert int(await _col("is_approved")) == 1


async def test_real_column_written_directly_is_mirrored(doctor_row):
    # Property 2: the doctor profile editor sends these column names directly.
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"experience": 17}})
    assert int(await _col("experience")) == 17


async def test_availability_flags_written_directly(doctor_row):
    await msdb.db.doctors.update_one(
        {"id": DID}, {"$set": {"is_available_online": True, "is_available_offline": True}})
    assert int(await _col("is_available_online")) == 1
    assert int(await _col("is_available_offline")) == 1


async def test_availability_change_is_not_clobbered_by_stale_synthesis(doctor_row):
    # Regression: the row's read-side synthesis derived consultation_mode from
    # the flags as they were BEFORE the update. Merging the $set onto that
    # enriched view made the stale 'none' win, so turning online on silently
    # stored 0 and the doctor stayed invisible for online booking.
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"is_available_online": True}})
    assert int(await _col("is_available_online")) == 1
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"is_available_offline": True}})
    assert int(await _col("is_available_online")) == 1
    assert int(await _col("is_available_offline")) == 1


async def test_experience_alias_not_reverted_by_stale_synthesis(doctor_row):
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"experience_years": 9}})
    assert int(await _col("experience")) == 9


async def test_real_columns_survive_an_unrelated_update(doctor_row):
    # A blob-only write must not wipe the columns the website reads.
    await msdb.db.doctors.update_one(
        {"id": DID}, {"$set": {"clinic_name": "Ayurveda Kendra"}})
    assert int(await _col("experience")) == 5
    assert await _col("languages") == "Hindi"
    assert await _col("system") == "ayurveda"


async def test_gender_enum_written_directly(doctor_row):
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"gender": "female"}})
    assert await _col("gender") == "female"


async def test_updated_at_accepts_the_tz_aware_iso_string(doctor_row):
    # now_iso() emits '+00:00'; MySQL DATETIME rejects that, so the write used
    # to raise and take the whole profile update down with it.
    stamp = "2026-01-02T03:04:05.678901+00:00"
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"updated_at": stamp}})
    assert await _col("updated_at") is not None


async def test_languages_alias_still_joins(doctor_row):
    await msdb.db.doctors.update_one(
        {"id": DID}, {"$set": {"languages": ["Hindi", "Tamil"]}})
    assert await _col("languages") == "Hindi, Tamil"


async def test_consultation_mode_alias_still_splits(doctor_row):
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"consultation_mode": "both"}})
    assert int(await _col("is_available_online")) == 1
    assert int(await _col("is_available_offline")) == 1


async def test_unrelated_blob_only_field_does_not_leak(doctor_row):
    # clinic_name has no website column: it must stay in the blob only.
    await msdb.db.doctors.update_one({"id": DID}, {"$set": {"clinic_name": "Clinic"}})
    cols = await msdb._columns("doctors")
    assert "clinic_name" not in cols
    doc = await msdb.db.doctors.find_one({"id": DID})
    assert doc.get("clinic_name") == "Clinic"