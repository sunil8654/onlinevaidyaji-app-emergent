"""
One-off backfill: populate the real DATE/TIME columns on `appointments` from the
`slot` value already stored in each row's `data` JSON blob.

Those columns are NOT NULL and were never written (msdb's _MIRROR_TYPES has no
date/time/enum), so every row sat on 1970-01-01 00:00:00 / status='pending'.

Usage:
    python backfill_appointment_dates.py --dry-run   # show the plan, change nothing
    python backfill_appointment_dates.py --apply     # write it

Safe to re-run: only rows whose real columns are still the epoch default are touched.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import msdb
from msdb import _as_date, _as_time

EPOCH_DATE = "1970-01-01"


def parse_blob(raw):
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", "replace")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    return raw or {}


async def main(apply_changes: bool) -> int:
    rows = await msdb._query(
        "SELECT id, status, appointment_date, data FROM appointments ORDER BY id"
    )

    plan, skipped = [], []
    for r in rows:
        rid = r["id"]
        current_date = str(r.get("appointment_date"))[:10]
        blob = parse_blob(r.get("data"))
        slot = blob.get("slot")
        d, t = _as_date(slot), _as_time(slot)
        if d is None:
            skipped.append((rid, "no parsable 'slot' in data blob"))
            continue
        if current_date != EPOCH_DATE:
            skipped.append((rid, f"already populated ({current_date})"))
            continue
        plan.append((rid, slot, d, t))

    print(f"{'id':<5}{'slot':<22}{'-> appointment_date':<20}{'time':<10}")
    print("-" * 57)
    for rid, slot, d, t in plan:
        print(f"{rid:<5}{str(slot):<22}{str(d):<20}{str(t):<10}")

    if skipped:
        print(f"\nskipped {len(skipped)}:")
        for rid, why in skipped:
            print(f"  id={rid}: {why}")

    if not plan:
        print("\nnothing to do.")
        return 0

    if not apply_changes:
        print(f"\nDRY RUN - {len(plan)} row(s) would be updated. Re-run with --apply.")
        return 0

    conn = await msdb._get_conn()
    async with conn.cursor() as cur:
        for rid, _slot, d, t in plan:
            await cur.execute(
                "UPDATE appointments SET appointment_date=%s, appointment_time=%s "
                "WHERE id=%s",
                (d.isoformat(), t.isoformat() if t else "00:00:00", rid),
            )
        await conn.commit()
    print(f"\napplied {len(plan)} update(s).")

    check = await msdb._query(
        "SELECT id, appointment_date, appointment_time, status FROM appointments ORDER BY id"
    )
    print("\nresult:")
    for r in check:
        print(f"  id={r['id']:<5} {str(r['appointment_date'])[:10]}  "
              f"{str(r['appointment_time'])[:8]}  {r['status']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry run)")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.apply)))
