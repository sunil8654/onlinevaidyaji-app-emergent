"""Doctor Full Profile: field mapping, real slots, and booking validation.

Self-contained on purpose: it creates and removes its own doctor / user rows
instead of going through `/api/auth/register`, so it does not depend on a
shared phone number or the per-IP register rate limit.

Slot semantics are pinned to the website's `GET /slots/available`
(OnlineVaidhyaJi.com/backend/routes/slots.js):
  * `day_of_week` follows JS `Date.getDay()` (0 = Sunday)
  * date-specific rows override recurring rows entirely
  * 30-minute starts, keeping only `start + 30min <= end`
  * slot `time` is "HH:MM:SS", label is 12-hour with no leading zero
  * booked = an `appointments` row for that date with status != 'cancelled'
"""
import asyncio
import datetime
import sys
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import msdb  # noqa: E402
import server  # noqa: E402

pytestmark = pytest.mark.asyncio

DOCTOR_ID = 9501
USER_ID = 9501

ONLINE, OFFLINE = "online", "offline"


def _day(offset: int = 1) -> datetime.date:
    return datetime.date.today() + datetime.timedelta(days=offset)


def _dow(d: datetime.date) -> int:
    """JS Date.getDay() order, which is what appointment_slots.day_of_week uses."""
    return d.isoweekday() % 7


async def _reset() -> None:
    for table, col, val in (
        ("reviews", "doctor_id", DOCTOR_ID),
        ("doctor_status", "doctor_id", DOCTOR_ID),
        ("doctor_specializations", "doctor_id", DOCTOR_ID),
        ("appointment_slots", "doctor_id", DOCTOR_ID),
        ("appointments", "doctor_id", DOCTOR_ID),
        ("doctors", "id", DOCTOR_ID),
        ("users", "id", USER_ID),
    ):
        await msdb._query("DELETE FROM `%s` WHERE %s=%%s" % (table, col), [val])


async def _create_doctor(**overrides) -> None:
    await _reset()
    await msdb._query(
        "INSERT INTO `users` (id,name,email,phone,role,password,created_at) "
        "VALUES (%s,'Profile Test','profiletest@vaidhyaji.example.com','9990009501',"
        "'doctor','!x',NOW())",
        [USER_ID],
    )
    fields = {
        "qualification": "BHMS, MD",
        "experience": 10,
        "consultation_fee": 800.00,
        "about": "A dedicated practitioner.",
        "bio": "Focus on hormonal health and PCOS.",
        "languages": "Hindi, English",
        "city": "Delhi",
        "is_available_online": 1,
        "is_available_offline": 1,
        "rating": 4.80,
        "review_count": 27,
        "is_approved": 1,
    }
    fields.update(overrides)
    await msdb._query(
        "INSERT INTO `doctors` (id,user_id,slug,system,gender,"
        "qualification,experience,consultation_fee,about,bio,languages,city,"
        "is_available_online,is_available_offline,rating,review_count,is_approved) "
        "VALUES (%s,%s,'dr-profile-test','ayurveda','female',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [DOCTOR_ID, USER_ID, fields["qualification"], fields["experience"],
         fields["consultation_fee"], fields["about"], fields["bio"], fields["languages"],
         fields["city"], fields["is_available_online"], fields["is_available_offline"],
         fields["rating"], fields["review_count"], fields["is_approved"]],
    )


async def _add_slot(day, start, end, *, dow=None, is_available=1) -> None:
    await msdb._query(
        "INSERT INTO `appointment_slots` "
        "(doctor_id,day_of_week,date,start_time,end_time,is_available) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        [DOCTOR_ID, dow, day, start, end, is_available],
    )


async def _book(day, hhmm, *, status="confirmed", type_=ONLINE) -> None:
    await msdb._query(
        "INSERT INTO `appointments` (patient_id,doctor_id,appointment_date,"
        "appointment_time,type,status,created_at) VALUES (1,%s,%s,%s,%s,%s,NOW())",
        [DOCTOR_ID, day, f"{hhmm}:00", type_, status],
    )


@pytest_asyncio.fixture
async def doctor():
    await _create_doctor()
    yield DOCTOR_ID
    await _reset()


# --------------------------------------------------------------------------- #
# Profile field mapping
# --------------------------------------------------------------------------- #
async def test_profile_exposes_every_field_the_website_shows(doctor):
    doc = await server._load_doctor_public(str(DOCTOR_ID))
    pub = await server.serialize_doctor_public(doc)

    assert pub["name"] == "Profile Test"
    assert pub["qualification"] == "BHMS, MD"
    assert pub["experience_years"] == 10
    assert pub["about"] == "A dedicated practitioner."
    assert pub["bio"] == "Focus on hormonal health and PCOS."
    assert pub["city"] == "Delhi"
    assert pub["consultation_fee"] == 800.0
    assert pub["is_available_online"] is True
    assert pub["is_available_offline"] is True
    assert pub["consultation_mode"] == "both"
    assert pub["is_available"] is True


async def test_about_and_bio_stay_separate(doctor):
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["about"] != pub["bio"]


async def test_comma_separated_languages_are_normalised(doctor):
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["languages"] == ["Hindi", "English"]


async def test_detail_profile_survives_a_cold_table_cache(doctor):
    # Regression: the detail endpoint selects rows with raw SQL, which bypasses
    # the collection API that normally fills msdb's table cache. On a cold cache
    # (e.g. the first request after a restart) every real column was dropped and
    # the profile rendered empty.
    msdb._table_cache.pop("doctors", None)
    pub = await server.serialize_doctor_public(
        await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["qualification"] == "BHMS, MD"
    assert pub["city"] == "Delhi"
    assert pub["about"] == "A dedicated practitioner."
    assert pub["consultation_fee"] == 800.0
    assert pub["is_available_online"] is True


async def test_json_array_languages_are_preserved(doctor):
    await msdb._query(
        "UPDATE `doctors` SET languages=%s WHERE id=%s", ('["Tamil","Hindi"]', DOCTOR_ID))
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["languages"] == ["Tamil", "Hindi"]


async def test_public_payload_never_leaks_account_identifiers(doctor):
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    for leaked in ("user_id", "email", "phone", "password"):
        assert leaked not in pub


async def test_missing_fields_are_reported_as_none_not_invented(doctor):
    await msdb._query(
        "UPDATE `doctors` SET qualification=NULL, about=NULL, bio=NULL, "
        "city=NULL, consultation_fee=NULL, experience=NULL, languages=NULL WHERE id=%s", [DOCTOR_ID])
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["qualification"] is None
    assert pub["about"] is None
    assert pub["bio"] is None
    assert pub["city"] is None
    assert pub["consultation_fee"] is None
    assert pub["languages"] == []


async def test_rating_comes_from_approved_reviews_only(doctor):
    await msdb._query("INSERT INTO `reviews` "
                      "(doctor_id,patient_id,appointment_id,rating,comment,is_approved,created_at) "
                      "VALUES (%s,1,NULL,5,'Great',1,NOW())", [DOCTOR_ID])
    await msdb._query("INSERT INTO `reviews` "
                      "(doctor_id,patient_id,appointment_id,rating,comment,is_approved,created_at) "
                      "VALUES (%s,1,NULL,1,'Bad',0,NOW())", [DOCTOR_ID])
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["review_count"] == 1
    assert pub["rating"] == pytest.approx(5.0)


async def test_rating_falls_back_to_denormalised_columns(doctor):
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["review_count"] == 27
    assert pub["rating"] == pytest.approx(4.8)


async def test_online_only_doctor_reports_single_mode(doctor):
    await msdb._query(
        "UPDATE `doctors` SET is_available_offline=0 WHERE id=%s", [DOCTOR_ID])
    pub = await server.serialize_doctor_public(await server._load_doctor_public(str(DOCTOR_ID)))
    assert pub["consultation_mode"] == "online"
    assert pub["is_available_offline"] is False


# --------------------------------------------------------------------------- #
# Slots - website parity
# --------------------------------------------------------------------------- #
async def test_no_schedule_means_no_slots(doctor):
    out = await server.get_doctor_slots(str(DOCTOR_ID), _day(1).isoformat())
    assert out["slots"] == []
    assert out["available"] == 0


async def test_window_expands_into_thirty_minute_slots(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "13:00:00")
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert [s["time"] for s in out["slots"]] == [
        "10:00:00", "10:30:00", "11:00:00", "11:30:00", "12:00:00", "12:30:00",
    ]
    assert out["total"] == 6
    assert out["available"] == 6


async def test_slot_time_carries_seconds_and_label_has_no_leading_zero(doctor):
    d = _day(1)
    await _add_slot(d, "13:00:00", "14:00:00")
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert out["slots"][0]["time"] == "13:00:00"
    assert out["slots"][0]["label"] == "1:00 PM"


async def test_window_shorter_than_interval_yields_nothing(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "10:29:00")
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert out["total"] == 0


async def test_unavailable_row_never_produces_a_slot(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00", is_available=0)
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert out["total"] == 0


async def test_recurring_row_resolves_on_matching_weekday(doctor):
    d = _day(2)
    await _add_slot(None, "09:00:00", "09:30:00", dow=_dow(d))
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert [s["time"] for s in out["slots"]] == ["09:00:00"]


async def test_recurring_row_ignored_on_other_weekday(doctor):
    d = _day(2)
    other = _day(5)
    await _add_slot(None, "09:00:00", "09:30:00", dow=_dow(d))
    out = await server.get_doctor_slots(str(DOCTOR_ID), other.isoformat())
    assert out["total"] == 0


async def test_sunday_is_day_of_week_zero(doctor):
    # Walk forward to the next Sunday and check the website's getDay() mapping.
    d = _day(1)
    while _dow(d) != 0:
        d += datetime.timedelta(days=1)
    await _add_slot(None, "08:00:00", "08:30:00", dow=0)
    assert _dow(d) == 0
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert [s["time"] for s in out["slots"]] == ["08:00:00"]


async def test_date_specific_rows_override_recurring_rows(doctor):
    d = _day(1)
    await _add_slot(None, "08:00:00", "09:00:00", dow=_dow(d))
    await _add_slot(d, "14:00:00", "15:00:00")
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert [s["time"] for s in out["slots"]] == ["14:00:00", "14:30:00"]


async def test_booked_slot_is_flagged_but_still_listed(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    await _book(d, "10:30")
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert [s["time"] for s in out["slots"] if s["is_booked"]] == ["10:30:00"]
    assert out["total"] == 4 and out["available"] == 3


async def test_cancelled_appointment_frees_the_slot(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    await _book(d, "10:30", status="cancelled")
    out = await server.get_doctor_slots(str(DOCTOR_ID), d.isoformat())
    assert out["total"] == 4
    assert out["available"] == 4


async def test_mysql_time_arriving_as_timedelta_is_handled():
    assert server._as_hhmm(datetime.timedelta(hours=13, minutes=45)) == "13:45"
    assert server._as_hms(datetime.timedelta(hours=10)) == "10:00:00"


async def test_appointment_time_is_returned_as_a_clock_not_seconds(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    await _book(d, "10:00")
    appt = await msdb.db.appointments.find_one({"doctor_id": DOCTOR_ID}, {"_id": 0})
    assert appt["appointment_time"] == "10:00:00"


async def test_slots_reject_bad_input(doctor):
    for bad in ("nope", "2026-13-45", ""):
        with pytest.raises(server.HTTPException):
            await server.get_doctor_slots(str(DOCTOR_ID), bad)
    with pytest.raises(server.HTTPException):
        await server.get_doctor_slots("999999", _day(1).isoformat())


# --------------------------------------------------------------------------- #
# Booking validation
# --------------------------------------------------------------------------- #
async def test_only_published_slots_are_bookable(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    stamp = d.isoformat()
    assert await server._is_slot_bookable(DOCTOR_ID, f"{stamp} 10:00") is True
    assert await server._is_slot_bookable(DOCTOR_ID, f"{stamp} 11:30") is True
    assert await server._is_slot_bookable(DOCTOR_ID, f"{stamp} 12:00") is False
    assert await server._is_slot_bookable(DOCTOR_ID, f"{stamp} 23:00") is False


async def test_malformed_slot_is_rejected_not_raised(doctor):
    for bad in ("nonsense", "", "2026-09-30", "2026-09-30 99:99"):
        assert await server._is_slot_bookable(DOCTOR_ID, bad) is False


async def test_booking_a_taken_slot_is_refused(doctor):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    await _book(d, "10:30")
    assert await server._is_slot_bookable(DOCTOR_ID, f"{d.isoformat()} 10:30") is False


async def test_appointment_persists_type_and_symptoms(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(server, "log_activity", _noop)
    monkeypatch.setattr(server, "send_push", _noop)

    body = server.AppointmentInput(
        doctor_id=str(DOCTOR_ID), slot=f"{d.isoformat()} 10:00",
        type=ONLINE, symptoms="  irregular periods  ",
    )
    created = await server.create_appointment(body, {"id": 1, "name": "P", "role": "patient"})

    row = await msdb.db.appointments.find_one({"id": created["id"]}, {"_id": 0})
    assert row["type"] == ONLINE
    assert row["symptoms"] == "irregular periods"
    assert str(row["appointment_date"]) == d.isoformat()
    assert row["appointment_time"] == "10:00:00"


async def test_online_booking_refused_when_doctor_is_offline_only(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    await msdb._query(
        "UPDATE `doctors` SET is_available_online=0, is_available_offline=1 WHERE id=%s", [DOCTOR_ID])

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(server, "log_activity", _noop)
    monkeypatch.setattr(server, "send_push", _noop)

    body = server.AppointmentInput(
        doctor_id=str(DOCTOR_ID), slot=f"{d.isoformat()} 10:00", type=ONLINE)
    with pytest.raises(server.HTTPException) as exc:
        await server.create_appointment(body, {"id": 1, "name": "P", "role": "patient"})
    assert exc.value.status_code == 400


async def test_offline_booking_refused_when_doctor_is_online_only(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    await msdb._query(
        "UPDATE `doctors` SET is_available_online=1, is_available_offline=0 WHERE id=%s", [DOCTOR_ID])

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(server, "log_activity", _noop)
    monkeypatch.setattr(server, "send_push", _noop)

    body = server.AppointmentInput(
        doctor_id=str(DOCTOR_ID), slot=f"{d.isoformat()} 10:00", type=OFFLINE)
    with pytest.raises(server.HTTPException) as exc:
        await server.create_appointment(body, {"id": 1, "name": "P", "role": "patient"})
    assert exc.value.status_code == 400


async def test_booking_an_unpublished_time_is_refused(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(server, "log_activity", _noop)
    monkeypatch.setattr(server, "send_push", _noop)

    body = server.AppointmentInput(
        doctor_id=str(DOCTOR_ID), slot=f"{d.isoformat()} 23:00", type=ONLINE)
    with pytest.raises(server.HTTPException) as exc:
        await server.create_appointment(body, {"id": 1, "name": "P", "role": "patient"})
    assert exc.value.status_code == 400


async def test_fee_is_not_invented_when_absent(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    await msdb._query(
        "UPDATE `doctors` SET consultation_fee=NULL WHERE id=%s", [DOCTOR_ID])

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(server, "log_activity", _noop)
    monkeypatch.setattr(server, "send_push", _noop)

    body = server.AppointmentInput(
        doctor_id=str(DOCTOR_ID), slot=f"{d.isoformat()} 10:00", type=ONLINE)
    created = await server.create_appointment(body, {"id": 1, "name": "P", "role": "patient"})
    row = await msdb.db.appointments.find_one({"id": created["id"]}, {"_id": 0})
    assert not row.get("amount")


# --------------------------------------------------------------------------- #
# Payment pricing
#
# The doctor profile books and then takes payment. The amount charged must come
# from the doctor's real consultation_fee, captured on the appointment at
# booking time - never from a client-supplied figure and never from a hardcoded
# fallback, which would take real money for a fee nobody quoted.
# --------------------------------------------------------------------------- #
async def _book_via_api(doctor_id: int, monkeypatch, when: str) -> str:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(server, "log_activity", _noop)
    monkeypatch.setattr(server, "send_push", _noop)
    body = server.AppointmentInput(doctor_id=str(doctor_id), slot=when, type=ONLINE)
    created = await server.create_appointment(
        body, {"id": 1, "name": "P", "role": "patient"})
    return str(created["id"])


async def test_payment_price_is_the_doctors_real_fee(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    appt_id = await _book_via_api(DOCTOR_ID, monkeypatch, f"{d.isoformat()} 10:00")
    assert await server._resolve_server_price("appointment", appt_id, {"id": 1}) == 80000


async def test_payment_refuses_when_the_doctor_has_no_fee(doctor, monkeypatch):
    # Regression: this used to fall back to a hardcoded Rs 500 and would have
    # charged a made-up amount for a doctor who has quoted nothing.
    await msdb._query(
        "UPDATE `doctors` SET consultation_fee=NULL WHERE id=%s", [DOCTOR_ID])
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    appt_id = await _book_via_api(DOCTOR_ID, monkeypatch, f"{d.isoformat()} 10:00")

    stored = await msdb.db.appointments.find_one({"id": appt_id}, {"_id": 0})
    assert not stored.get("amount")

    with pytest.raises(server.HTTPException) as exc:
        await server._resolve_server_price("appointment", appt_id, {"id": 1})
    assert exc.value.status_code == 400
    assert "not set a consultation fee" in exc.value.detail


async def test_payment_refuses_a_zero_fee(doctor, monkeypatch):
    await msdb._query(
        "UPDATE `doctors` SET consultation_fee=0 WHERE id=%s", [DOCTOR_ID])
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    appt_id = await _book_via_api(DOCTOR_ID, monkeypatch, f"{d.isoformat()} 10:00")
    with pytest.raises(server.HTTPException) as exc:
        await server._resolve_server_price("appointment", appt_id, {"id": 1})
    assert exc.value.status_code == 400


async def test_payment_refuses_someone_elses_appointment(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    appt_id = await _book_via_api(DOCTOR_ID, monkeypatch, f"{d.isoformat()} 10:00")
    with pytest.raises(server.HTTPException) as exc:
        await server._resolve_server_price("appointment", appt_id, {"id": 999})
    assert exc.value.status_code == 404


async def test_payment_refuses_an_already_paid_appointment(doctor, monkeypatch):
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    appt_id = await _book_via_api(DOCTOR_ID, monkeypatch, f"{d.isoformat()} 10:00")
    await msdb.db.appointments.update_one({"id": appt_id}, {"$set": {"paid": True}})
    with pytest.raises(server.HTTPException) as exc:
        await server._resolve_server_price("appointment", appt_id, {"id": 1})
    assert exc.value.status_code == 409


async def test_fractional_fee_is_preserved_in_paise(doctor, monkeypatch):
    await msdb._query(
        "UPDATE `doctors` SET consultation_fee=499.50 WHERE id=%s", [DOCTOR_ID])
    d = _day(1)
    await _add_slot(d, "10:00:00", "12:00:00")
    appt_id = await _book_via_api(DOCTOR_ID, monkeypatch, f"{d.isoformat()} 10:00")
    assert await server._resolve_server_price("appointment", appt_id, {"id": 1}) == 49950
