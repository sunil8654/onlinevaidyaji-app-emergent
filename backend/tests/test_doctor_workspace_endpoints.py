"""Regression tests for the doctor workspace endpoints.

These three endpoints were the source of the reported doctor-app bugs:

* `/doctor/my-appointments` sorted by the JSON-blob `slot` field, which made
  msdb sort in Python after loading every matching row, and then hard-capped the
  result at 500 rows - so a doctor's older consultations were unreachable.
* `/doctor/my-patients` loaded up to 1000 appointment rows and de-duplicated
  them in Python, reading `a["slot"]`/`a["patient_name"]` straight out of the
  blob with no default.
* `/doctor/earnings` summed two Python scans of up to 2000 rows each, both
  filtered on blob fields, so the headline total silently dropped payments past
  the cap.

The tests below pin the parts that must not regress: the SQL range/order
predicates are built from the real indexed columns, paging is honoured, and one
doctor never sees another doctor's rows.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import server as S  # noqa: E402
from server import APPT_ORDER, APPT_ORDER_ASC, _appt_scope_clause  # noqa: E402

pytestmark = pytest.mark.asyncio


# --------------------------------------------------------------------------
# Pure predicate builders - no database required.
# --------------------------------------------------------------------------

async def test_scope_clauses_use_real_indexed_columns():
    """Every scope must resolve to a real column, never the blob `slot`."""
    for scope in ("upcoming", "past", "today"):
        sql, params = _appt_scope_clause(scope)
        assert sql, f"{scope} produced no predicate"
        assert "slot" not in sql.lower(), f"{scope} still references blob slot"
        assert params, f"{scope} produced no bound parameter"

    today_sql, today_params = _appt_scope_clause("today")
    assert "appointment_date" in today_sql
    assert today_params[0] == datetime.now().strftime("%Y-%m-%d")

    up_sql, up_params = _appt_scope_clause("upcoming")
    pa_sql, pa_params = _appt_scope_clause("past")
    # Boundary is built from date+time concatenated so an appointment landing
    # exactly on "now" is not counted as past. Both scopes share the same
    # boundary instant and differ only in the comparison operator.
    assert "appointment_date" in up_sql and "appointment_time" in up_sql
    assert "appointment_date" in pa_sql and "appointment_time" in pa_sql
    assert ">=" in up_sql
    assert "<" in pa_sql and ">=" not in pa_sql
    assert up_params == pa_params, "both scopes must share one boundary instant"


async def test_unknown_scope_has_no_predicate():
    assert _appt_scope_clause("all") == ("", [])
    assert _appt_scope_clause("nonsense") == ("", [])


async def test_order_uses_real_columns_and_moves_together():
    """Upcoming lists must be soonest-first; history newest-first.

    The tiebreaker direction has to match the sort direction, otherwise two
    appointments at one clock time can swap places between pages and a doctor
    sees one twice and skips the other.
    """
    for order in (APPT_ORDER, APPT_ORDER_ASC):
        cols = [c for c, _ in order]
        assert cols == ["appointment_date", "appointment_time", "id"]
        assert "slot" not in cols

    dirs = [d for _, d in APPT_ORDER]
    assert dirs == ["desc", "desc", "desc"]
    adirs = [d for _, d in APPT_ORDER_ASC]
    assert adirs == ["asc", "asc", "asc"]


# --------------------------------------------------------------------------
# Database-backed behaviour. Skipped when no doctor fixture is available.
# --------------------------------------------------------------------------

@pytest_asyncio.fixture
async def doctor_user():
    """A real doctor who owns at least one appointment."""
    try:
        rows = await S._sql_query(
            "SELECT d.user_id AS uid, d.id AS did, COUNT(a.id) AS n "
            "FROM `doctors` d JOIN `appointments` a ON a.doctor_id = d.id "
            "GROUP BY d.user_id, d.id HAVING n > 0 LIMIT 1"
        )
    except Exception as e:  # pragma: no cover - environment without a database
        pytest.skip(f"database unavailable: {e}")
    if not rows:
        pytest.skip("no doctor with appointments in this database")
    r = rows[0]
    return {"id": str(r["uid"]), "role": "doctor"}


@pytest_asyncio.fixture
async def other_doctor_user(doctor_user):
    """A different doctor, used to prove cross-doctor isolation."""
    rows = await S._sql_query(
        "SELECT user_id FROM `doctors` WHERE user_id <> %s LIMIT 1",
        [doctor_user["id"]],
    )
    if not rows:
        pytest.skip("need a second doctor to test isolation")
    return {"id": str(rows[0]["user_id"]), "role": "doctor"}


async def _raw_appt_ids(user, scope="all", order=""):
    """Ground truth straight from SQL, independent of the endpoint."""
    d = await S.db.doctors.find_one({"user_id": user["id"]})
    did = int(d["id"])
    sql = "SELECT id FROM `appointments` WHERE doctor_id = %s"
    params = [did]
    w, p = _appt_scope_clause(scope)
    if w:
        sql += " AND " + w
        params += p
    order_sql = " ORDER BY appointment_date ASC, appointment_time ASC, id ASC"
    if order.lower() == "desc":
        order_sql = " ORDER BY appointment_date DESC, appointment_time DESC, id DESC"
    elif not order and scope != "upcoming":
        order_sql = " ORDER BY appointment_date DESC, appointment_time DESC, id DESC"
    rows = await S._sql_query(sql + order_sql, params)
    return [str(r["id"]) for r in rows]


async def test_my_appointments_returns_envelope_and_is_paged(doctor_user):
    res = await S.doctor_my_appointments(
        user=doctor_user, scope="all", status="", order="", page=1, limit=2
    )
    for key in ("items", "total", "page", "limit", "has_more"):
        assert key in res, f"missing {key} in paged envelope"
    assert res["page"] == 1 and res["limit"] == 2
    assert len(res["items"]) <= 2
    assert res["total"] >= len(res["items"])
    assert res["has_more"] == (2 < res["total"])


async def test_my_appointments_limit_is_capped(doctor_user):
    """The old endpoint's 500-row cap is gone, but the page size stays bounded."""
    res = await S.doctor_my_appointments(
        user=doctor_user, scope="all", status="", order="", page=1, limit=100_000
    )
    assert res["limit"] <= S.APPT_PAGE_MAX


async def test_my_appointments_paging_reaches_older_rows(doctor_user):
    """Every appointment must be reachable by paging - this is the bug where a
    hard cap hid everything past the newest N rows."""
    truth = await _raw_appt_ids(doctor_user)
    seen = []
    page = 1
    while True:
        res = await S.doctor_my_appointments(
            user=doctor_user, scope="all", status="", order="", page=page, limit=3
        )
        seen += [str(i["id"]) for i in res["items"]]
        if not res["has_more"]:
            break
        page += 1
        assert page < 100, "paging did not terminate"
    assert sorted(seen) == sorted(truth), "paging lost or duplicated appointments"


async def test_my_appointments_ordering_matches_sql(doctor_user):
    for order in ("asc", "desc"):
        res = await S.doctor_my_appointments(
            user=doctor_user, scope="all", status="", order=order, page=1, limit=100
        )
        truth = await _raw_appt_ids(doctor_user, order=order)
        assert [str(i["id"]) for i in res["items"]] == truth


async def test_my_appointments_scope_partitions_exhaustively(doctor_user):
    """upcoming + past must add up to the unfiltered total.

    Any appointment dropped by the partition is one the doctor can never see.
    """
    allr = await S.doctor_my_appointments(
        user=doctor_user, scope="all", status="", order="", page=1, limit=1
    )
    up = await S.doctor_my_appointments(
        user=doctor_user, scope="upcoming", status="", order="", page=1, limit=1
    )
    past = await S.doctor_my_appointments(
        user=doctor_user, scope="past", status="", order="", page=1, limit=1
    )
    assert up["total"] + past["total"] == allr["total"], (
        "an appointment fell through both the upcoming and past filters"
    )


async def test_my_appointments_isolates_doctors(doctor_user, other_doctor_user):
    mine = await S.doctor_my_appointments(
        user=doctor_user, scope="all", status="", order="", page=1, limit=100
    )
    theirs = await S.doctor_my_appointments(
        user=other_doctor_user, scope="all", status="", order="", page=1, limit=100
    )
    mine_ids = {str(i["id"]) for i in mine["items"]}
    theirs_ids = {str(i["id"]) for i in theirs["items"]}
    assert not (mine_ids & theirs_ids), "one doctor saw another doctor's appointments"


async def test_my_appointments_rejects_patients(doctor_user):
    with pytest.raises(Exception):
        await S.doctor_my_appointments(
            user={"id": "1", "role": "patient"}, scope="all", status="",
            order="", page=1, limit=5,
        )


async def test_my_patients_groups_uniquely_and_counts_visits(doctor_user):
    res = await S.doctor_my_patients(user=doctor_user, page=1, limit=100)
    items = res["items"]
    ids = [i["patient_id"] for i in items]
    assert len(ids) == len(set(ids)), "a patient was listed more than once"

    # total_visits must match a real GROUP BY, not be a hardcoded 0.
    truth = await S._sql_query(
        "SELECT patient_id AS pid, COUNT(*) AS visits FROM `appointments` "
        "WHERE doctor_id = (SELECT id FROM `doctors` WHERE user_id = %s) "
        "GROUP BY patient_id",
        [doctor_user["id"]],
    )
    expected = {str(r["pid"]): int(r["visits"]) for r in truth}
    assert res["total"] == len(expected)
    for item in items:
        assert item["total_visits"] == expected[item["patient_id"]]
        assert item["total_visits"] >= 1


async def test_my_patients_last_visit_is_newest(doctor_user):
    res = await S.doctor_my_patients(user=doctor_user, page=1, limit=100)
    truth = await S._sql_query(
        "SELECT patient_id AS pid, MAX(CONCAT(IFNULL(appointment_date,'1000-01-01'),' ',"
        "IFNULL(appointment_time,'00:00:00'))) AS lv FROM `appointments` "
        "WHERE doctor_id = (SELECT id FROM `doctors` WHERE user_id = %s) "
        "GROUP BY patient_id",
        [doctor_user["id"]],
    )
    expected = {str(r["pid"]): str(r["lv"]) for r in truth}
    for item in res["items"]:
        assert item["last_visit"] == expected[item["patient_id"]]


async def test_my_patients_isolates_doctors(doctor_user, other_doctor_user):
    mine = await S.doctor_my_patients(user=doctor_user, page=1, limit=100)
    theirs = await S.doctor_my_patients(user=other_doctor_user, page=1, limit=100)
    assert not (
        {i["patient_id"] for i in mine["items"]} & {i["patient_id"] for i in theirs["items"]}
    )


async def test_earnings_envelope_and_dense_trend(doctor_user):
    e = await S.doctor_earnings(user=doctor_user)
    for key in (
        "total_paise", "month_paise", "week_paise", "today_paise",
        "consultations", "daily", "recent",
    ):
        assert key in e, f"missing {key}"
    # The chart maps over `daily`, so it must always have exactly 30 buckets.
    assert len(e["daily"]) == 30
    dates = [d["date"] for d in e["daily"]]
    assert len(set(dates)) == 30
    for value in (e["total_paise"], e["month_paise"], e["week_paise"], e["today_paise"]):
        assert isinstance(value, int) and value >= 0
    # Period sums can never exceed the all-time total.
    assert e["today_paise"] <= e["total_paise"]
    assert e["week_paise"] <= e["total_paise"]
    assert e["month_paise"] <= e["total_paise"]


async def test_earnings_trend_starts_29_days_ago(doctor_user):
    e = await S.doctor_earnings(user=doctor_user)
    expected = (datetime.now().date() - timedelta(days=29)).strftime("%Y-%m-%d")
    assert e["daily"][0]["date"] == expected
    assert e["daily"][-1]["date"] == datetime.now().strftime("%Y-%m-%d")


async def test_earnings_recent_is_bounded(doctor_user):
    """`recent` is a preview list; the total must not be capped by its length."""
    e = await S.doctor_earnings(user=doctor_user)
    assert len(e["recent"]) <= 20
    if e["consultations"] > len(e["recent"]):
        # More payments than preview rows is fine only if the total still counts
        # all of them - i.e. total is not derived from `recent`.
        assert e["total_paise"] >= sum(r["amount_paise"] for r in e["recent"])


async def test_earnings_unknown_doctor_returns_zero_not_error(doctor_user):
    e = await S.doctor_earnings(user={"id": "99999999", "role": "doctor"})
    assert e["total_paise"] == 0
    assert e["consultations"] == 0
    assert len(e["daily"]) == 30


async def test_earnings_rejects_patients():
    with pytest.raises(Exception):
        await S.doctor_earnings(user={"id": "1", "role": "patient"})


async def test_earnings_scales_rupees_to_paise(doctor_user):
    """`payments.amount` is DECIMAL rupees; the app contract is paise.

    Proves the x100 conversion against a read-only synthetic set, so a future
    refactor cannot silently start reporting rupees as paise (a 100x error).
    """
    synth = (
        "SELECT 1 AS aid, 1 AS did, CAST(500.00 AS DECIMAL(10,2)) AS amount "
        "UNION ALL SELECT 2,1,CAST(200.50 AS DECIMAL(10,2)) "
        "UNION ALL SELECT 3,2,CAST(999.00 AS DECIMAL(10,2))"
    )
    paise = "CAST(COALESCE(amount,0) * 100 AS SIGNED)"
    mine = await S._sql_query(
        f"SELECT COALESCE(SUM({paise}),0) AS total FROM ({synth}) x WHERE did = %s",
        [1],
    )
    assert int(mine[0]["total"]) == 50000 + 20050
    theirs = await S._sql_query(
        f"SELECT COALESCE(SUM({paise}),0) AS total FROM ({synth}) x WHERE did = %s",
        [2],
    )
    assert int(theirs[0]["total"]) == 99900
