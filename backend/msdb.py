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
from datetime import date, datetime, time
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
    if "languages" not in doc:
        doc["languages"] = [] if doc.get("languages") is None else doc["languages"]
    langs = doc.get("languages")
    if isinstance(langs, str):
        doc["languages"] = [x.strip() for x in langs.split(",") if x.strip()]
    return doc


POST_READ_SYNTH: Dict[str, Any] = {
    "pharmacy_products": _synth_medicine,
    "doctors": _synth_doctor,
}

_fill_re = re.compile(r"^([a-z]+)")

_conn: Optional[asyncmy.connection.Connection] = None
_lock = asyncio.Lock()
_table_cache: Dict[str, Optional[Dict[str, Any]]] = {}


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
    )
    try:
        async with conn.cursor() as cur:
            await cur.execute("SET FOREIGN_KEY_CHECKS=0")
            await cur.execute("SET NAMES utf8mb4")
    except Exception:
        pass
    return conn


async def _get_conn() -> asyncmy.connection.Connection:
    global _conn
    if _conn is None:
        _conn = await _open_conn()
    try:
        await _conn.ping()
    except Exception:
        try:
            await _conn.ensure_closed()
        except Exception:
            pass
        _conn = await _open_conn()
    return _conn


async def _query(sql: str, params: Optional[List[Any]] = None) -> Any:
    """Run a statement. Returns row list for SELECT, lastrowid for writes."""
    async with _lock:
        conn = await _get_conn()
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await cur.execute(sql, params or ())
            if cur.description is None:
                return cur.lastrowid
            return await cur.fetchall()


async def close_db() -> None:
    global _conn
    async with _lock:
        if _conn is not None:
            try:
                await _conn.ensure_closed()
            except Exception:
                pass
            _conn = None
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

    # ---- Mongo-ish API ---------------------------------------------------- #
    async def find_one(self, filt: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None):
        for d in await self._all_docs():
            if _match_doc(d, filt):
                return _apply_projection(d, projection)
        return None

    def find(self, filt: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None) -> Cursor:
        return Cursor(self._find_all(filt, projection))

    async def _find_all(self, filt, projection):
        await self._ensure()
        rows = await _query("SELECT * FROM `%s`" % _ident(self._table))
        docs = [self._db.row_to_doc(r, self._table) for r in rows]
        docs = await self._enrich(docs)
        out = []
        for d in docs:
            if _match_doc(d, filt):
                out.append(_apply_projection(d, projection))
        return out

    async def count_documents(self, filt: Optional[Dict[str, Any]] = None) -> int:
        n = 0
        for d in await self._all_docs():
            if _match_doc(d, filt):
                n += 1
        return n

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
        new_doc = _apply_update(dict(target), update)
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
    def row_to_doc(self, row: Dict[str, Any], table: str) -> Dict[str, Any]:
        info = _table_cache.get(table) or {}
        doc: Dict[str, Any] = {}
        raw = row.get("data")
        if raw:
            try:
                loaded = json.loads(raw)
                if isinstance(loaded, dict):
                    doc = loaded
            except (TypeError, ValueError, json.JSONDecodeError):
                doc = {}
        for col in info:
            if col in ("id", "data"):
                continue
            if col in doc:
                continue
            v = _norm_cell(row.get(col))
            if v is None:
                continue
            doc[col] = v
        if "id" not in doc and row.get("id") is not None:
            doc["id"] = str(row["id"])
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
        # Columns exclusively managed via col_map (e.g. doctors: verified ->
        # is_approved). row_to_doc also exposes the raw column names in the doc,
        # so without this guard a STALE raw value (is_approved=0 read earlier)
        # would re-mirror over the mapped write and silently defeat app->web sync.
        flat_targets: Set[str] = set()
        for _t in col_map.values():
            if isinstance(_t, str):
                flat_targets.add(_t)
            elif isinstance(_t, (list, tuple)):
                for _x in _t:
                    if isinstance(_x, str):
                        flat_targets.add(_x)
                    elif isinstance(_x, (list, tuple)) and len(_x) == 2:
                        flat_targets.add(_x[0])
        for k, v in doc.items():
            if k in ("_id", "id"):
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
                    if col in col_names and col not in columns:
                        sv = fn(v)
                        if sv is not None:
                            columns[col] = _to_sql(sv)
                    continue
                col = str(target)
                if col in col_names and col not in columns and (mapped or col not in flat_targets) and _is_scalar(v) and v is not None:
                    ctype = _base_type(info[col]["type"])
                    if ctype in _MIRROR_TYPES:
                        columns[col] = _to_sql(v)
            if k in info and k not in columns and k not in flat_targets:
                ctype = _base_type(info[k]["type"])
                if ctype in _MIRROR_TYPES and _is_scalar(v) and v is not None:
                    columns[k] = _to_sql(v)
            elif v is not None and _is_scalar(v) and k not in col_map:
                sc = _snake(k)
                if sc in col_names and sc not in columns and sc not in flat_targets:
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