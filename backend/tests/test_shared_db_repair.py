"""Regression tests for the shared-DB repairs made on real rows.

These lock in the three defects that had already corrupted rows:
  * appointments.status stuck at the ENUM default 'pending' while the JSON blob
    held the real value
  * doctors.system left NULL (website's "Type of Medicine" column empty) while
    data.specialty held the value
  * doctors.slug missing, or generated from `system` instead of the
    specializations name the website actually uses
"""
import subprocess
import json
import uuid

import pytest

import msdb
import server


@pytest.mark.asyncio
async def test_appointment_status_column_matches_blob_and_is_not_left_pending():
    """The historical bug: status column frozen at the ENUM default while the
    blob carried the authoritative value, or the two drifting apart after a
    repair. A read must return the status the website would see."""
    rows = await msdb._query("SELECT id, status, data FROM appointments")
    assert rows, "expected appointments to exist"
    for r in rows:
        blob = json.loads(r.get("data") or "{}")
        real = r.get("status")
        assert real in ("pending", "confirmed", "completed", "cancelled"), real
        if blob.get("status"):
            assert real == blob["status"], (
                f"appointment {r['id']}: column={real!r} blob={blob['status']!r}"
            )


@pytest.mark.asyncio
async def test_no_doctor_has_empty_system_column():
    """`system` is the website's Type of Medicine column. It was NULL on 14/15
    rows while data.specialty held 'Ayurveda'."""
    rows = await msdb._query(
        "SELECT id, system, data FROM doctors WHERE system IS NULL OR system = %s", ("",)
    )
    assert len(rows) == 0, f"doctors with empty system: {[r['id'] for r in rows]}"


@pytest.mark.asyncio
async def test_all_doctors_have_unique_non_empty_slug():
    total = await msdb._query("SELECT COUNT(*) c FROM doctors")
    distinct = await msdb._query("SELECT COUNT(DISTINCT slug) d FROM doctors")
    assert total[0]["c"] == distinct[0]["d"], "duplicate slugs would 404 the website"
    empty = await msdb._query(
        "SELECT id FROM doctors WHERE slug IS NULL OR slug = %s", ("",)
    )
    assert len(empty) == 0, f"doctors missing slug: {[r['id'] for r in empty]}"


def test_slug_generator_matches_website_node_implementation():
    """Parity check against OnlineVaidhyaJi.com/backend/utils/slug.js, run
    through node so the test tracks the real source of truth."""
    cases = [
        ["sunil singh", "ayurveda"],
        ["Test Doctor", "Ayurveda"],
        ["TEST_Doctor", None],
        ["Dr. Amit Verma", "Allopathy"],
        ["", "ayurveda"],
        ["Dr", ""],
        ["Dr", None],
        ["  ", "Orthopedics"],
    ]
    out = subprocess.run(
        [
            "node",
            "-e",
            "const {generateDoctorSlug}=require('./../OnlineVaidhyaJi.com/backend/utils/slug.js');"
            "console.log(JSON.stringify(" + json.dumps(cases) + ".map(([n,s])=>generateDoctorSlug(n,s))));",
        ],
        capture_output=True,
        text=True,
    )
    assert out.returncode == 0, out.stderr
    node_slugs = json.loads(out.stdout.strip())
    for (name, spec), node_slug in zip(cases, node_slugs):
        assert server._slugify_doctor(name, spec) == node_slug, (
            f"slug mismatch for {name!r}/{spec!r}: "
            f"app={server._slugify_doctor(name, spec)!r} node={node_slug!r}"
        )


@pytest.mark.asyncio
async def test_stored_slugs_match_website_generator_using_specialization_name():
    """The repair must use the `specializations` name, never `system`.

    `system` ('ayurveda') is not what the website passes to
    generateDoctorSlug - it passes primary_specialization, which is NULL for
    every current row, so the correct slug is name-only.
    """
    rows = await msdb._query(
        "SELECT d.id, d.slug, s.name AS spec_name, u.name AS uname FROM doctors d "
        "LEFT JOIN users u ON u.id = d.user_id "
        "LEFT JOIN specializations s ON s.id = d.specialization_id ORDER BY d.id"
    )
    seen = set()
    for r in rows:
        base = server._slugify_doctor((r.get("uname") or "").strip(), r.get("spec_name"))
        if base in seen:
            base = f"{base}-{r['id']}"
        seen.add(base)
        assert r.get("slug") == base, (
            f"doctor {r['id']}: stored slug {r.get('slug')!r} != website slug {base!r}"
        )


@pytest.mark.asyncio
async def test_status_update_round_trips_through_real_column():
    """The write path itself must keep working after the repair: a status change
    has to land in the ENUM column, not just the blob."""
    suffix = uuid.uuid4().hex[:8]
    u = await server.db.users.insert_one(
        {
            "name": "StatusRT",
            "email": f"statusrt_{suffix}@example.test",
            "phone": f"6{suffix}",
            "role": "patient",
        }
    )
    appt = await server.db.appointments.insert_one(
        {
            "patient_id": u.inserted_id,
            "doctor_id": 10,
            "status": "confirmed",
            "type": "online",
            "appointment_date": "2032-03-04",
            "appointment_time": "10:00",
            "data": {},
        }
    )
    try:
        assert appt.inserted_id, "appointments.id must come from the INT column"
        row = await msdb._query(
            "SELECT status FROM appointments WHERE id = %s", (appt.inserted_id,)
        )
        assert row[0]["status"] == "confirmed"

        await server.db.appointments.update_one(
            {"id": appt.inserted_id}, {"$set": {"status": "cancelled"}}
        )
        row2 = await msdb._query(
            "SELECT status FROM appointments WHERE id = %s", (appt.inserted_id,)
        )
        assert row2[0]["status"] == "cancelled"
    finally:
        await msdb._query("DELETE FROM appointments WHERE id = %s", (appt.inserted_id,))
        await msdb._query("DELETE FROM users WHERE id = %s", (u.inserted_id,))
