"""MongoDB-style data layer backed by the project MySQL database.

Replaces motor/pymongo (MongoDB) for the Online VaidyaJi app backend. The backend
server.py keeps its `db.<collection>.find_one(...)` style code unchanged; this
module implements that subset of the Mongo API directly against MySQL tables that
are created by onlinevaidyaji-full-database.sql.

Design notes
------------
* Collection names map 1:1 to MySQL tables in the SAME database used by the
  website (set via MYSQL_DATABASE). If a table does not exist yet it is
  auto-created with a generic document shape.
* Every managed table gets an extra `data` JSON column (added at startup if
  missing). The full app document is stored there so the app's Mongo-style
  workflow round-trips exactly.
* Scalar fields whose (snake_case) name matches a real column are ALSO mirrored
  into that column, so the website backend keeps seeing meaningful rows.
* `id` is the MySQL AUTO_INCREMENT primary key (INT). It is exposed to the API as
  a string to preserve the app's original "id is a string" contract.
* Foreign key checks are disabled on this connection because the app's relaxed
  document model cannot satisfy every FK/NOT NULL constraint of the website
  tables (e.g. seeded doctors have no linked user row).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import asyncmy
import asyncmy.cursors
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", 3306))
MYSQL_USER = os.environ.get("MYSQL_USER", "root")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "onlinevaidyaji")

# Column types that we mirror scalar values into (ENUM/temporal/binary are kept
# ONLY in the `data` JSON blob to avoid schema clashes with the app's documents).
_MIRROR_TYPES = {
    "tinyint", "smallint", "int", "mediumint", "bigint",
    "float", "double", "decimal",
    "char", "varchar", "text", "tinytext", "mediumtext", "longtext", "json",
}
_INT_TYPES = {"tinyint", "smallint", "int", "mediumint", "bigint"}
_DECIMAL_TYPES = {"float", "double", "decimal"}

# --------------------------------------------------------------------------- #
# Real-table mapping for the shared onlinevaidyaji database
# --------------------------------------------------------------------------- #
# The full schema (onlinevaidyaji-full-database.sql) already contains the app
# collections converted to MySQL. A few app collection names map onto website
# tables with different table/column names (the SQL file documents these).
# Resolving them here (instead of auto-creating generic tables) makes the app
# read/write the SAME rows the website uses.

# Collection name -> real MySQL table name.
TABLE_ALIASES: Dict[str, str] = {
    "activity": "audit_logs",                    # admin audit trail
    "support_messages": "contact_messages",      # support-chat lead-gen
    "medicines": "pharmacy_products",            # AYUSH shop catalog
    "medicine_orders": "orders",                 # medicine orders
    "health_documents": "prescription_uploads",  # patient-uploaded reports
    "doc_com_dm_messages": "messages",           # doctor DMs (thread_id -> room_id)
    "doc_com_notifications": "notifications",    # doctor community notifications
}

def _join_langs(v: Any) -> Any:
    if isinstance(v, (list, tuple, set)):
        return ", ".join(str(x) for x in v)
    return v or ""


def _enum_val(v: Any) -> Any:
    """Coerce an ENUM write to a plain string; drop empties so MySQL uses its default."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _as_date(v: Any) -> Any:
    """Accept date/datetime/ISO strings (and 'YYYY-MM-DD HH:MM' slots) -> date."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _int_val(v: Any) -> Any:
    """Coerce to int for INT writes; drop empties so MySQL applies its default."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _bool_val(v: Any) -> Any:
    """Coerce a flag to 0/1 for TINYINT availability columns."""
    if v is None or v == "":
        return None
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("both", "online", "true", "1", "yes"):
            return 1
        if s in ("offline", "false", "0", "no"):
            return 0
        return None
    return 1 if v else 0


def _as_datetime(v: Any) -> Any:
    """Accept date/datetime/ISO-8601 strings -> naive datetime for MySQL DATETIME.

    now_iso() produces tz-aware ISO strings ('...T...+00:00'). MySQL rejects the
    trailing offset on a DATETIME column, so strip it instead of losing the write.
    """
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    s = str(v).strip().replace("T", " ")
    if s.endswith("Z"):
        s = s[:-1].strip()
    m = re.search(r"[+-]\d{2}:\d{2}$", s)          # drop a trailing UTC offset
    if m:
        s = s[:m.start()].strip()
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _as_time(v: Any) -> Any:
    """Accept time/datetime/ISO strings (and 'YYYY-MM-DD HH:MM' slots) -> time."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.time()
    if isinstance(v, time):
        return v
    s = str(v).strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M:%S", "%H:%M", "%I:%M %p"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    return None


# Collection name -> {app document field: target column(s)}.
# Values are mirrored into these columns (when scalar + mirrorable) so the website
# backend sees meaningful rows, in addition to the full app document round-tripping
# through the `data` JSON column. A field maps to:
#   - a column name, or
#   - a list of column names (same value into each, e.g. price), or
#   - a list of (column, transform_fn) pairs for values that need reshaping.
COLUMN_MAPS: Dict[str, Dict[str, Any]] = {
    "activity": {"kind": "action", "actor_id": "user_id", "actor_name": "details"},
    "support_messages": {"session_id": "subject", "text": "message"},
    "health_documents": {"storage_path": "file_path"},
    "doc_com_dm_messages": {"thread_id": "room_id", "text": "content"},
    "doc_com_notifications": {"doctor_id": "user_id", "snippet": "message", "read": "is_read"},
    "medicines": {"price": ["sale_price", "mrp"]},
    # appointments: the real columns are DATE / TIME / ENUM, and none of those
    # base types are in _MIRROR_TYPES, so without these callable entries
    # split_doc drops them into the JSON blob and every booking silently stored
    # appointment_date=1970-01-01, appointment_time=00:00, status='pending'.
    # The callable branch bypasses the _MIRROR_TYPES gate.
    "appointments": {
        "status": [("status", _enum_val)],
        "type": [("type", _enum_val)],
        "appointment_date": [("appointment_date", _as_date)],
        "appointment_time": [("appointment_time", _as_time)],
    },
    # Doctor consultation surface. Same reason as `appointments`: these tables are
    # almost entirely ENUM / TIMESTAMP / DATE columns, none of which are in
    # _MIRROR_TYPES, so without callable entries split_doc drops every one of
    # them into the JSON blob and the website reads NULL/empty rows.
    "consultation_rooms": {
        "type": [("type", _enum_val)],
        "status": [("status", _enum_val)],
        "created_at": [("created_at", _as_datetime)],
        "ended_at": [("ended_at", _as_datetime)],
    },
    "messages": {
        "sender_role": [("sender_role", _enum_val)],
        "message_type": [("message_type", _enum_val)],
        "is_read": [("is_read", _bool_val)],
        "read_at": [("read_at", _as_datetime)],
        "created_at": [("created_at", _as_datetime)],
    },
    "video_sessions": {
        "status": [("status", _enum_val)],
        "started_at": [("started_at", _as_datetime)],
        "ended_at": [("ended_at", _as_datetime)],
        "created_at": [("created_at", _as_datetime)],
    },
    "doctor_verifications": {
        "status": [("status", _enum_val)],
        "verified_at": [("verified_at", _as_datetime)],
        "created_at": [("created_at", _as_datetime)],
    },
    "doctor_status": {
        "status": [("status", _enum_val)],
        "last_seen": [("last_seen", _as_datetime)],
        "updated_at": [("updated_at", _as_datetime)],
    },
    "appointment_slots": {
        "date": [("date", _as_date)],
        "start_time": [("start_time", _as_time)],
        "end_time": [("end_time", _as_time)],
        "is_available": [("is_available", _bool_val)],
        "day_of_week": [("day_of_week", _int_val)],
        "created_at": [("created_at", _as_datetime)],
    },
    # notifications is reached through the doc_com_notifications alias above, but
    # the general inbox writes it directly under its real name.
    "notifications": {
        "is_read": [("is_read", _bool_val)],
        "created_at": [("created_at", _as_datetime)],
    },
    # Bidirectional doctor sync — app field names -> website doctors columns.
    "doctors": {
        "experience_years": "experience",
        "reviews": "review_count",
        "verified": "is_approved",
        "languages": [("languages", _join_langs)],
        "consultation_mode": [
            ("is_available_online", lambda v: 1 if v in ("both", "online") else 0),
            ("is_available_offline", lambda v: 1 if v in ("both", "offline") else 0),
        ],
        # The doctor profile editor writes these real columns directly rather
        # than through the aliases above, so they need explicit entries: ENUM and
        # DATETIME base types are absent from _MIRROR_TYPES and would otherwise
        # land in the JSON blob only, leaving the website unchanged.
        "gender": [("gender", _enum_val)],
        "experience": [("experience", _int_val)],
        "is_available_online": [("is_available_online", _bool_val)],
        "is_available_offline": [("is_available_offline", _bool_val)],
        "updated_at": [("updated_at", _as_datetime)],
        "created_at": [("created_at", _as_datetime)],
    },
}

# Table name -> doc post-processor. Synthesises app-style fields from real
# columns so the app UI keeps working on rows written by the website backend
# (which have no `data` JSON payload).
def _synth_medicine(doc: Dict[str, Any]) -> Dict[str, Any]:
    if doc.get("price") is None:
        for col in ("sale_price", "mrp"):
            v = doc.get(col)
            if v is not None:
                doc["price"] = float(v)
                break
    return doc


def _lang_list(value: Any) -> List[str]:
    """Normalise `doctors.languages` to a list of plain language names.

    The website stores a comma-separated varchar, but the app has also written
    a JSON array into the same column, so accept both. Splitting a JSON string
    on commas leaves quote fragments behind, which is why this is not a bare
    `split(",")`.
    """
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        return [str(p).strip() for p in value if str(p).strip()]
    s = str(value).strip()
    if s.startswith("["):
        try:
            parsed = json.loads(s)
        except (TypeError, ValueError):
            parsed = None
        if isinstance(parsed, list):
            return [str(p).strip() for p in parsed if str(p).strip()]
    return [x.strip() for x in s.split(",") if x.strip()]


def _synth_doctor(doc: Dict[str, Any]) -> Dict[str, Any]:
    # Website-written rows have no `data` JSON — expose app-style fields from
    # the real columns so the app UI renders them like app-written rows.
    if doc.get("verified") is None:
        doc["verified"] = bool(doc.get("is_approved"))
    if "experience_years" not in doc:
        doc["experience_years"] = doc.get("experience") or 0
    if "reviews" not in doc:
        doc["reviews"] = doc.get("review_count") or 0
    if "consultation_mode" not in doc:
        online = bool(doc.get("is_available_online"))
        offline = bool(doc.get("is_available_offline"))
        doc["consultation_mode"] = "both" if (online and offline) else ("online" if online else ("offline" if offline else None))
    # Web rows only carry `system` — give app callers the field shapes they
    # expect so raw no-projection reads (e.g. create_appointment) never KeyError.
    doc.setdefault("specialty", doc.get("system") or None)
    doc.setdefault("qualification", None)
    doc.setdefault("consultation_fee", None)
    doc.setdefault("bio", None)
    doc.setdefault("rating", 0.0)
    doc.setdefault("avatar_url", None)
    doc["languages"] = _lang_list(doc.get("languages"))
    return doc


def _synth_appointment(doc: Dict[str, Any]) -> Dict[str, Any]:
    """`appointments.appointment_time` is a MySQL TIME column.

    The driver hands TIME back as a `datetime.timedelta`, which JSON-encodes to
    a plain number of seconds - the app was rendering "36000.0" where it should
    show 10:00 AM. Normalise once, here, so every read path (find / find_one /
    raw SQL via row_to_doc) returns "HH:MM:SS".
    """
    t = doc.get("appointment_time")
    if isinstance(t, timedelta):
        secs = int(t.total_seconds())
        if 0 <= secs < 86400:
            doc["appointment_time"] = "%02d:%02d:%02d" % (
                secs // 3600, (secs % 3600) // 60, secs % 60,
            )
    elif isinstance(t, time):
        doc["appointment_time"] = t.strftime("%H:%M:%S")
    return doc


POST_READ_SYNTH: Dict[str, Any] = {
    "pharmacy_products": _synth_medicine,
    "doctors": _synth_doctor,
    "appointments": _synth_appointment,
}

_fill_re = re.compile(r"^([a-z]+)")

_pool: Optional[asyncmy.Pool] = None
_pool_loop: Optional[asyncio.AbstractEventLoop] = None
_pool_lock = asyncio.Lock()
_table_cache: Dict[str, Optional[Dict[str, Any]]] = {}
# Pool sizing. The old code funnelled every statement through ONE connection
# guarded by a global asyncio.Lock, so requests were executed strictly one at a
# time and a single slow query blocked the whole app. DB_POOL_SIZE caps the
# concurrent statement count; DB_POOL_MIN keeps warm connections so a burst
# does not pay a TCP+auth handshake per request.
DB_POOL_MIN = max(1, int(os.environ.get("DB_POOL_MIN", "4")))
DB_POOL_MAX = max(DB_POOL_MIN, int(os.environ.get("DB_POOL_SIZE", "16")))
# Fail fast instead of hanging a request thread forever if MySQL is down.
DB_CONNECT_TIMEOUT = max(1, int(os.environ.get("DB_CONNECT_TIMEOUT", "10")))


# --------------------------------------------------------------------------- #
# Connection helpers
# --------------------------------------------------------------------------- #
def _now_iso() -> str:
    return datetime.now(datetime.timezone.utc).isoformat()


def _ident(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]+", str(name)):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


async def _open_conn() -> asyncmy.connection.Connection:
    conn = await asyncmy.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        db=MYSQL_DATABASE,
        autocommit=True,
        charset="utf8mb4",
        connect_timeout=DB_CONNECT_TIMEOUT,
    )
    try:
        async with conn.cursor() as cur:
            await cur.execute("SET FOREIGN_KEY_CHECKS=0")
            await cur.execute("SET NAMES utf8mb4")
    except Exception:
        pass
    return conn


async def _discard_pool() -> None:
    """Drop the cached pool. Safe to call when it is already unusable."""
    global _pool, _pool_loop
    pool, _pool, _pool_loop = _pool, None, None
    if pool is None:
        return
    try:
        pool.close()
        await pool.wait_closed()
    except Exception:
        pass


async def _get_pool() -> asyncmy.Pool:
    """The shared connection pool, created on first use.

    A pool is bound to the event loop that created it - asyncmy runs pool
    housekeeping as tasks on that loop. If the running loop has changed (the
    test suite gives each test a fresh loop) the cached pool is dead, so it is
    discarded and rebuilt instead of handing back connections that can never be
    used again.
    """
    global _pool, _pool_loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # pragma: no cover - only outside async context
        loop = None
    if _pool is not None and _pool_loop is not loop:
        await _discard_pool()
    if _pool is None:
        async with _pool_lock:
            # Re-check: another coroutine may have built it while we waited.
            if _pool is None or _pool_loop is not loop:
                await _discard_pool()
                _pool = await asyncmy.create_pool(
                    host=MYSQL_HOST,
                    port=MYSQL_PORT,
                    user=MYSQL_USER,
                    password=MYSQL_PASSWORD,
                    db=MYSQL_DATABASE,
                    autocommit=True,
                    charset="utf8mb4",
                    minsize=DB_POOL_MIN,
                    maxsize=DB_POOL_MAX,
                    init_command="SET FOREIGN_KEY_CHECKS=0",
                    connect_timeout=DB_CONNECT_TIMEOUT,
                )
                _pool_loop = loop
    return _pool


async def _get_conn() -> asyncmy.connection.Connection:
    """A dedicated connection, outside the pool.

    Only for callers that need to hold a connection open (the backfill script).
    Prefer `_query` / `_query_many`, which borrow from the pool instead.
    """
    return await _open_conn()


async def _query(sql: str, params: Optional[List[Any]] = None) -> Any:
    """Run a statement. Returns row list for SELECT, lastrowid for writes."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await cur.execute(sql, list(params) if params else [])
            if cur.description is None:
                return cur.lastrowid
            return await cur.fetchall()


async def _query_many(statements: List[tuple]) -> List[Any]:
    """Run several statements on ONE pooled connection.

    Used where a listing needs a COUNT plus a page of rows: borrowing one
    connection keeps both statements on the same session without serialising
    other requests behind a global lock.
    """
    pool = await _get_pool()
    out: List[Any] = []
    async with pool.acquire() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            for sql, params in statements:
                await cur.execute(sql, list(params) if params else [])
                out.append(
                    cur.lastrowid if cur.description is None else await cur.fetchall()
                )
    return out



async def close_db() -> None:
    await _discard_pool()
    _table_cache.clear()


# --------------------------------------------------------------------------- #
# Schema helpers
# --------------------------------------------------------------------------- #
async def _columns(table: str) -> Dict[str, Dict[str, Any]]:
    t = _ident(table)
    if t in _table_cache and _table_cache[t] is not None:
        return _table_cache[t]
    rows = await _query(
        "SELECT COLUMN_NAME AS c, DATA_TYPE AS t, COLUMN_TYPE AS ct, "
        "IS_NULLABLE AS n, "
        "COLUMN_DEFAULT AS d, EXTRA AS e, CHARACTER_MAXIMUM_LENGTH AS l "
        "FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
        [MYSQL_DATABASE, t],
    )
    if not rows:
        _table_cache[t] = None
        return {}
    info: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        info[r["c"]] = {
            "type": (r["t"] or "").lower(),
            "col_type": (r["ct"] or "").lower(),
            "not_null": (r["n"] or "yes").lower() == "no",
            "default": r["d"],
            "extra": (r["e"] or "").lower(),
            "len": r["l"],
        }
    # Mark columns covered by PRIMARY/UNIQUE indexes so auto-fill values are unique.
    try:
        urows = await _query(
            "SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND NON_UNIQUE = 0",
            [MYSQL_DATABASE, t],
        )
        for r in urows:
            if r["c"] in info:
                info[r["c"]]["unique"] = True
    except Exception:
        pass
    _table_cache[t] = info
    return info


async def _table_exists(table: str) -> bool:
    return bool(await _columns(table))


async def _ensure_collection(table: str) -> None:
    """Create the table + `data` JSON column if missing."""
    t = _ident(table)
    if not await _table_exists(t):
        await _query(
            "CREATE TABLE IF NOT EXISTS `%s` ("
            "id INT AUTO_INCREMENT PRIMARY KEY, "
            "created_at DATETIME NULL, "
            "data JSON NULL)" % t
        )
        _table_cache[t] = None
        await _columns(t)
    info = await _columns(t)
    if "data" not in info:
        await _query("ALTER TABLE `%s` ADD COLUMN data JSON NULL" % t)
        _table_cache[t] = None
        await _columns(t)


# --------------------------------------------------------------------------- #
# Value conversion helpers
# --------------------------------------------------------------------------- #
def _snake(key: str) -> str:
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key).lower()


def _base_type(stype: str) -> str:
    m = _fill_re.match(stype)
    return m.group(1) if m else stype


def _enum_members(col_type: Optional[str]) -> List[str]:
    """Extract the allowed values from an ENUM column type, e.g.
    `enum('user','assistant')` -> ['user', 'assistant']. Empty when not an enum."""
    if not col_type:
        return []
    return re.findall(r"'((?:[^'\\]|\\.)*)'", str(col_type))


def _fill_value(stype: str, unique: bool = False, max_len: Optional[int] = None,
                col_type: Optional[str] = None) -> Any:
    b = _base_type(stype)
    if b in _INT_TYPES or b in _DECIMAL_TYPES:
        return _fill_int() if unique else 0
    if b in ("date",):
        return "1970-01-01"
    if b in ("time",):
        return "00:00:00"
    if b in ("datetime", "timestamp"):
        return "1970-01-01 00:00:00"
    if b == "enum":
        # NOT NULL ENUM columns have no sensible empty string — insert a valid
        # member instead so strict MySQL/MariaDB modes don't truncate-reject it.
        members = _enum_members(col_type)
        if members:
            return members[0]
        return ""  # defensive: malformed enum type, e.g. empty enum(...)
    return _fill_uuid(max_len) if unique else ""


def _fill_uuid(max_len: Optional[int] = None) -> str:
    token = "fill_" + uuid.uuid4().hex[:16]
    if max_len and len(token) > max_len:
        token = "f" + uuid.uuid4().hex[: max_len - 1]
    return token


def _fill_int() -> int:
    return uuid.uuid4().int >> 64


def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool, Decimal))


def _to_sql(v: Any) -> Any:
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return v


def _norm_cell(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, time):
        return v.isoformat()
    if isinstance(v, (Decimal,)):
        return float(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return v


# --------------------------------------------------------------------------- #
# Mongo-style filter/update evaluation (pure python)
# --------------------------------------------------------------------------- #
def _values_eq(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float, Decimal)) and isinstance(b, (int, float, Decimal, bool)):
        return float(a) == float(b)
    if isinstance(a, (bool,)) and isinstance(b, (int, float)):
        return float(a) == float(b)
    if isinstance(a, str) and isinstance(b, bool):
        return False
    # A value hydrated from a real MySQL column keeps its numeric type, while
    # the same value round-tripped through the `data` JSON blob is a string
    # (and user["id"] from a JWT is a string too). Compare numerically when
    # one side is a number and the other is its decimal-string form, otherwise
    # filters like {"patient_id": "15"} silently match nothing.
    if isinstance(a, str) != isinstance(b, str):
        num, txt = (b, a) if isinstance(a, str) else (a, b)
        if isinstance(num, (int, float, Decimal)) and not isinstance(num, bool):
            s = txt.strip()
            try:
                return float(num) == float(s)
            except (TypeError, ValueError):
                return a == b
    return a == b


def _cmp(a: Any, b: Any) -> int:
    try:
        fa, fb = float(a), float(b)
        return -1 if fa < fb else (1 if fa > fb else 0)
    except (TypeError, ValueError):
        pass
    if isinstance(a, str) and isinstance(b, str):
        return -1 if a < b else (1 if a > b else 0)
    try:
        return -1 if a < b else (1 if a > b else 0)
    except TypeError:
        return 0


def _get_path(doc: Dict[str, Any], key: str) -> Any:
    if "." in key:
        cur: Any = doc
        for p in key.split("."):
            if not isinstance(cur, dict) or p not in cur:
                return None
            cur = cur[p]
        return cur
    return doc.get(key)


def _has_path(doc: Dict[str, Any], key: str) -> bool:
    if "." in key:
        cur: Any = doc
        for p in key.split("."):
            if not isinstance(cur, dict) or p not in cur:
                return False
            cur = cur[p]
        return True
    return key in doc


def _missing_matches(cond: Any) -> bool:
    """True when a document that LACKS a field should still match the condition."""
    if isinstance(cond, dict):
        if "$ne" in cond or "$nin" in cond:
            return True
        if "$exists" in cond:
            return cond["$exists"] is False
        if "$eq" in cond:
            return cond["$eq"] is None
        if "$in" in cond:
            return None in cond["$in"]
        if "$not" in cond:
            return True
        if "$or" in cond:
            return any(_missing_matches(x) for x in cond["$or"])
        if "$and" in cond:
            return all(_missing_matches(x) for x in cond["$and"])
        if "$size" in cond:
            return False
        return False
    return cond is None


def _match_cond(cond: Any, act: Any, present: bool) -> bool:
    if isinstance(cond, dict) and not any(
        k in cond
        for k in (
            "$ne", "$eq", "$in", "$nin", "$gt", "$gte", "$lt", "$lte",
            "$regex", "$options", "$exists", "$size", "$all", "$not",
            "$elemMatch", "$type", "$mod", "$text",
        )
    ):
        # Plain dict -> full-document equality (nested object match)
        if not present:
            return cond is None
        return _values_eq(act, cond)

    if not isinstance(cond, dict):
        return _values_eq(act if present else None, cond)

    for op, cv in cond.items():
        if op == "$ne":
            if _values_eq(act if present else None, cv):
                return False
        elif op == "$eq":
            if not _values_eq(act if present else None, cv):
                return False
        elif op == "$in":
            if not any(_values_eq(act if present else None, x) for x in cv):
                return False
        elif op == "$nin":
            if any(_values_eq(act if present else None, x) for x in cv):
                return False
        elif op in ("$gt", "$gte", "$lt", "$lte"):
            if not present or act is None:
                return False
            c = _cmp(act, cv)
            if op == "$gt" and not (c > 0):
                return False
            if op == "$gte" and not (c >= 0):
                return False
            if op == "$lt" and not (c < 0):
                return False
            if op == "$lte" and not (c <= 0):
                return False
        elif op == "$regex":
            if not present or act is None:
                return False
            flags = 0
            opts = cond.get("$options", "")
            if "i" in opts:
                flags |= re.I
            if "m" in opts:
                flags |= re.M
            if "s" in opts:
                flags |= re.S
            try:
                if not re.search(cv, str(act), flags):
                    return False
            except re.error:
                return False
        elif op == "$options":
            pass
        elif op == "$exists":
            if bool(present) != bool(cv):
                return False
        elif op == "$size":
            if not present or act is None or not isinstance(act, (list, tuple, dict, str)):
                return False
            if len(act) != cv:
                return False
        elif op == "$all":
            if not present or not isinstance(act, list):
                return False
            for x in cv:
                if x not in act:
                    return False
        elif op == "$not":
            if _match_cond(cv, act, present):
                return False
        elif op == "$elemMatch":
            if not present or not isinstance(act, list):
                return False
            if not isinstance(cv, dict):
                return False
            if not any(_match_doc(item, cv) for item in act):
                return False
        else:
            if not _values_eq(act if present else None, cv):
                return False
    return True


def _match_doc(doc: Dict[str, Any], filt: Optional[Dict[str, Any]]) -> bool:
    if not filt:
        return True
    for k, v in filt.items():
        if k == "$or":
            if not any(_match_doc(doc, sub) for sub in v):
                return False
            continue
        if k == "$and":
            if not all(_match_doc(doc, sub) for sub in v):
                return False
            continue
        present = _has_path(doc, k)
        if not present:
            if not _missing_matches(v):
                return False
            continue
        if not _match_cond(v, _get_path(doc, k), True):
            return False
    return True


# --------------------------------------------------------------------------- #
# SQL filter pushdown
# --------------------------------------------------------------------------- #
# Every find() used to run `SELECT *` over the whole table and match in Python
# via _match_doc. On the shared database that turns `users.find_one({"id": sub})`
# - the lookup every authenticated request performs - into a full table read
# plus a JSON decode per row, and `appointments.find({"patient_id": ...})` into
# a full scan of every booking ever made. Equality predicates are pushed into
# the WHERE clause instead so MySQL can serve them from the primary key.
#
# Only NOT NULL columns qualify. row_to_doc deliberately lets the `data` JSON
# blob win over a NULL real column, so a nullable column can disagree with the
# blob; `WHERE col = ?` would then silently drop rows that Python matching
# would have returned. A NOT NULL column is always written, so the two agree.

def _pushdown_column(field: str, info: Dict[str, Any], collection: str) -> Optional[str]:
    """Real column to filter `field` on, or None when Python matching must stay."""
    if not field or "." in field or field.startswith("$"):
        return None
    candidates: List[str] = [field, _snake(field)]
    mapped = COLUMN_MAPS.get(collection, {}).get(field)
    if isinstance(mapped, str):
        candidates.append(mapped)
    elif isinstance(mapped, (list, tuple)):
        for target in mapped:
            if isinstance(target, (list, tuple)) and len(target) == 2 and callable(target[1]):
                target = target[0]
            if isinstance(target, str):
                candidates.append(target)
    for col in candidates:
        meta = info.get(col)
        if meta and meta.get("not_null"):
            return col
    return None


def _sql_where(
    filt: Optional[Dict[str, Any]], info: Dict[str, Any], collection: str
) -> tuple:
    """Push the pushable equality subset of `filt` down into SQL.

    Returns (sql, params, resolved_fields). An empty sql means nothing
    qualified and the caller must fall back to full-scan Python matching.
    `resolved_fields` is the subset of `filt` the SQL clause already proved, so
    the caller can re-match only what is left.
    """
    if not isinstance(filt, dict) or not filt:
        return "", [], set()
    clauses: List[str] = []
    params: List[Any] = []
    resolved: Set[str] = set()
    for field, cond in filt.items():
        col = _pushdown_column(field, info, collection)
        if col is None:
            continue
        if isinstance(cond, dict):
            if set(cond) != {"$eq"}:
                continue
            cond = cond["$eq"]
        # `None` means "matches missing too" in _missing_matches; `col = NULL`
        # would not, so leave those to Python.
        if cond is None or not _is_scalar(cond):
            continue
        clauses.append(f"`{col}` = %s")
        params.append(_to_sql(cond))
        resolved.add(field)
    if not clauses:
        return "", [], set()
    return " WHERE " + " AND ".join(clauses), params, resolved



def _set_path(doc: Dict[str, Any], key: str, value: Any) -> None:
    if "." in key:
        cur: Any = doc
        parts = key.split(".")
        for p in parts[:-1]:
            nxt = cur.get(p)
            if not isinstance(nxt, dict):
                nxt = {}
                cur[p] = nxt
            cur = nxt
        cur[parts[-1]] = value
    else:
        doc[key] = value


def _del_path(doc: Dict[str, Any], key: str) -> None:
    if "." in key:
        parts = key.split(".")
        cur: Any = doc
        for p in parts[:-1]:
            if not isinstance(cur, dict) or p not in cur:
                return
            cur = cur[p]
        if isinstance(cur, dict):
            cur.pop(parts[-1], None)
    else:
        doc.pop(key, None)


def _matches_pull(item: Any, cond: Any) -> bool:
    if isinstance(cond, dict):
        return _match_doc(item, cond)
    return _values_eq(item, cond)


def _apply_update(doc: Dict[str, Any], update: Dict[str, Any]) -> Dict[str, Any]:
    for op, spec in update.items():
        if op == "$set":
            for k, v in spec.items():
                _set_path(doc, k, v)
        elif op == "$unset":
            keys = spec.keys() if isinstance(spec, dict) else spec
            for k in keys:
                _del_path(doc, str(k))
        elif op == "$inc":
            for k, v in spec.items():
                cur = _get_path(doc, k) if _has_path(doc, k) else None
                try:
                    base = int(cur) if cur is not None else 0
                except (TypeError, ValueError):
                    base = 0
                _set_path(doc, k, base + int(v))
        elif op == "$push":
            for k, v in spec.items():
                cur = doc.get(k)
                if not isinstance(cur, list):
                    cur = []
                    doc[k] = cur
                if isinstance(v, dict) and "$each" in v:
                    cur.extend(v.get("$each", []))
                    sl = v.get("$slice")
                    if sl is not None:
                        if sl < 0:
                            doc[k] = cur[sl:]
                        else:
                            doc[k] = cur[:sl]
                else:
                    cur.append(v)
        elif op == "$addToSet":
            for k, v in spec.items():
                cur = doc.get(k)
                if not isinstance(cur, list):
                    cur = []
                    doc[k] = cur
                items = v.get("$each", []) if isinstance(v, dict) and "$each" in v else [v]
                for x in items:
                    if not any(_values_eq(x, y) for y in cur):
                        cur.append(x)
        elif op == "$pull":
            for k, v in spec.items():
                cur = doc.get(k)
                if isinstance(cur, list):
                    doc[k] = [item for item in cur if not _matches_pull(item, v)]
        elif op == "$setOnInsert":
            for k, v in spec.items():
                _set_path(doc, k, v)
        elif op == "$min":
            for k, v in spec.items():
                cur = doc.get(k)
                if cur is None or _cmp(v, cur) < 0:
                    doc[k] = v
        elif op == "$max":
            for k, v in spec.items():
                cur = doc.get(k)
                if cur is None or _cmp(v, cur) > 0:
                    doc[k] = v
        elif op == "$currentDate":
            for k in spec:
                doc[k] = _now_iso()
        elif op == "$rename":
            for a, b in spec.items():
                if a in doc:
                    doc[b] = doc.pop(a)
        else:
            # Unknown operator: fall back to $set semantics so nothing crashes.
            for k, v in spec.items():
                _set_path(doc, k, v)
    return doc


# --------------------------------------------------------------------------- #
# Result + cursor objects
# --------------------------------------------------------------------------- #
class Result:
    def __init__(
        self,
        inserted_id: Any = None,
        acknowledged: bool = True,
        matched_count: int = 0,
        modified_count: int = 0,
        deleted_count: int = 0,
        upserted_id: Any = None,
    ):
        self.inserted_id = inserted_id
        self.acknowledged = acknowledged
        self.matched_count = matched_count
        self.modified_count = modified_count
        self.deleted_count = deleted_count
        self.upserted_id = upserted_id


class Cursor:
    """Lazy async cursor exposing the motor style API (`await c.to_list(n)`)."""

    def __init__(self, coro):
        self._task = asyncio.ensure_future(coro)
        self._docs: Optional[List[Dict[str, Any]]] = None
        self._sorts: List[tuple] = []
        self._limit: Optional[int] = None

    def sort(self, key: Any, direction: int = 1) -> "Cursor":
        if isinstance(key, list):
            for item in key:
                self._sorts.append(tuple(item))
        else:
            self._sorts.append((key, direction or 1))
        return self

    def limit(self, n: Optional[int]) -> "Cursor":
        if n is not None:
            self._limit = int(n)
        return self

    async def _resolve(self) -> List[Dict[str, Any]]:
        if self._docs is None:
            docs = await self._task
            reverse = {1: False, -1: True}
            for key, direction in reversed(self._sorts):
                docs = sorted(
                    docs,
                    key=lambda d, k=key: _norm_sort_key(d.get(k)),
                    reverse=reverse.get(direction, False),
                )
            if self._limit is not None and len(docs) > self._limit:
                docs = docs[: self._limit]
            self._docs = docs
        return self._docs

    def to_list(self, length: Optional[int] = None):
        return self._resolve()

    async def __aiter__(self):
        for d in await self._resolve():
            yield d

    def __await__(self):
        return self._resolve().__await__()


def _norm_sort_key(v: Any) -> Any:
    if v is None:
        return (0, "")
    if isinstance(v, (datetime, date)):
        return (1, v.isoformat())
    if isinstance(v, (int, float, Decimal)):
        return (1, float(v))
    return (1, str(v))


def _apply_projection(doc: Dict[str, Any], projection: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not projection:
        return dict(doc)
    vals = set(projection.values())
    if all(v == 0 for v in vals):
        out = {k: val for k, val in doc.items() if k not in projection}
        return out
    out: Dict[str, Any] = {}
    for k, v in projection.items():
        if v in (1, True):
            out[k] = doc.get(k)
    return out


# --------------------------------------------------------------------------- #
# Collection
# --------------------------------------------------------------------------- #
class Collection:
    def __init__(self, name: str, database: "SQLDatabase"):
        self.name = name
        self._db = database
        # Resolve app collection names onto the real shared-DB tables.
        self._table = TABLE_ALIASES.get(name, name)

    # ---- low level -------------------------------------------------------- #
    async def _ensure(self) -> None:
        await _ensure_collection(self._table)

    async def _all_docs(self) -> List[Dict[str, Any]]:
        await self._ensure()
        rows = await _query("SELECT * FROM `%s`" % _ident(self._table))
        docs = [self._db.row_to_doc(r, self._table) for r in rows]
        return await self._enrich(docs)

    async def _split_doc(self, doc: Dict[str, Any]) -> tuple:
        return await self._db.split_doc(self._table, doc, collection=self.name)

    async def enrich_docs(self, docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Public wrapper around `_enrich` for callers that already selected a
        subset of rows in SQL and only need the read-side join synthesis
        (users + specializations) applied to that subset. Keeps list endpoints
        from having to load the whole table just to enrich one page."""
        return await self._enrich(docs)

    async def _enrich(self, docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Read-side join synthesis: website-created doctor rows have only FK
        columns (user_id / specialization_id) — pull name/email/phone/avatar and
        specialty from the users + specializations tables so the app sees them."""
        if self.name != "doctors" or not docs:
            return docs
        uids = list({str(d.get("user_id")) for d in docs if d.get("user_id") is not None})
        if uids and await _table_exists("users"):
            qs = ",".join(["%s"] * len(uids))
            rows = await _query(
                "SELECT id, name, email, phone, image FROM `users` WHERE id IN (%s)" % qs,
                uids,
            )
            users_by_id = {str(r["id"]): r for r in rows}
            for d in docs:
                u = users_by_id.get(str(d.get("user_id")))
                if u:
                    if not d.get("name"):
                        d["name"] = u.get("name")
                    d.setdefault("email", u.get("email"))
                    d.setdefault("phone", u.get("phone"))
                    d.setdefault("avatar_url", u.get("image"))
        sids = list({str(d.get("specialization_id")) for d in docs if d.get("specialization_id") is not None})
        if sids and await _table_exists("specializations"):
            qs = ",".join(["%s"] * len(sids))
            rows = await _query(
                "SELECT id, name FROM `specializations` WHERE id IN (%s)" % qs,
                sids,
            )
            spec_by_id = {str(r["id"]): r["name"] for r in rows}
            for d in docs:
                s = spec_by_id.get(str(d.get("specialization_id")))
                if s and not d.get("specialty"):
                    d["specialty"] = s
        return docs

    async def _selected(self, filt) -> List[Dict[str, Any]]:
        """Docs matching `filt`, with pushable equality resolved by MySQL.

        When nothing is pushable this is the old behaviour (whole table, match
        in Python). When some predicates are pushable they run in SQL and only
        the residue is re-matched here - the SQL clause can only remove rows
        Python matching would have rejected too, so results are identical.
        """
        await self._ensure()
        info = await _columns(self._table)
        where_sql, params, resolved = _sql_where(filt, info, self.name)
        if not where_sql:
            rows = await _query("SELECT * FROM `%s`" % _ident(self._table))
            docs = [self._db.row_to_doc(r, self._table) for r in rows]
            docs = await self._enrich(docs)
            return [d for d in docs if _match_doc(d, filt)]

        rows = await _query(
            "SELECT * FROM `%s`%s" % (_ident(self._table), where_sql), tuple(params)
        )
        docs = await self._enrich([self._db.row_to_doc(r, self._table) for r in rows])
        residue = {k: v for k, v in filt.items() if k not in resolved} if filt else {}
        if not residue:
            return docs
        return [d for d in docs if _match_doc(d, residue)]

    # ---- Mongo-ish API ---------------------------------------------------- #
    async def find_one(
        self,
        filt: Optional[Dict[str, Any]] = None,
        projection: Optional[Dict[str, Any]] = None,
        sort: Optional[Any] = None,
    ):
        matched = await self._selected(filt)
        if sort and matched:
            reverse = {1: False, -1: True}
            specs = sort if isinstance(sort, list) else [sort]
            for item in reversed(specs):
                key, direction = tuple(item)
                matched = sorted(
                    matched,
                    key=lambda d, k=key: _norm_sort_key(d.get(k)),
                    reverse=reverse.get(direction, False),
                )
        for d in matched:
            return _apply_projection(d, projection)
        return None

    def find(self, filt: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None) -> Cursor:
        return Cursor(self._find_all(filt, projection))

    async def _find_all(self, filt, projection):
        return [_apply_projection(d, projection) for d in await self._selected(filt)]

    async def count_documents(self, filt: Optional[Dict[str, Any]] = None) -> int:
        if isinstance(filt, dict) and filt:
            info = await _columns(self._table)
            where_sql, params, resolved = _sql_where(filt, info, self.name)
            residue = {k: v for k, v in filt.items() if k not in resolved}
            if not residue:
                rows = await _query(
                    "SELECT COUNT(*) AS n FROM `%s`%s" % (_ident(self._table), where_sql),
                    params,
                )
                return int((rows[0] or {}).get("n") or 0)
        return sum(1 for d in await self._all_docs() if _match_doc(d, filt))


    async def insert_one(self, doc_src: Dict[str, Any]) -> Result:
        doc = dict(doc_src)
        doc.pop("_id", None)
        await self._ensure()  # guarantee the table + `data` JSON column exist
        if self._table == "doctors" and not doc.get("user_id"):
            await self._create_stub_user(doc)
        cols, data = await self._split_doc(doc)
        t = _ident(self._table)
        col_names = list(cols.keys())
        params = list(cols.values()) + [json.dumps(data, ensure_ascii=False, default=str)]
        if col_names:
            sql = "INSERT INTO `%s` (`%s`, data) VALUES (%s)" % (
                t,
                "`, `".join(_ident(c) for c in col_names),
                ", ".join(["%s"] * len(col_names) + ["%s"]),
            )
        else:
            # No mirrorable scalar columns (e.g. table has only temporal cols
            # which intentionally stay in the JSON blob) — insert data only.
            sql = "INSERT INTO `%s` (data) VALUES (%%s)" % t
        last_id = await _query(sql, params)
        real_id = int(last_id)
        # SQL rows are AUTO_INCREMENT — reflect the real id back into the
        # caller's doc so endpoints that return the same dict advertise an id
        # that actually resolves on later lookups (the app pre-assigned a
        # throwaway uuid which msdb ignores).
        if "id" in doc_src:
            doc_src["id"] = str(real_id)
        return Result(inserted_id=real_id, acknowledged=True)

    async def insert_many(self, docs: List[Dict[str, Any]]) -> Result:
        for doc in docs:
            await self.insert_one(doc)
        return Result(acknowledged=True)

    async def _merge_base(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        """The document an update should be merged onto: the row's REAL columns.

        `_all_docs` returns the *enriched* view - post-read synthesis
        (`verified`, `experience_years`, `consultation_mode`, joined
        `specializations`) plus the users join. Merging a `$set` onto that view
        meant those derived values were written straight back, and because they
        were computed from the row as it was *before* the update they silently
        overrode the field being changed: setting `is_available_online=True`
        still stored 0, because the stale `consultation_mode='none'` the synth
        had produced won the race. Merging onto the raw row keeps the caller's
        values authoritative.
        """
        pk = doc.get("id")
        if pk is None:
            return dict(doc)
        try:
            pk_int = int(pk)
        except (TypeError, ValueError):
            return dict(doc)
        await self._ensure()
        rows = await _query(
            "SELECT * FROM `%s` WHERE id = %%s" % _ident(self._table), [pk_int])
        if not rows:
            return dict(doc)
        return self._db.row_to_doc(rows[0], self._table, with_synth=False)

    async def update_one(self, filt, update, upsert: bool = False, **kwargs) -> Result:
        docs = await self._all_docs()
        target = None
        for d in docs:
            if _match_doc(d, filt):
                target = d
                break
        upserted_id = None
        if target is None:
            if not upsert:
                return Result(acknowledged=True, matched_count=0, modified_count=0)
            new_doc: Dict[str, Any] = {}
            _apply_update(new_doc, update)
            for k, v in (filt or {}).items():
                if k.startswith("$") or isinstance(v, dict):
                    continue
                if not _has_path(new_doc, k):
                    _set_path(new_doc, k, v)
            res = await self.insert_one(new_doc)
            upserted_id = res.inserted_id
            return Result(acknowledged=True, matched_count=1, modified_count=1,
                          upserted_id=upserted_id)
        new_doc = _apply_update(await self._merge_base(target), update)
        await self._write_row(new_doc)
        return Result(acknowledged=True, matched_count=1, modified_count=1)

    async def update_many(self, filt, update, **kwargs) -> Result:
        n = 0
        for d in await self._all_docs():
            if _match_doc(d, filt):
                new_doc = _apply_update(dict(d), update)
                await self._write_row(new_doc)
                n += 1
        return Result(acknowledged=True, matched_count=n, modified_count=n)

    async def delete_one(self, filt) -> Result:
        for d in await self._all_docs():
            if _match_doc(d, filt):
                await self._delete_row(d)
                return Result(acknowledged=True, deleted_count=1)
        return Result(acknowledged=True, deleted_count=0)

    async def delete_many(self, filt) -> Result:
        n = 0
        for d in await self._all_docs():
            if _match_doc(d, filt):
                await self._delete_row(d)
                n += 1
        return Result(acknowledged=True, deleted_count=n)

    async def _write_row(self, doc: Dict[str, Any]) -> None:
        await self._ensure()
        pk = doc.get("id")
        if pk is None:
            return
        try:
            pk_int = int(pk)
        except (TypeError, ValueError):
            return
        cols, data = await self._split_doc(doc)
        t = _ident(self._table)
        if cols:
            set_clause = ", ".join("`%s` = %%s" % _ident(c) for c in cols)
            params = list(cols.values())
        else:
            set_clause = "`data` = %s"
            params = []
        params.append(json.dumps(data, ensure_ascii=False, default=str))
        await _query(
            "UPDATE `%s` SET %s, data = %%s WHERE id = %%s" % (t, set_clause),
            params + [pk_int],
        )

    async def _delete_row(self, doc: Dict[str, Any]) -> None:
        try:
            await _query(
                "DELETE FROM `%s` WHERE id = %%s" % _ident(self._table),
                [int(doc["id"])],
            )
        except (KeyError, TypeError, ValueError):
            return

    async def _create_stub_user(self, doc: Dict[str, Any]) -> None:
        """Link doctor rows to a real users row (doctors.user_id is NOT NULL)."""
        email = doc.get("email") or f"doc_{uuid.uuid4().hex[:12]}@app.placeholder"
        stub = {
            "name": doc.get("name") or "Doctor",
            "email": email,
            "phone": doc.get("phone"),
            "password": doc.get("password") or "",
            "role": "doctor",
            "is_active": True,
            "is_verified": bool(doc.get("verified")),
            "created_at": _now_iso(),
            "stub_doctor": True,
        }
        users_coll = Collection("users", self._db)
        res = await users_coll.insert_one(stub)
        doc["user_id"] = res.inserted_id

    # ---- aggregation ------------------------------------------------------- #
    def aggregate(self, pipeline: List[Dict[str, Any]]) -> Cursor:
        return Cursor(self._aggregate(pipeline))

    async def _aggregate(self, pipeline: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        docs = await self._all_docs()
        for stage in pipeline:
            op = next(iter(stage))
            arg = stage[op]
            if op == "$match":
                docs = [d for d in docs if _match_doc(d, arg)]
            elif op == "$lookup":
                from_table = arg.get("from", "")
                lf = arg.get("localField", "")
                ff = arg.get("foreignField", "")
                as_key = arg.get("as", "")
                others = await Collection(from_table, self._db)._all_docs()
                index: Dict[Any, List[Dict[str, Any]]] = {}
                for o in others:
                    key = _norm_sort_key(o.get(ff))
                    index.setdefault(str(key), []).append(o)
                for d in docs:
                    d[as_key] = index.get(str(_norm_sort_key(d.get(lf))), [])
            elif op == "$unwind":
                key = arg if isinstance(arg, str) else arg.get("path", "")
                key = key.lstrip("$")
                new_docs = []
                for d in docs:
                    arr = d.get(key)
                    if not isinstance(arr, list):
                        if isinstance(arg, dict) and arg.get("preserveNullAndEmptyArrays"):
                            new_docs.append(dict(d))
                        continue
                    for item in arr:
                        c = dict(d)
                        c[key] = item
                        new_docs.append(c)
                docs = new_docs
            elif op == "$group":
                groups: Dict[str, Dict[str, Any]] = {}
                for d in docs:
                    gid = _resolve_expr(arg.get("_id"), d)
                    gkey = json.dumps(gid, ensure_ascii=False, default=str, sort_keys=True)
                    g = groups.setdefault(gkey, {"_id": gid})
                    for k, acc in arg.items():
                        if k == "_id":
                            continue
                        if not isinstance(acc, dict):
                            continue
                        aop = next(iter(acc))
                        aexpr = acc[aop]
                        if aop == "$sum":
                            val = _resolve_expr(aexpr, d)
                            g[k] = g.get(k, 0) + _to_number(val) if aexpr != 1 else g.get(k, 0) + 1
                        elif aop == "$first":
                            if "_first_" + k not in g:
                                g["_first_" + k] = True
                                g[k] = _resolve_expr(aexpr, d)
                        elif aop == "$max":
                            val = _resolve_expr(aexpr, d)
                            if k not in g or _cmp(val, g[k]) > 0:
                                g[k] = val
                        elif aop == "$min":
                            val = _resolve_expr(aexpr, d)
                            if k not in g or _cmp(val, g[k]) < 0:
                                g[k] = val
                        elif aop == "$avg":
                            val = _resolve_expr(aexpr, d)
                            n = g.get("_avg_n_" + k, 0)
                            g["_avg_n_" + k] = n + 1
                            g[k] = (g.get("_avg_sum_" + k, 0) + _to_number(val)) / (n + 1)
                        elif aop == "$push":
                            g.setdefault(k, []).append(_resolve_expr(aexpr, d))
                        elif aop == "$count":
                            g[k] = len(_resolve_expr(aexpr, d))
                    for k in [x for x in list(g.keys()) if x.startswith("_")]:
                        g.pop(k, None)
                docs = list(groups.values())
            elif op == "$addFields":
                for d in docs:
                    for k, expr in arg.items():
                        if k == "_id":
                            continue
                        d[k] = _resolve_expr(expr, d)
            elif op == "$project":
                new_docs = []
                vals = set(arg.values())
                exclude = all(v == 0 for v in vals)
                for d in docs:
                    if exclude:
                        new_docs.append({k: v for k, v in d.items() if k not in arg})
                    else:
                        nd: Dict[str, Any] = {}
                        for k, v in arg.items():
                            if v in (1, True):
                                nd[k] = d.get(k)
                            else:
                                nd[k] = _resolve_expr(v, d)
                        new_docs.append(nd)
                docs = new_docs
            elif op == "$sort":
                sorters = list(arg.items())
                for key, direction in reversed(sorters):
                    rev = direction < 0
                    docs = sorted(docs, key=lambda d, k=key: _norm_sort_key(d.get(k)), reverse=rev)
            elif op == "$limit":
                docs = docs[: int(arg)]
            elif op == "$skip":
                docs = docs[int(arg):]
            elif op == "$count":
                docs = [{"count": len(docs)}]
        return docs

    async def create_index(self, keys, unique: bool = False, name: Optional[str] = None, **kwargs):
        """Create a MySQL index. No-op when the table/columns are unavailable."""
        try:
            t = _ident(self._table)
            if not await _table_exists(t):
                return None
            info = await _columns(t)
            cols = []
            for item in keys:
                col = item[0] if isinstance(item, (list, tuple)) else item
                if col not in info:
                    return None
                cols.append(_ident(col))
            if not cols:
                return None
            idx_name = _ident(name or f"idx_{'_'.join(cols)}")
            kind = "UNIQUE INDEX" if unique else "INDEX"
            await _query(
                "ALTER TABLE `%s` ADD %s %s (%s)" % (t, kind, idx_name, ", ".join(cols))
            )
        except Exception:
            pass
        return None


def _to_number(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _resolve_expr(expr: Any, d: Dict[str, Any]) -> Any:
    """Resolve simple aggregation expressions in a document context."""
    if isinstance(expr, str) and expr.startswith("$"):
        return d.get(expr[1:])
    if isinstance(expr, dict):
        if "$size" in expr:
            val = _resolve_expr(expr["$size"], d)
            return len(val) if isinstance(val, (list, dict, str)) else 0
        if "$sum" in expr:
            return sum(_to_number(x) for x in _resolve_expr(expr["$sum"], d)) if isinstance(
                _resolve_expr(expr["$sum"], d), list
            ) else _resolve_expr(expr["$sum"], d)
        if "$first" in expr:
            return _resolve_expr(expr["$first"], d)
        out = {}
        for k, v in expr.items():
            out[k] = _resolve_expr(v, d)
        return out
    return expr


# --------------------------------------------------------------------------- #
# Database facade
# --------------------------------------------------------------------------- #
class SQLDatabase:
    def __getattr__(self, name: str) -> Collection:
        if name.startswith("_"):
            raise AttributeError(name)
        return Collection(name, self)

    def __getitem__(self, name: str) -> Collection:
        return Collection(name, self)

    async def close(self) -> None:
        await close_db()

    # ---- doc store plumbing ----------------------------------------------- #
    async def find_paged(
        self,
        table: str,
        where: Dict[str, Any],
        *,
        collection: str = "",
        order_by: Optional[List[tuple]] = None,
        limit: int = 20,
        offset: int = 0,
        extra_where: str = "",
        extra_params: Optional[List[Any]] = None,
    ) -> tuple:
        """Paged find on real columns: returns (docs, total_count).

        `where` must be equality-only on NOT NULL columns, and `order_by` is a
        list of (column, "asc"|"desc") pairs naming real columns. Both are
        served directly by MySQL, so a listing no longer has to materialise
        every matching row to count and slice it in Python. `extra_where` is an
        operator-composed range/status clause supplied by the caller; it is
        internal and never user input.
        """
        coll = collection or table
        info = await _columns(table)
        where_sql, params, _ = _sql_where(where, info, coll)
        if not where_sql:
            raise ValueError(f"find_paged needs at least one indexed equality: {where!r}")
        if extra_where:
            where_sql += " AND " + extra_where
            params = list(params) + list(extra_params or [])

        order_sql = ""
        if order_by:
            parts = []
            for col, direction in order_by:
                if col not in info:
                    continue
                parts.append(f"`{col}` {'DESC' if str(direction).lower().startswith('d') else 'ASC'}")
            if parts:
                order_sql = " ORDER BY " + ", ".join(parts)

        # COUNT + page on one pooled connection: two round trips, but they share
        # a session and no other request has to queue behind a global lock.
        page_sql = f"SELECT * FROM `{table}`{where_sql}{order_sql} LIMIT %s OFFSET %s"
        count_sql = f"SELECT COUNT(*) AS n FROM `{table}`{where_sql}"
        count_row, rows = await _query_many(
            [(count_sql, params), (page_sql, list(params) + [int(limit), int(offset)])]
        )
        total = int((count_row or [{"n": 0}])[0].get("n") or 0)
        return [self.row_to_doc(r, table) for r in rows], total

    def row_to_doc(self, row: Dict[str, Any], table: str, with_synth: bool = True) -> Dict[str, Any]:
        info = _table_cache.get(table) or {}
        # Load the app's JSON mirror first, then let REAL schema columns win.
        # The website is a plain MySQL client: it writes the real columns
        # (e.g. "UPDATE users SET image = ?"). The `data` blob is an
        # app-internal detail. If the blob won, every field the app had ever
        # touched would be frozen and the website's updates would be invisible
        # to the app (and vice-versa) - the two profiles would drift apart.
        # A NULL real column never overrides the blob, so app-only fields and
        # values the app did not mirror into a column still come through.
        extra: Dict[str, Any] = {}
        raw = row.get("data")
        if raw:
            try:
                loaded = json.loads(raw)
                if isinstance(loaded, dict):
                    extra = loaded
            except (TypeError, ValueError, json.JSONDecodeError):
                extra = {}
        doc: Dict[str, Any] = dict(extra)
        for col in info:
            if col in ("id", "data"):
                continue
            v = _norm_cell(row.get(col))
            if v is None:
                continue
            doc[col] = v
        if "id" not in doc and row.get("id") is not None:
            doc["id"] = str(row["id"])
        if with_synth:
            synth = POST_READ_SYNTH.get(table)
            if synth:
                doc = synth(doc)
        return doc

    async def split_doc(self, table: str, doc: Dict[str, Any], collection: Optional[str] = None) -> tuple:
        info = await _columns(table)
        if not info:
            info = await _columns(table)
        columns: Dict[str, Any] = {}
        data: Dict[str, Any] = {}
        col_names = {c for c in info if c not in ("id", "data")}
        col_map = COLUMN_MAPS.get(collection or table, {})
        # Two passes. Pass 1 writes every plain/raw field, pass 2 writes the
        # col_map aliases on top.
        #
        # An alias has to be authoritative, because row_to_doc exposes the real
        # column names alongside app-level fields: an update is merged onto the
        # row that was just read, so `verified` (alias) arrives next to a stale
        # raw `is_approved`. Writing them in a single pass made the winner depend
        # on dict order, so an alias could be silently reverted - or, when the
        # target column was blocked outright, dropped into the blob and never
        # reach the website that actually reads the columns.
        for alias_pass in (False, True):
          for k, v in doc.items():
            if k in ("_id", "id"):
                continue
            if (k in col_map) != alias_pass:
                continue
            mapped = k in col_map
            # Mirrored targets: explicit column map first, else field/direct or
            # snake_case (camelCase -> snake_case) column name.
            targets = col_map.get(k, k)
            if not isinstance(targets, (list, tuple)) or (
                isinstance(targets, tuple) and len(targets) == 2 and isinstance(targets[0], str)
            ):
                targets = [targets]
            for target in targets:
                if isinstance(target, (list, tuple)) and len(target) == 2 and callable(target[1]):
                    col, fn = target[0], target[1]
                    if col in col_names:
                        sv = fn(v)
                        if sv is not None:
                            columns[col] = _to_sql(sv)
                    continue
                col = str(target)
                if col in col_names and (mapped or col not in columns) and _is_scalar(v) and v is not None:
                    ctype = _base_type(info[col]["type"])
                    if ctype in _MIRROR_TYPES:
                        columns[col] = _to_sql(v)
            if k in info and k not in columns:
                ctype = _base_type(info[k]["type"])
                if ctype in _MIRROR_TYPES and _is_scalar(v) and v is not None:
                    columns[k] = _to_sql(v)
            elif v is not None and _is_scalar(v) and k not in col_map:
                sc = _snake(k)
                if sc in col_names and sc not in columns:
                    ctype = _base_type(info[sc]["type"])
                    if ctype in _MIRROR_TYPES:
                        columns[sc] = _to_sql(v)
            # Full document value always round-trips via the `data` JSON column.
            data[k] = v
        # Fill NOT NULL columns that the app didn't provide.
        for col, meta in info.items():
            if col in ("id", "data"):
                continue
            if col in columns:
                continue
            if meta.get("not_null") and meta.get("default") is None and "auto_increment" not in meta.get("extra", ""):
                columns[col] = _fill_value(
                    meta["type"], meta.get("unique", False), meta.get("len"), meta.get("col_type")
                )
        # Mirror scalars only when value is safe; also keep copy in data for API.
        return columns, data


db = SQLDatabase()