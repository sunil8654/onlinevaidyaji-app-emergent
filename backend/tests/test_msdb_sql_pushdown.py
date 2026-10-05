"""Guard the SQL filter pushdown added to msdb.

The pushdown moves equality predicates out of Python and into the WHERE clause.
That is only sound if the two agree exactly, so these tests compare the fast
path against the original full-scan matcher on the same real rows.
"""
import sys
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import msdb  # noqa: E402
from msdb import _columns, _match_doc, _pushdown_column, _sql_where, db  # noqa: E402

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def user_rows():
    rows = await db.users.find({}).to_list(None)
    if len(rows) < 2:
        pytest.skip("need at least 2 users rows in the database")
    return rows


@pytest.mark.asyncio
async def test_id_is_pushed_down_for_users():
    info = await _columns("users")
    assert _pushdown_column("id", info, "users") == "id"
    sql, params, resolved = _sql_where({"id": 7}, info, "users")
    assert sql == " WHERE `id` = %s"
    assert params == [7]
    assert resolved == {"id"}


@pytest.mark.asyncio
async def test_phone_and_email_are_pushed_down():
    info = await _columns("users")
    for field in ("phone", "email"):
        assert _pushdown_column(field, info, "users") == field


@pytest.mark.asyncio
async def test_nullable_column_is_not_pushed_down():
    """row_to_doc lets the `data` blob win over a NULL real column, so filtering
    a nullable column in SQL would drop rows Python matching returns."""
    info = await _columns("users")
    for col, meta in info.items():
        if meta.get("not_null") or col == "id":
            continue
        assert _pushdown_column(col, info, "users") != col, col


@pytest.mark.asyncio
async def test_none_and_operators_are_not_pushed_down():
    info = await _columns("users")
    assert _sql_where({"id": None}, info, "users") == ("", [], set())
    assert _sql_where({"id": {"$in": [1, 2]}}, info, "users") == ("", [], set())
    assert _sql_where({"id": {"$gt": 5}}, info, "users") == ("", [], set())
    assert _sql_where({"$or": [{"id": 1}]}, info, "users") == ("", [], set())
    assert _sql_where(None, info, "users") == ("", [], set())


@pytest.mark.asyncio
async def test_dotted_and_unknown_fields_are_not_pushed_down():
    info = await _columns("users")
    assert _pushdown_column("address.city", info, "users") is None
    assert _pushdown_column("no_such_field", info, "users") is None


@pytest.mark.asyncio
async def test_pushed_filter_matches_python_result(user_rows):
    """The fast path must return exactly what the old matcher returned."""
    checked = 0
    for doc in user_rows[:20]:
        doc_id = doc.get("id")
        if doc_id is None:
            continue
        expected = [d for d in user_rows if _match_doc(d, {"id": doc_id})]
        got = await db.users.find({"id": doc_id}).to_list(None)
        assert [d.get("id") for d in got] == [d.get("id") for d in expected]

        one = await db.users.find_one({"id": doc_id})
        assert one is not None
        assert str(one.get("id")) == str(doc_id)

        assert await db.users.count_documents({"id": doc_id}) == len(expected)
        checked += 1
    assert checked, "no usable users rows to compare"


@pytest.mark.asyncio
async def test_find_paged_requires_indexed_equality():
    with pytest.raises(ValueError):
        await db.find_paged("appointments", {}, limit=1)


@pytest.mark.asyncio
async def test_find_paged_counts_and_pages(user_rows):
    doc_id = next(d["id"] for d in user_rows if d.get("id") is not None)
    try:
        key = int(doc_id)
    except (TypeError, ValueError):
        pytest.skip("users.id is not numeric")
    page, total = await db.find_paged("users", {"id": key}, limit=1, offset=0)
    assert total == 1
    assert len(page) == 1
    assert str(page[0].get("id")) == str(doc_id)


@pytest.mark.asyncio
async def test_patient_appointments_paged_loses_nothing():
    """The patient history listing: no row duplicated, skipped or truncated
    across pages - the old code took the first 200 of an ascending sort."""
    rows = await db.appointments.find({}).to_list(None)
    if not rows:
        pytest.skip("no appointments rows")
    patient_id = next((d.get("patient_id") for d in rows if d.get("patient_id") is not None), None)
    if patient_id is None:
        pytest.skip("no patient_id on any appointment")

    expected_total = sum(1 for d in rows if _match_doc(d, {"patient_id": patient_id}))
    seen, page = [], 1
    while True:
        chunk, total = await db.find_paged(
            "appointments",
            {"patient_id": patient_id},
            limit=5,
            offset=(page - 1) * 5,
            order_by=[("appointment_date", "desc"), ("appointment_time", "desc")],
        )
        assert total == expected_total
        seen.extend(str(d.get("id")) for d in chunk)
        if not chunk or len(seen) >= total:
            break
        page += 1
        assert page < 100, "pagination did not terminate"

    assert len(seen) == expected_total
    assert len(set(seen)) == len(seen), "duplicate appointments across pages"


@pytest.mark.asyncio
async def test_patient_profiles_user_id_is_pushed_down():
    info = await _columns("patient_profiles")
    if "user_id" not in info:
        pytest.skip("patient_profiles table missing")
    assert _pushdown_column("user_id", info, "patient_profiles") == "user_id"
