from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, validator
from typing import List, Optional, Literal, Dict, Any, Tuple
import uuid
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
import asyncio
import time
import jwt
import bcrypt

from emergentintegrations.llm.chat import LlmChat, UserMessage
import httpx
from emails import (
    send_welcome_email_bg,
    send_prakriti_report_email_bg,
)  # Phase 1c: welcome + Prakriti report emails

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Auth
JWT_SECRET = os.environ['JWT_SECRET']
# Guard against weak/default secrets in production
if len(JWT_SECRET) < 32 or "change-me" in JWT_SECRET.lower() or JWT_SECRET.lower() in {"secret", "changeme", "vaidyaji", "vaidhyaji"}:
    raise RuntimeError(
        "JWT_SECRET is too weak or a known default. Set a strong random value (>=32 chars) in .env"
    )
JWT_ALGORITHM = os.environ['JWT_ALGORITHM']
JWT_EXPIRE_DAYS = int(os.environ.get('JWT_EXPIRE_DAYS', 30))
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')
# Guard against missing / weak / well-known admin creds (prevents SEC-001)
_WEAK_ADMIN_PWDS = {"admin", "admin123", "admin@123", "password", "changeme", "vaidhyaji", "admin@vaidhyaji", "vaidyaji", "admin@vaidyaji"}
if not ADMIN_EMAIL or not ADMIN_PASSWORD:
    raise RuntimeError(
        "ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment. "
        "The seeded admin account will NOT be created without an explicit strong password."
    )
if len(ADMIN_PASSWORD) < 12 or ADMIN_PASSWORD.lower() in _WEAK_ADMIN_PWDS:
    raise RuntimeError(
        "ADMIN_PASSWORD is too weak or a well-known default. "
        "Use at least 12 characters with mixed case, numbers and symbols."
    )

# Push
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)

app = FastAPI(title="Online VaidyaJi API")
api_router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ----------------- Rate Limiter (in-memory, per-IP) -----------------
# Lightweight sliding-window limiter. Good enough for a single-worker deploy;
# for multi-worker, back this with Redis (SEC-002 mitigation).
_rate_buckets: Dict[str, "deque[float]"] = defaultdict(deque)
_rate_lock = asyncio.Lock()


def _client_ip(request: Request) -> str:
    """Extract client IP. Only trusts X-Forwarded-For / X-Real-IP when the direct
    peer is a private-network address (typical K8s ingress / reverse-proxy). This
    prevents a public client from spoofing the header to bypass rate limits.
    """
    peer_host = request.client.host if request.client else "unknown"

    def _is_private(ip: str) -> bool:
        try:
            import ipaddress
            addr = ipaddress.ip_address(ip)
            return addr.is_private or addr.is_loopback or addr.is_link_local
        except Exception:
            return False

    if _is_private(peer_host):
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            # Take the LAST (rightmost) IP in the chain — this is the address the
            # trusted proxy actually saw. Earlier entries are attacker-controllable
            # if the ingress appends rather than overwrites.
            parts = [p.strip() for p in fwd.split(",") if p.strip()]
            if parts:
                return parts[-1]
        real = request.headers.get("x-real-ip")
        if real:
            return real.strip()
    return peer_host


async def rate_limit(request: Request, key: str, max_calls: int, window_seconds: int) -> None:
    """Raise 429 if `key` (usually IP+route) exceeds `max_calls` per window."""
    now = time.monotonic()
    bucket_key = f"{key}:{_client_ip(request)}"
    async with _rate_lock:
        bucket = _rate_buckets[bucket_key]
        # drop entries outside the window
        while bucket and (now - bucket[0]) > window_seconds:
            bucket.popleft()
        if len(bucket) >= max_calls:
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please slow down and try again shortly.",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


# ----------------- Models -----------------
class RegisterInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=200)
    # Phone is OPTIONAL for patient signup — patients can add it later via
    # `/users/me`. Doctors are still expected to provide one at registration
    # so admins can call them for verification (enforced in the route).
    phone: Optional[str] = Field(None, max_length=20)
    role: Literal["patient", "doctor"] = "patient"
    registration_number: Optional[str] = Field(None, max_length=100)  # for doctors

    @validator("phone")
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        # Empty / None is allowed — the field is optional now.
        if v is None or not str(v).strip():
            return None
        # Normalise: strip spaces, plus, hyphens, and country code 91
        raw = "".join(ch for ch in v if ch.isdigit())
        if raw.startswith("91") and len(raw) == 12:
            raw = raw[2:]
        if len(raw) != 10 or raw[0] not in "6789":
            raise ValueError("Enter a valid 10-digit Indian mobile number")
        return raw


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)


class User(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    phone: Optional[str] = None
    created_at: str


class HealthProfileInput(BaseModel):
    age: Optional[int] = None
    gender: Optional[str] = None
    dosha: Optional[str] = None  # Vata, Pitta, Kapha
    conditions: List[str] = []
    lifestyle: Optional[str] = None


class DoctorProfileInput(BaseModel):
    specialty: str  # Ayurveda, Homoeopathy, Yoga, Unani, Siddha
    qualification: str
    experience_years: int
    languages: List[str] = []
    bio: Optional[str] = None
    consultation_fee: int = 500
    avatar_url: Optional[str] = None


class AppointmentInput(BaseModel):
    doctor_id: str
    slot: str  # ISO datetime string
    reason: Optional[str] = None


class ReminderInput(BaseModel):
    medicine_name: str
    dosage: str
    times: List[str]  # e.g. ["08:00", "20:00"]
    notes: Optional[str] = None


class ChatMessageInput(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=100)
    message: str = Field(..., min_length=1, max_length=4000)


class ChallengeJoinInput(BaseModel):
    challenge_id: str = Field(..., min_length=1, max_length=100)


class MedicineItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    dosage: str = Field(..., max_length=100)      # e.g. "1 tab", "½ tsp"
    frequency: str = Field(..., max_length=100)   # e.g. "BD" or "Morning + Night"
    duration: str = Field(..., max_length=100)    # e.g. "7 days"
    instructions: Optional[str] = Field(None, max_length=500)


class PrescriptionInput(BaseModel):
    diagnosis: str = Field(..., min_length=1, max_length=1000)
    medicines: str = Field("", max_length=4000)   # legacy multi-line text
    notes: Optional[str] = Field(None, max_length=2000)
    medicines_structured: Optional[List[MedicineItem]] = None
    symptoms: Optional[str] = Field(None, max_length=2000)
    advice: Optional[str] = Field(None, max_length=2000)
    follow_up: Optional[str] = Field(None, max_length=500)


class ReportInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    kind: str = Field("lab", max_length=40)       # lab | scan | note
    date: Optional[str] = Field(None, max_length=40)
    notes: Optional[str] = Field(None, max_length=2000)
    # Cap base64 payload at ~4 MB (base64 is 4/3 of raw, so raw ≈ 3 MB)
    image_base64: Optional[str] = Field(None, max_length=4_000_000)


# ----------------- Helpers -----------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if cred is None:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def log_activity(kind: str, actor: Optional[dict] = None, meta: Optional[dict] = None) -> None:
    try:
        await db.activity.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind,
            "at": now_iso(),
            "actor_id": actor["id"] if actor else None,
            "actor_name": actor["name"] if actor else None,
            "actor_role": actor["role"] if actor else None,
            "meta": meta or {},
        })
    except Exception:
        logger.exception("activity log failed")


async def require_admin(user: dict = Depends(current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def require_super_admin(user: dict = Depends(current_user)) -> dict:
    """Super-admin (env-seeded) only — for staff/team management."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    if user.get("admin_role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super Admin only — this action manages the admin team")
    return user


async def _appt_actor_ids(user: dict) -> tuple[str, Optional[str]]:
    """Return (user_id, doctor_row_id_or_none) for appointment ACL checks.

    Appointments store `patient_id = users.id` and `doctor_id = doctors.id`
    (see book_appointment). So for role==doctor we must resolve the doctors
    row to authorize.
    """
    if user.get("role") == "doctor":
        d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
        return user["id"], (d or {}).get("id")
    return user["id"], None


async def _is_appt_participant(user: dict, appt: dict) -> bool:
    """True if `user` is either the patient or the doctor of `appt`."""
    if appt.get("patient_id") == user["id"]:
        return True
    _, doc_id = await _appt_actor_ids(user)
    return bool(doc_id and appt.get("doctor_id") == doc_id)


# ----------------- Auth Routes -----------------
@api_router.post("/auth/register")
async def register(body: RegisterInput, request: Request):
    # Rate limit: 30 registrations per IP per hour (prevents mass signup abuse
    # while allowing legitimate signup bursts and CI/test runs on shared IPs)
    await rate_limit(request, "auth:register", max_calls=30, window_seconds=3600)
    # Doctors must supply a phone we can reach them on for verification.
    # Patients may leave it blank at signup — they can add it later.
    if body.role == "doctor" and not body.phone:
        raise HTTPException(status_code=400, detail="Phone number is required for doctor registration")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "name": body.name,
        "email": body.email.lower(),
        "password": hash_password(body.password),
        "role": body.role,
        "phone": body.phone,
        "is_admin": False,
        "created_at": now_iso(),
    }
    if body.role == "doctor":
        doc["registration_number"] = body.registration_number
        doc["verified"] = False  # pending admin approval
        doc["documents_uploaded"] = bool(body.registration_number)
    await db.users.insert_one(doc)

    # Doctor self-registration => create a pending entry in doctors collection
    if body.role == "doctor":
        await db.doctors.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": doc["name"],
            "email": doc["email"],
            "phone": doc.get("phone"),
            "registration_number": doc.get("registration_number"),
            "specialty": "Ayurveda",  # default until admin edits
            "qualification": "Pending admin verification",
            "experience_years": 0,
            "languages": ["Hindi", "English"],
            "consultation_fee": 499,
            "bio": "Newly enrolled AYUSH practitioner — awaiting admin approval.",
            "avatar_url": "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg",
            "rating": 0.0, "reviews": 0,
            "verified": False,
            "created_at": now_iso(),
        })
        await log_activity("doctor_enrolled", actor=doc, meta={"email": doc["email"]})
    else:
        await log_activity("patient_registered", actor=doc, meta={"email": doc["email"]})
    # Phase 1c: fire-and-forget bilingual welcome email (safe if send fails)
    send_welcome_email_bg({k: v for k, v in doc.items() if k not in ("password", "_id")})
    token = make_token(user_id, body.role)
    return {
        "token": token,
        "user": {k: v for k, v in doc.items() if k not in ("password", "_id")},
    }


@api_router.post("/auth/login")
async def login(body: LoginInput, request: Request):
    # Rate limit: 10 login attempts per IP per 5 minutes (prevents brute-force)
    await rate_limit(request, "auth:login", max_calls=10, window_seconds=300)
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = make_token(user["id"], user["role"])
    user.pop("_id", None)
    user.pop("password", None)
    must_change = bool(user.get("must_change_password", False))
    return {"token": token, "user": user, "must_change_password": must_change}


@api_router.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return user


# ----------------- Password Reset (admin-mediated) -----------------
class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class ChangePasswordIn(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str = Field(..., min_length=8, max_length=128)


class AdminApproveResetIn(BaseModel):
    temp_password: Optional[str] = Field(None, min_length=12, max_length=128)


def _generate_temp_password() -> str:
    """Server-generated strong temporary password. Mix of upper/lower/digit."""
    import secrets, string
    alphabet = string.ascii_letters + string.digits
    # 12 chars + always inject 1 upper, 1 lower, 1 digit
    body = ''.join(secrets.choice(alphabet) for _ in range(9))
    return f"V{secrets.choice(string.ascii_uppercase)}{body}{secrets.choice(string.digits)}"


def _is_strong_password(pw: str) -> bool:
    if len(pw) < 8 or len(pw) > 128:
        return False
    has_letter = any(c.isalpha() for c in pw)
    has_digit = any(c.isdigit() for c in pw)
    return has_letter and has_digit


@api_router.post("/auth/request-password-reset")
async def request_password_reset(body: PasswordResetRequestIn, request: Request):
    """Non-enumerating password reset request. Always returns generic success.
    Creates a pending ticket for admin to approve. TTL-cleaned after 7 days.
    """
    # Rate limit: 5 requests per IP per hour + 3 per email per hour
    await rate_limit(request, "auth:reset-req:ip", max_calls=5, window_seconds=3600)
    email = body.email.strip().lower()
    await rate_limit(request, f"auth:reset-req:email:{email}", max_calls=3, window_seconds=3600)
    user = await db.users.find_one({"email": email})
    if user:
        existing = await db.password_resets.find_one({
            "user_id": user["id"], "status": "pending",
        })
        if not existing:
            await db.password_resets.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user["id"],
                "email": email,
                "name": user.get("name") or "",
                "role": user.get("role") or "patient",
                "status": "pending",
                "requested_at": now_iso(),
                "requested_ip": _client_ip(request),
                "expires_at": (datetime.utcnow() + timedelta(days=7)).isoformat(),
                "approved_at": None,
                "approved_by_admin_id": None,
            })
            await log_activity("password_reset_requested", actor=user, meta={"email": email})
    # Always return generic success — do NOT reveal whether email exists
    return {"message": "If an account with that email exists, our team will assist you within 24 hours."}


@api_router.get("/admin/password-resets")
async def admin_list_password_resets(status: str = "pending", admin: dict = Depends(require_admin)):
    if status not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="Invalid status filter")
    items = await db.password_resets.find({"status": status}, {"_id": 0}).sort("requested_at", -1).to_list(200)
    return {"items": items}


@api_router.post("/admin/password-resets/{reset_id}/approve")
async def admin_approve_reset(reset_id: str, body: AdminApproveResetIn, admin: dict = Depends(require_admin)):
    """Approve a pending reset. Server-generated temp password unless admin
    supplies a strong one. Sets must_change_password=True on the user, so the
    user is forced to change it on next login.
    """
    req = await db.password_resets.find_one({"id": reset_id, "status": "pending"})
    if not req:
        raise HTTPException(status_code=404, detail="Reset request not found or already handled")
    temp = body.temp_password or _generate_temp_password()
    if not _is_strong_password(temp):
        raise HTTPException(status_code=400, detail="Temporary password is too weak (8+ chars, mix letters & digits)")
    now = now_iso()
    upd = await db.users.update_one(
        {"id": req["user_id"]},
        {"$set": {
            "password": hash_password(temp),
            "must_change_password": True,
            "temp_password_set_at": now,
            "updated_at": now,
        }},
    )
    if upd.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await db.password_resets.update_one(
        {"id": reset_id, "status": "pending"},
        {"$set": {
            "status": "approved",
            "approved_at": now,
            "approved_by_admin_id": admin["id"],
        }},
    )
    await log_activity("password_reset_approved", actor=admin, meta={
        "target_user_id": req["user_id"], "target_email": req.get("email"), "reset_id": reset_id,
    })
    return {
        "reset_id": reset_id,
        "email": req.get("email"),
        "name": req.get("name"),
        "temp_password": temp,
        "message": "Share this temporary password with the user. They will be forced to change it on next login.",
    }


@api_router.post("/admin/password-resets/{reset_id}/reject")
async def admin_reject_reset(reset_id: str, admin: dict = Depends(require_admin)):
    req = await db.password_resets.find_one({"id": reset_id, "status": "pending"})
    if not req:
        raise HTTPException(status_code=404, detail="Reset request not found or already handled")
    await db.password_resets.update_one(
        {"id": reset_id, "status": "pending"},
        {"$set": {"status": "rejected", "approved_at": now_iso(), "approved_by_admin_id": admin["id"]}},
    )
    await log_activity("password_reset_rejected", actor=admin, meta={
        "target_user_id": req["user_id"], "target_email": req.get("email"), "reset_id": reset_id,
    })
    return {"ok": True}


@api_router.post("/auth/change-password")
async def change_password(body: ChangePasswordIn, request: Request, user: dict = Depends(current_user)):
    """User (authenticated) changes their own password. Clears must_change_password."""
    await rate_limit(request, f"auth:change-pw:{user['id']}", max_calls=5, window_seconds=600)
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if not _is_strong_password(body.new_password):
        raise HTTPException(status_code=400, detail="Password must be 8+ characters and mix letters & digits")
    now = now_iso()
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password": hash_password(body.new_password),
            "must_change_password": False,
            "password_changed_at": now,
            "updated_at": now,
        }, "$unset": {"temp_password_set_at": ""}},
    )
    await log_activity("password_changed", actor=user, meta={"user_id": user["id"]})
    return {"ok": True, "message": "Password updated"}


# ----------------- Patient Profile -----------------
@api_router.get("/patient/profile")
async def get_patient_profile(user: dict = Depends(current_user)):
    if user["role"] != "patient":
        raise HTTPException(status_code=403, detail="Only patients")
    profile = await db.patient_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    return profile or {}


@api_router.put("/patient/profile")
async def upsert_patient_profile(body: HealthProfileInput, user: dict = Depends(current_user)):
    if user["role"] != "patient":
        raise HTTPException(status_code=403, detail="Only patients")
    doc = body.dict()
    doc["user_id"] = user["id"]
    doc["updated_at"] = now_iso()
    await db.patient_profiles.update_one(
        {"user_id": user["id"]}, {"$set": doc}, upsert=True
    )
    return doc


# ----------------- Doctors -----------------
# Fields safe to expose in the public directory (no personal contact / govt IDs).
_PUBLIC_DOCTOR_PROJECTION = {
    "_id": 0,
    "id": 1, "name": 1, "specialty": 1, "qualification": 1,
    "experience_years": 1, "languages": 1, "consultation_fee": 1,
    "bio": 1, "avatar_url": 1, "rating": 1, "reviews": 1, "verified": 1,
    "is_available": 1, "consultation_mode": 1,
    "last_seen_at": 1,  # used to compute the live "online now" green dot
    # Deliberately NOT included: phone, email, registration_number, user_id.
}

# Doctor is considered "online now" if they heart-beat within this window.
DOCTOR_ONLINE_WINDOW_SECONDS = 180  # 3 minutes


def _compute_is_online(last_seen_iso: Optional[str]) -> bool:
    if not last_seen_iso:
        return False
    try:
        dt = datetime.fromisoformat(last_seen_iso.replace("Z", ""))
    except Exception:
        return False
    return (datetime.utcnow() - dt).total_seconds() <= DOCTOR_ONLINE_WINDOW_SECONDS


def _decorate_doctor(d: Dict[str, Any]) -> Dict[str, Any]:
    """Add computed `is_online` field + safe defaults."""
    d.setdefault("is_available", True)
    d.setdefault("consultation_mode", "both")
    d["is_online"] = _compute_is_online(d.get("last_seen_at"))
    # Never leak the raw timestamp to public callers — only the boolean.
    d.pop("last_seen_at", None)
    return d


@api_router.get("/doctors")
async def list_doctors(specialty: Optional[str] = None):
    q = {"verified": True}
    if specialty and specialty.lower() != "all":
        q["specialty"] = specialty
    docs = await db.doctors.find(q, _PUBLIC_DOCTOR_PROJECTION).to_list(200)
    return [_decorate_doctor(d) for d in docs]


@api_router.get("/doctors/{doctor_id}")
async def get_doctor(doctor_id: str):
    doc = await db.doctors.find_one({"id": doctor_id}, _PUBLIC_DOCTOR_PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Doctor not found")
    return _decorate_doctor(doc)


@api_router.post("/doctors/heartbeat")
async def doctor_heartbeat(request: Request, user: dict = Depends(current_user)):
    """Called by the doctor client every ~60s so patients see a live green dot."""
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    # Cheap per-user throttle — a misbehaving client shouldn't hammer the DB.
    await rate_limit(request, f"doctor:heartbeat:{user['id']}", max_calls=120, window_seconds=3600)
    now_iso_str = datetime.utcnow().isoformat() + "Z"
    await db.doctors.update_one(
        {"user_id": user["id"]},
        {"$set": {"last_seen_at": now_iso_str}},
    )
    return {"ok": True, "last_seen_at": now_iso_str, "window_seconds": DOCTOR_ONLINE_WINDOW_SECONDS}



# ----------------- Appointments -----------------
@api_router.post("/appointments")
async def create_appointment(body: AppointmentInput, user: dict = Depends(current_user)):
    doctor = await db.doctors.find_one({"id": body.doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    appt = {
        "id": str(uuid.uuid4()),
        "patient_id": user["id"],
        "patient_name": user["name"],
        "doctor_id": doctor["id"],
        "doctor_name": doctor["name"],
        "doctor_specialty": doctor["specialty"],
        "slot": body.slot,
        "reason": body.reason,
        "status": "confirmed",
        "paid": False,
        "amount": doctor.get("consultation_fee", 500),
        "prescription": None,
        "created_at": now_iso(),
    }
    await db.appointments.insert_one(appt)
    appt.pop("_id", None)
    await log_activity("appointment_booked", actor=user, meta={
        "doctor_name": doctor["name"], "specialty": doctor["specialty"], "slot": body.slot,
    })
    # Push notification to patient (non-blocking)
    try:
        await send_push(
            recipients=[user["id"]],
            data={
                "title": "Appointment booked ✅",
                "message": f"Consultation with {doctor['name']} on {body.slot}",
                "action_url": "/appointments",
            },
            idempotency_key=f"appt_booked_{appt['id']}",
        )
    except Exception as e:
        logger.warning(f"appt-book push failed (non-blocking): {e}")
    return appt


@api_router.get("/appointments")
async def list_appointments(user: dict = Depends(current_user)):
    if user["role"] == "patient":
        q = {"patient_id": user["id"]}
    else:
        # For doctors, appointments store doctor_id = doctors.id (not users.id)
        _, doc_id = await _appt_actor_ids(user)
        if not doc_id:
            return []
        q = {"doctor_id": doc_id}
    items = await db.appointments.find(q, {"_id": 0}).sort("slot", 1).to_list(200)
    return items


@api_router.post("/appointments/{appt_id}/pay", deprecated=True)
async def pay_appointment(appt_id: str, user: dict = Depends(current_user)):
    """DISABLED: Use /api/payments/create-order + /api/payments/verify instead.

    Kept as an endpoint so old clients get a clear error; never marks anything paid.
    """
    raise HTTPException(
        status_code=410,
        detail="Direct pay endpoint disabled. Use Razorpay checkout via /api/payments/create-order.",
    )


@api_router.post("/appointments/{appt_id}/prescription")
async def add_prescription(appt_id: str, body: PrescriptionInput, user: dict = Depends(current_user)):
    # Only the doctor of record can create/update a prescription (SEC-003).
    # Patients writing their own prescriptions creates fabricated clinical records.
    appt = await db.appointments.find_one({"id": appt_id}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only the treating doctor can add a prescription")
    _, doc_id = await _appt_actor_ids(user)
    if not doc_id or appt.get("doctor_id") != doc_id:
        raise HTTPException(status_code=403, detail="You are not the doctor of record for this appointment")

    data = body.dict()
    # If a structured list is provided but `medicines` string is empty, compose it
    structured = data.get("medicines_structured") or []
    if structured and not (data.get("medicines") or "").strip():
        lines = []
        for i, m in enumerate(structured, 1):
            piece = f"{i}. {m['name']} — {m['dosage']}, {m['frequency']} × {m['duration']}"
            if m.get("instructions"):
                piece += f" ({m['instructions']})"
            lines.append(piece)
        data["medicines"] = "\n".join(lines)

    prescription = {
        **data,
        "written_at": now_iso(),
        "author_id": user["id"],
        "author_name": user["name"],
    }
    await db.appointments.update_one({"id": appt_id}, {"$set": {"prescription": prescription}})
    # Push notify the patient that a new Rx is available (non-blocking)
    if appt.get("patient_id") and appt["patient_id"] != user["id"]:
        try:
            await send_push(
                recipients=[appt["patient_id"]],
                data={
                    "title": "New prescription 📄",
                    "message": f"Dr. {user['name']} added your prescription. Tap to view.",
                    "action_url": "/appointments",
                },
                idempotency_key=f"rx_{appt_id}",
            )
        except Exception as e:
            logger.warning(f"rx push failed (non-blocking): {e}")
    return prescription


@api_router.get("/prescriptions")
async def list_prescriptions(user: dict = Depends(current_user)):
    q = {"patient_id": user["id"]} if user["role"] == "patient" else {"doctor_id": user["id"]}
    q["prescription"] = {"$ne": None}
    items = await db.appointments.find(q, {"_id": 0}).sort("slot", -1).to_list(200)
    return items


@api_router.get("/prescriptions/{appt_id}/pdf")
async def prescription_pdf(appt_id: str, download: int = 0, user: dict = Depends(current_user)):
    """Render an appointment's prescription as a downloadable PDF.

    Access:
    - the patient of record
    - the doctor of record
    - an admin

    Query params:
    - `?download=1` forces attachment download; otherwise inline (mobile viewer).
    """
    appt = await db.appointments.find_one({"id": appt_id}, {"_id": 0})
    if not appt or not appt.get("prescription"):
        raise HTTPException(status_code=404, detail="Prescription not found")
    # Authorization — only participants + admin
    _, doc_id = await _appt_actor_ids(user)
    is_patient = appt.get("patient_id") == user["id"]
    is_doctor = doc_id and appt.get("doctor_id") == doc_id
    is_admin = bool(user.get("is_admin"))
    if not (is_patient or is_doctor or is_admin):
        raise HTTPException(status_code=403, detail="You are not permitted to view this prescription")

    # Enrich the render with public doctor + patient info (best-effort).
    doctor = None
    if appt.get("doctor_id"):
        doctor = await db.doctors.find_one({"id": appt["doctor_id"]}, _PUBLIC_DOCTOR_PROJECTION)
    patient = None
    if appt.get("patient_id"):
        patient = await db.users.find_one(
            {"id": appt["patient_id"]},
            {"_id": 0, "id": 1, "name": 1, "age": 1, "gender": 1},
        )

    try:
        from prescription_pdf import render_prescription_pdf
        pdf_bytes = await run_in_threadpool(
            render_prescription_pdf, appt, doctor=doctor, patient=patient,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Prescription PDF render failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not render prescription") from e

    filename = f"prescription-{appt_id[:8]}.pdf"
    disposition = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ----------------- Daily.co Video Consultation -----------------
DAILY_API_KEY = os.environ.get("DAILY_API_KEY", "")
DAILY_BASE = "https://api.daily.co/v1"


class VideoSessionInput(BaseModel):
    appointment_id: Optional[str] = None
    doctor_id: Optional[str] = None  # for instant consults w/o appt
    duration_minutes: int = 60


async def _daily_create_room(room_name: str, exp_ts: int) -> dict:
    if not DAILY_API_KEY:
        raise HTTPException(status_code=503, detail="Daily.co not configured (missing DAILY_API_KEY)")
    payload = {
        "name": room_name,
        "privacy": "private",
        "properties": {
            "exp": exp_ts,
            "eject_at_room_exp": True,
            "enable_prejoin_ui": True,
            "enable_screenshare": True,
            "enable_chat": True,
            "start_video_off": False,
            "start_audio_off": False,
        },
    }
    headers = {"Authorization": f"Bearer {DAILY_API_KEY}"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{DAILY_BASE}/rooms", json=payload, headers=headers)
    already_exists = (
        r.status_code == 409
        or (r.status_code == 400 and "already exists" in r.text.lower())
    )
    if already_exists:
        # Room already exists – fetch it
        async with httpx.AsyncClient(timeout=20) as client:
            g = await client.get(f"{DAILY_BASE}/rooms/{room_name}", headers=headers)
        if g.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Daily fetch room failed: {g.text}")
        return g.json()
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Daily create room failed: {r.text}")
    return r.json()


async def _daily_create_token(room_name: str, user_name: str, user_id: str, is_owner: bool, exp_ts: int) -> str:
    if not DAILY_API_KEY:
        raise HTTPException(status_code=503, detail="Daily.co not configured")
    payload = {
        "properties": {
            "room_name": room_name,
            "exp": exp_ts,
            "user_name": user_name,
            "user_id": user_id,
            "is_owner": is_owner,
        }
    }
    headers = {"Authorization": f"Bearer {DAILY_API_KEY}"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{DAILY_BASE}/meeting-tokens", json=payload, headers=headers)
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Daily create token failed: {r.text}")
    return r.json()["token"]


@api_router.post("/video/session")
async def create_video_session(body: VideoSessionInput, user: dict = Depends(current_user)):
    """Create (or fetch) a Daily.co room + token for this user.

    Works for both scheduled appointments (pass appointment_id) and instant consults
    (pass doctor_id). Returns { room_url, token, room_name, is_owner, exp }.
    """
    is_owner = user.get("role") == "doctor"
    now_ts = int(datetime.now(timezone.utc).timestamp())
    duration = max(15, min(body.duration_minutes, 180))
    exp_ts = now_ts + duration * 60

    room_name = None
    doctor = None
    appt = None

    if body.appointment_id:
        appt = await db.appointments.find_one({"id": body.appointment_id}, {"_id": 0})
        if not appt:
            raise HTTPException(status_code=404, detail="Appointment not found")
        # Authorization: only linked patient or doctor (doctor_id references doctors.id)
        if not await _is_appt_participant(user, appt):
            raise HTTPException(status_code=403, detail="Not part of this appointment")
        room_name = appt.get("daily_room_name") or f"vaidhya-appt-{appt['id']}"[:60]
        # Doctor owns the room (needs kick/mute powers)
        _, doc_id = await _appt_actor_ids(user)
        is_owner = bool(doc_id and appt.get("doctor_id") == doc_id)
    elif body.doctor_id:
        doctor = await db.doctors.find_one({"id": body.doctor_id}, {"_id": 0})
        if not doctor:
            raise HTTPException(status_code=404, detail="Doctor not found")
        # Instant consult room – ephemeral; tie to user+doctor+timestamp
        room_name = f"vaidhya-instant-{user['id'][:8]}-{doctor['id'][:8]}-{now_ts}"[:60]
    else:
        raise HTTPException(status_code=400, detail="Provide appointment_id or doctor_id")

    # Create/fetch room
    room = await _daily_create_room(room_name, exp_ts)

    # Persist room fields on appointment for reuse
    if appt is not None and not appt.get("daily_room_url"):
        await db.appointments.update_one(
            {"id": appt["id"]},
            {"$set": {
                "daily_room_name": room["name"],
                "daily_room_url": room["url"],
                "daily_room_exp": exp_ts,
            }},
        )

    # Generate token for this participant
    token = await _daily_create_token(
        room_name=room["name"],
        user_name=user.get("name") or "Guest",
        user_id=user["id"],
        is_owner=is_owner,
        exp_ts=exp_ts,
    )

    await log_activity("video_session_started", actor=user, meta={
        "room_name": room["name"], "is_owner": is_owner,
        "appointment_id": body.appointment_id, "doctor_id": body.doctor_id,
    })

    # Extract domain subdomain from room URL (e.g. https://onlinevaidya.daily.co/room)
    domain_sub = "onlinevaidya"
    try:
        from urllib.parse import urlparse
        host = urlparse(room["url"]).hostname or ""
        if host.endswith(".daily.co"):
            domain_sub = host.split(".")[0]
    except Exception:
        pass

    from urllib.parse import quote
    embed_url = (
        f"/api/video/embed/{room['name']}"
        f"?token={quote(token)}"
        f"&user_name={quote(user.get('name') or 'Guest')}"
        f"&domain={quote(domain_sub)}"
    )

    return {
        "room_url": room["url"],
        "room_name": room["name"],
        "token": token,
        "embed_url": embed_url,
        "is_owner": is_owner,
        "exp": exp_ts,
        "user_name": user.get("name") or "Guest",
    }


def _js_str(val) -> str:
    """Safely embed a Python value as a JSON literal inside an inline <script>.

    json.dumps does NOT escape `</`, `<script`, `<!--`, `-->`, `U+2028`, `U+2029`.
    An attacker who can influence val (e.g. token, user_name query params) could
    inject `</script><img src=x onerror=…>` to break out of the script tag.
    We post-escape those sequences to make the JSON literal safe inside HTML.
    """
    s = json.dumps(val)
    return (s.replace("<", "\\u003c")
             .replace(">", "\\u003e")
             .replace("&", "\\u0026")
             .replace("\u2028", "\\u2028")
             .replace("\u2029", "\\u2029"))


@app.get("/api/video/embed/{room_name}", response_class=HTMLResponse)
async def video_embed(room_name: str, token: str = "", user_name: str = "Guest", domain: str = "onlinevaidya"):
    """HTML page that hosts the Daily Prebuilt iframe.

    Rendered inside a React Native WebView so we can use Daily's fully-featured
    JS SDK without needing a native Expo build. Token is passed in the query
    string; it is short-lived (~60min) and room-locked so exposure risk is low.
    """
    # Basic validation
    safe_room = ''.join(c for c in room_name if c.isalnum() or c in '-_')[:80]
    safe_domain = ''.join(c for c in domain if c.isalnum() or c in '-_')[:60] or "onlinevaidya"
    # Sanitize free-form user_name — strip anything not alnum/space/dot/hyphen
    safe_user_name = ''.join(c for c in (user_name or "Guest") if c.isalnum() or c in " .-_'")[:60] or "Guest"
    # Token is opaque; only permit URL-safe base64 chars used by Daily
    safe_token = ''.join(c for c in token if c.isalnum() or c in "._-")[:2048]
    if not safe_room:
        raise HTTPException(status_code=400, detail="Invalid room name")
    room_url_js = _js_str(f"https://{safe_domain}.daily.co/{safe_room}")
    token_js = _js_str(safe_token)
    user_name_js = _js_str(safe_user_name)

    html = f"""<!doctype html>
<html>
<head>
  <meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'/>
  <meta charset='utf-8'/>
  <title>Online VaidyaJi Consultation</title>
  <style>
    html, body {{ margin:0; padding:0; height:100%; width:100%; background:#0F4C36; overflow:hidden; font-family: -apple-system, Roboto, sans-serif; }}
    #call {{ position: absolute; inset: 0; }}
    #err {{ color:#fff; padding:20px; text-align:center; font-size:14px; }}
    .loader {{ color:#fff; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; }}
    .spinner {{ width:36px; height:36px; border:3px solid rgba(255,255,255,0.25); border-top-color:#F4B942; border-radius:50%; margin:0 auto 12px; animation: spin 1s linear infinite; }}
    @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  </style>
</head>
<body>
  <div class='loader' id='loader'><div class='spinner'></div>Connecting to your Vaidya…</div>
  <div id='call'></div>
  <script src='https://unpkg.com/@daily-co/daily-js'></script>
  <script>
    (function(){{
      var roomUrl = {room_url_js};
      var token = {token_js};
      var userName = {user_name_js};
      try {{
        var call = window.DailyIframe.createFrame(document.getElementById('call'), {{
          iframeStyle: {{ position:'absolute', width:'100%', height:'100%', border:'0', top:'0', left:'0' }},
          showLeaveButton: true,
          showFullscreenButton: false,
          theme: {{
            colors: {{
              accent: '#F4B942',
              accentText: '#0F4C36',
              background: '#0F4C36',
              backgroundAccent: '#123B2A',
              baseText: '#F7F5F0',
              border: '#1B5C43',
              mainAreaBg: '#0F4C36',
              mainAreaBgAccent: '#123B2A',
              mainAreaText: '#F7F5F0',
              supportiveText: '#F4E4C1'
            }}
          }}
        }});
        call.on('joined-meeting', function(){{ document.getElementById('loader').style.display='none'; }});
        call.on('error', function(e){{ document.getElementById('loader').innerHTML = 'Connection error: ' + (e && e.errorMsg ? e.errorMsg : 'unknown'); }});
        call.on('left-meeting', function(){{
          try {{ if (window.ReactNativeWebView) {{ window.ReactNativeWebView.postMessage(JSON.stringify({{type:'left'}})); }} }} catch(_) {{}}
          try {{ if (window.parent && window.parent !== window) {{ window.parent.postMessage(JSON.stringify({{type:'left'}}), '*'); }} }} catch(_) {{}}
        }});
        var joinOpts = {{ url: roomUrl, userName: userName }};
        if (token) joinOpts.token = token;
        call.join(joinOpts);
      }} catch (e) {{
        document.getElementById('loader').innerHTML = 'Failed to load video: ' + e.message;
      }}
    }})();
  </script>
</body>
</html>"""
    return HTMLResponse(html)


# ----------------- Razorpay Payments -----------------
import hmac
import hashlib
try:
    import razorpay
except ImportError:
    razorpay = None

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
_rzp_client = None
if razorpay and RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    _rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))


class PaymentOrderInput(BaseModel):
    amount: int  # in paise (>= 100)
    currency: str = "INR"
    purpose: Literal["appointment", "diet_plan", "medicine_order", "lab_booking", "custom"] = "custom"
    reference_id: Optional[str] = None  # id of appointment/order/booking/plan
    description: Optional[str] = None


class PaymentVerifyInput(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    purpose: Optional[str] = None
    reference_id: Optional[str] = None


# Server-side price catalog — client never sets prices
_FIXED_PRICES_PAISE = {
    "diet_plan": 20000,     # ₹200 weekly plan
    "ai_yoga": 50000,       # ₹500/month
    "lab_booking": 49900,   # ₹499 default
    "medicine_order": None, # computed from cart
}


async def _resolve_server_price(purpose: str, reference_id: Optional[str], user: dict) -> int:
    """Return the authoritative price in paise for a given purpose+reference.

    Client-supplied `amount` is ignored except for `custom` purpose (kept
    for one-off flows) which still enforces a hard cap.
    """
    if purpose == "appointment":
        if not reference_id:
            raise HTTPException(status_code=400, detail="appointment reference_id required")
        appt = await db.appointments.find_one({"id": reference_id}, {"_id": 0})
        if not appt or appt.get("patient_id") != user["id"]:
            raise HTTPException(status_code=404, detail="Appointment not found or not yours")
        if appt.get("paid"):
            raise HTTPException(status_code=409, detail="Appointment already paid")
        fee_rs = int(appt.get("amount") or 500)
        return max(100, fee_rs * 100)
    if purpose == "diet_plan":
        return _FIXED_PRICES_PAISE["diet_plan"]
    if purpose == "ai_yoga":
        return _FIXED_PRICES_PAISE["ai_yoga"]
    if purpose == "lab_booking":
        if not reference_id:
            return _FIXED_PRICES_PAISE["lab_booking"]
        booking = await db.lab_bookings.find_one({"id": reference_id, "user_id": user["id"]}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Lab booking not found or not yours")
        if booking.get("paid"):
            raise HTTPException(status_code=409, detail="Lab booking already paid")
        return max(100, int(booking.get("amount") or 499) * 100)
    if purpose == "medicine_order":
        if not reference_id:
            raise HTTPException(status_code=400, detail="medicine_order reference_id required")
        order = await db.medicine_orders.find_one({"id": reference_id, "user_id": user["id"]}, {"_id": 0})
        if not order:
            raise HTTPException(status_code=404, detail="Order not found or not yours")
        if order.get("paid"):
            raise HTTPException(status_code=409, detail="Order already paid")
        return max(100, int(order.get("total") or 0) * 100)
    # purpose == "custom" — one-off amounts capped hard
    return -1  # signals "use body.amount" with hard cap in caller


@api_router.post("/payments/create-order")
async def create_payment_order(body: PaymentOrderInput, user: dict = Depends(current_user)):
    """Create a Razorpay order. Price is ALWAYS resolved server-side."""
    if _rzp_client is None:
        raise HTTPException(status_code=503, detail="Razorpay not configured on server")
    if body.currency.upper() != "INR":
        raise HTTPException(status_code=400, detail="Only INR currency supported")

    resolved = await _resolve_server_price(body.purpose, body.reference_id, user)
    if resolved == -1:
        # Custom purpose — accept client amount but hard-cap
        amount_paise = int(body.amount)
        if amount_paise < 100 or amount_paise > 5000000:  # min ₹1, max ₹50,000
            raise HTTPException(status_code=400, detail="Amount out of allowed range")
    else:
        amount_paise = resolved
        # Reject if client tried to send a different amount (log for audit)
        if body.amount and int(body.amount) != amount_paise:
            logger.warning(
                "payment amount mismatch: client=%s server=%s user=%s purpose=%s ref=%s",
                body.amount, amount_paise, user["id"], body.purpose, body.reference_id,
            )

    # Receipt must be <= 40 chars
    receipt = f"vaidhya_{body.purpose[:8]}_{uuid.uuid4().hex[:8]}"[:40]

    try:
        rzp_order = _rzp_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "payment_capture": 1,
            "notes": {
                "user_id": user["id"],
                "user_name": user.get("name", ""),
                "purpose": body.purpose,
                "reference_id": body.reference_id or "",
            },
        })
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Razorpay order failed: {e}")

    # Persist a local payment record
    payment_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "razorpay_order_id": rzp_order["id"],
        "razorpay_payment_id": None,
        "amount": amount_paise,
        "currency": "INR",
        "purpose": body.purpose,
        "reference_id": body.reference_id,
        "description": body.description,
        "status": "created",
        "created_at": now_iso(),
        "verified_at": None,
    }
    await db.payments.insert_one(payment_doc)

    await log_activity("payment_order_created", actor=user, meta={
        "razorpay_order_id": rzp_order["id"], "amount": amount_paise,
        "purpose": body.purpose, "reference_id": body.reference_id,
    })

    return {
        "order_id": rzp_order["id"],
        "amount": rzp_order["amount"],
        "currency": rzp_order["currency"],
        "receipt": receipt,
        "key_id": RAZORPAY_KEY_ID,  # safe to expose
        "purpose": body.purpose,
        "reference_id": body.reference_id,
    }


def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """HMAC-SHA256(order_id|payment_id, KEY_SECRET) == signature"""
    if not RAZORPAY_KEY_SECRET:
        return False
    body = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@api_router.post("/payments/verify")
async def verify_payment(body: PaymentVerifyInput, user: dict = Depends(current_user)):
    if _rzp_client is None:
        raise HTTPException(status_code=503, detail="Razorpay not configured on server")
    if not (body.razorpay_order_id and body.razorpay_payment_id and body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Missing payment fields")

    ok = _verify_razorpay_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)
    if not ok:
        await log_activity("payment_signature_mismatch", actor=user, meta={
            "razorpay_order_id": body.razorpay_order_id,
            "razorpay_payment_id": body.razorpay_payment_id,
        })
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    # Look up local record
    payment = await db.payments.find_one({"razorpay_order_id": body.razorpay_order_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment record not found")
    if payment["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your payment")

    # Idempotent update
    await db.payments.update_one(
        {"razorpay_order_id": body.razorpay_order_id},
        {"$set": {
            "razorpay_payment_id": body.razorpay_payment_id,
            "razorpay_signature": body.razorpay_signature,
            "status": "paid",
            "verified_at": now_iso(),
        }},
    )

    # Mark the linked resource as paid depending on purpose
    purpose = payment.get("purpose") or body.purpose
    ref_id = payment.get("reference_id") or body.reference_id
    if purpose == "appointment" and ref_id:
        await db.appointments.update_one(
            {"id": ref_id, "patient_id": user["id"]},
            {"$set": {"paid": True, "paid_at": now_iso(), "razorpay_payment_id": body.razorpay_payment_id}},
        )
    elif purpose == "medicine_order" and ref_id:
        await db.medicine_orders.update_one(
            {"id": ref_id, "user_id": user["id"]},
            {"$set": {"paid": True, "paid_at": now_iso(), "razorpay_payment_id": body.razorpay_payment_id}},
        )
    elif purpose == "lab_booking" and ref_id:
        await db.lab_bookings.update_one(
            {"id": ref_id, "user_id": user["id"]},
            {"$set": {"paid": True, "paid_at": now_iso(), "razorpay_payment_id": body.razorpay_payment_id}},
        )
    elif purpose == "diet_plan" and ref_id:
        await db.diet_plans.update_one(
            {"id": ref_id, "user_id": user["id"]},
            {"$set": {"paid": True, "paid_at": now_iso(), "razorpay_payment_id": body.razorpay_payment_id}},
        )

    await log_activity("payment_verified", actor=user, meta={
        "razorpay_order_id": body.razorpay_order_id,
        "razorpay_payment_id": body.razorpay_payment_id,
        "purpose": purpose, "reference_id": ref_id,
    })

    # Push notification confirming payment (non-blocking)
    try:
        amount_rs = int(payment.get("amount", 0)) / 100
        purpose_labels = {
            "appointment": "consultation",
            "diet_plan": "diet plan",
            "medicine_order": "medicine order",
            "lab_booking": "lab test",
            "custom": "purchase",
        }
        label = purpose_labels.get(purpose or "custom", "purchase")
        await send_push(
            recipients=[user["id"]],
            data={
                "title": "Payment received ✅",
                "message": f"₹{amount_rs:.0f} paid for your {label}. Thank you!",
                "action_url": "/(tabs)/profile",
            },
            idempotency_key=f"pay_verified_{body.razorpay_payment_id}",
        )
    except Exception as e:
        logger.warning(f"pay-verify push failed (non-blocking): {e}")

    return {
        "success": True,
        "razorpay_payment_id": body.razorpay_payment_id,
        "purpose": purpose,
        "reference_id": ref_id,
    }


@api_router.get("/payments/mine")
async def my_payments(user: dict = Depends(current_user)):
    items = await db.payments.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items


@app.get("/api/payments/checkout/{order_id}", response_class=HTMLResponse)
async def payment_checkout_page(
    order_id: str,
    amount: int,
    name: str = "Online VaidyaJi",
    description: str = "Consultation",
    prefill_name: str = "",
    prefill_email: str = "",
    prefill_contact: str = "",
):
    """HTML page hosting the Razorpay Standard Checkout modal.

    Loaded inside a React Native WebView so it works in Expo Go without
    installing react-native-razorpay. On success/failure the page posts
    a message back to the WebView via window.ReactNativeWebView.postMessage.
    """
    safe_order = ''.join(c for c in order_id if c.isalnum() or c in '_-')[:60]
    if not safe_order:
        raise HTTPException(status_code=400, detail="Invalid order id")
    # Sanitize display fields (strip <, >, &, control chars, script sequences)
    def _clean_display(v: str, max_len: int = 80) -> str:
        v = (v or "")[:max_len]
        return ''.join(c for c in v if c.isalnum() or c in " .-_'@+")
    order_js = _js_str(safe_order)
    key_js = _js_str(RAZORPAY_KEY_ID)
    amount_js = _js_str(int(amount))
    name_js = _js_str(_clean_display(name, 60))
    desc_js = _js_str(_clean_display(description, 100))
    pn = _js_str(_clean_display(prefill_name, 60))
    pe = _js_str(_clean_display(prefill_email, 80))
    pc = _js_str(_clean_display(prefill_contact, 20))

    html = f"""<!doctype html>
<html>
<head>
  <meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'/>
  <meta charset='utf-8'/>
  <title>VaidyaJi Checkout</title>
  <style>
    html, body {{ margin:0; padding:0; height:100%; width:100%; background:#0F4C36; font-family:-apple-system, Roboto, sans-serif; color:#F7F5F0; }}
    .wrap {{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:24px; }}
    .card {{ max-width:340px; }}
    .spinner {{ width:36px; height:36px; border:3px solid rgba(255,255,255,0.25); border-top-color:#F4B942; border-radius:50%; margin:0 auto 16px; animation:spin 1s linear infinite; }}
    @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
    .amount {{ font-size:36px; font-weight:700; color:#F4B942; margin:8px 0 4px; }}
    .desc {{ font-size:13px; opacity:0.8; margin-bottom:20px; }}
    button {{ background:#F4B942; color:#0F4C36; border:0; padding:14px 28px; border-radius:24px; font-weight:700; font-size:15px; cursor:pointer; width:100%; }}
    button:disabled {{ opacity:0.6; }}
    .msg {{ margin-top:16px; font-size:13px; opacity:0.9; }}
    .err {{ color:#FFA07A; }}
    .ok {{ color:#A0E5C0; }}
  </style>
</head>
<body>
  <div class='wrap'>
    <div class='card'>
      <div class='spinner' id='spinner'></div>
      <div class='amount'>₹{{amount_display}}</div>
      <div class='desc' id='desc'></div>
      <button id='payBtn' onclick='openCheckout()'>Pay Now</button>
      <div class='msg' id='msg'></div>
    </div>
  </div>
  <script src='https://checkout.razorpay.com/v1/checkout.js'></script>
  <script>
    var ORDER_ID = {order_js};
    var KEY_ID = {key_js};
    var AMOUNT = {amount_js};
    var NAME = {name_js};
    var DESC = {desc_js};
    var PN = {pn}, PE = {pe}, PC = {pc};

    document.getElementById('desc').textContent = DESC;
    document.querySelector('.amount').textContent = '\u20B9' + (AMOUNT/100).toFixed(2);

    function post(payload) {{
      try {{ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }} catch(_) {{}}
      try {{ if (window.parent && window.parent !== window) window.parent.postMessage(JSON.stringify(payload), '*'); }} catch(_) {{}}
    }}

    function openCheckout() {{
      document.getElementById('payBtn').disabled = true;
      document.getElementById('msg').textContent = 'Opening secure Razorpay…';
      var options = {{
        key: KEY_ID,
        amount: AMOUNT,
        currency: 'INR',
        name: NAME,
        description: DESC,
        order_id: ORDER_ID,
        prefill: {{ name: PN, email: PE, contact: PC }},
        theme: {{ color: '#0F4C36' }},
        modal: {{
          ondismiss: function() {{
            document.getElementById('payBtn').disabled = false;
            document.getElementById('msg').innerHTML = "<span class='err'>Payment cancelled. Tap Pay Now to retry.</span>";
            post({{ type: 'dismiss' }});
          }}
        }},
        handler: function(response) {{
          document.getElementById('msg').innerHTML = "<span class='ok'>Payment received. Verifying…</span>";
          post({{
            type: 'success',
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature
          }});
        }}
      }};
      try {{
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function(resp) {{
          document.getElementById('payBtn').disabled = false;
          var desc = (resp && resp.error && resp.error.description) || 'Payment failed';
          document.getElementById('msg').innerHTML = "<span class='err'>" + desc + "</span>";
          post({{ type: 'failed', description: desc, code: (resp && resp.error && resp.error.code) || '' }});
        }});
        rzp.open();
      }} catch (e) {{
        document.getElementById('payBtn').disabled = false;
        document.getElementById('msg').innerHTML = "<span class='err'>" + e.message + "</span>";
        post({{ type: 'error', message: e.message }});
      }}
    }}

    // Auto-open on load
    window.addEventListener('load', function() {{ setTimeout(openCheckout, 400); }});
  </script>
</body>
</html>"""
    # amount_display placeholder replacement (kept for readability)
    html = html.replace("{amount_display}", f"{amount/100:.2f}")
    return HTMLResponse(html)


# ----------------- Reports (Health Records vault) -----------------
@api_router.post("/reports")
async def add_report(body: ReportInput, user: dict = Depends(current_user)):
    r = body.dict()
    r["id"] = str(uuid.uuid4())
    r["user_id"] = user["id"]
    r["created_at"] = now_iso()
    if not r.get("date"):
        r["date"] = now_iso()
    await db.reports.insert_one(r)
    r.pop("_id", None)
    return r


@api_router.get("/reports")
async def list_reports(user: dict = Depends(current_user)):
    items = await db.reports.find({"user_id": user["id"]}, {"_id": 0}).sort("date", -1).to_list(200)
    return items


@api_router.delete("/reports/{report_id}")
async def delete_report(report_id: str, user: dict = Depends(current_user)):
    r = await db.reports.delete_one({"id": report_id, "user_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ----------------- Reminders -----------------
@api_router.post("/reminders")
async def create_reminder(body: ReminderInput, user: dict = Depends(current_user)):
    r = body.dict()
    r["id"] = str(uuid.uuid4())
    r["user_id"] = user["id"]
    r["created_at"] = now_iso()
    r["active"] = True
    await db.reminders.insert_one(r)
    r.pop("_id", None)
    return r


@api_router.get("/reminders")
async def list_reminders(user: dict = Depends(current_user)):
    items = await db.reminders.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api_router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, user: dict = Depends(current_user)):
    r = await db.reminders.delete_one({"id": reminder_id, "user_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ----------------- Feed & Daily Tip -----------------
@api_router.get("/feed")
async def get_feed():
    items = await db.feed.find({}, {"_id": 0}).sort("order", 1).to_list(200)
    return items


@api_router.get("/daily-tip")
async def daily_tip():
    # Deterministic tip-of-day based on day-of-year
    tips = await db.feed.find({"category": "tip"}, {"_id": 0}).to_list(200)
    if not tips:
        return {"title": "Drink warm water with lemon", "body": "Kickstart your digestion the AYUSH way."}
    day = datetime.now(timezone.utc).timetuple().tm_yday
    return tips[day % len(tips)]


# ----------------- Challenges -----------------
@api_router.get("/challenges")
async def list_challenges(user: dict = Depends(current_user)):
    challenges = await db.challenges.find({}, {"_id": 0}).to_list(100)
    joined = await db.user_challenges.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    joined_map = {j["challenge_id"]: j for j in joined}
    for c in challenges:
        uj = joined_map.get(c["id"])
        c["joined"] = uj is not None
        c["streak"] = uj.get("streak", 0) if uj else 0
    return challenges


@api_router.post("/challenges/join")
async def join_challenge(body: ChallengeJoinInput, user: dict = Depends(current_user)):
    ch = await db.challenges.find_one({"id": body.challenge_id})
    if not ch:
        raise HTTPException(status_code=404, detail="Challenge not found")
    doc = {
        "user_id": user["id"],
        "challenge_id": body.challenge_id,
        "streak": 1,
        "joined_at": now_iso(),
        "last_checkin": now_iso(),
    }
    await db.user_challenges.update_one(
        {"user_id": user["id"], "challenge_id": body.challenge_id},
        {"$set": doc},
        upsert=True,
    )
    await _award_points(user["id"], 25, reason="challenge_joined", meta={"challenge_id": body.challenge_id})
    return {"ok": True, "streak": 1}


# ----------------- Engagement (points, streaks, badges) -----------------
BADGE_LIBRARY = [
    {"key": "first_step",       "title": "First Step",       "desc": "Signed up for VaidyaJi",           "icon": "star",          "points": 20},
    {"key": "wellness_starter", "title": "Wellness Starter", "desc": "Logged your first wellness metric", "icon": "activity",      "points": 30},
    {"key": "check_in_7",       "title": "7-Day Streak",     "desc": "Checked in 7 days in a row",        "icon": "zap",           "points": 100},
    {"key": "check_in_30",      "title": "30-Day Streak",    "desc": "Checked in 30 days in a row",       "icon": "award",         "points": 500},
    {"key": "quiz_master",      "title": "Quiz Master",      "desc": "Scored 100% on a health quiz",      "icon": "book-open",     "points": 75},
    {"key": "yogi",             "title": "Yogi",             "desc": "Completed 10 yoga sessions",        "icon": "wind",          "points": 150},
    {"key": "community_voice",  "title": "Community Voice",  "desc": "Posted 5 times in the community",   "icon": "message-square", "points": 60},
    {"key": "consulted",        "title": "Health Seeker",    "desc": "Booked your first consultation",    "icon": "video",         "points": 80},
    {"key": "challenger",       "title": "Challenger",       "desc": "Joined a wellness challenge",       "icon": "target",        "points": 50},
]

_LEVELS = [
    (0, "Seeker"), (100, "Explorer"), (300, "Practitioner"),
    (700, "Sadhak"),  (1500, "Adhikari"), (3000, "Vaidhya Ratna"),
]


def _level_for(points: int) -> Dict[str, Any]:
    """Return {level, title, next_at, progress_pct} for a given total-points value."""
    cur = _LEVELS[0]
    nxt: Optional[tuple] = None
    for i, lv in enumerate(_LEVELS):
        if points >= lv[0]:
            cur = lv
            nxt = _LEVELS[i + 1] if i + 1 < len(_LEVELS) else None
    span = (nxt[0] - cur[0]) if nxt else 1
    progress = int(((points - cur[0]) / span) * 100) if span > 0 else 100
    return {
        "level": _LEVELS.index(cur) + 1,
        "title": cur[1],
        "next_at": nxt[0] if nxt else None,
        "next_title": nxt[1] if nxt else None,
        "progress_pct": max(0, min(100, progress)),
    }


async def _get_engagement(user_id: str) -> Dict[str, Any]:
    e = await db.user_engagement.find_one({"user_id": user_id}, {"_id": 0})
    if not e:
        e = {
            "user_id": user_id, "points": 0,
            "streak_current": 0, "streak_max": 0, "streak_last_date": None,
            "badges": [], "history": [], "created_at": now_iso(),
        }
        await db.user_engagement.insert_one(e.copy())
    return e


async def _award_points(user_id: str, points: int, reason: str, meta: Optional[dict] = None) -> None:
    """Fire-and-forget: increments points, appends history entry. Never throws."""
    try:
        await db.user_engagement.update_one(
            {"user_id": user_id},
            {
                "$setOnInsert": {"created_at": now_iso()},
                "$inc": {"points": int(points)},
                "$push": {"history": {"$each": [{
                    "reason": reason, "points": int(points),
                    "meta": meta or {}, "at": now_iso(),
                }], "$slice": -50}},
            },
            upsert=True,
        )
    except Exception as exc:
        logger.debug("award_points failed for %s: %s", user_id, exc)


async def _grant_badge(user_id: str, key: str) -> bool:
    """Grant a badge if not already earned. Returns True if newly granted."""
    badge = next((b for b in BADGE_LIBRARY if b["key"] == key), None)
    if not badge:
        return False
    e = await db.user_engagement.find_one({"user_id": user_id}, {"_id": 0, "badges": 1}) or {}
    owned = {b["key"] for b in (e.get("badges") or [])}
    if key in owned:
        return False
    await db.user_engagement.update_one(
        {"user_id": user_id},
        {"$push": {"badges": {"key": key, "earned_at": now_iso()}}, "$setOnInsert": {"created_at": now_iso()}},
        upsert=True,
    )
    await _award_points(user_id, badge["points"], reason=f"badge:{key}")
    return True


@api_router.get("/engagement/me")
async def engagement_me(user: dict = Depends(current_user)):
    e = await _get_engagement(user["id"])
    owned = {b["key"] for b in (e.get("badges") or [])}
    lvl = _level_for(e.get("points", 0))
    # Compose full badge list with earned flag + earned_at
    badge_map = {b["key"]: b for b in (e.get("badges") or [])}
    all_badges = [{
        **b,
        "earned": b["key"] in owned,
        "earned_at": badge_map.get(b["key"], {}).get("earned_at"),
    } for b in BADGE_LIBRARY]
    return {
        "points": e.get("points", 0),
        "streak_current": e.get("streak_current", 0),
        "streak_max": e.get("streak_max", 0),
        "streak_last_date": e.get("streak_last_date"),
        "level": lvl,
        "badges": all_badges,
        "badges_earned": len([b for b in all_badges if b["earned"]]),
        "badges_total": len(BADGE_LIBRARY),
        "history": (e.get("history") or [])[-20:][::-1],
    }


@api_router.post("/engagement/checkin")
async def engagement_checkin(user: dict = Depends(current_user)):
    """Daily check-in. Increments streak, awards +10 points, may grant streak badges."""
    e = await _get_engagement(user["id"])
    today = datetime.utcnow().date().isoformat()
    last = e.get("streak_last_date")
    if last == today:
        return {
            "already_checked_in": True,
            "streak_current": e.get("streak_current", 0),
            "points_awarded": 0,
            "streak_max": e.get("streak_max", 0),
        }
    # If last check-in was yesterday, continue streak; else restart at 1.
    if last:
        try:
            last_d = datetime.fromisoformat(last).date()
            if (datetime.utcnow().date() - last_d).days == 1:
                new_streak = int(e.get("streak_current", 0)) + 1
            else:
                new_streak = 1
        except Exception:
            new_streak = 1
    else:
        new_streak = 1
    new_max = max(int(e.get("streak_max", 0)), new_streak)
    await db.user_engagement.update_one(
        {"user_id": user["id"]},
        {"$set": {"streak_current": new_streak, "streak_max": new_max, "streak_last_date": today}},
        upsert=True,
    )
    await _award_points(user["id"], 10, reason="daily_checkin")
    newly = []
    if new_streak >= 7 and await _grant_badge(user["id"], "check_in_7"):
        newly.append("check_in_7")
    if new_streak >= 30 and await _grant_badge(user["id"], "check_in_30"):
        newly.append("check_in_30")
    # Grant first_step badge on very first check-in
    await _grant_badge(user["id"], "first_step")
    return {
        "already_checked_in": False,
        "streak_current": new_streak,
        "streak_max": new_max,
        "points_awarded": 10,
        "new_badges": newly,
    }


# ----------------- Quizzes -----------------
class QuizSubmitInput(BaseModel):
    answers: List[int] = Field(..., max_length=50)


def _seeded_quizzes() -> List[Dict[str, Any]]:
    """Statically-defined quizzes so tests + prod stay in sync."""
    return [
        {
            "id": "quiz-dosha-basics",
            "title": "What's Your Dominant Dosha?",
            "category": "ayurveda",
            "description": "5-question quick self-assessment to hint at your Ayurvedic constitution.",
            "image_url": "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg",
            "duration_min": 3,
            "points": 30,
            "questions": [
                {"q": "How is your body frame?",
                 "options": ["Thin, light", "Medium, athletic", "Heavier, sturdy"],
                 "correct": 0, "explain": "All body types are valid — this is just a self-check."},
                {"q": "What is your typical appetite?",
                 "options": ["Variable, irregular", "Strong, gets hungry fast", "Steady, low"],
                 "correct": 1, "explain": "Strong appetite is a Pitta trait; variable is Vata; low is Kapha."},
                {"q": "How is your sleep?",
                 "options": ["Light, disturbed", "Sound but short", "Deep and long"],
                 "correct": 2, "explain": "Deep, long sleep is a classic Kapha trait."},
                {"q": "How do you handle stress?",
                 "options": ["Get anxious", "Get irritated", "Withdraw"],
                 "correct": 0, "explain": "Anxiety under stress is a Vata response."},
                {"q": "How does your skin feel?",
                 "options": ["Dry", "Warm, prone to rash", "Oily, smooth"],
                 "correct": 1, "explain": "Warm, red-prone skin often indicates elevated Pitta."},
            ],
        },
        {
            "id": "quiz-sleep-hygiene",
            "title": "How Good Is Your Sleep Hygiene?",
            "category": "sleep",
            "description": "5 questions on your bedtime habits — AYUSH-aligned.",
            "image_url": "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg",
            "duration_min": 3,
            "points": 30,
            "questions": [
                {"q": "How many hours before bed do you eat dinner?",
                 "options": ["<1 hr", "1–2 hrs", "3+ hrs"], "correct": 2,
                 "explain": "Ayurveda recommends dinner 3 hours before bed for full digestion."},
                {"q": "Do you use screens in bed?",
                 "options": ["Yes, often", "Sometimes", "Rarely / never"], "correct": 2,
                 "explain": "Blue light disturbs Vata and delays melatonin."},
                {"q": "Bedtime consistency?",
                 "options": ["Random", "Within 1 hour", "Same time daily"], "correct": 2,
                 "explain": "Consistent sleep-wake time balances circadian rhythm."},
                {"q": "Room temperature?",
                 "options": ["Warm & stuffy", "Neutral", "Cool & dark"], "correct": 2,
                 "explain": "Cool, dark rooms deepen sleep."},
                {"q": "Wind-down ritual (tea, journal, oil massage)?",
                 "options": ["None", "Occasionally", "Every night"], "correct": 2,
                 "explain": "Abhyanga (self-massage) or warm milk pacifies Vata before sleep."},
            ],
        },
        {
            "id": "quiz-gut-health",
            "title": "Is Your Digestion Balanced?",
            "category": "digestion",
            "description": "Quick check on Agni (digestive fire) health.",
            "image_url": "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg",
            "duration_min": 3,
            "points": 30,
            "questions": [
                {"q": "Water with meals?",
                 "options": ["Cold water", "Room-temp water", "Warm/no water"], "correct": 2,
                 "explain": "Warm water (or sips only) protects Agni."},
                {"q": "Bloating frequency?",
                 "options": ["Daily", "Weekly", "Rarely"], "correct": 2,
                 "explain": "Frequent bloating indicates weak Agni."},
                {"q": "Do you skip breakfast?",
                 "options": ["Yes", "Sometimes", "No"], "correct": 2,
                 "explain": "Skipping breakfast weakens Agni; Ayurveda recommends warm, cooked breakfast."},
                {"q": "How is your bowel movement?",
                 "options": ["Irregular", "Every 1–2 days", "Daily & complete"], "correct": 2,
                 "explain": "Daily, complete elimination is a sign of healthy digestion."},
                {"q": "Spices in daily food?",
                 "options": ["None", "A few", "Ginger, cumin, coriander regularly"], "correct": 2,
                 "explain": "Warming spices kindle Agni."},
            ],
        },
        {
            "id": "quiz-stress-check",
            "title": "Stress & Nervous System Check",
            "category": "mind",
            "description": "5 questions to gauge your Vata mind-load.",
            "image_url": "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg",
            "duration_min": 3,
            "points": 30,
            "questions": [
                {"q": "How often do you feel overwhelmed weekly?",
                 "options": ["4+ times", "1–3 times", "Rarely"], "correct": 2,
                 "explain": "Elevated stress imbalances Vata."},
                {"q": "Do you practise pranayama?",
                 "options": ["Never", "Sometimes", "Daily"], "correct": 2,
                 "explain": "Anulom-Vilom balances the nervous system."},
                {"q": "Time spent in nature/week?",
                 "options": ["<1 hr", "1–3 hrs", "3+ hrs"], "correct": 2,
                 "explain": "Nature time reduces cortisol."},
                {"q": "Meditation frequency?",
                 "options": ["Never", "Weekly", "Daily"], "correct": 2,
                 "explain": "Daily meditation lowers Vata aggravation."},
                {"q": "Caffeine intake?",
                 "options": ["3+ cups", "1–2 cups", "None / herbal only"], "correct": 2,
                 "explain": "Excess caffeine aggravates Vata & Pitta."},
            ],
        },
    ]


@api_router.get("/quizzes")
async def list_quizzes(user: dict = Depends(current_user)):
    """Public quiz catalogue with user's previous attempts."""
    attempts = await db.quiz_attempts.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    best_by_quiz: Dict[str, int] = {}
    for a in attempts:
        qid = a["quiz_id"]
        best_by_quiz[qid] = max(best_by_quiz.get(qid, 0), int(a.get("score", 0)))
    out = []
    for q in _seeded_quizzes():
        item = {
            "id": q["id"], "title": q["title"], "category": q["category"],
            "description": q["description"], "image_url": q["image_url"],
            "duration_min": q["duration_min"], "points": q["points"],
            "questions_count": len(q["questions"]),
            "best_score": best_by_quiz.get(q["id"], 0),
            "attempted": q["id"] in best_by_quiz,
        }
        out.append(item)
    return out


@api_router.get("/quizzes/{quiz_id}")
async def get_quiz(quiz_id: str, user: dict = Depends(current_user)):
    q = next((x for x in _seeded_quizzes() if x["id"] == quiz_id), None)
    if not q:
        raise HTTPException(status_code=404, detail="Quiz not found")
    # Do NOT leak `correct` before submission
    return {
        **{k: v for k, v in q.items() if k != "questions"},
        "questions": [{"q": qq["q"], "options": qq["options"]} for qq in q["questions"]],
    }


@api_router.post("/quizzes/{quiz_id}/submit")
async def submit_quiz(quiz_id: str, body: QuizSubmitInput, user: dict = Depends(current_user)):
    q = next((x for x in _seeded_quizzes() if x["id"] == quiz_id), None)
    if not q:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if len(body.answers) != len(q["questions"]):
        raise HTTPException(status_code=400, detail="Answer count mismatch")
    score = 0
    details = []
    for i, qq in enumerate(q["questions"]):
        picked = body.answers[i]
        correct = int(qq["correct"])
        ok = picked == correct
        if ok:
            score += 1
        details.append({
            "q": qq["q"], "picked": picked, "correct": correct,
            "ok": ok, "explain": qq.get("explain", ""),
        })
    pct = int((score / len(q["questions"])) * 100)
    # SEC-001 fix: only award points on first attempt or improved score.
    # Any subsequent attempt is still allowed (users get their review + explanations),
    # but no points/badges are re-granted → self-farming loop closed.
    prev = await db.quiz_attempts.find(
        {"user_id": user["id"], "quiz_id": quiz_id}, {"_id": 0, "score": 1}
    ).sort("at", -1).to_list(200)
    prev_best = max((int(a.get("score", 0)) for a in prev), default=-1)
    is_first = len(prev) == 0
    improved = score > prev_best
    earned = 0
    if is_first or improved:
        earned = 5 * score
        if pct == 100:
            earned += int(q.get("points", 30))
    attempt = {
        "id": str(uuid.uuid4()), "user_id": user["id"], "quiz_id": quiz_id,
        "score": score, "total": len(q["questions"]), "pct": pct,
        "answers": body.answers, "at": now_iso(),
        "points_awarded": earned,
    }
    await db.quiz_attempts.insert_one(attempt)
    attempt.pop("_id", None)
    if earned > 0:
        await _award_points(
            user["id"], earned, reason="quiz_submitted",
            meta={"quiz_id": quiz_id, "score": score, "total": len(q["questions"])},
        )
    newly_earned: List[str] = []
    # Only grant badge on a fresh perfect score (idempotent — _grant_badge already dedupes,
    # but this saves the DB write on replays).
    if pct == 100 and (is_first or improved) and await _grant_badge(user["id"], "quiz_master"):
        newly_earned.append("quiz_master")
    return {
        "score": score, "total": len(q["questions"]), "pct": pct,
        "points_awarded": earned, "details": details,
        "new_badges": newly_earned,
        "already_attempted": not (is_first or improved),
    }


# ----------------- AI Chatbot -----------------
SYSTEM_PROMPT = (
    "You are 'AI VaidyaJi', a warm, knowledgeable AYUSH health companion inspired by the "
    "Indian traditions of Ayurveda, Homoeopathy, Yoga, Unani, and Siddha. "
    "Your role is to gently help users understand their symptoms, suggest AYUSH-based home "
    "remedies (like herbs, yoga asanas, dietary guidance), and recommend seeing a qualified "
    "AYUSH doctor when symptoms are serious or persistent. "
    "Always be respectful of modern medicine — never discourage users from seeing a physician. "
    "Keep answers concise (2-4 short paragraphs), practical, and rooted in AYUSH wisdom. "
    "Use simple English with occasional Hindi/Sanskrit terms in italics-style (e.g., 'ashwagandha', 'pranayama'). "
    "For every serious symptom (chest pain, breathing issues, high fever, bleeding, mental health crisis), "
    "advise immediate consultation with a doctor."
)


@api_router.post("/chat/message")
async def chat_message(body: ChatMessageInput, request: Request, user: dict = Depends(current_user)):
    # Rate limit LLM calls: 20 per user per 5 min (prevents cost amplification)
    await rate_limit(request, f"chat:msg:{user['id']}", max_calls=20, window_seconds=300)
    # persist user message
    await db.chat_messages.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": body.session_id,
        "user_id": user["id"],
        "role": "user",
        "text": body.message,
        "created_at": now_iso(),
    })

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=body.session_id,
        system_message=SYSTEM_PROMPT,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    try:
        reply = await chat.send_message(UserMessage(text=body.message))
    except Exception as e:
        logger.exception("LLM error")
        raise HTTPException(status_code=502, detail="AI assistant is temporarily unavailable. Please try again.")

    reply_text = reply if isinstance(reply, str) else str(reply)

    await db.chat_messages.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": body.session_id,
        "user_id": user["id"],
        "role": "assistant",
        "text": reply_text,
        "created_at": now_iso(),
    })
    return {"reply": reply_text}


@api_router.get("/chat/history/{session_id}")
async def chat_history(session_id: str, user: dict = Depends(current_user)):
    msgs = await db.chat_messages.find(
        {"session_id": session_id, "user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    return msgs


# ----------------- Analytics -----------------
class AnalyticsEvent(BaseModel):
    event: str
    props: Optional[dict] = None


@api_router.post("/analytics")
async def track(event: AnalyticsEvent, user: dict = Depends(current_user)):
    await db.analytics.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "event": event.event,
        "props": event.props or {},
        "at": now_iso(),
    })
    return {"ok": True}


# ----------------- Seed -----------------
async def seed():
    if await db.doctors.count_documents({}) == 0:
        doctors = [
            {"id": str(uuid.uuid4()), "name": "Dr. Meera Sharma", "specialty": "Ayurveda",
             "qualification": "BAMS, MD (Ayu)", "experience_years": 12,
             "languages": ["Hindi", "English"], "consultation_fee": 599,
             "bio": "Specializes in dosha-based lifestyle correction and Panchakarma.",
             "avatar_url": "https://images.pexels.com/photos/5738735/pexels-photo-5738735.jpeg",
             "rating": 4.8, "reviews": 214, "verified": True},
            {"id": str(uuid.uuid4()), "name": "Dr. Arjun Nair", "specialty": "Homoeopathy",
             "qualification": "BHMS", "experience_years": 9,
             "languages": ["English", "Malayalam", "Hindi"], "consultation_fee": 499,
             "bio": "Chronic skin & respiratory conditions with individualised remedies.",
             "avatar_url": "https://images.pexels.com/photos/5888168/pexels-photo-5888168.jpeg",
             "rating": 4.7, "reviews": 158, "verified": True},
            {"id": str(uuid.uuid4()), "name": "Yogacharya Riya Patel", "specialty": "Yoga",
             "qualification": "MSc Yoga Therapy", "experience_years": 15,
             "languages": ["Hindi", "Gujarati", "English"], "consultation_fee": 399,
             "bio": "Therapeutic yoga for back pain, PCOS, and anxiety.",
             "avatar_url": "https://images.pexels.com/photos/5938358/pexels-photo-5938358.jpeg",
             "rating": 4.9, "reviews": 302, "verified": True},
            {"id": str(uuid.uuid4()), "name": "Hakim Zaid Ahmad", "specialty": "Unani",
             "qualification": "BUMS", "experience_years": 20,
             "languages": ["Urdu", "Hindi", "English"], "consultation_fee": 549,
             "bio": "Traditional Unani mizaj-based diagnosis and treatment.",
             "avatar_url": "https://images.pexels.com/photos/6749773/pexels-photo-6749773.jpeg",
             "rating": 4.6, "reviews": 121, "verified": True},
            {"id": str(uuid.uuid4()), "name": "Dr. Kavitha Iyer", "specialty": "Siddha",
             "qualification": "BSMS", "experience_years": 11,
             "languages": ["Tamil", "English"], "consultation_fee": 449,
             "bio": "Siddha herbal & mineral therapies for chronic ailments.",
             "avatar_url": "https://images.pexels.com/photos/5407206/pexels-photo-5407206.jpeg",
             "rating": 4.7, "reviews": 96, "verified": True},
            {"id": str(uuid.uuid4()), "name": "Dr. Rohan Deshmukh", "specialty": "Ayurveda",
             "qualification": "BAMS, MD (Kayachikitsa)", "experience_years": 8,
             "languages": ["Marathi", "Hindi", "English"], "consultation_fee": 449,
             "bio": "Gut health, immunity and metabolic disorders.",
             "avatar_url": "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg",
             "rating": 4.5, "reviews": 74, "verified": True},
        ]
        await db.doctors.insert_many(doctors)

    if await db.feed.count_documents({}) == 0:
        feed = [
            {"id": str(uuid.uuid4()), "order": 1, "category": "tip",
             "title": "Start your day with warm water",
             "body": "A glass of warm water with a pinch of ajwain kindles Agni (digestive fire) and gently detoxes overnight ama.",
             "image_url": "https://images.pexels.com/photos/20689437/pexels-photo-20689437.jpeg"},
            {"id": str(uuid.uuid4()), "order": 2, "category": "remedy",
             "title": "Turmeric milk for immunity",
             "body": "Boil 1 cup milk with ¼ tsp haldi, pinch of black pepper, and a clove. Best 30 minutes before bed.",
             "image_url": "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg"},
            {"id": str(uuid.uuid4()), "order": 3, "category": "tip",
             "title": "Abhyanga: 5-minute oil massage",
             "body": "Warm sesame oil rubbed on scalp & feet before bath calms Vata and improves sleep.",
             "image_url": "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg"},
            {"id": str(uuid.uuid4()), "order": 4, "category": "yoga",
             "title": "Anulom Vilom — 5 min daily",
             "body": "Alternate-nostril pranayama balances your nadis and lowers stress within a week.",
             "image_url": "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg"},
            {"id": str(uuid.uuid4()), "order": 5, "category": "remedy",
             "title": "Herbal tea for cough",
             "body": "Boil tulsi, ginger, honey & black pepper in water. Sip warm 2× a day for sore throat.",
             "image_url": "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg"},
            {"id": str(uuid.uuid4()), "order": 6, "category": "tip",
             "title": "Eat with the sun",
             "body": "Your Pitta is strongest at midday — make lunch your biggest meal, dinner your lightest.",
             "image_url": "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg"},
        ]
        await db.feed.insert_many(feed)

    if await db.challenges.count_documents({}) == 0:
        challenges = [
            {"id": str(uuid.uuid4()), "title": "21-Day Pranayama", "duration_days": 21,
             "description": "5 minutes of Anulom Vilom every morning.",
             "image_url": "https://images.pexels.com/photos/13943905/pexels-photo-13943905.jpeg",
             "badge": "Prana Master"},
            {"id": str(uuid.uuid4()), "title": "Sunrise Warm Water", "duration_days": 14,
             "description": "Warm water first thing in the morning for 2 weeks.",
             "image_url": "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg",
             "badge": "Agni Ignitor"},
            {"id": str(uuid.uuid4()), "title": "No Screens After 10 PM", "duration_days": 30,
             "description": "Protect your sleep, calm your Vata.",
             "image_url": "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg",
             "badge": "Nidra Guardian"},
        ]
        await db.challenges.insert_many(challenges)

    if await db.medicines.count_documents({}) == 0:
        meds = [
            {"id": str(uuid.uuid4()), "order": 1, "category": "immunity", "name": "Chyawanprash",
             "brand": "Dabur", "price": 349, "unit": "500 g jar",
             "description": "Classical rasayana boosting immunity, respiratory health & vitality. Contains Amla, Pippali, Ashwagandha.",
             "image_url": "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg"},
            {"id": str(uuid.uuid4()), "order": 2, "category": "stress", "name": "Ashwagandha Tablets",
             "brand": "Himalaya", "price": 249, "unit": "60 tabs",
             "description": "Adaptogenic herb for stress, sleep and stamina.",
             "image_url": "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg"},
            {"id": str(uuid.uuid4()), "order": 3, "category": "digestive", "name": "Triphala Churna",
             "brand": "Baidyanath", "price": 179, "unit": "100 g",
             "description": "Amla + Haritaki + Bibhitaki — gentle digestion & detox.",
             "image_url": "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg"},
            {"id": str(uuid.uuid4()), "order": 4, "category": "skin", "name": "Kumkumadi Tailam",
             "brand": "Kottakkal", "price": 399, "unit": "10 ml",
             "description": "Saffron-infused night oil for radiant, even-toned skin.",
             "image_url": "https://images.pexels.com/photos/5407206/pexels-photo-5407206.jpeg"},
            {"id": str(uuid.uuid4()), "order": 5, "category": "immunity", "name": "Tulsi Drops",
             "brand": "Organic India", "price": 199, "unit": "30 ml",
             "description": "5 tulsi varieties in a bottle — take 3-5 drops in water daily.",
             "image_url": "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg"},
            {"id": str(uuid.uuid4()), "order": 6, "category": "joint", "name": "Mahanarayan Oil",
             "brand": "Kottakkal", "price": 289, "unit": "200 ml",
             "description": "Traditional oil for joint & muscle aches, post-workout recovery.",
             "image_url": "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg"},
            {"id": str(uuid.uuid4()), "order": 7, "category": "sleep", "name": "Brahmi Ghrita",
             "brand": "Baidyanath", "price": 449, "unit": "150 g",
             "description": "Medicated ghee for memory, focus & deep sleep.",
             "image_url": "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg"},
            {"id": str(uuid.uuid4()), "order": 8, "category": "digestive", "name": "Hingvastak Churna",
             "brand": "Dabur", "price": 129, "unit": "100 g",
             "description": "Post-meal digestive powder to reduce bloating & gas.",
             "image_url": "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg"},
        ]
        await db.medicines.insert_many(meds)

    if await db.lab_tests.count_documents({}) == 0:
        labs = [
            {"id": str(uuid.uuid4()), "order": 1, "category": "general", "name": "Complete Blood Count (CBC)",
             "price": 399, "turnaround": "6 hours", "fasting": False,
             "description": "Baseline count of RBC, WBC, platelets, hemoglobin.",
             "image_url": "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg"},
            {"id": str(uuid.uuid4()), "order": 2, "category": "metabolic", "name": "Diabetes Screen (HbA1c + FBS)",
             "price": 599, "turnaround": "12 hours", "fasting": True,
             "description": "3-month average blood sugar + fasting glucose.",
             "image_url": "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg"},
            {"id": str(uuid.uuid4()), "order": 3, "category": "wellness", "name": "AYUSH Wellness Panel",
             "price": 1499, "turnaround": "24 hours", "fasting": True,
             "description": "CBC + Lipid + Liver + Thyroid + Vitamin D & B12 — the classic annual check-up.",
             "image_url": "https://images.pexels.com/photos/5407206/pexels-photo-5407206.jpeg"},
            {"id": str(uuid.uuid4()), "order": 4, "category": "hormone", "name": "Thyroid Profile",
             "price": 549, "turnaround": "12 hours", "fasting": False,
             "description": "T3, T4, TSH — assess thyroid function.",
             "image_url": "https://images.pexels.com/photos/5407206/pexels-photo-5407206.jpeg"},
            {"id": str(uuid.uuid4()), "order": 5, "category": "wellness", "name": "Vitamin D & B12",
             "price": 799, "turnaround": "12 hours", "fasting": False,
             "description": "Critical for energy, mood, bone & nerve health.",
             "image_url": "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg"},
        ]
        await db.lab_tests.insert_many(labs)

    if await db.blogs.count_documents({}) == 0:
        blogs = [
            {"id": str(uuid.uuid4()), "order": 1, "category": "ayurveda",
             "title": "Understanding Your Dosha in 5 Minutes",
             "excerpt": "Vata, Pitta, or Kapha — knowing your constitution is the first step to real health.",
             "body": (
                 "Ayurveda teaches that every human is a unique blend of three biological energies — Vata (air+space), "
                 "Pitta (fire+water), and Kapha (earth+water). Your dominant dosha shapes your body type, digestion, "
                 "sleep, mood, and even the diseases you're prone to.\n\n"
                 "Vata people are quick, creative, and can suffer dryness and anxiety when unbalanced. Pitta types are "
                 "sharp, decisive, and prone to inflammation, heat, and burnout. Kapha types are calm, stable, but can "
                 "gain weight and slow down easily.\n\n"
                 "The magic of Ayurveda is that once you know your dosha, you can eat, exercise, sleep, and even work "
                 "in a way that keeps you balanced. Take our free dosha quiz in the app and start your journey."
             ),
             "image_url": "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg",
             "author": "Dr. Meera Sharma", "read_min": 5, "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "order": 2, "category": "remedy",
             "title": "5 AYUSH Home Remedies for Winter Cough",
             "excerpt": "Tulsi, honey, ginger — kitchen shelf cures that actually work.",
             "body": (
                 "1. Tulsi-Ginger Kadha — Boil 10 tulsi leaves + 1 inch grated ginger + 2 cloves in 2 cups water. "
                 "Reduce to 1 cup, add honey. Sip twice daily.\n\n"
                 "2. Turmeric Milk (Haldi Doodh) — 1 glass milk, ¼ tsp turmeric, pinch of black pepper. "
                 "Best 30 min before sleep.\n\n"
                 "3. Steam with Ajwain — Add 1 tsp ajwain to boiling water, inhale steam.\n\n"
                 "4. Honey + Cinnamon — 1 tsp honey with a pinch of cinnamon, twice daily.\n\n"
                 "5. Warm Sesame Oil Chest Rub — Warm 1 tbsp sesame oil, massage on chest and back, cover with cotton cloth."
             ),
             "image_url": "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg",
             "author": "Dr. Arjun Nair", "read_min": 4, "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "order": 3, "category": "yoga",
             "title": "Morning Yoga for Beginners — 15 Min",
             "excerpt": "A gentle routine to energise your day, no equipment needed.",
             "body": (
                 "Start with 5 rounds of Surya Namaskar at a comfortable pace. Follow with:\n"
                 "• Tadasana (mountain pose) — 1 min\n• Vrikshasana (tree) — 30 sec each side\n"
                 "• Bhujangasana (cobra) — 5 breaths\n• Balasana (child) — 1 min\n\n"
                 "Finish with 5 minutes of Anulom Vilom pranayama. Doing this daily for 21 days transforms your energy."
             ),
             "image_url": "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg",
             "author": "Yogacharya Riya Patel", "read_min": 6, "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "order": 4, "category": "nutrition",
             "title": "AYUSH Diet Rules Everyone Should Know",
             "excerpt": "6 timeless rules from Ayurveda that upgrade every meal.",
             "body": (
                 "1. Eat sitting down, slowly, and chew each bite.\n2. Lunch should be your largest meal.\n"
                 "3. Sip warm water, never ice-cold, during meals.\n4. Don't mix milk with sour or salty foods.\n"
                 "5. Include all six tastes (sweet, sour, salty, bitter, pungent, astringent) daily.\n"
                 "6. Dinner should end 3 hours before sleep."
             ),
             "image_url": "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg",
             "author": "VaidyaJi Editorial", "read_min": 3, "created_at": now_iso()},
        ]
        await db.blogs.insert_many(blogs)


@app.on_event("startup")
async def on_startup():
    await seed()
    # One-time backfill: seeded doctors created before verify field existed
    # should be treated as verified so they show up in public /api/doctors
    await db.doctors.update_many(
        {"verified": {"$exists": False}}, {"$set": {"verified": True}}
    )
    await db.doctors.update_many(
        {"verified": None, "user_id": {"$exists": False}}, {"$set": {"verified": True}}
    )
    # Ensure a unique index on community_likes to prevent duplicate likes
    # under concurrent taps (race-safe like count).
    try:
        await db.community_likes.create_index(
            [("post_id", 1), ("user_id", 1)], unique=True, name="uniq_post_user_like"
        )
    except Exception as e:
        logger.warning(f"Could not create community_likes unique index: {e}")
    # Seed / upsert single admin — this account becomes the SUPER ADMIN.
    existing = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "VaidyaJi Admin",
            "email": ADMIN_EMAIL.lower(),
            "password": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "is_admin": True,
            "admin_role": "super_admin",
            "phone": None,
            "created_at": now_iso(),
        })
    else:
        # ALWAYS sync stored password with current env ADMIN_PASSWORD at startup so
        # rotating the env value invalidates any previously-known credential (SEC-001).
        # Skip only if the current env password already matches (avoids needless writes).
        set_doc = {"is_admin": True, "role": "admin", "admin_role": "super_admin"}
        if not verify_password(ADMIN_PASSWORD, existing.get("password", "")):
            set_doc["password"] = hash_password(ADMIN_PASSWORD)
            logger.info("Admin password synced with env ADMIN_PASSWORD.")
        await db.users.update_one({"email": ADMIN_EMAIL.lower()}, {"$set": set_doc})


# ----------------- App wiring -----------------
# ----------------- Admin -----------------
class DoctorUpsertInput(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    specialty: str
    qualification: str
    experience_years: int = 0
    languages: List[str] = []
    consultation_fee: int = 499
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    registration_number: Optional[str] = None
    verified: bool = True


@api_router.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_admin)):
    total_patients = await db.users.count_documents({"role": "patient"})
    total_doctors = await db.doctors.count_documents({})
    verified_doctors = await db.doctors.count_documents({"verified": True})
    pending_doctors = await db.doctors.count_documents({"verified": False})
    total_appointments = await db.appointments.count_documents({})
    consultations_today = await db.appointments.count_documents({
        "created_at": {"$gte": datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()}
    })
    total_reminders = await db.reminders.count_documents({})
    leads = await db.leads.count_documents({})
    return {
        "patients": total_patients,
        "doctors": total_doctors,
        "verified_doctors": verified_doctors,
        "pending_doctors": pending_doctors,
        "appointments": total_appointments,
        "consultations_today": consultations_today,
        "reminders": total_reminders,
        "leads": leads,
    }


@api_router.get("/admin/doctors")
async def admin_list_doctors(verify_status: Optional[str] = None, admin: dict = Depends(require_admin)):
    q: dict = {}
    if verify_status == "pending":
        q["verified"] = False
    elif verify_status == "verified":
        q["verified"] = True
    items = await db.doctors.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.post("/admin/doctors")
async def admin_add_doctor(body: DoctorUpsertInput, admin: dict = Depends(require_admin)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    doc.setdefault("rating", 4.5)
    doc.setdefault("reviews", 0)
    if not doc.get("avatar_url"):
        doc["avatar_url"] = "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg"
    await db.doctors.insert_one(doc)
    doc.pop("_id", None)
    await log_activity("admin_doctor_added", actor=admin, meta={"doctor": doc["name"]})
    return doc


@api_router.put("/admin/doctors/{doctor_id}")
async def admin_update_doctor(doctor_id: str, body: DoctorUpsertInput, admin: dict = Depends(require_admin)):
    upd = {k: v for k, v in body.dict().items() if v is not None}
    r = await db.doctors.update_one({"id": doctor_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Doctor not found")
    updated = await db.doctors.find_one({"id": doctor_id}, {"_id": 0})
    await log_activity("admin_doctor_edited", actor=admin, meta={"doctor_id": doctor_id})
    return updated


@api_router.post("/admin/doctors/{doctor_id}/approve")
async def admin_approve_doctor(doctor_id: str, admin: dict = Depends(require_admin)):
    d = await db.doctors.find_one({"id": doctor_id})
    if not d:
        raise HTTPException(status_code=404, detail="Doctor not found")
    await db.doctors.update_one({"id": doctor_id}, {"$set": {"verified": True, "approved_at": now_iso()}})
    if d.get("user_id"):
        await db.users.update_one({"id": d["user_id"]}, {"$set": {"verified": True}})
    await log_activity("admin_doctor_approved", actor=admin, meta={"doctor_id": doctor_id, "name": d.get("name")})
    # Push notification to doctor (non-blocking)
    if d.get("user_id"):
        try:
            await send_push(
                recipients=[d["user_id"]],
                data={
                    "title": "You're approved! 🎉",
                    "message": f"Welcome to Online VaidyaJi, Dr. {d.get('name', 'Vaidya')}. Start seeing patients now.",
                    "action_url": "/doctor/home",
                },
                idempotency_key=f"doc_approved_{doctor_id}",
            )
        except Exception as e:
            logger.warning(f"doc-approved push failed (non-blocking): {e}")
    return {"ok": True}


@api_router.post("/admin/doctors/{doctor_id}/reject")
async def admin_reject_doctor(doctor_id: str, admin: dict = Depends(require_admin)):
    d = await db.doctors.find_one({"id": doctor_id})
    if not d:
        raise HTTPException(status_code=404, detail="Doctor not found")
    await db.doctors.update_one({"id": doctor_id}, {"$set": {"verified": False, "rejected_at": now_iso()}})
    await log_activity("admin_doctor_rejected", actor=admin, meta={"doctor_id": doctor_id})
    return {"ok": True}


@api_router.delete("/admin/doctors/{doctor_id}")
async def admin_delete_doctor(doctor_id: str, admin: dict = Depends(require_admin)):
    d = await db.doctors.find_one({"id": doctor_id})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    await db.doctors.delete_one({"id": doctor_id})
    if d.get("user_id"):
        await db.users.delete_one({"id": d["user_id"]})
    await log_activity("admin_doctor_removed", actor=admin, meta={"doctor_id": doctor_id, "name": d.get("name")})
    return {"ok": True}


@api_router.get("/admin/patients")
async def admin_list_patients(admin: dict = Depends(require_admin)):
    pipeline = [
        {"$match": {"role": "patient", "deleted": {"$ne": True}}},
        {"$lookup": {
            "from": "appointments",
            "localField": "id",
            "foreignField": "patient_id",
            "as": "_appts"
        }},
        {"$addFields": {"appointments": {"$size": "$_appts"}}},
        {"$project": {"_id": 0, "password": 0, "_appts": 0}},
        {"$sort": {"created_at": -1}},
        {"$limit": 1000},
    ]
    users = await db.users.aggregate(pipeline).to_list(1000)
    return users


@api_router.get("/admin/patients/{patient_id}")
async def admin_get_patient(patient_id: str, admin: dict = Depends(require_admin)):
    """Full patient profile for admin viewing/editing."""
    u = await db.users.find_one({"id": patient_id, "role": "patient"}, {"_id": 0, "password": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Patient not found")
    # Enrich with counts
    appt_count = await db.appointments.count_documents({"patient_id": patient_id})
    rx_count = await db.prescriptions.count_documents({"patient_id": patient_id})
    fam = await db.family_members.count_documents({"user_id": patient_id})
    u["appointments_count"] = appt_count
    u["prescriptions_count"] = rx_count
    u["family_members_count"] = fam
    return u


class AdminPatientUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    dob: Optional[str] = Field(None, max_length=20)
    gender: Optional[str] = Field(None, max_length=20)
    blood_group: Optional[str] = Field(None, max_length=10)
    address: Optional[str] = Field(None, max_length=300)
    city: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)


@api_router.put("/admin/patients/{patient_id}")
async def admin_update_patient(patient_id: str, body: AdminPatientUpdate, admin: dict = Depends(require_admin)):
    u = await db.users.find_one({"id": patient_id, "role": "patient"})
    if not u:
        raise HTTPException(status_code=404, detail="Patient not found")
    upd = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "email" in upd:
        upd["email"] = upd["email"].lower()
        # Guard against duplicate emails
        existing = await db.users.find_one({"email": upd["email"], "id": {"$ne": patient_id}})
        if existing:
            raise HTTPException(status_code=409, detail="Another user already has this email")
    upd["updated_at"] = now_iso()
    await db.users.update_one({"id": patient_id}, {"$set": upd})
    await log_activity("admin_patient_update", actor=admin, meta={"patient_id": patient_id, "fields": list(upd.keys())})
    fresh = await db.users.find_one({"id": patient_id}, {"_id": 0, "password": 0})
    return fresh


@api_router.delete("/admin/patients/{patient_id}")
async def admin_delete_patient(patient_id: str, admin: dict = Depends(require_admin)):
    """Soft delete: marks user as deleted, hides from listings, preserves data."""
    u = await db.users.find_one({"id": patient_id, "role": "patient"})
    if not u:
        raise HTTPException(status_code=404, detail="Patient not found")
    await db.users.update_one({"id": patient_id}, {"$set": {
        "deleted": True, "deleted_at": now_iso(), "deleted_by": admin["id"],
    }})
    await log_activity("admin_patient_delete", actor=admin, meta={"patient_id": patient_id, "email": u.get("email")})
    return {"ok": True, "soft_deleted": True}


@api_router.post("/admin/patients/{patient_id}/restore")
async def admin_restore_patient(patient_id: str, admin: dict = Depends(require_admin)):
    r = await db.users.update_one(
        {"id": patient_id, "role": "patient", "deleted": True},
        {"$unset": {"deleted": "", "deleted_at": "", "deleted_by": ""}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Deleted patient not found")
    await log_activity("admin_patient_restore", actor=admin, meta={"patient_id": patient_id})
    return {"ok": True}


# ── Doctor detail + extended CRUD (verification viewer) ─────────────
@api_router.get("/admin/doctors/{doctor_id}")
async def admin_get_doctor(doctor_id: str, admin: dict = Depends(require_admin)):
    """Full doctor profile for verification review — includes registration number,
    degree, uploaded documents, avatar, and everything admin needs to approve.
    """
    d = await db.doctors.find_one({"id": doctor_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Doctor not found")
    # Enrich with linked user + counts
    if d.get("user_id"):
        u = await db.users.find_one({"id": d["user_id"]}, {"_id": 0, "password": 0})
        if u:
            d["user_account"] = u
        d["appointments_count"] = await db.appointments.count_documents({"doctor_id": doctor_id})
        d["prescriptions_count"] = await db.prescriptions.count_documents({"doctor_id": doctor_id})
        d["community_posts_count"] = await db.doc_com_posts.count_documents({"doctor_id": d["user_id"]})
    return d


class AdminDoctorUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    specialty: Optional[str] = Field(None, max_length=100)
    qualification: Optional[str] = Field(None, max_length=200)
    experience_years: Optional[int] = Field(None, ge=0, le=80)
    languages: Optional[List[str]] = None
    consultation_fee: Optional[int] = Field(None, ge=0, le=100000)
    bio: Optional[str] = Field(None, max_length=1000)
    clinic_name: Optional[str] = Field(None, max_length=200)
    clinic_address: Optional[str] = Field(None, max_length=500)
    registration_number: Optional[str] = Field(None, max_length=100)
    verified: Optional[bool] = None
    avatar_url: Optional[str] = Field(None, max_length=4_500_000)  # base64 avatar
    admin_notes: Optional[str] = Field(None, max_length=1000)


@api_router.put("/admin/doctors/{doctor_id}/full")
async def admin_update_doctor_full(doctor_id: str, body: AdminDoctorUpdate, admin: dict = Depends(require_admin)):
    """Admin edits any doctor field (name, fees, bio, verified status, etc.)."""
    d = await db.doctors.find_one({"id": doctor_id})
    if not d:
        raise HTTPException(status_code=404, detail="Doctor not found")
    upd = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "email" in upd:
        upd["email"] = upd["email"].lower()
    upd["updated_at"] = now_iso()
    await db.doctors.update_one({"id": doctor_id}, {"$set": upd})
    # Also mirror name/email/phone on the linked user account (login goes through users)
    if d.get("user_id"):
        user_mirror = {}
        for f in ("name", "email", "phone"):
            if f in upd:
                user_mirror[f] = upd[f]
        if user_mirror:
            await db.users.update_one({"id": d["user_id"]}, {"$set": user_mirror})
    await log_activity("admin_doctor_update_full", actor=admin, meta={"doctor_id": doctor_id, "fields": list(upd.keys())})
    fresh = await db.doctors.find_one({"id": doctor_id}, {"_id": 0})
    return fresh


# ── Admin staff / team management (super admin only) ────────────────
class AdminStaffCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class AdminStaffResetPassword(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)


def _is_strong_admin_password(pw: str) -> bool:
    if len(pw) < 8:
        return False
    return any(c.isalpha() for c in pw) and any(c.isdigit() for c in pw)


@api_router.get("/admin/staff")
async def admin_list_staff(admin: dict = Depends(require_admin)):
    """Any admin can see the team roster. Only super_admin can modify."""
    rows = await db.users.find(
        {"is_admin": True}, {"_id": 0, "password": 0}
    ).sort("created_at", 1).to_list(200)
    return rows


@api_router.post("/admin/staff")
async def admin_create_staff(body: AdminStaffCreate, admin: dict = Depends(require_super_admin)):
    email = body.email.lower()
    if not _is_strong_admin_password(body.password):
        raise HTTPException(status_code=400, detail="Password must be 8+ chars with letters & digits")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "email": email,
        "password": hash_password(body.password),
        "role": "admin",
        "is_admin": True,
        "admin_role": "admin",  # regular admin — cannot manage staff
        "phone": None,
        "must_change_password": True,  # force change on first login
        "created_at": now_iso(),
        "created_by": admin["id"],
    }
    await db.users.insert_one(doc.copy())
    await log_activity("admin_staff_create", actor=admin, meta={"target_email": email})
    doc.pop("_id", None)
    doc.pop("password", None)
    return doc


@api_router.delete("/admin/staff/{user_id}")
async def admin_delete_staff(user_id: str, admin: dict = Depends(require_super_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot remove yourself")
    target = await db.users.find_one({"id": user_id, "is_admin": True})
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")
    if target.get("admin_role") == "super_admin":
        raise HTTPException(status_code=400, detail="Super Admin account cannot be removed. Rotate ADMIN_EMAIL/ADMIN_PASSWORD in .env to change it.")
    await db.users.delete_one({"id": user_id})
    await log_activity("admin_staff_delete", actor=admin, meta={"target_user_id": user_id, "target_email": target.get("email")})
    return {"ok": True}


@api_router.post("/admin/staff/{user_id}/reset-password")
async def admin_reset_staff_password(user_id: str, body: AdminStaffResetPassword, admin: dict = Depends(require_super_admin)):
    target = await db.users.find_one({"id": user_id, "is_admin": True})
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")
    if not _is_strong_admin_password(body.new_password):
        raise HTTPException(status_code=400, detail="Password must be 8+ chars with letters & digits")
    await db.users.update_one({"id": user_id}, {"$set": {
        "password": hash_password(body.new_password),
        "must_change_password": True,
        "temp_password_set_at": now_iso(),
    }})
    await log_activity("admin_staff_reset_pw", actor=admin, meta={"target_user_id": user_id, "target_email": target.get("email")})
    return {"ok": True, "temp_password": body.new_password, "message": "Password reset. Share with the admin — they must change it on their next login."}


@api_router.get("/admin/patients/{patient_id}/appointments")
async def admin_patient_appointments(patient_id: str, admin: dict = Depends(require_admin)):
    items = await db.appointments.find({"patient_id": patient_id}, {"_id": 0}).sort("slot", -1).to_list(500)
    return items


@api_router.get("/admin/activity")
async def admin_activity(limit: int = 100, admin: dict = Depends(require_admin)):
    items = await db.activity.find({}, {"_id": 0}).sort("at", -1).to_list(limit)
    return items


@api_router.get("/admin/leads")
async def admin_leads(admin: dict = Depends(require_admin)):
    items = await db.leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


# ----------------- Support / Lead-gen AI -----------------
SUPPORT_PROMPT = (
    "You are 'VaidyaJi Support' — a warm, helpful assistant for the Online VaidyaJi app. "
    "Your job is TWO-fold: "
    "(1) Answer user questions about how to use the app (booking doctors, AYUSH specialties, symptom checker, medicine reminders, wellness challenges, pricing, health records). "
    "(2) Gently collect the user's name, phone/email and their goal (e.g., 'need Ayurvedic consultation for acidity') so our team can follow up — but ONLY if they haven't shared this yet and only after answering their query. "
    "Keep responses concise (2-3 short paragraphs), warm, and India-focused. Use occasional Hindi phrases (Namaste, Dhanyavaad, Aap ki seva mein). "
    "If a user shares contact details, respond with: 'Got it! We will follow up soon.' and end that message with a marker on a new line: LEAD_CAPTURED. "
    "Never give medical diagnoses — for medical queries, gently redirect them to the AI VaidyaJi chatbot inside the app or a real doctor."
)


class SupportChatInput(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=100)
    message: str = Field(..., min_length=1, max_length=2000)


class LeadInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    contact: str = Field(..., min_length=1, max_length=200)  # phone or email
    goal: Optional[str] = Field(None, max_length=500)
    source: Optional[str] = Field("support-chat", max_length=60)


@api_router.post("/support/chat")
async def support_chat(body: SupportChatInput, request: Request):
    # Rate limit: anonymous LLM endpoint — 10 msgs per IP per 5 min
    await rate_limit(request, "support:chat", max_calls=10, window_seconds=300)
    # session-based (anonymous OK). Store both messages.
    await db.support_messages.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": body.session_id,
        "role": "user",
        "text": body.message,
        "created_at": now_iso(),
    })
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"support-{body.session_id}",
        system_message=SUPPORT_PROMPT,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        reply = await chat.send_message(UserMessage(text=body.message))
    except Exception as e:
        logger.exception("support LLM error")
        raise HTTPException(status_code=502, detail="Support assistant is temporarily unavailable. Please try again.")
    reply_text = reply if isinstance(reply, str) else str(reply)
    await db.support_messages.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": body.session_id,
        "role": "assistant",
        "text": reply_text,
        "created_at": now_iso(),
    })
    lead_captured = "LEAD_CAPTURED" in reply_text
    return {"reply": reply_text.replace("LEAD_CAPTURED", "").strip(), "lead_captured": lead_captured}


@api_router.post("/support/lead")
async def create_lead(body: LeadInput):
    lead = body.dict()
    lead["id"] = str(uuid.uuid4())
    lead["created_at"] = now_iso()
    lead["status"] = "new"
    await db.leads.insert_one(lead)
    lead.pop("_id", None)
    await log_activity("lead_captured", actor=None, meta={"name": body.name, "contact": body.contact})
    return lead


# ----------------- End admin/support -----------------


# ----------------- Medicines (Shop) -----------------
class MedicineOrderInput(BaseModel):
    items: List[dict]  # [{medicine_id, qty}]
    address: Optional[str] = None


@api_router.get("/medicines")
async def list_medicines(category: Optional[str] = None):
    q: dict = {}
    if category and category.lower() != "all":
        q["category"] = category
    items = await db.medicines.find(q, {"_id": 0}).sort("order", 1).to_list(200)
    return items


@api_router.get("/medicines/{med_id}")
async def get_medicine(med_id: str):
    m = await db.medicines.find_one({"id": med_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    return m


@api_router.post("/medicines/order")
async def order_medicines(body: MedicineOrderInput, user: dict = Depends(current_user)):
    if not body.items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    ids = [i.get("medicine_id") for i in body.items]
    meds = await db.medicines.find({"id": {"$in": ids}}, {"_id": 0}).to_list(200)
    med_map = {m["id"]: m for m in meds}
    total = 0
    resolved = []
    for it in body.items:
        m = med_map.get(it.get("medicine_id"))
        try:
            qty = int(it.get("qty", 1))
        except (TypeError, ValueError):
            qty = 0
        # Clamp qty to a safe positive range (prevents negative-price manipulation
        # or DoS via huge quantities on this mock endpoint).
        if qty < 1 or qty > 99:
            continue
        if not m:
            continue
        line = qty * m.get("price", 0)
        total += line
        resolved.append({"medicine_id": m["id"], "name": m["name"], "qty": qty, "unit_price": m["price"], "line_total": line})
    if not resolved:
        raise HTTPException(status_code=400, detail="No valid items in order")
    order = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "items": resolved,
        "address": body.address,
        "total": total,
        # Pending payment — client must invoke /payments/create-order+/payments/verify
        # to move to "paid" (see payment verification flow at server.py ~1020).
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.medicine_orders.insert_one(order)
    order.pop("_id", None)
    await log_activity("medicine_ordered", actor=user, meta={"total": total, "items": len(resolved)})
    return order


@api_router.get("/medicines/orders/mine")
async def my_medicine_orders(user: dict = Depends(current_user)):
    items = await db.medicine_orders.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items


# ----------------- Lab tests -----------------
class LabBookingInput(BaseModel):
    lab_test_id: str
    slot: str
    address: Optional[str] = None


@api_router.get("/lab-tests")
async def list_lab_tests(category: Optional[str] = None):
    q: dict = {}
    if category and category.lower() != "all":
        q["category"] = category
    items = await db.lab_tests.find(q, {"_id": 0}).sort("order", 1).to_list(200)
    return items


@api_router.get("/lab-tests/{test_id}")
async def get_lab_test(test_id: str):
    t = await db.lab_tests.find_one({"id": test_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    return t


@api_router.post("/lab-tests/book")
async def book_lab_test(body: LabBookingInput, user: dict = Depends(current_user)):
    t = await db.lab_tests.find_one({"id": body.lab_test_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Test not found")
    booking = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "lab_test_id": t["id"],
        "test_name": t["name"],
        "price": t["price"],
        "slot": body.slot,
        "address": body.address,
        "status": "confirmed",
        "created_at": now_iso(),
    }
    await db.lab_bookings.insert_one(booking)
    booking.pop("_id", None)
    await log_activity("lab_test_booked", actor=user, meta={"test": t["name"], "price": t["price"]})
    return booking


@api_router.get("/lab-tests/bookings/mine")
async def my_lab_bookings(user: dict = Depends(current_user)):
    items = await db.lab_bookings.find({"user_id": user["id"]}, {"_id": 0}).sort("slot", -1).to_list(100)
    return items


# ----------------- Blogs -----------------
@api_router.get("/blogs")
async def list_blogs(category: Optional[str] = None):
    q: dict = {}
    if category and category.lower() != "all":
        q["category"] = category
    items = await db.blogs.find(q, {"_id": 0}).sort("order", 1).to_list(200)
    return items


@api_router.get("/blogs/{blog_id}")
async def get_blog(blog_id: str):
    b = await db.blogs.find_one({"id": blog_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Not found")
    return b


# ----------------- AI Diet Plan -----------------
class DietPlanInput(BaseModel):
    goal: str  # e.g., "weight loss", "better sleep", "boost immunity"
    dosha: Optional[str] = None
    conditions: Optional[List[str]] = None
    vegetarian: bool = True
    duration_days: int = 1  # 1 or 7
    structured: bool = False  # if True, return day-wise meal breakdown as JSON


def _clamp_days(n: int) -> int:
    if n <= 1:
        return 1
    if n <= 3:
        return 3
    return 7


DOSHA_KEYS = ("vata", "pitta", "kapha")

DOSHA_DESCRIPTIONS = {
    "vata": {
        "essence": "Air & Ether — creative, quick, movement-driven.",
        "traits": ["Light, thin build", "Dry skin & hair", "Cold hands & feet", "Fast talker & thinker", "Irregular appetite", "Light, disturbed sleep"],
        "balance": "Warmth, routine, oils, grounding foods, slow deep breathing.",
    },
    "pitta": {
        "essence": "Fire & Water — sharp, focused, transformation-driven.",
        "traits": ["Medium build & muscle tone", "Warm skin, may flush", "Strong appetite & digestion", "Ambitious & sharp-minded", "Sensitive to heat", "Moderate sound sleep"],
        "balance": "Cool foods, moderation, avoid spicy/oily, meditation, moonlight walks.",
    },
    "kapha": {
        "essence": "Earth & Water — steady, calm, grounding.",
        "traits": ["Solid, larger build", "Smooth oily skin & thick hair", "Slow, steady digestion", "Calm & patient temperament", "Slow to anger, holds emotions", "Deep, long sleep"],
        "balance": "Warm spices, movement, light meals, stimulating routines, avoid dairy.",
    },
}


class PrakritiAssessInput(BaseModel):
    # answers: list of one of "V", "P", "K" (one per question)
    answers: List[Literal["V", "P", "K"]]
    # optional metadata for future use
    age: Optional[int] = None
    gender: Optional[str] = None


@api_router.post("/prakriti/assess")
async def prakriti_assess(body: PrakritiAssessInput, user: dict = Depends(current_user)):
    """Compute Prakriti (constitution) scores from a symptom/habit questionnaire.

    Returns dosha percentages + dominant/secondary + narrative description, and
    saves the resulting dosha string to the user's patient profile.
    """
    if len(body.answers) < 5:
        raise HTTPException(status_code=400, detail="At least 5 answers required for a meaningful assessment")
    counts = {"V": 0, "P": 0, "K": 0}
    for a in body.answers:
        counts[a] = counts.get(a, 0) + 1
    total = sum(counts.values()) or 1
    vata_pct = round(counts["V"] / total * 100)
    pitta_pct = round(counts["P"] / total * 100)
    kapha_pct = round(counts["K"] / total * 100)

    # Determine dominant / secondary. Ties within 10 pts of leader → dual dosha
    ordered = sorted(
        [("Vata", vata_pct), ("Pitta", pitta_pct), ("Kapha", kapha_pct)],
        key=lambda x: -x[1],
    )
    dominant = ordered[0][0]
    secondary = ordered[1][0] if (ordered[0][1] - ordered[1][1]) <= 10 and ordered[1][1] > 0 else None
    dosha_str = f"{dominant}-{secondary}" if secondary else dominant

    key = dominant.lower()
    desc = DOSHA_DESCRIPTIONS.get(key, {})

    result = {
        "vata": vata_pct,
        "pitta": pitta_pct,
        "kapha": kapha_pct,
        "dominant": dominant,
        "secondary": secondary,
        "dosha": dosha_str,
        "description": desc.get("essence", ""),
        "traits": desc.get("traits", []),
        "balance": desc.get("balance", ""),
        "assessed_at": now_iso(),
    }

    # Persist to patient profile (only for patient role — silently skip for doctors)
    if user.get("role") == "patient":
        await db.patient_profiles.update_one(
            {"user_id": user["id"]},
            {"$set": {
                "dosha": dosha_str,
                "prakriti_result": result,
                "updated_at": now_iso(),
                "user_id": user["id"],
            }},
            upsert=True,
        )

    # Also log a lightweight history entry
    try:
        await db.prakriti_assessments.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            **result,
        })
    except Exception:
        logger.exception("prakriti_assessment log failed")

    await log_activity("prakriti_assessed", actor=user, meta={"dosha": dosha_str})
    return result


@api_router.post("/diet-plan")
async def generate_diet_plan(body: DietPlanInput, request: Request, user: dict = Depends(current_user)):
    # Rate limit paid LLM calls: 5 diet plans per user per hour
    await rate_limit(request, f"dietplan:{user['id']}", max_calls=5, window_seconds=3600)
    days = _clamp_days(int(body.duration_days or 1))
    dosha = (body.dosha or "").strip()
    if not dosha and user.get("role") == "patient":
        # Fill from saved patient profile if the client didn't send it
        prof = await db.patient_profiles.find_one({"user_id": user["id"]}, {"_id": 0, "dosha": 1}) or {}
        dosha = prof.get("dosha") or ""

    if body.structured:
        prompt = (
            f"You are an AYUSH nutritionist. Create a PERSONALISED {days}-day meal plan.\n"
            f"Goal: {body.goal}\n"
            f"Dosha (Prakriti): {dosha or 'unknown'}\n"
            f"Conditions: {', '.join(body.conditions or []) or 'none'}\n"
            f"Vegetarian: {body.vegetarian}\n\n"
            "Return ONLY a JSON object (no code fences, no commentary) shaped exactly like:\n"
            '{"summary": "1-2 sentence overview of the plan strategy",\n'
            ' "principles": ["3-5 short Ayurvedic principles guiding this plan"],\n'
            ' "days": [\n'
            '   {"day": 1, "name": "Day 1",\n'
            '    "meals": [\n'
            '       {"slot": "Early morning", "title": "…", "items": ["…"], "reasoning": "one-line ayurvedic reasoning"},\n'
            '       {"slot": "Breakfast", "title": "…", "items": ["…"], "reasoning": "…"},\n'
            '       {"slot": "Mid-morning", "title": "…", "items": ["…"], "reasoning": "…"},\n'
            '       {"slot": "Lunch", "title": "…", "items": ["…"], "reasoning": "…"},\n'
            '       {"slot": "Evening", "title": "…", "items": ["…"], "reasoning": "…"},\n'
            '       {"slot": "Dinner", "title": "…", "items": ["…"], "reasoning": "…"},\n'
            '       {"slot": "Bedtime", "title": "…", "items": ["…"], "reasoning": "…"}\n'
            '    ]}\n'
            f'   ... (exactly {days} day objects)\n'
            ' ],\n'
            ' "avoid": ["3-6 foods this dosha/goal should avoid"],\n'
            ' "favour": ["3-6 foods this dosha/goal should favour"]\n'
            "}\n"
            "Keep items list to 1-3 short lines. Use real, culturally-Indian foods. "
            "Vary meals across days. Include tastes (rasa) hint in reasoning where useful."
        )
    else:
        prompt = (
            f"Create a personalised 1-day AYUSH diet plan.\n"
            f"Goal: {body.goal}\n"
            f"Dosha: {dosha or 'unknown'}\n"
            f"Conditions: {', '.join(body.conditions or []) or 'none'}\n"
            f"Vegetarian: {body.vegetarian}\n\n"
            "Return sections labelled Early Morning, Breakfast, Mid-morning, Lunch, Evening Snack, Dinner, Bedtime. "
            "Each section: 1-2 short bullet points with Ayurvedic reasoning. Total under 250 words. Warm, practical Indian foods."
        )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"diet-{user['id']}-{uuid.uuid4()}",
        system_message="You are an AYUSH nutritionist. Give practical, culturally-aware Indian diet plans grounded in Ayurveda.",
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        reply = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI error: {e}")
    text = reply if isinstance(reply, str) else str(reply)

    plan_structured = None
    if body.structured:
        # Try to extract JSON out of the reply — model may accidentally wrap in ```
        raw = text.strip()
        if raw.startswith("```"):
            # strip code fences
            first_nl = raw.find("\n")
            raw = raw[first_nl + 1:] if first_nl > 0 else raw
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and isinstance(parsed.get("days"), list):
                plan_structured = parsed
        except Exception as e:
            logger.warning(f"diet-plan JSON parse failed, falling back to text: {e}")

    plan = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "goal": body.goal,
        "dosha": dosha or None,
        "duration_days": days,
        "vegetarian": body.vegetarian,
        "plan": text,
        "plan_structured": plan_structured,
        "created_at": now_iso(),
    }
    await db.diet_plans.insert_one(plan)
    plan.pop("_id", None)
    await log_activity("diet_plan_generated", actor=user, meta={"goal": body.goal, "days": days, "dosha": dosha})
    return plan


@api_router.get("/diet-plans")
async def my_diet_plans(user: dict = Depends(current_user)):
    items = await db.diet_plans.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return items


# ----------------- Doctor onboarding & workspace -----------------
class DoctorOnboardInput(BaseModel):
    specialty: str
    qualification: str
    registration_number: str
    experience_years: int = 0
    languages: List[str] = []
    consultation_fee: int = 499
    bio: Optional[str] = None
    clinic_name: Optional[str] = None
    clinic_address: Optional[str] = None
    documents: Optional[List[str]] = None  # base64 or filename placeholders
    # Base64-encoded profile photo (data URI or raw base64). Cap ~4 MB.
    avatar_base64: Optional[str] = Field(None, max_length=4_000_000)


class DoctorProfileUpdate(BaseModel):
    """Fields a doctor is allowed to edit after onboarding."""
    specialty: Optional[str] = Field(None, max_length=100)
    qualification: Optional[str] = Field(None, max_length=200)
    experience_years: Optional[int] = Field(None, ge=0, le=80)
    languages: Optional[List[str]] = None
    consultation_fee: Optional[int] = Field(None, ge=0, le=100000)
    bio: Optional[str] = Field(None, max_length=1000)
    clinic_name: Optional[str] = Field(None, max_length=200)
    clinic_address: Optional[str] = Field(None, max_length=500)
    avatar_base64: Optional[str] = Field(None, max_length=4_000_000)


# ── Doctor Availability (calendar / schedule) ────────────────────────────
# `weekly_schedule` maps ISO weekday (0=Mon, 6=Sun) to a list of HH:MM slots.
# `is_available` is a hard toggle: when False, the doctor is "offline" and
# hidden from instant consult routing, even if their schedule says otherwise.
class DoctorAvailabilityInput(BaseModel):
    is_available: Optional[bool] = None
    consultation_mode: Optional[str] = Field(None, pattern="^(online|offline|both)$")
    weekly_schedule: Optional[Dict[str, List[str]]] = None  # e.g. {"0": ["09:00", "09:30", "17:00"]}
    slot_duration_min: Optional[int] = Field(None, ge=5, le=120)
    notes: Optional[str] = Field(None, max_length=300)


@api_router.get("/doctor/me")
async def doctor_me(user: dict = Depends(current_user)):
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0})
    return d or {}


@api_router.put("/doctor/onboard")
async def doctor_onboard(body: DoctorOnboardInput, user: dict = Depends(current_user)):
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    upd = body.dict()
    # Convert base64 photo → data URI stored as avatar_url so it renders directly in <Image>.
    avatar_b64 = upd.pop("avatar_base64", None)
    if avatar_b64:
        upd["avatar_url"] = avatar_b64 if avatar_b64.startswith("data:") else f"data:image/jpeg;base64,{avatar_b64}"
    upd["onboarded_at"] = now_iso()
    upd["documents_uploaded"] = bool(body.documents) or bool(body.registration_number)
    r = await db.doctors.update_one({"user_id": user["id"]}, {"$set": upd}, upsert=True)
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0})
    await log_activity("doctor_onboarded", actor=user, meta={"specialty": body.specialty})
    return d


@api_router.put("/doctor/profile")
async def doctor_update_profile(body: DoctorProfileUpdate, user: dict = Depends(current_user)):
    """Doctor edits their own profile (bio, fee, avatar, etc.) after onboarding."""
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    upd = {k: v for k, v in body.dict().items() if v is not None}
    avatar_b64 = upd.pop("avatar_base64", None)
    if avatar_b64:
        upd["avatar_url"] = avatar_b64 if avatar_b64.startswith("data:") else f"data:image/jpeg;base64,{avatar_b64}"
    if not upd:
        raise HTTPException(status_code=400, detail="No fields to update")
    upd["updated_at"] = now_iso()
    d = await db.doctors.find_one({"user_id": user["id"]})
    if not d or not d.get("onboarded_at"):
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    await db.doctors.update_one({"user_id": user["id"]}, {"$set": upd})
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0})
    return d


@api_router.get("/doctor/availability")
async def doctor_get_availability(user: dict = Depends(current_user)):
    """Return the currently signed-in doctor's calendar/availability."""
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    return {
        "is_available": bool(d.get("is_available", True)),
        "consultation_mode": d.get("consultation_mode", "both"),
        "weekly_schedule": d.get("weekly_schedule") or {},
        "slot_duration_min": d.get("slot_duration_min", 30),
        "notes": d.get("availability_notes", ""),
    }


@api_router.put("/doctor/availability")
async def doctor_set_availability(body: DoctorAvailabilityInput, user: dict = Depends(current_user)):
    """Doctor updates their calendar / availability toggle."""
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    upd: Dict[str, Any] = {}
    if body.is_available is not None:
        upd["is_available"] = bool(body.is_available)
    if body.consultation_mode is not None:
        upd["consultation_mode"] = body.consultation_mode
    if body.weekly_schedule is not None:
        # Sanitise: only accept keys "0".."6" and unique sorted HH:MM entries (capped to 24 slots/day)
        clean: Dict[str, List[str]] = {}
        for day in [str(i) for i in range(7)]:
            slots = body.weekly_schedule.get(day) or []
            valid: List[str] = []
            for s in slots:
                if not isinstance(s, str) or len(s) != 5 or s[2] != ":":
                    continue
                try:
                    hh, mm = int(s[:2]), int(s[3:])
                except Exception:
                    continue
                if 0 <= hh <= 23 and 0 <= mm <= 59 and s not in valid:
                    valid.append(s)
            valid.sort()
            clean[day] = valid[:24]
        upd["weekly_schedule"] = clean
    if body.slot_duration_min is not None:
        upd["slot_duration_min"] = int(body.slot_duration_min)
    if body.notes is not None:
        upd["availability_notes"] = body.notes
    if not upd:
        raise HTTPException(status_code=400, detail="No fields to update")
    upd["updated_at"] = now_iso()
    d = await db.doctors.find_one({"user_id": user["id"]})
    if not d or not d.get("onboarded_at"):
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    await db.doctors.update_one({"user_id": user["id"]}, {"$set": upd})
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0})
    return {
        "is_available": bool(d.get("is_available", True)),
        "consultation_mode": d.get("consultation_mode", "both"),
        "weekly_schedule": d.get("weekly_schedule") or {},
        "slot_duration_min": d.get("slot_duration_min", 30),
        "notes": d.get("availability_notes", ""),
    }


@api_router.get("/doctor/my-appointments")
async def doctor_my_appointments(user: dict = Depends(current_user)):
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    # Find the doctor record for this user, then their appointments
    d = await db.doctors.find_one({"user_id": user["id"]})
    if not d:
        return []
    items = await db.appointments.find({"doctor_id": d["id"]}, {"_id": 0}).sort("slot", 1).to_list(500)
    return items


@api_router.get("/doctor/my-patients")
async def doctor_my_patients(user: dict = Depends(current_user)):
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    d = await db.doctors.find_one({"user_id": user["id"]})
    if not d:
        return []
    ap = await db.appointments.find({"doctor_id": d["id"]}, {"_id": 0}).to_list(1000)
    # dedupe by patient_id
    seen: dict = {}
    for a in ap:
        pid = a["patient_id"]
        rec = seen.get(pid) or {"patient_id": pid, "patient_name": a["patient_name"], "visits": 0, "last_visit": None, "has_rx": False}
        rec["visits"] += 1
        if not rec["last_visit"] or a["slot"] > rec["last_visit"]:
            rec["last_visit"] = a["slot"]
        if a.get("prescription"):
            rec["has_rx"] = True
        seen[pid] = rec
    return list(seen.values())


@api_router.get("/doctor/patients/{patient_id}/history")
async def doctor_patient_history(patient_id: str, user: dict = Depends(current_user)):
    """Full visit + prescription history between the logged-in doctor and one patient."""
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    d = await db.doctors.find_one({"user_id": user["id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Doctor profile not found")
    # Ensure the doctor has actually seen this patient
    items = await db.appointments.find(
        {"doctor_id": d["id"], "patient_id": patient_id},
        {"_id": 0},
    ).sort("slot", -1).to_list(200)
    if not items:
        # No treatment relationship — refuse to leak arbitrary patient info
        raise HTTPException(status_code=403, detail="No treatment history with this patient")
    # Get lightweight patient info (name/age/dosha)
    patient = await db.users.find_one({"id": patient_id}, {"_id": 0, "password": 0}) or {}
    prof = await db.patient_profiles.find_one({"user_id": patient_id}, {"_id": 0}) or {}

    total_paid = 0
    total_rx = 0
    for a in items:
        if a.get("paid"):
            # Try to sum from payments table for accuracy
            pay = await db.payments.find_one(
                {"reference_id": a["id"], "purpose": "appointment", "status": "paid"},
                {"_id": 0, "amount": 1},
            )
            if pay:
                total_paid += int(pay.get("amount", 0))
        if a.get("prescription"):
            total_rx += 1

    return {
        "patient": {
            "id": patient.get("id", patient_id),
            "name": patient.get("name") or (items[0].get("patient_name") if items else "Patient"),
            "email": patient.get("email"),
            "phone": patient.get("phone"),
            "age": prof.get("age"),
            "gender": prof.get("gender"),
            "dosha": prof.get("dosha"),
            "conditions": prof.get("conditions") or [],
            "lifestyle": prof.get("lifestyle"),
        },
        "stats": {
            "total_visits": len(items),
            "total_prescriptions": total_rx,
            "total_paid_paise": total_paid,
            "first_visit": items[-1]["slot"] if items else None,
            "last_visit": items[0]["slot"] if items else None,
        },
        "appointments": items,
    }


@api_router.get("/doctor/earnings")
async def doctor_earnings(user: dict = Depends(current_user)):
    """Earnings summary for the currently logged-in doctor.

    Aggregates from `payments` (source of truth for money) joined with
    `appointments` on `reference_id`. All amounts are returned in paise.
    """
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctors only")
    d = await db.doctors.find_one({"user_id": user["id"]})
    if not d:
        return {
            "total_paise": 0,
            "month_paise": 0,
            "week_paise": 0,
            "today_paise": 0,
            "consultations": 0,
            "daily": [],
            "recent": [],
        }

    # Set of appointment ids that belong to this doctor
    appts_cursor = db.appointments.find(
        {"doctor_id": d["id"], "paid": True},
        {"_id": 0, "id": 1, "patient_name": 1, "slot": 1, "paid_at": 1},
    )
    appts = await appts_cursor.to_list(2000)
    if not appts:
        return {
            "total_paise": 0,
            "month_paise": 0,
            "week_paise": 0,
            "today_paise": 0,
            "consultations": 0,
            "daily": [],
            "recent": [],
        }
    appt_index = {a["id"]: a for a in appts}
    appt_ids = list(appt_index.keys())

    pays = await db.payments.find(
        {"reference_id": {"$in": appt_ids}, "purpose": "appointment", "status": "paid"},
        {"_id": 0},
    ).sort("verified_at", -1).to_list(2000)

    now = datetime.now(timezone.utc)
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_today - timedelta(days=start_of_today.weekday())
    start_of_month = start_of_today.replace(day=1)
    start_of_trend = start_of_today - timedelta(days=29)  # 30-day trend

    total = month = week = today = 0
    daily_map: dict = {}
    recent: list = []
    for p in pays:
        amt = int(p.get("amount", 0))
        total += amt
        ts_raw = p.get("verified_at") or p.get("created_at")
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")) if ts_raw else None
        except Exception:
            ts = None
        if ts:
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts >= start_of_today:
                today += amt
            if ts >= start_of_week:
                week += amt
            if ts >= start_of_month:
                month += amt
            if ts >= start_of_trend:
                key = ts.strftime("%Y-%m-%d")
                daily_map[key] = daily_map.get(key, 0) + amt
        a = appt_index.get(p.get("reference_id")) or {}
        recent.append({
            "razorpay_payment_id": p.get("razorpay_payment_id"),
            "amount_paise": amt,
            "verified_at": p.get("verified_at"),
            "patient_name": a.get("patient_name") or "Patient",
            "appointment_id": p.get("reference_id"),
            "appointment_slot": a.get("slot"),
        })

    # Build a dense 30-day daily list (zero-fill missing days)
    daily = []
    for i in range(30):
        d_key = (start_of_trend + timedelta(days=i)).strftime("%Y-%m-%d")
        daily.append({"date": d_key, "amount_paise": daily_map.get(d_key, 0)})

    return {
        "total_paise": total,
        "month_paise": month,
        "week_paise": week,
        "today_paise": today,
        "consultations": len(pays),
        "daily": daily,
        "recent": recent[:20],
    }


# ----------------- Push notifications -----------------
class RegisterPushBody(BaseModel):
    # user_id is IGNORED here — authoritative id comes from the JWT.
    # We still accept it in the payload for backward compatibility with the
    # existing frontend client, but never trust it.
    user_id: Optional[str] = None
    platform: str
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, user: dict = Depends(current_user)):
    # Enforce user_id from JWT — never trust client
    payload = {
        "user_id": user["id"],
        "platform": body.platform,
        "device_token": body.device_token,
    }
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=payload)
        if resp.status_code == 401:
            logger.warning("EMERGENT_PUSH_KEY placeholder — push will only work after deploy")
            return {"status": "pending", "note": "push key placeholder"}
        if resp.status_code >= 500:
            return {"status": "unavailable"}
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"register-push non-blocking error: {e}")
        return {"status": "pending"}
    return {"status": "registered"}


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        return
    try:
        payload: dict = {"recipients": recipients[:100], "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = idempotency_key
        resp = await _push_client.post("/api/v1/push/trigger", json=payload)
        if resp.status_code >= 400:
            logger.warning(f"send_push non-2xx: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"send_push failed (non-blocking): {e}")


class BroadcastInput(BaseModel):
    title: str
    message: str
    audience: Literal["all_patients", "all_doctors", "all"] = "all_patients"


@api_router.post("/admin/broadcast")
async def admin_broadcast(body: BroadcastInput, admin: dict = Depends(require_admin)):
    q: dict = {}
    if body.audience == "all_patients": q["role"] = "patient"
    elif body.audience == "all_doctors": q["role"] = "doctor"
    users = await db.users.find(q, {"_id": 0, "id": 1}).to_list(5000)
    ids = [u["id"] for u in users]
    # chunk 100
    for i in range(0, len(ids), 100):
        await send_push(ids[i:i+100], {"title": body.title, "message": body.message})
    await log_activity("admin_broadcast", actor=admin, meta={"audience": body.audience, "recipients": len(ids)})
    return {"sent_to": len(ids)}


# ----------------- AI Yoga library -----------------
# Curated free video library. Videos are public-embed YouTube links from well
# known yoga teachers. Sequences are structured so the app can guide poses
# on top of the video.

YOGA_LIBRARY: List[Dict[str, Any]] = [
    {
        "id": "morning-energy-20",
        "title": "Morning Energiser Suryanamaskar",
        "category": "Morning",
        "level": "Beginner",
        "duration_min": 20,
        "dosha_target": ["Kapha", "Vata"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=73sjOu0g58M",
        "youtube_id": "73sjOu0g58M",
        "thumbnail": "https://images.pexels.com/photos/3822583/pexels-photo-3822583.jpeg",
        "instructor": "Yoga With Adriene",
        "benefits": [
            "Wakes up the spine & warms every joint",
            "Kindles agni (digestive fire) for the day",
            "Improves circulation and breath capacity",
        ],
        "poses": [
            {"name": "Centering breath", "duration_sec": 60, "cue": "Sit tall. 6 slow deep breaths through the nose."},
            {"name": "Tadasana",         "duration_sec": 45, "cue": "Feet together, crown lifted, palms in prayer."},
            {"name": "Urdhva Hastasana", "duration_sec": 30, "cue": "Inhale, sweep arms up, gaze between thumbs."},
            {"name": "Uttanasana",       "duration_sec": 45, "cue": "Exhale, fold forward, soften the neck."},
            {"name": "Ardha Uttanasana", "duration_sec": 30, "cue": "Inhale, flat back, fingertips to shins."},
            {"name": "Plank",            "duration_sec": 45, "cue": "Step back, wrists under shoulders, gaze forward."},
            {"name": "Chaturanga",       "duration_sec": 20, "cue": "Elbows hug in, lower halfway with control."},
            {"name": "Urdhva Mukha",     "duration_sec": 30, "cue": "Roll open, chest forward, thighs lifted."},
            {"name": "Adho Mukha",       "duration_sec": 60, "cue": "Downward-facing dog. Pedal the feet, lengthen spine."},
            {"name": "Warrior I (R)",    "duration_sec": 40, "cue": "Right foot forward, bend front knee 90°."},
            {"name": "Warrior II (R)",   "duration_sec": 40, "cue": "Open hips, arms wide, gaze over right fingertips."},
            {"name": "Warrior I (L)",    "duration_sec": 40, "cue": "Repeat on the left side."},
            {"name": "Warrior II (L)",   "duration_sec": 40, "cue": "Open hips, arms wide, gaze over left fingertips."},
            {"name": "Balasana",         "duration_sec": 60, "cue": "Child's pose. Big toes together, knees wide."},
            {"name": "Savasana",         "duration_sec": 120, "cue": "Lie back, palms open. Feel the aliveness."},
        ],
    },
    {
        "id": "back-pain-relief-25",
        "title": "Back Pain Relief Flow",
        "category": "Therapy",
        "level": "Beginner",
        "duration_min": 25,
        "dosha_target": ["Vata"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=DWKcox3ExAQ",
        "youtube_id": "DWKcox3ExAQ",
        "thumbnail": "https://images.pexels.com/photos/4056723/pexels-photo-4056723.jpeg",
        "instructor": "Yoga With Kassandra",
        "benefits": [
            "Releases tension in lumbar & thoracic spine",
            "Mobilises hips (a common cause of lower-back pain)",
            "Strengthens deep core stabilisers",
        ],
        "poses": [
            {"name": "Constructive rest",       "duration_sec": 60, "cue": "Feet on floor, knees bent. Notice the low back settle."},
            {"name": "Apanasana (knees to chest)","duration_sec": 60, "cue": "Draw knees in, gentle circles."},
            {"name": "Supine Twist (R)",        "duration_sec": 60, "cue": "Knees to the right, gaze left."},
            {"name": "Supine Twist (L)",        "duration_sec": 60, "cue": "Knees to the left, gaze right."},
            {"name": "Cat-Cow",                 "duration_sec": 90, "cue": "Slow round and arch with the breath."},
            {"name": "Bird-Dog (R)",            "duration_sec": 45, "cue": "Right arm + left leg, extend & hold."},
            {"name": "Bird-Dog (L)",            "duration_sec": 45, "cue": "Switch sides."},
            {"name": "Sphinx",                  "duration_sec": 60, "cue": "Forearms down, gentle backbend."},
            {"name": "Child's Pose",            "duration_sec": 60, "cue": "Knees wide, sit hips back."},
            {"name": "Setu Bandha (Bridge)",    "duration_sec": 60, "cue": "Feet parallel, lift hips, chest to chin."},
            {"name": "Happy Baby",              "duration_sec": 45, "cue": "Grip outer feet, rock side to side."},
            {"name": "Savasana",                "duration_sec": 150, "cue": "Full relaxation, palms up."},
        ],
    },
    {
        "id": "pcos-hormonal-30",
        "title": "PCOS & Hormonal Balance",
        "category": "Women",
        "level": "Intermediate",
        "duration_min": 30,
        "dosha_target": ["Kapha", "Pitta"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=CLc8AwaKCyk",
        "youtube_id": "CLc8AwaKCyk",
        "thumbnail": "https://images.pexels.com/photos/6787207/pexels-photo-6787207.jpeg",
        "instructor": "Yoga With Bird",
        "benefits": [
            "Massages ovaries + boosts pelvic circulation",
            "Supports endocrine (thyroid, adrenals) balance",
            "Calms the nervous system + insulin sensitivity",
        ],
        "poses": [
            {"name": "Nadi Shodhana",       "duration_sec": 180, "cue": "Alternate-nostril breath. 3 minutes."},
            {"name": "Cat-Cow",             "duration_sec": 60, "cue": "Warm-up the spine."},
            {"name": "Butterfly (Baddha Konasana)", "duration_sec": 90, "cue": "Soles together, gently press knees down."},
            {"name": "Setu Bandhasana",     "duration_sec": 60, "cue": "Bridge pose. Lift, roll shoulders in."},
            {"name": "Supta Baddha Konasana","duration_sec": 90, "cue": "Reclined butterfly, palms on belly."},
            {"name": "Malasana (Garland)",  "duration_sec": 90, "cue": "Deep squat, hands in prayer, elbows press knees."},
            {"name": "Marjari Twist",       "duration_sec": 60, "cue": "Thread the needle, both sides."},
            {"name": "Ustrasana (Camel)",   "duration_sec": 45, "cue": "Hands to sacrum, gentle backbend."},
            {"name": "Viparita Karani",     "duration_sec": 180, "cue": "Legs up the wall. Total surrender."},
            {"name": "Bhramari",            "duration_sec": 120, "cue": "Humming bee breath. 8 rounds."},
            {"name": "Savasana",            "duration_sec": 180, "cue": "Rest deeply."},
        ],
    },
    {
        "id": "stress-melter-nidra-15",
        "title": "Stress-melter Yoga Nidra",
        "category": "Sleep",
        "level": "Beginner",
        "duration_min": 15,
        "dosha_target": ["Vata", "Pitta"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=M0u9GST_j8U",
        "youtube_id": "M0u9GST_j8U",
        "thumbnail": "https://images.pexels.com/photos/3822730/pexels-photo-3822730.jpeg",
        "instructor": "Ally Boothroyd",
        "benefits": [
            "Down-regulates the sympathetic nervous system",
            "Improves deep sleep quality",
            "Restores adrenal capacity",
        ],
        "poses": [
            {"name": "Settling",       "duration_sec": 120, "cue": "Lie flat. Bolster under knees if you have one."},
            {"name": "Body scan",      "duration_sec": 300, "cue": "Sweep awareness slowly toe-to-crown."},
            {"name": "Breath awareness","duration_sec": 180, "cue": "Count breaths from 27 down to 1."},
            {"name": "Sankalpa",       "duration_sec": 60, "cue": "Silently affirm your intention 3 times."},
            {"name": "Return",         "duration_sec": 240, "cue": "Wiggle fingers/toes. Sit slowly."},
        ],
    },
    {
        "id": "detox-twist-20",
        "title": "Kapha-crushing Detox Twists",
        "category": "Detox",
        "level": "Intermediate",
        "duration_min": 20,
        "dosha_target": ["Kapha"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=b1H3xO3x_Js",
        "youtube_id": "b1H3xO3x_Js",
        "thumbnail": "https://images.pexels.com/photos/3822455/pexels-photo-3822455.jpeg",
        "instructor": "Yoga With Adriene",
        "benefits": [
            "Fires up metabolism and lymph flow",
            "Wrings out abdominal organs (agni support)",
            "Lifts sluggish energy",
        ],
        "poses": [
            {"name": "Kapalabhati",    "duration_sec": 120, "cue": "Skull-shining breath. 2 rounds of 30."},
            {"name": "Sun A x3",       "duration_sec": 240, "cue": "Move fast to warm the body."},
            {"name": "Revolved Chair", "duration_sec": 60, "cue": "Chair pose, twist right. Then left."},
            {"name": "Warrior II → Side Angle (R)", "duration_sec": 90, "cue": "Bind if you can. Deep breath."},
            {"name": "Warrior II → Side Angle (L)", "duration_sec": 90, "cue": "Repeat on the left."},
            {"name": "Ardha Matsyendrasana",       "duration_sec": 60, "cue": "Seated spinal twist, both sides."},
            {"name": "Bhujangasana",   "duration_sec": 45, "cue": "Cobra, lift chest without shoulders climbing."},
            {"name": "Savasana",       "duration_sec": 120, "cue": "Rest."},
        ],
    },
    {
        "id": "pitta-cooling-25",
        "title": "Cooling Pitta Flow",
        "category": "Cooling",
        "level": "Beginner",
        "duration_min": 25,
        "dosha_target": ["Pitta"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=Eml2xnoLpYE",
        "youtube_id": "Eml2xnoLpYE",
        "thumbnail": "https://images.pexels.com/photos/6787352/pexels-photo-6787352.jpeg",
        "instructor": "Yoga With Adriene",
        "benefits": [
            "Cools mental heat, irritability & inflammation",
            "Soft moon-salutation style — no competition",
            "Calms burnout / high achievers",
        ],
        "poses": [
            {"name": "Sheetali Pranayama","duration_sec": 180, "cue": "Curl tongue, inhale cool, exhale nose."},
            {"name": "Moon Salutation A", "duration_sec": 240, "cue": "Half moon, side lunge, goddess. Both sides."},
            {"name": "Uttanpadasana",     "duration_sec": 60, "cue": "Legs up 45°, activate belly."},
            {"name": "Halasana",          "duration_sec": 60, "cue": "Plough pose. Feet behind head or a chair."},
            {"name": "Karnapidasana",     "duration_sec": 45, "cue": "Knees to ears. Only if halasana feels ok."},
            {"name": "Matsyasana",        "duration_sec": 60, "cue": "Fish. Open the heart, chin up gently."},
            {"name": "Bhramari",          "duration_sec": 120, "cue": "Bee breath. 12 rounds."},
            {"name": "Savasana",          "duration_sec": 180, "cue": "Cover eyes if bright. Long rest."},
        ],
    },
    {
        "id": "quick-desk-10",
        "title": "10-min Desk Reset",
        "category": "Quick",
        "level": "Beginner",
        "duration_min": 10,
        "dosha_target": ["Vata", "Kapha"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=tAUf7aajBWE",
        "youtube_id": "tAUf7aajBWE",
        "thumbnail": "https://images.pexels.com/photos/4498135/pexels-photo-4498135.jpeg",
        "instructor": "Yoga With Adriene",
        "benefits": [
            "Un-crunches shoulders + neck",
            "Opens hip flexors from sitting",
            "Boosts alertness without caffeine",
        ],
        "poses": [
            {"name": "Neck rolls",      "duration_sec": 45, "cue": "Slow, both directions."},
            {"name": "Shoulder rolls",  "duration_sec": 45, "cue": "Big circles, forward then back."},
            {"name": "Seated twist",    "duration_sec": 45, "cue": "Right hand behind, left across, twist."},
            {"name": "Standing forward fold", "duration_sec": 60, "cue": "Bend knees, ragdoll."},
            {"name": "Lunge (R)",       "duration_sec": 60, "cue": "Sink into the right hip flexor."},
            {"name": "Lunge (L)",       "duration_sec": 60, "cue": "Switch sides."},
            {"name": "Wall chest opener","duration_sec": 45, "cue": "Palm on wall, rotate away."},
            {"name": "3 deep breaths",  "duration_sec": 60, "cue": "Inhale possibility, exhale tension."},
        ],
    },
    {
        "id": "pranayama-basics-15",
        "title": "Pranayama Basics",
        "category": "Breath",
        "level": "Beginner",
        "duration_min": 15,
        "dosha_target": ["Vata", "Pitta", "Kapha"],
        "language": "English",
        "premium": False,
        "video_url": "https://www.youtube.com/watch?v=OXjlR4mXxSk",
        "youtube_id": "OXjlR4mXxSk",
        "thumbnail": "https://images.pexels.com/photos/3822166/pexels-photo-3822166.jpeg",
        "instructor": "Michael Bijker",
        "benefits": [
            "Balances all three doshas via breath ratios",
            "Regulates heart-rate variability",
            "Foundation for meditation practice",
        ],
        "poses": [
            {"name": "Comfortable seat", "duration_sec": 60, "cue": "Sukhasana or vajrasana."},
            {"name": "Diaphragmatic breath","duration_sec": 180, "cue": "Hand on belly, hand on chest. Belly rises first."},
            {"name": "Ujjayi",           "duration_sec": 180, "cue": "Ocean sound, subtle throat constriction."},
            {"name": "Nadi Shodhana",    "duration_sec": 240, "cue": "Alternate nostril: 4 in / 4 out."},
            {"name": "Bhramari",         "duration_sec": 180, "cue": "Humming exhale. 12 rounds."},
            {"name": "Silent sit",       "duration_sec": 120, "cue": "Watch the natural breath."},
        ],
    },
]


def _yoga_summary(item: dict) -> dict:
    """Return the light-weight card shape (no pose sequence)."""
    return {
        "id": item["id"],
        "title": item["title"],
        "category": item["category"],
        "level": item["level"],
        "duration_min": item["duration_min"],
        "dosha_target": item["dosha_target"],
        "language": item["language"],
        "premium": item["premium"],
        "thumbnail": item["thumbnail"],
        "instructor": item["instructor"],
    }


@api_router.get("/yoga/library")
async def yoga_library(
    category: Optional[str] = None,
    dosha: Optional[str] = None,
    level: Optional[str] = None,
    user: dict = Depends(current_user),
):
    """List curated yoga sessions with optional category/dosha/level filters.

    If the caller is a patient with a saved dosha and no `dosha` filter is
    passed, the response also includes a `recommended` array sorted so the
    dosha-matched sessions come first.
    """
    items = list(YOGA_LIBRARY)
    if category:
        items = [i for i in items if i["category"].lower() == category.lower()]
    if dosha:
        d = dosha.lower()
        items = [i for i in items if any(t.lower() == d for t in i["dosha_target"])]
    if level:
        items = [i for i in items if i["level"].lower() == level.lower()]

    saved_dosha = None
    if user.get("role") == "patient":
        prof = await db.patient_profiles.find_one({"user_id": user["id"]}, {"_id": 0, "dosha": 1}) or {}
        saved_dosha = (prof.get("dosha") or "").split("-")[0].strip() or None  # take the dominant

    all_summaries = [_yoga_summary(i) for i in items]
    categories = sorted({i["category"] for i in YOGA_LIBRARY})
    recommended: list = []
    if saved_dosha and not dosha:
        matched = [s for s in all_summaries if saved_dosha in [d for d in _yoga_by_id(s["id"])["dosha_target"]]]
        recommended = matched[:6]

    return {
        "items": all_summaries,
        "categories": ["All"] + categories,
        "levels": ["Beginner", "Intermediate", "Advanced"],
        "recommended": recommended,
        "dosha": saved_dosha,
        "total": len(all_summaries),
    }


def _yoga_by_id(sid: str) -> Optional[dict]:
    for i in YOGA_LIBRARY:
        if i["id"] == sid:
            return i
    return None


@api_router.get("/yoga/sessions/{session_id}")
async def yoga_session_detail(session_id: str, user: dict = Depends(current_user)):
    item = _yoga_by_id(session_id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    return item  # full payload including poses


class YogaCompletionInput(BaseModel):
    session_id: str
    completed_seconds: int = 0
    total_seconds: int = 0
    completed_poses: int = 0


@api_router.post("/yoga/log")
async def log_yoga_session(body: YogaCompletionInput, user: dict = Depends(current_user)):
    item = _yoga_by_id(body.session_id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "session_id": body.session_id,
        "session_title": item["title"],
        "category": item["category"],
        "duration_min": item["duration_min"],
        "completed_seconds": max(0, int(body.completed_seconds)),
        "total_seconds": max(0, int(body.total_seconds)),
        "completed_poses": max(0, int(body.completed_poses)),
        "logged_at": now_iso(),
    }
    await db.yoga_sessions.insert_one(entry)
    entry.pop("_id", None)
    await log_activity("yoga_session_logged", actor=user, meta={"session_id": body.session_id})
    return entry


@api_router.get("/yoga/mine")
async def my_yoga_sessions(user: dict = Depends(current_user)):
    """Return a lightweight streak + total-minutes stat plus the last 20 sessions."""
    items = await db.yoga_sessions.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("logged_at", -1).to_list(50)

    # Compute streak from unique days ending today (UTC)
    days = sorted({str(s["logged_at"])[:10] for s in items}, reverse=True)
    streak = 0
    now = datetime.now(timezone.utc).date()
    for i, d in enumerate(days):
        try:
            day = datetime.fromisoformat(d).date()
        except Exception:
            continue
        expected = now - timedelta(days=i)
        if day == expected:
            streak += 1
        else:
            break

    total_min = sum(int(s.get("completed_seconds", 0)) // 60 for s in items)

    return {
        "sessions": items[:20],
        "streak_days": streak,
        "total_minutes": total_min,
        "total_sessions": len(items),
    }


# ----------------- End new features -----------------


# ----------------- Wellness Dashboard (BMI, Weight, Sleep, Steps, BP, Sugar, Mood) -----------------
WELLNESS_TYPES = {
    "bmi", "weight", "sleep", "steps", "bp", "sugar", "mood", "water"
}


class WellnessLogInput(BaseModel):
    type: Literal["bmi", "weight", "sleep", "steps", "bp", "sugar", "mood", "water"]
    # Flexible numeric payload — depends on type
    value: Optional[float] = None            # weight kg, sleep hrs, steps count, mood 1-5, water glasses
    systolic: Optional[int] = None           # for bp
    diastolic: Optional[int] = None          # for bp
    fasting: Optional[int] = None            # for sugar (mg/dL)
    post_meal: Optional[int] = None          # for sugar (mg/dL)
    height_cm: Optional[float] = None        # for bmi
    weight_kg: Optional[float] = None        # for bmi
    note: Optional[str] = None
    date: Optional[str] = None               # ISO date (defaults to today)
    member_id: Optional[str] = None          # optional family member scope


def _wellness_today() -> str:
    return datetime.utcnow().date().isoformat()


@api_router.post("/wellness/log")
async def wellness_log(body: WellnessLogInput, user: dict = Depends(current_user)):
    log_date = body.date or _wellness_today()
    doc: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "member_id": body.member_id,
        "type": body.type,
        "date": log_date,
        "created_at": now_iso(),
        "note": body.note,
    }
    # Compute derived fields
    if body.type == "bmi":
        if not body.height_cm or not body.weight_kg or body.height_cm <= 0:
            raise HTTPException(status_code=400, detail="height_cm and weight_kg required for BMI")
        h_m = body.height_cm / 100.0
        bmi = round(body.weight_kg / (h_m * h_m), 1)
        doc["height_cm"] = body.height_cm
        doc["weight_kg"] = body.weight_kg
        doc["value"] = bmi
        doc["category"] = (
            "Underweight" if bmi < 18.5 else
            "Normal" if bmi < 25 else
            "Overweight" if bmi < 30 else
            "Obese"
        )
    elif body.type == "bp":
        if not body.systolic or not body.diastolic:
            raise HTTPException(status_code=400, detail="systolic and diastolic required for BP")
        doc["systolic"] = body.systolic
        doc["diastolic"] = body.diastolic
        doc["value"] = body.systolic  # primary for chart
        s, d = body.systolic, body.diastolic
        if s < 120 and d < 80:
            doc["category"] = "Normal"
        elif s < 130 and d < 80:
            doc["category"] = "Elevated"
        elif s < 140 or d < 90:
            doc["category"] = "Stage 1"
        else:
            doc["category"] = "Stage 2"
    elif body.type == "sugar":
        if body.fasting is None and body.post_meal is None:
            raise HTTPException(status_code=400, detail="fasting or post_meal required for sugar")
        doc["fasting"] = body.fasting
        doc["post_meal"] = body.post_meal
        doc["value"] = body.fasting or body.post_meal
        if body.fasting:
            if body.fasting < 100:
                doc["category"] = "Normal"
            elif body.fasting < 126:
                doc["category"] = "Pre-diabetic"
            else:
                doc["category"] = "Diabetic"
    else:
        if body.value is None:
            raise HTTPException(status_code=400, detail="value required")
        doc["value"] = body.value

    await db.wellness_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/wellness/history")
async def wellness_history(
    type: Optional[str] = None,
    days: int = 30,
    member_id: Optional[str] = None,
    user: dict = Depends(current_user),
):
    days = min(max(days, 1), 365)
    since = (datetime.utcnow().date() - timedelta(days=days)).isoformat()
    q: Dict[str, Any] = {"user_id": user["id"], "date": {"$gte": since}}
    if type:
        q["type"] = type
    if member_id:
        q["member_id"] = member_id
    else:
        # By default only user's own logs (no member scope)
        q["member_id"] = None
    items = await db.wellness_logs.find(q).sort("date", -1).to_list(500)
    for i in items:
        i.pop("_id", None)
    return {"items": items, "days": days}


@api_router.get("/wellness/dashboard")
async def wellness_dashboard(member_id: Optional[str] = None, user: dict = Depends(current_user)):
    """Return the latest reading for each metric + basic trends."""
    q_scope: Dict[str, Any] = {"user_id": user["id"], "member_id": member_id}
    result: Dict[str, Any] = {}
    for t in ["bmi", "weight", "sleep", "steps", "bp", "sugar", "mood", "water"]:
        last = await db.wellness_logs.find_one({**q_scope, "type": t}, sort=[("date", -1), ("created_at", -1)])
        if last:
            last.pop("_id", None)
            result[t] = last
        else:
            result[t] = None

    # Weekly aggregates for main metrics (last 7 days)
    since = (datetime.utcnow().date() - timedelta(days=7)).isoformat()
    weekly: Dict[str, List[Dict[str, Any]]] = {}
    for t in ["weight", "sleep", "steps", "water"]:
        items = await db.wellness_logs.find(
            {**q_scope, "type": t, "date": {"$gte": since}}
        ).sort("date", 1).to_list(200)
        weekly[t] = [{"date": i["date"], "value": i.get("value")} for i in items]

    # Compute a naive health score (0-100) from available metrics
    score = 50
    if result.get("water") and (result["water"].get("value") or 0) >= 8:
        score += 10
    if result.get("sleep") and 6.5 <= (result["sleep"].get("value") or 0) <= 8.5:
        score += 10
    if result.get("steps") and (result["steps"].get("value") or 0) >= 6000:
        score += 10
    if result.get("bmi") and result["bmi"].get("category") == "Normal":
        score += 10
    if result.get("bp") and result["bp"].get("category") == "Normal":
        score += 10
    score = min(score, 100)

    return {"latest": result, "weekly": weekly, "health_score": score}


@api_router.delete("/wellness/log/{log_id}")
async def wellness_delete(log_id: str, user: dict = Depends(current_user)):
    res = await db.wellness_logs.delete_one({"id": log_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Log not found")
    return {"deleted": True}


# ----------------- Family Health (multiple member profiles) -----------------
class FamilyMemberInput(BaseModel):
    name: str
    relation: str  # e.g. Spouse, Child, Parent, Sibling
    gender: Optional[str] = None
    dob: Optional[str] = None            # ISO date
    blood_group: Optional[str] = None
    conditions: List[str] = []
    allergies: List[str] = []
    avatar_url: Optional[str] = None


class GrowthEntry(BaseModel):
    date: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    head_circ_cm: Optional[float] = None
    note: Optional[str] = None


class VaccinationEntry(BaseModel):
    vaccine: str
    scheduled_date: Optional[str] = None
    given_date: Optional[str] = None
    dose: Optional[str] = None
    notes: Optional[str] = None


def _member_dict(body: FamilyMemberInput) -> Dict[str, Any]:
    return {
        "name": body.name,
        "relation": body.relation,
        "gender": body.gender,
        "dob": body.dob,
        "blood_group": body.blood_group,
        "conditions": body.conditions,
        "allergies": body.allergies,
        "avatar_url": body.avatar_url,
    }


@api_router.post("/family/members")
async def add_family_member(body: FamilyMemberInput, user: dict = Depends(current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        **_member_dict(body),
        "growth": [],
        "vaccinations": [],
        "created_at": now_iso(),
    }
    await db.family_members.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/family/members")
async def list_family_members(user: dict = Depends(current_user)):
    items = await db.family_members.find({"user_id": user["id"]}).sort("created_at", 1).to_list(50)
    for i in items:
        i.pop("_id", None)
    return {"items": items}


@api_router.get("/family/members/{member_id}")
async def get_family_member(member_id: str, user: dict = Depends(current_user)):
    m = await db.family_members.find_one({"id": member_id, "user_id": user["id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    m.pop("_id", None)
    return m


@api_router.put("/family/members/{member_id}")
async def update_family_member(member_id: str, body: FamilyMemberInput, user: dict = Depends(current_user)):
    res = await db.family_members.update_one(
        {"id": member_id, "user_id": user["id"]},
        {"$set": _member_dict(body)},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"updated": True}


@api_router.delete("/family/members/{member_id}")
async def delete_family_member(member_id: str, user: dict = Depends(current_user)):
    res = await db.family_members.delete_one({"id": member_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"deleted": True}


@api_router.post("/family/members/{member_id}/growth")
async def add_growth_entry(member_id: str, body: GrowthEntry, user: dict = Depends(current_user)):
    m = await db.family_members.find_one({"id": member_id, "user_id": user["id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    entry = {
        "id": str(uuid.uuid4()),
        "date": body.date or _wellness_today(),
        "height_cm": body.height_cm,
        "weight_kg": body.weight_kg,
        "head_circ_cm": body.head_circ_cm,
        "note": body.note,
    }
    # Compute BMI if both available
    if body.height_cm and body.weight_kg and body.height_cm > 0:
        h_m = body.height_cm / 100.0
        entry["bmi"] = round(body.weight_kg / (h_m * h_m), 1)
    await db.family_members.update_one(
        {"id": member_id, "user_id": user["id"]},
        {"$push": {"growth": entry}},
    )
    return entry


@api_router.post("/family/members/{member_id}/vaccination")
async def add_vaccination_entry(member_id: str, body: VaccinationEntry, user: dict = Depends(current_user)):
    m = await db.family_members.find_one({"id": member_id, "user_id": user["id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    entry = {
        "id": str(uuid.uuid4()),
        "vaccine": body.vaccine,
        "scheduled_date": body.scheduled_date,
        "given_date": body.given_date,
        "dose": body.dose,
        "notes": body.notes,
        "created_at": now_iso(),
    }
    await db.family_members.update_one(
        {"id": member_id, "user_id": user["id"]},
        {"$push": {"vaccinations": entry}},
    )
    return entry


@api_router.delete("/family/members/{member_id}/vaccination/{entry_id}")
async def delete_vaccination_entry(member_id: str, entry_id: str, user: dict = Depends(current_user)):
    await db.family_members.update_one(
        {"id": member_id, "user_id": user["id"]},
        {"$pull": {"vaccinations": {"id": entry_id}}},
    )
    return {"deleted": True}


@api_router.delete("/family/members/{member_id}/growth/{entry_id}")
async def delete_growth_entry(member_id: str, entry_id: str, user: dict = Depends(current_user)):
    await db.family_members.update_one(
        {"id": member_id, "user_id": user["id"]},
        {"$pull": {"growth": {"id": entry_id}}},
    )
    return {"deleted": True}


# ----------------- Child Developmental Milestones (age-based checklist) -----------------
CHILD_MILESTONES = [
    {"age_months": 2, "items": ["Smiles at people", "Coos", "Follows objects with eyes", "Holds head up briefly"]},
    {"age_months": 4, "items": ["Laughs out loud", "Reaches for toys", "Holds head steady", "Rolls tummy to back"]},
    {"age_months": 6, "items": ["Sits with support", "Recognises familiar faces", "Babbles (baba, mama)", "Passes objects hand-to-hand"]},
    {"age_months": 9, "items": ["Sits without support", "Crawls", "Waves bye-bye", "Responds to own name"]},
    {"age_months": 12, "items": ["Stands with support", "Says 1-2 words", "Waves & claps", "Uses pincer grasp (thumb+finger)"]},
    {"age_months": 18, "items": ["Walks alone", "Says 6-10 words", "Points to show interest", "Drinks from a cup"]},
    {"age_months": 24, "items": ["Runs", "2-word sentences", "Points to body parts", "Follows simple instructions"]},
    {"age_months": 36, "items": ["Rides a tricycle", "3-word sentences", "Names colours", "Plays with other children"]},
    {"age_months": 60, "items": ["Draws a person (3+ parts)", "Counts to 10", "Tells stories", "Dresses without help"]},
]


@api_router.get("/family/members/{member_id}/milestones")
async def get_milestones(member_id: str, user: dict = Depends(current_user)):
    m = await db.family_members.find_one({"id": member_id, "user_id": user["id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    # Compute age in months from DOB
    age_months = None
    if m.get("dob"):
        try:
            dob = datetime.fromisoformat(m["dob"]).date()
            today = datetime.utcnow().date()
            age_months = (today.year - dob.year) * 12 + (today.month - dob.month)
        except Exception:
            pass
    achieved = set(m.get("milestones_done", []))
    groups = []
    for g in CHILD_MILESTONES:
        applicable = age_months is None or age_months >= g["age_months"] - 3
        groups.append({
            "age_months": g["age_months"],
            "age_label": (f"{g['age_months']} mo" if g["age_months"] < 24 else f"{g['age_months']//12} yr"),
            "applicable": applicable,
            "items": [{"text": it, "done": it in achieved} for it in g["items"]],
        })
    return {"age_months": age_months, "groups": groups}


class MilestoneToggle(BaseModel):
    text: str = Field(..., min_length=1, max_length=200)
    done: bool


@api_router.post("/family/members/{member_id}/milestones/toggle")
async def toggle_milestone(member_id: str, body: MilestoneToggle, request: Request, user: dict = Depends(current_user)):
    await rate_limit(request, f"family:mile:{user['id']}", max_calls=120, window_seconds=3600)
    m = await db.family_members.find_one({"id": member_id, "user_id": user["id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    op = {"$addToSet": {"milestones_done": body.text}} if body.done else {"$pull": {"milestones_done": body.text}}
    await db.family_members.update_one({"id": member_id, "user_id": user["id"]}, op)
    return {"ok": True}


# ----------------- Women's Health -----------------
class PeriodLogInput(BaseModel):
    start_date: str = Field(..., max_length=40)      # ISO date YYYY-MM-DD
    end_date: Optional[str] = Field(None, max_length=40)
    cycle_length: Optional[int] = Field(28, ge=15, le=60)
    flow: Optional[Literal["light", "normal", "heavy"]] = "normal"
    symptoms: List[str] = []
    mood: Optional[Literal["happy", "calm", "anxious", "sad", "irritable"]] = None
    notes: Optional[str] = Field(None, max_length=1000)


class PregnancyInput(BaseModel):
    is_active: bool
    lmp_date: Optional[str] = Field(None, max_length=40)  # last menstrual period
    notes: Optional[str] = Field(None, max_length=1000)


class GynaeProfileInput(BaseModel):
    pcos: bool = False
    pcod: bool = False
    conditions: List[str] = []
    surgeries: List[str] = []
    medications: List[str] = []
    notes: Optional[str] = Field(None, max_length=2000)


PREGNANCY_MILESTONES = [
    (4,  "Heart begins to form. Take folic acid 400mcg daily."),
    (8,  "Baby is the size of a raspberry. Morning sickness may peak."),
    (12, "First trimester ends! Miscarriage risk drops significantly."),
    (16, "You may feel first tiny movements (quickening)."),
    (20, "Anatomy scan — baby's organs are visible on ultrasound."),
    (24, "Baby can hear your voice. Talk & sing to your bump."),
    (28, "Third trimester begins. Track kick counts daily."),
    (32, "Baby's brain developing rapidly. Rest well."),
    (36, "Baby is nearly full-term. Prepare hospital bag."),
    (40, "Due date! Baby ready for the world."),
]


def _weeks_from(iso_date: str) -> int:
    try:
        d = datetime.fromisoformat(iso_date).date()
        return max(0, (datetime.utcnow().date() - d).days // 7)
    except Exception:
        return 0


@api_router.post("/women/period-log")
async def log_period(body: PeriodLogInput, request: Request, user: dict = Depends(current_user)):
    # Cap cycle inserts per user to prevent unbounded storage growth
    await rate_limit(request, f"women:period:{user['id']}", max_calls=20, window_seconds=3600)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "start_date": body.start_date,
        "end_date": body.end_date,
        "cycle_length": body.cycle_length,
        "flow": body.flow,
        "symptoms": body.symptoms,
        "mood": body.mood,
        "notes": body.notes,
        "created_at": now_iso(),
    }
    await db.women_cycles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/women/cycles")
async def list_cycles(limit: int = 12, user: dict = Depends(current_user)):
    limit = min(max(limit, 1), 50)
    items = await db.women_cycles.find({"user_id": user["id"]}).sort("start_date", -1).to_list(limit)
    for i in items:
        i.pop("_id", None)
    # Predict next period based on latest cycle
    next_predicted = None
    fertile_window = None
    if items:
        latest = items[0]
        try:
            start = datetime.fromisoformat(latest["start_date"]).date()
            length = int(latest.get("cycle_length") or 28)
            next_predicted = (start + timedelta(days=length)).isoformat()
            # Fertile window: roughly day 10-16 of next cycle (approx)
            ov = start + timedelta(days=length - 14)
            fertile_window = {
                "start": (ov - timedelta(days=3)).isoformat(),
                "end": (ov + timedelta(days=1)).isoformat(),
            }
        except Exception:
            pass
    return {"cycles": items, "next_period_predicted": next_predicted, "fertile_window": fertile_window}


@api_router.delete("/women/period-log/{log_id}")
async def delete_period(log_id: str, user: dict = Depends(current_user)):
    res = await db.women_cycles.delete_one({"id": log_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


@api_router.put("/women/pregnancy")
async def set_pregnancy(body: PregnancyInput, request: Request, user: dict = Depends(current_user)):
    await rate_limit(request, f"women:preg:{user['id']}", max_calls=30, window_seconds=3600)
    doc = {
        "user_id": user["id"],
        "is_active": body.is_active,
        "lmp_date": body.lmp_date,
        "notes": body.notes,
        "updated_at": now_iso(),
    }
    await db.women_pregnancy.update_one(
        {"user_id": user["id"]}, {"$set": doc}, upsert=True,
    )
    return {"ok": True, **doc}


@api_router.get("/women/pregnancy")
async def get_pregnancy(user: dict = Depends(current_user)):
    p = await db.women_pregnancy.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    if not p.get("is_active") or not p.get("lmp_date"):
        return {"is_active": False}
    weeks = _weeks_from(p["lmp_date"])
    due_date = None
    try:
        lmp = datetime.fromisoformat(p["lmp_date"]).date()
        due_date = (lmp + timedelta(days=280)).isoformat()
    except Exception:
        pass
    # Latest milestone applicable
    current_milestone = None
    for wk, msg in PREGNANCY_MILESTONES:
        if weeks >= wk:
            current_milestone = {"week": wk, "message": msg}
    return {
        **p,
        "weeks": weeks,
        "due_date": due_date,
        "current_milestone": current_milestone,
        "milestones": [{"week": w, "message": m, "reached": weeks >= w} for w, m in PREGNANCY_MILESTONES],
    }


@api_router.put("/women/gynae-profile")
async def upsert_gynae(body: GynaeProfileInput, request: Request, user: dict = Depends(current_user)):
    await rate_limit(request, f"women:gynae:{user['id']}", max_calls=30, window_seconds=3600)
    doc = body.dict()
    doc.update({"user_id": user["id"], "updated_at": now_iso()})
    await db.women_gynae.update_one({"user_id": user["id"]}, {"$set": doc}, upsert=True)
    return doc


@api_router.get("/women/gynae-profile")
async def get_gynae(user: dict = Depends(current_user)):
    p = await db.women_gynae.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    return p


@api_router.get("/women/wellness-tips")
async def wellness_tips(phase: str = "follicular", request: Request = None):
    # Light IP-level throttle on this public endpoint
    if request is not None:
        await rate_limit(request, "women:tips", max_calls=60, window_seconds=300)
    tips_by_phase = {
        "menstrual": [
            "Warm sesame oil abhyanga for cramps. Sip ginger-jaggery tea.",
            "Restorative yoga: child's pose, supported bridge. Skip strong inversions.",
            "Iron-rich foods: dates, beetroot, sesame, spinach, jaggery.",
        ],
        "follicular": [
            "Energy is rising — good time for new routines and workouts.",
            "Include ghee, almonds and dates for ojas (vitality).",
            "Pranayama: Anulom-Vilom for hormonal balance.",
        ],
        "ovulation": [
            "Peak energy — light meals, cooling foods (coconut water, cucumber).",
            "Shatavari + warm milk for reproductive tonic (consult Vaidya).",
            "Moderate cardio + yoga; avoid excess spice.",
        ],
        "luteal": [
            "Nurture yourself — magnesium-rich foods (pumpkin seeds, cacao).",
            "Skip heavy exercise; do gentle yin yoga & meditation.",
            "Reduce caffeine & salt to ease PMS symptoms.",
        ],
        "pregnancy": [
            "Daily Garbhini pranayama (gentle deep breathing) for baby's wellbeing.",
            "Ojas-building foods: ghee, milk, almonds, dates. Avoid papaya & pineapple.",
            "Prenatal yoga: cat-cow, seated twists, gentle squats.",
        ],
        "pcos": [
            "Cinnamon + fenugreek water helps insulin sensitivity.",
            "Surya Namaskar 12 rounds daily — great for PCOS.",
            "Avoid dairy, refined sugar; favour warm cooked meals.",
        ],
    }
    return {"phase": phase, "tips": tips_by_phase.get(phase, tips_by_phase["follicular"])}


# ----------------- Community Feed -----------------
class CommunityPostInput(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    hashtags: List[str] = []
    image_base64: Optional[str] = Field(None, max_length=4_000_000)
    is_question: bool = False


class CommunityCommentInput(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)


async def _author_snapshot(user: dict) -> Dict[str, Any]:
    """Small stable snapshot for display (name + role + verified badge)."""
    role = user.get("role", "patient")
    verified = False
    avatar = None
    if role == "doctor":
        d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0, "verified": 1, "avatar_url": 1, "specialty": 1})
        verified = bool(d and d.get("verified"))
        avatar = (d or {}).get("avatar_url")
    if user.get("is_admin"):
        verified = True  # official account
    return {
        "id": user["id"],
        "name": user.get("name") or "User",
        "role": "admin" if user.get("is_admin") else role,
        "verified": verified,
        "avatar_url": avatar,
    }


@api_router.post("/community/posts")
async def create_post(body: CommunityPostInput, request: Request, user: dict = Depends(current_user)):
    # Rate limit: 10 posts per user per hour
    await rate_limit(request, f"community:post:{user['id']}", max_calls=10, window_seconds=3600)
    tags = [t.strip().lower().lstrip("#") for t in body.hashtags if t.strip()][:8]
    doc = {
        "id": str(uuid.uuid4()),
        "author": await _author_snapshot(user),
        "content": body.content,
        "hashtags": tags,
        "image_base64": body.image_base64,
        "is_question": body.is_question,
        "like_count": 0,
        "comment_count": 0,
        "created_at": now_iso(),
    }
    await db.community_posts.insert_one(doc)
    doc.pop("_id", None)
    await log_activity("community_post", actor=user, meta={"post_id": doc["id"], "is_question": body.is_question})
    return doc


@api_router.get("/community/posts")
async def list_posts(hashtag: Optional[str] = None, is_question: Optional[bool] = None,
                     limit: int = 20, before: Optional[str] = None,
                     user: dict = Depends(current_user)):
    limit = min(max(limit, 1), 50)
    q: Dict[str, Any] = {}
    if hashtag:
        q["hashtags"] = hashtag.lower().lstrip("#")
    if is_question is not None:
        q["is_question"] = is_question
    if before:
        q["created_at"] = {"$lt": before}
    items = await db.community_posts.find(q, {"image_base64": 0}).sort("created_at", -1).to_list(limit)
    # Mark liked_by_me
    my_likes = await db.community_likes.find({"user_id": user["id"]}, {"_id": 0, "post_id": 1}).to_list(500)
    liked_set = {r["post_id"] for r in my_likes}
    for it in items:
        it.pop("_id", None)
        it["liked_by_me"] = it["id"] in liked_set
    return {"items": items}


@api_router.get("/community/posts/{post_id}")
async def get_post(post_id: str, user: dict = Depends(current_user)):
    p = await db.community_posts.find_one({"id": post_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    p["liked_by_me"] = bool(await db.community_likes.find_one({"post_id": post_id, "user_id": user["id"]}))
    return p


@api_router.post("/community/posts/{post_id}/like")
async def toggle_like(post_id: str, user: dict = Depends(current_user)):
    # 404 if the post does not exist — prevents orphan likes / counter drift on stale IDs.
    exists = await db.community_posts.find_one({"id": post_id}, {"_id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Post not found")
    existing = await db.community_likes.find_one({"post_id": post_id, "user_id": user["id"]})
    if existing:
        res = await db.community_likes.delete_one({"post_id": post_id, "user_id": user["id"]})
        # Only decrement if we actually deleted (race-safe)
        if res.deleted_count:
            await db.community_posts.update_one({"id": post_id}, {"$inc": {"like_count": -1}})
        return {"liked": False}
    # Insert-then-inc; ignore duplicate insert if a concurrent tap already inserted
    try:
        await db.community_likes.insert_one({"post_id": post_id, "user_id": user["id"], "created_at": now_iso()})
        await db.community_posts.update_one({"id": post_id}, {"$inc": {"like_count": 1}})
    except Exception:
        pass
    return {"liked": True}


@api_router.post("/community/posts/{post_id}/comments")
async def add_comment(post_id: str, body: CommunityCommentInput, request: Request, user: dict = Depends(current_user)):
    await rate_limit(request, f"community:comment:{user['id']}", max_calls=30, window_seconds=3600)
    p = await db.community_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    doc = {
        "id": str(uuid.uuid4()),
        "post_id": post_id,
        "author": await _author_snapshot(user),
        "text": body.text,
        "created_at": now_iso(),
    }
    await db.community_comments.insert_one(doc)
    await db.community_posts.update_one({"id": post_id}, {"$inc": {"comment_count": 1}})
    doc.pop("_id", None)
    return doc


@api_router.get("/community/posts/{post_id}/comments")
async def list_comments(post_id: str, user: dict = Depends(current_user)):
    items = await db.community_comments.find({"post_id": post_id}).sort("created_at", 1).to_list(200)
    for i in items:
        i.pop("_id", None)
    return {"items": items}


@api_router.delete("/community/posts/{post_id}")
async def delete_post(post_id: str, user: dict = Depends(current_user)):
    p = await db.community_posts.find_one({"id": post_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    # Author or admin can delete
    if p["author"]["id"] != user["id"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only the author or admin can delete this post")
    await db.community_posts.delete_one({"id": post_id})
    await db.community_comments.delete_many({"post_id": post_id})
    await db.community_likes.delete_many({"post_id": post_id})
    return {"deleted": True}


@api_router.get("/community/hashtags")
async def list_hashtags(user: dict = Depends(current_user)):
    # Aggregate top hashtags
    pipeline = [
        {"$unwind": "$hashtags"},
        {"$group": {"_id": "$hashtags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 20},
    ]
    items = await db.community_posts.aggregate(pipeline).to_list(20)
    return {"items": [{"tag": i["_id"], "count": i["count"]} for i in items]}


# ============================================================================
# Doctor Community (Instagram-style social layer — verified doctors only)
# Collections used: doc_com_posts, doc_com_likes, doc_com_comments,
# doc_com_saves, doc_com_follows, doc_com_notifications, doc_com_reports
# ============================================================================

MAX_CAROUSEL_IMAGES = 5
MAX_POST_CAPTION = 2200
MAX_COMMENT_LEN = 800
MAX_HASHTAGS = 15
DOCTOR_SPECIALTIES = {"Ayurveda", "Homoeopathy", "Yoga", "Naturopathy", "Unani", "Siddha", "General"}


class DoctorPostIn(BaseModel):
    images: List[str] = Field(default_factory=list, max_length=MAX_CAROUSEL_IMAGES)
    caption: str = Field(default="", max_length=MAX_POST_CAPTION)
    hashtags: List[str] = Field(default_factory=list, max_length=MAX_HASHTAGS)
    specialty_tag: Optional[str] = Field(None, max_length=50)
    clinical_flag: bool = False


class DoctorCommentIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_COMMENT_LEN)


class DoctorReportIn(BaseModel):
    target_type: Literal["post", "comment", "reel", "story", "dm_message"]
    target_id: str = Field(..., max_length=100)
    reason: str = Field(..., max_length=300)


class AdminHideReasonIn(BaseModel):
    reason: str = Field("Removed by admin", max_length=300)


class AdminBanIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=300)


class BroadcastIn(BaseModel):
    message: str = Field(..., min_length=3, max_length=500)


async def require_doctor_community(user: dict = Depends(current_user)) -> dict:
    """Access gate: only verified, non-banned doctors reach these endpoints."""
    if user.get("community_banned"):
        raise HTTPException(status_code=403, detail="Your community access has been suspended")
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Doctor Community is for verified doctors only")
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0, "verified": 1, "onboarded_at": 1})
    if not d or not d.get("verified"):
        raise HTTPException(status_code=403, detail="Your doctor account is not yet verified. Please contact the VaidyaJi admin team.")
    return user


def _normalise_hashtags(tags: List[str]) -> List[str]:
    out: List[str] = []
    for t in tags[:MAX_HASHTAGS]:
        if not isinstance(t, str):
            continue
        cleaned = t.strip().lstrip("#").lower()
        cleaned = "".join(ch for ch in cleaned if ch.isalnum() or ch == "_")[:40]
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


async def _doctor_snapshot(doctor_user_id: str) -> Dict[str, Any]:
    """Small cached-friendly doctor card for post/comment surfacing."""
    d = await db.doctors.find_one(
        {"user_id": doctor_user_id},
        {"_id": 0, "name": 1, "specialty": 1, "qualification": 1, "avatar_url": 1, "verified": 1,
         "clinic_name": 1, "clinic_address": 1, "consultation_fee": 1, "experience_years": 1},
    )
    if not d:
        u = await db.users.find_one({"id": doctor_user_id}, {"_id": 0, "name": 1})
        d = {"name": (u or {}).get("name", "Doctor"), "verified": False}
    return {
        "id": doctor_user_id,
        "name": d.get("name") or "Doctor",
        "specialty": d.get("specialty") or "",
        "qualification": d.get("qualification") or "",
        "avatar_url": d.get("avatar_url") or "",
        "clinic_name": d.get("clinic_name") or "",
        "clinic_address": d.get("clinic_address") or "",
        "consultation_fee": int(d.get("consultation_fee") or 0),
        "experience_years": int(d.get("experience_years") or 0),
        "verified": bool(d.get("verified", False)),
    }


async def _hydrate_posts(posts: List[Dict[str, Any]], me_id: str) -> List[Dict[str, Any]]:
    """Attach author, liked/saved flags, comment/like counts to a list of posts."""
    if not posts:
        return []
    doctor_ids = list({p["doctor_id"] for p in posts})
    doctors: Dict[str, Dict[str, Any]] = {}
    for did in doctor_ids:
        doctors[did] = await _doctor_snapshot(did)
    post_ids = [p["id"] for p in posts]
    liked_rows = await db.doc_com_likes.find(
        {"post_id": {"$in": post_ids}, "doctor_id": me_id}, {"_id": 0, "post_id": 1}
    ).to_list(len(post_ids))
    saved_rows = await db.doc_com_saves.find(
        {"post_id": {"$in": post_ids}, "doctor_id": me_id}, {"_id": 0, "post_id": 1}
    ).to_list(len(post_ids))
    liked = {r["post_id"] for r in liked_rows}
    saved = {r["post_id"] for r in saved_rows}
    out = []
    for p in posts:
        p.pop("_id", None)
        p["author"] = doctors.get(p["doctor_id"], {"id": p["doctor_id"], "name": "Doctor", "verified": False})
        p["liked_by_me"] = p["id"] in liked
        p["saved_by_me"] = p["id"] in saved
        out.append(p)
    return out


async def _notify(doctor_id: str, kind: str, actor_id: str, post_id: Optional[str] = None,
                  snippet: Optional[str] = None) -> None:
    if doctor_id == actor_id:
        return  # do not notify self-actions
    try:
        await db.doc_com_notifications.insert_one({
            "id": str(uuid.uuid4()),
            "doctor_id": doctor_id, "type": kind, "actor_id": actor_id,
            "post_id": post_id, "snippet": snippet, "read": False, "at": now_iso(),
        })
    except Exception as exc:
        logger.debug("doc-notify failed: %s", exc)


# ── Access + profile ────────────────────────────────────────────────
@api_router.get("/community/doctor/access")
async def doc_com_access(user: dict = Depends(current_user)):
    """Lightweight probe used by the frontend to route to the community or a gate screen."""
    if user.get("role") != "doctor":
        return {"has_access": False, "reason": "patient_role"}
    if user.get("community_banned"):
        return {"has_access": False, "reason": "banned"}
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0, "verified": 1})
    if not d or not d.get("verified"):
        return {"has_access": False, "reason": "not_verified"}
    return {"has_access": True}


@api_router.get("/community/doctor/profile/{doctor_id}")
async def doc_com_profile(doctor_id: str, user: dict = Depends(require_doctor_community)):
    snap = await _doctor_snapshot(doctor_id)
    # bio from doctors collection
    d = await db.doctors.find_one({"user_id": doctor_id}, {"_id": 0, "bio": 1, "experience_years": 1, "languages": 1})
    snap["bio"] = (d or {}).get("bio", "")
    snap["experience_years"] = (d or {}).get("experience_years", 0)
    snap["languages"] = (d or {}).get("languages", [])
    posts_count = await db.doc_com_posts.count_documents({"doctor_id": doctor_id, "hidden": {"$ne": True}})
    followers = await db.doc_com_follows.count_documents({"following_id": doctor_id})
    following = await db.doc_com_follows.count_documents({"follower_id": doctor_id})
    is_following = False
    if doctor_id != user["id"]:
        is_following = bool(await db.doc_com_follows.find_one({"follower_id": user["id"], "following_id": doctor_id}))
    return {
        **snap,
        "posts_count": posts_count,
        "followers_count": followers,
        "following_count": following,
        "is_following": is_following,
        "is_me": doctor_id == user["id"],
    }


@api_router.get("/community/doctor/profile/{doctor_id}/posts")
async def doc_com_profile_posts(doctor_id: str, user: dict = Depends(require_doctor_community), limit: int = 30):
    limit = min(max(limit, 1), 60)
    posts = await db.doc_com_posts.find(
        {"doctor_id": doctor_id, "hidden": {"$ne": True}}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return await _hydrate_posts(posts, user["id"])


# ── Follow / unfollow ───────────────────────────────────────────────
@api_router.post("/community/doctor/follow/{target_id}")
async def doc_com_follow(target_id: str, user: dict = Depends(require_doctor_community)):
    if target_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    target = await db.doctors.find_one({"user_id": target_id}, {"_id": 0, "verified": 1})
    if not target or not target.get("verified"):
        raise HTTPException(status_code=404, detail="Doctor not found")
    existing = await db.doc_com_follows.find_one({"follower_id": user["id"], "following_id": target_id})
    if existing:
        return {"ok": True, "already": True}
    await db.doc_com_follows.insert_one({
        "follower_id": user["id"], "following_id": target_id, "created_at": now_iso(),
    })
    await _notify(target_id, "follow", user["id"])
    return {"ok": True, "already": False}


@api_router.delete("/community/doctor/follow/{target_id}")
async def doc_com_unfollow(target_id: str, user: dict = Depends(require_doctor_community)):
    await db.doc_com_follows.delete_one({"follower_id": user["id"], "following_id": target_id})
    return {"ok": True}


@api_router.get("/community/doctor/me/followers")
async def doc_com_my_followers(user: dict = Depends(require_doctor_community), limit: int = 100):
    rows = await db.doc_com_follows.find({"following_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return [await _doctor_snapshot(r["follower_id"]) for r in rows]


@api_router.get("/community/doctor/me/following")
async def doc_com_my_following(user: dict = Depends(require_doctor_community), limit: int = 100):
    rows = await db.doc_com_follows.find({"follower_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return [await _doctor_snapshot(r["following_id"]) for r in rows]


# ── Posts (CRUD) ────────────────────────────────────────────────────
@api_router.post("/community/doctor/posts")
async def doc_com_create_post(body: DoctorPostIn, user: dict = Depends(require_doctor_community)):
    if not body.images and not body.caption.strip():
        raise HTTPException(status_code=400, detail="Post needs an image or caption")
    if len(body.images) > MAX_CAROUSEL_IMAGES:
        raise HTTPException(status_code=400, detail=f"Max {MAX_CAROUSEL_IMAGES} images per post")
    # Cap total payload per image ~4 MB + aggregate cap to prevent 22 MB posts
    total_bytes = 0
    for i, img in enumerate(body.images):
        if not isinstance(img, str) or len(img) > 4_500_000:
            raise HTTPException(status_code=400, detail=f"Image {i+1} too large (max 4 MB)")
        total_bytes += len(img)
    if total_bytes > 12_000_000:
        raise HTTPException(status_code=400, detail="Total image payload exceeds 12 MB — please compress")
    if body.specialty_tag and body.specialty_tag not in DOCTOR_SPECIALTIES:
        raise HTTPException(status_code=400, detail="Invalid specialty tag")
    doc = {
        "id": str(uuid.uuid4()),
        "doctor_id": user["id"],
        "images": body.images,
        "type": "carousel" if len(body.images) > 1 else ("image" if body.images else "text"),
        "caption": body.caption.strip(),
        "hashtags": _normalise_hashtags(body.hashtags),
        "specialty_tag": body.specialty_tag,
        "clinical_flag": bool(body.clinical_flag),
        "pinned": False,
        "hidden": False,
        "hidden_reason": None,
        "likes_count": 0,
        "comments_count": 0,
        "saves_count": 0,
        "created_at": now_iso(),
    }
    await db.doc_com_posts.insert_one(doc.copy())
    doc.pop("_id", None)
    doc["author"] = await _doctor_snapshot(user["id"])
    doc["liked_by_me"] = False
    doc["saved_by_me"] = False
    return doc


@api_router.get("/community/doctor/posts/{post_id}")
async def doc_com_get_post(post_id: str, user: dict = Depends(require_doctor_community)):
    p = await db.doc_com_posts.find_one({"id": post_id, "hidden": {"$ne": True}}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    hydrated = await _hydrate_posts([p], user["id"])
    return hydrated[0]


@api_router.delete("/community/doctor/posts/{post_id}")
async def doc_com_delete_post(post_id: str, user: dict = Depends(require_doctor_community)):
    p = await db.doc_com_posts.find_one({"id": post_id}, {"_id": 0, "doctor_id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    if p["doctor_id"] != user["id"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only author or admin can delete")
    await db.doc_com_posts.delete_one({"id": post_id})
    await db.doc_com_likes.delete_many({"post_id": post_id})
    await db.doc_com_comments.delete_many({"post_id": post_id})
    await db.doc_com_saves.delete_many({"post_id": post_id})
    # Cascade: remove orphaned notifications & reports tied to this post.
    await db.doc_com_notifications.delete_many({"post_id": post_id})
    await db.doc_com_reports.delete_many({"target_type": "post", "target_id": post_id})
    return {"deleted": True}


# ── Feed ────────────────────────────────────────────────────────────
@api_router.get("/community/doctor/feed")
async def doc_com_feed(user: dict = Depends(require_doctor_community), limit: int = 20, before: Optional[str] = None):
    limit = min(max(limit, 1), 40)
    followed = await db.doc_com_follows.find({"follower_id": user["id"]}, {"_id": 0, "following_id": 1}).to_list(500)
    ids = [r["following_id"] for r in followed] + [user["id"]]
    q: Dict[str, Any] = {"hidden": {"$ne": True}}
    if ids:
        q["doctor_id"] = {"$in": ids}
    if before:
        q["created_at"] = {"$lt": before}
    posts = await db.doc_com_posts.find(q).sort([("pinned", -1), ("created_at", -1)]).limit(limit).to_list(limit)
    # If a doctor follows nobody yet, mix in a small set of recent global posts.
    if not followed and len(posts) < limit:
        extra = await db.doc_com_posts.find(
            {"hidden": {"$ne": True}, "doctor_id": {"$ne": user["id"]}}
        ).sort("created_at", -1).limit(limit - len(posts)).to_list(limit)
        seen = {p["id"] for p in posts}
        posts += [p for p in extra if p["id"] not in seen]
    return await _hydrate_posts(posts, user["id"])


# ── Like / Save ─────────────────────────────────────────────────────
@api_router.post("/community/doctor/posts/{post_id}/like")
async def doc_com_like(post_id: str, user: dict = Depends(require_doctor_community)):
    p = await db.doc_com_posts.find_one({"id": post_id, "hidden": {"$ne": True}}, {"_id": 0, "id": 1, "doctor_id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    existing = await db.doc_com_likes.find_one({"post_id": post_id, "doctor_id": user["id"]})
    if existing:
        return {"liked": True, "already": True}
    await db.doc_com_likes.insert_one({
        "post_id": post_id, "doctor_id": user["id"], "created_at": now_iso(),
    })
    await db.doc_com_posts.update_one({"id": post_id}, {"$inc": {"likes_count": 1}})
    await _notify(p["doctor_id"], "like", user["id"], post_id)
    return {"liked": True, "already": False}


@api_router.delete("/community/doctor/posts/{post_id}/like")
async def doc_com_unlike(post_id: str, user: dict = Depends(require_doctor_community)):
    res = await db.doc_com_likes.delete_one({"post_id": post_id, "doctor_id": user["id"]})
    if res.deleted_count:
        await db.doc_com_posts.update_one({"id": post_id}, {"$inc": {"likes_count": -1}})
    return {"liked": False}


@api_router.post("/community/doctor/posts/{post_id}/save")
async def doc_com_save(post_id: str, user: dict = Depends(require_doctor_community)):
    p = await db.doc_com_posts.find_one({"id": post_id, "hidden": {"$ne": True}}, {"_id": 0, "id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    existing = await db.doc_com_saves.find_one({"post_id": post_id, "doctor_id": user["id"]})
    if existing:
        return {"saved": True}
    await db.doc_com_saves.insert_one({
        "post_id": post_id, "doctor_id": user["id"], "created_at": now_iso(),
    })
    await db.doc_com_posts.update_one({"id": post_id}, {"$inc": {"saves_count": 1}})
    return {"saved": True}


@api_router.delete("/community/doctor/posts/{post_id}/save")
async def doc_com_unsave(post_id: str, user: dict = Depends(require_doctor_community)):
    res = await db.doc_com_saves.delete_one({"post_id": post_id, "doctor_id": user["id"]})
    if res.deleted_count:
        await db.doc_com_posts.update_one({"id": post_id}, {"$inc": {"saves_count": -1}})
    return {"saved": False}


@api_router.get("/community/doctor/me/saved")
async def doc_com_saved_posts(user: dict = Depends(require_doctor_community), limit: int = 50):
    saves = await db.doc_com_saves.find({"doctor_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    if not saves:
        return []
    post_ids = [s["post_id"] for s in saves]
    posts = await db.doc_com_posts.find({"id": {"$in": post_ids}, "hidden": {"$ne": True}}).to_list(len(post_ids))
    # Preserve save order
    by_id = {p["id"]: p for p in posts}
    ordered = [by_id[pid] for pid in post_ids if pid in by_id]
    return await _hydrate_posts(ordered, user["id"])


# ── Comments ────────────────────────────────────────────────────────
@api_router.get("/community/doctor/posts/{post_id}/comments")
async def doc_com_list_comments(post_id: str, user: dict = Depends(require_doctor_community)):
    p = await db.doc_com_posts.find_one({"id": post_id, "hidden": {"$ne": True}}, {"_id": 0, "id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    rows = await db.doc_com_comments.find(
        {"post_id": post_id, "hidden": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    for c in rows:
        c["author"] = await _doctor_snapshot(c["doctor_id"])
    return rows


@api_router.post("/community/doctor/posts/{post_id}/comments")
async def doc_com_add_comment(post_id: str, body: DoctorCommentIn, user: dict = Depends(require_doctor_community)):
    p = await db.doc_com_posts.find_one({"id": post_id, "hidden": {"$ne": True}}, {"_id": 0, "id": 1, "doctor_id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    doc = {
        "id": str(uuid.uuid4()),
        "post_id": post_id, "doctor_id": user["id"],
        "text": body.text.strip(), "created_at": now_iso(), "hidden": False,
    }
    await db.doc_com_comments.insert_one(doc.copy())
    await db.doc_com_posts.update_one({"id": post_id}, {"$inc": {"comments_count": 1}})
    await _notify(p["doctor_id"], "comment", user["id"], post_id, snippet=body.text[:80])
    doc.pop("_id", None)
    doc["author"] = await _doctor_snapshot(user["id"])
    return doc


@api_router.delete("/community/doctor/comments/{comment_id}")
async def doc_com_delete_comment(comment_id: str, user: dict = Depends(require_doctor_community)):
    c = await db.doc_com_comments.find_one({"id": comment_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c["doctor_id"] != user["id"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only author or admin can delete")
    await db.doc_com_comments.delete_one({"id": comment_id})
    await db.doc_com_posts.update_one({"id": c["post_id"]}, {"$inc": {"comments_count": -1}})
    return {"deleted": True}


# ── Explore / Search ────────────────────────────────────────────────
@api_router.get("/community/doctor/explore")
async def doc_com_explore(user: dict = Depends(require_doctor_community), specialty: Optional[str] = None, limit: int = 30):
    limit = min(max(limit, 1), 60)
    q: Dict[str, Any] = {"hidden": {"$ne": True}, "images.0": {"$exists": True}}
    if specialty and specialty != "All":
        q["specialty_tag"] = specialty
    # Simple trend: engagement * recency
    posts = await db.doc_com_posts.find(q).sort([
        ("pinned", -1), ("likes_count", -1), ("created_at", -1),
    ]).limit(limit).to_list(limit)
    return await _hydrate_posts(posts, user["id"])


@api_router.get("/community/doctor/search")
async def doc_com_search(q: str, user: dict = Depends(require_doctor_community), limit: int = 20):
    q = (q or "").strip()[:80]  # cap to prevent pathological patterns
    if not q or len(q) < 2:
        return {"doctors": [], "hashtags": [], "posts": []}
    limit = min(max(limit, 1), 40)
    import re as _re
    safe = _re.escape(q)  # SEC-001: treat user input as literal text, not regex
    # Doctors by name / specialty
    doc_query = {
        "verified": True,
        "user_id": {"$exists": True},
        "$or": [
            {"name": {"$regex": safe, "$options": "i"}},
            {"specialty": {"$regex": safe, "$options": "i"}},
        ],
    }
    doc_rows = await db.doctors.find(
        doc_query,
        {"_id": 0, "user_id": 1, "name": 1, "specialty": 1, "avatar_url": 1, "verified": 1, "clinic_name": 1},
    ).limit(limit).to_list(limit)
    doctors = [{
        "id": r["user_id"], "name": r["name"], "specialty": r.get("specialty", ""),
        "avatar_url": r.get("avatar_url", ""), "verified": True, "clinic_name": r.get("clinic_name", ""),
    } for r in doc_rows if r.get("user_id")]
    # Hashtag search
    tag = q.lstrip("#").lower()
    safe_tag = _re.escape(tag)
    pipeline = [
        {"$match": {"hidden": {"$ne": True}}},
        {"$unwind": "$hashtags"},
        {"$match": {"hashtags": {"$regex": f"^{safe_tag}"}}},
        {"$group": {"_id": "$hashtags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ]
    tag_rows = await db.doc_com_posts.aggregate(pipeline).to_list(limit)
    hashtags = [{"tag": r["_id"], "count": r["count"]} for r in tag_rows]
    # Recent posts matching caption
    post_rows = await db.doc_com_posts.find(
        {"hidden": {"$ne": True}, "caption": {"$regex": safe, "$options": "i"}}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    posts = await _hydrate_posts(post_rows, user["id"])
    return {"doctors": doctors, "hashtags": hashtags, "posts": posts}


@api_router.get("/community/doctor/hashtag/{tag}")
async def doc_com_by_hashtag(tag: str, user: dict = Depends(require_doctor_community), limit: int = 30):
    tag = tag.lstrip("#").lower()[:80]
    # Sanitise: only allow alnum + underscore (matches _normalise_hashtags), so no regex metacharacters ever reach mongo.
    tag = "".join(ch for ch in tag if ch.isalnum() or ch == "_")
    if not tag:
        raise HTTPException(status_code=400, detail="Invalid tag")
    posts = await db.doc_com_posts.find(
        {"hashtags": tag, "hidden": {"$ne": True}}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return await _hydrate_posts(posts, user["id"])


@api_router.get("/community/doctor/suggest")
async def doc_com_suggest(user: dict = Depends(require_doctor_community), limit: int = 10):
    """Suggest doctors to follow: verified, not-yet-followed, other than self."""
    limit = min(max(limit, 1), 20)
    following = await db.doc_com_follows.find({"follower_id": user["id"]}, {"_id": 0, "following_id": 1}).to_list(500)
    excluded = {r["following_id"] for r in following}
    excluded.add(user["id"])
    docs = await db.doctors.find(
        {"verified": True, "user_id": {"$exists": True, "$nin": list(excluded)}},
        {"_id": 0, "user_id": 1, "name": 1, "specialty": 1, "avatar_url": 1, "verified": 1},
    ).limit(limit).to_list(limit)
    return [{
        "id": d["user_id"], "name": d.get("name", "Doctor"),
        "specialty": d.get("specialty", ""), "avatar_url": d.get("avatar_url", ""), "verified": True,
    } for d in docs if d.get("user_id")]


# ── Notifications ───────────────────────────────────────────────────
@api_router.get("/community/doctor/notifications")
async def doc_com_notifications(user: dict = Depends(require_doctor_community), limit: int = 40):
    limit = min(max(limit, 1), 80)
    rows = await db.doc_com_notifications.find(
        {"doctor_id": user["id"]}, {"_id": 0},
    ).sort("at", -1).limit(limit).to_list(limit)
    for n in rows:
        n["actor"] = await _doctor_snapshot(n["actor_id"])
    unread = await db.doc_com_notifications.count_documents({"doctor_id": user["id"], "read": False})
    return {"items": rows, "unread": unread}


@api_router.post("/community/doctor/notifications/read")
async def doc_com_read_notifications(user: dict = Depends(require_doctor_community)):
    await db.doc_com_notifications.update_many(
        {"doctor_id": user["id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}


# ── Reports ─────────────────────────────────────────────────────────
@api_router.post("/community/doctor/report")
async def doc_com_report(body: DoctorReportIn, request: Request, user: dict = Depends(require_doctor_community)):
    # SEC-002: rate limit per doctor to prevent moderation queue spam
    await rate_limit(request, f"doc-com-report:{user['id']}", max_calls=20, window_seconds=3600)
    # Verify the target actually exists before persisting
    if body.target_type == "post":
        target = await db.doc_com_posts.find_one({"id": body.target_id}, {"_id": 0, "id": 1})
    elif body.target_type == "comment":
        target = await db.doc_com_comments.find_one({"id": body.target_id}, {"_id": 0, "id": 1})
    elif body.target_type == "reel":
        target = await db.doc_com_reels.find_one({"id": body.target_id}, {"_id": 0, "id": 1})
    elif body.target_type == "story":
        target = await db.doc_com_stories.find_one({"id": body.target_id}, {"_id": 0, "id": 1})
    elif body.target_type == "dm_message":
        # For DMs, only participants of the thread may report a message
        msg = await db.doc_com_dm_messages.find_one({"id": body.target_id}, {"_id": 0, "id": 1, "thread_id": 1})
        if not msg:
            raise HTTPException(status_code=404, detail="Reported item not found")
        thread = await db.doc_com_dm_threads.find_one({"id": msg["thread_id"]}, {"_id": 0, "participants": 1})
        if not thread or user["id"] not in thread.get("participants", []):
            raise HTTPException(status_code=403, detail="You can only report messages in your own conversations")
        target = msg
    else:  # pragma: no cover - Literal guards this
        target = None
    if not target:
        raise HTTPException(status_code=404, detail="Reported item not found")
    # De-duplicate: one report per (target, reporter)
    existing = await db.doc_com_reports.find_one({
        "target_type": body.target_type, "target_id": body.target_id, "reporter_id": user["id"],
    })
    if existing:
        return {"ok": True, "already": True}
    await db.doc_com_reports.insert_one({
        "id": str(uuid.uuid4()),
        "target_type": body.target_type, "target_id": body.target_id,
        "reason": body.reason.strip(), "reporter_id": user["id"],
        "resolved": False, "at": now_iso(),
    })
    return {"ok": True, "already": False}


# ── Admin moderation ────────────────────────────────────────────────
@api_router.post("/admin/doctor-community/pin/{post_id}")
async def admin_pin_post(post_id: str, admin: dict = Depends(require_admin)):
    r = await db.doc_com_posts.update_one({"id": post_id}, {"$set": {"pinned": True}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    await log_activity("doc_community_pin", actor=admin, meta={"post_id": post_id})
    return {"ok": True}


@api_router.post("/admin/doctor-community/unpin/{post_id}")
async def admin_unpin_post(post_id: str, admin: dict = Depends(require_admin)):
    r = await db.doc_com_posts.update_one({"id": post_id}, {"$set": {"pinned": False}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}


@api_router.post("/admin/doctor-community/hide/{post_id}")
async def admin_hide_post(post_id: str, body: AdminHideReasonIn, admin: dict = Depends(require_admin)):
    r = await db.doc_com_posts.update_one(
        {"id": post_id},
        {"$set": {"hidden": True, "hidden_reason": body.reason, "hidden_at": now_iso(), "hidden_by": admin["id"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    await log_activity("doc_community_hide_post", actor=admin, meta={"post_id": post_id, "reason": body.reason})
    return {"ok": True}


@api_router.post("/admin/doctor-community/unhide/{post_id}")
async def admin_unhide_post(post_id: str, admin: dict = Depends(require_admin)):
    r = await db.doc_com_posts.update_one(
        {"id": post_id},
        {"$set": {"hidden": False, "hidden_reason": None}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}


@api_router.post("/admin/doctor-community/ban/{doctor_id}")
async def admin_ban_doctor(doctor_id: str, body: AdminBanIn, admin: dict = Depends(require_admin)):
    u = await db.users.find_one({"id": doctor_id}, {"_id": 0, "role": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.get("role") != "doctor":
        raise HTTPException(status_code=400, detail="Target is not a doctor")
    await db.users.update_one(
        {"id": doctor_id},
        {"$set": {
            "community_banned": True,
            "community_ban_reason": body.reason,
            "community_banned_at": now_iso(),
            "community_banned_by": admin["id"],
        }},
    )
    await log_activity("doc_community_ban", actor=admin, meta={"doctor_id": doctor_id, "reason": body.reason})
    return {"ok": True}


@api_router.post("/admin/doctor-community/unban/{doctor_id}")
async def admin_unban_doctor(doctor_id: str, admin: dict = Depends(require_admin)):
    await db.users.update_one(
        {"id": doctor_id},
        {"$unset": {"community_banned": "", "community_ban_reason": "", "community_banned_at": "", "community_banned_by": ""}},
    )
    await log_activity("doc_community_unban", actor=admin, meta={"doctor_id": doctor_id})
    return {"ok": True}


@api_router.get("/admin/doctor-community/reports")
async def admin_list_reports(admin: dict = Depends(require_admin), resolved: bool = False, limit: int = 100):
    rows = await db.doc_com_reports.find(
        {"resolved": resolved}, {"_id": 0}
    ).sort("at", -1).limit(limit).to_list(limit)
    for r in rows:
        r["reporter"] = await _doctor_snapshot(r["reporter_id"])
        tt = r["target_type"]
        if tt == "post":
            p = await db.doc_com_posts.find_one({"id": r["target_id"]}, {"_id": 0, "id": 1, "doctor_id": 1, "caption": 1, "hidden": 1})
            r["post"] = p
        elif tt == "comment":
            c = await db.doc_com_comments.find_one({"id": r["target_id"]}, {"_id": 0})
            r["comment"] = c
        elif tt == "reel":
            rl = await db.doc_com_reels.find_one({"id": r["target_id"]}, {"_id": 0, "id": 1, "doctor_id": 1, "caption": 1, "hidden": 1, "thumbnail_url": 1})
            r["reel"] = rl
        elif tt == "story":
            st = await db.doc_com_stories.find_one({"id": r["target_id"]}, {"_id": 0, "id": 1, "doctor_id": 1, "caption": 1, "media_type": 1, "expires_at": 1})
            r["story"] = st
        elif tt == "dm_message":
            msg = await db.doc_com_dm_messages.find_one({"id": r["target_id"]}, {"_id": 0, "id": 1, "thread_id": 1, "sender_id": 1, "text": 1, "created_at": 1})
            if msg:
                msg["sender"] = await _doctor_snapshot(msg["sender_id"])
            r["dm_message"] = msg
    return {"items": rows}


# ── Admin moderation for Reels ──────────────────────────────────────
@api_router.post("/admin/doctor-community/reels/{reel_id}/hide")
async def admin_hide_reel(reel_id: str, body: AdminHideReasonIn, admin: dict = Depends(require_admin)):
    r = await db.doc_com_reels.update_one(
        {"id": reel_id},
        {"$set": {"hidden": True, "hidden_reason": body.reason, "hidden_at": now_iso(), "hidden_by": admin["id"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reel not found")
    await log_activity("doc_community_hide_reel", actor=admin, meta={"reel_id": reel_id, "reason": body.reason})
    return {"ok": True}


@api_router.post("/admin/doctor-community/reels/{reel_id}/unhide")
async def admin_unhide_reel(reel_id: str, admin: dict = Depends(require_admin)):
    r = await db.doc_com_reels.update_one(
        {"id": reel_id},
        {"$set": {"hidden": False, "hidden_reason": None}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reel not found")
    return {"ok": True}


@api_router.delete("/admin/doctor-community/reels/{reel_id}")
async def admin_delete_reel(reel_id: str, admin: dict = Depends(require_admin)):
    r = await db.doc_com_reels.find_one({"id": reel_id}, {"_id": 0, "id": 1, "doctor_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Reel not found")
    await db.doc_com_reels.delete_one({"id": reel_id})
    await db.doc_com_reel_likes.delete_many({"reel_id": reel_id})
    await db.doc_com_reel_views.delete_many({"reel_id": reel_id})
    await db.doc_com_reports.update_many({"target_type": "reel", "target_id": reel_id}, {"$set": {"resolved": True, "resolved_at": now_iso(), "resolved_by": admin["id"]}})
    await log_activity("doc_community_delete_reel", actor=admin, meta={"reel_id": reel_id, "author_id": r["doctor_id"]})
    return {"deleted": True}


# ── Admin moderation for Stories ────────────────────────────────────
@api_router.delete("/admin/doctor-community/stories/{story_id}")
async def admin_delete_story(story_id: str, admin: dict = Depends(require_admin)):
    s = await db.doc_com_stories.find_one({"id": story_id}, {"_id": 0, "id": 1, "doctor_id": 1})
    if not s:
        raise HTTPException(status_code=404, detail="Story not found")
    await db.doc_com_stories.delete_one({"id": story_id})
    await db.doc_com_story_views.delete_many({"story_id": story_id})
    await db.doc_com_reports.update_many({"target_type": "story", "target_id": story_id}, {"$set": {"resolved": True, "resolved_at": now_iso(), "resolved_by": admin["id"]}})
    await log_activity("doc_community_delete_story", actor=admin, meta={"story_id": story_id, "author_id": s["doctor_id"]})
    return {"deleted": True}


# ── Admin moderation for Direct Messages ────────────────────────────
@api_router.delete("/admin/doctor-community/dm/messages/{message_id}")
async def admin_delete_dm_message(message_id: str, admin: dict = Depends(require_admin)):
    """Redact an abusive DM message. Removes body but keeps the row so both users
    see 'Removed by moderator' rather than a broken conversation."""
    m = await db.doc_com_dm_messages.find_one({"id": message_id}, {"_id": 0, "id": 1, "sender_id": 1, "thread_id": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.doc_com_dm_messages.update_one(
        {"id": message_id},
        {"$set": {
            "text": "[Removed by moderator]",
            "image_url": "",
            "redacted": True,
            "redacted_at": now_iso(),
            "redacted_by": admin["id"],
        }},
    )
    await db.doc_com_reports.update_many({"target_type": "dm_message", "target_id": message_id}, {"$set": {"resolved": True, "resolved_at": now_iso(), "resolved_by": admin["id"]}})
    await log_activity("doc_community_redact_dm", actor=admin, meta={"message_id": message_id, "sender_id": m["sender_id"], "thread_id": m["thread_id"]})
    return {"ok": True, "redacted": True}


@api_router.post("/admin/doctor-community/reports/{report_id}/resolve")
async def admin_resolve_report(report_id: str, admin: dict = Depends(require_admin)):
    r = await db.doc_com_reports.update_one({"id": report_id}, {"$set": {"resolved": True, "resolved_at": now_iso(), "resolved_by": admin["id"]}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"ok": True}


@api_router.post("/admin/doctor-community/broadcast")
async def admin_doc_community_broadcast(body: BroadcastIn, admin: dict = Depends(require_admin)):
    """Post an official announcement — appears in every doctor's feed as pinned + notifies all."""
    doc = {
        "id": str(uuid.uuid4()),
        "doctor_id": admin["id"],
        "images": [],
        "type": "text",
        "caption": body.message.strip(),
        "hashtags": ["announcement"],
        "specialty_tag": None,
        "clinical_flag": False,
        "pinned": True,
        "hidden": False,
        "hidden_reason": None,
        "likes_count": 0,
        "comments_count": 0,
        "saves_count": 0,
        "created_at": now_iso(),
        "is_announcement": True,
    }
    await db.doc_com_posts.insert_one(doc.copy())
    # Fanout only to verified, non-banned doctors
    verified_doctors = await db.doctors.find(
        {"verified": True, "user_id": {"$exists": True}}, {"_id": 0, "user_id": 1}
    ).to_list(2000)
    verified_ids = {r["user_id"] for r in verified_doctors if r.get("user_id")}
    banned_users = await db.users.find(
        {"role": "doctor", "community_banned": True}, {"_id": 0, "id": 1}
    ).to_list(2000)
    banned_ids = {u["id"] for u in banned_users}
    recipients = verified_ids - banned_ids
    for uid in recipients:
        await _notify(uid, "announcement", admin["id"], doc["id"], snippet=body.message[:120])
    await log_activity("doc_community_broadcast", actor=admin, meta={"post_id": doc["id"], "recipients": len(recipients)})
    doc.pop("_id", None)
    return doc


# ══════════════════════════════════════════════════════════════════
# VAIDYA CHARCHA — PHASE B
# 24-hour Stories · Direct Messages (1:1) · Reels
# All routes require the caller to be a verified, non-banned doctor.
# ══════════════════════════════════════════════════════════════════

STORY_TTL_HOURS = 24
STORY_MAX_ACTIVE_PER_DOCTOR = 20
DM_MAX_MSG_LEN = 4000
DM_MAX_IMG_BYTES = 4_500_000
REEL_MAX_VIDEO_BYTES = 12_000_000  # ~12 MB base64
REEL_MAX_CAPTION = 2200

# SEC-001 fix: media allowlist
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
ALLOWED_VIDEO_MIMES = {"video/mp4", "video/quicktime", "video/webm", "video/x-m4v"}
# If we ever want to allow a remote CDN, add the host here. Empty = strict data-URI-only.
ALLOWED_MEDIA_HOSTS: set = set()


def _validate_media_uri(uri: str, kind: Literal["image", "video"], *, max_bytes: int, field_name: str = "media") -> str:
    """
    SEC-001: Only accept `data:` URIs with a MIME whitelist, or URLs from an
    explicit allowlist of trusted hosts. Rejects arbitrary http(s) URLs that
    would let a doctor plant a tracker or hostile server for other doctors'
    apps to auto-fetch.
    """
    if not uri or not isinstance(uri, str):
        raise HTTPException(status_code=400, detail=f"{field_name} is required")
    uri_l = uri.strip()
    if uri_l.startswith("data:"):
        # Parse MIME from data URI
        try:
            head, _b64 = uri_l.split(",", 1)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"{field_name}: malformed data URI")
        # head looks like: data:image/jpeg;base64
        mime = head[5:].split(";", 1)[0].strip().lower()
        allowed = ALLOWED_IMAGE_MIMES if kind == "image" else ALLOWED_VIDEO_MIMES
        if mime not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"{field_name}: unsupported media type '{mime}'. Allowed: {', '.join(sorted(allowed))}",
            )
        if len(uri_l) > max_bytes:
            raise HTTPException(status_code=400, detail=f"{field_name} too large (max {max_bytes // 1_000_000} MB)")
        return uri_l
    # Non-data URI: only allow explicit allowlisted hosts
    if not ALLOWED_MEDIA_HOSTS:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name}: only uploaded media is allowed. Please attach a photo or video from your device.",
        )
    try:
        from urllib.parse import urlparse
        parsed = urlparse(uri_l)
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field_name}: invalid URL")
    if parsed.scheme not in ("https",):
        raise HTTPException(status_code=400, detail=f"{field_name}: only https URLs allowed")
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_MEDIA_HOSTS:
        raise HTTPException(status_code=400, detail=f"{field_name}: host '{host}' is not on the media allowlist")
    return uri_l


def _story_expires_at() -> str:
    return (datetime.utcnow() + timedelta(hours=STORY_TTL_HOURS)).isoformat() + "Z"


def _is_expired(iso_str: str) -> bool:
    try:
        # Handle both "...Z" and offset-aware strings.
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        now = datetime.utcnow().replace(tzinfo=dt.tzinfo) if dt.tzinfo else datetime.utcnow()
        return dt < now
    except Exception:
        return False


# ───────────────────────── STORIES ─────────────────────────

class StoryIn(BaseModel):
    media_url: str = Field(..., min_length=8, max_length=6_000_000)  # base64 data URI or http url
    media_type: Literal["image", "video"] = "image"
    caption: Optional[str] = Field(None, max_length=280)


@api_router.post("/community/doctor/stories")
async def doc_com_create_story(body: StoryIn, request: Request, user: dict = Depends(require_doctor_community)):
    await rate_limit(request, f"dcom:story:{user['id']}", max_calls=STORY_MAX_ACTIVE_PER_DOCTOR, window_seconds=3600)
    # SEC-001: validate media type & host allowlist. Stories are image-only in the client.
    validated_media = _validate_media_uri(
        body.media_url, "image" if body.media_type == "image" else "video",
        max_bytes=DM_MAX_IMG_BYTES if body.media_type == "image" else REEL_MAX_VIDEO_BYTES,
        field_name="story media",
    )
    active = await db.doc_com_stories.count_documents({
        "doctor_id": user["id"], "expires_at": {"$gt": now_iso()},
    })
    if active >= STORY_MAX_ACTIVE_PER_DOCTOR:
        raise HTTPException(status_code=400, detail="You already have too many active stories")
    doc = {
        "id": str(uuid.uuid4()),
        "doctor_id": user["id"],
        "media_url": validated_media,
        "media_type": body.media_type,
        "caption": (body.caption or "").strip(),
        "views_count": 0,
        "created_at": now_iso(),
        "expires_at": _story_expires_at(),
    }
    await db.doc_com_stories.insert_one(doc.copy())
    doc.pop("_id", None)
    doc["author"] = await _doctor_snapshot(user["id"])
    doc["viewed_by_me"] = False
    return doc


@api_router.get("/community/doctor/stories/feed")
async def doc_com_stories_feed(user: dict = Depends(require_doctor_community)):
    """Return active stories grouped by doctor. Own stories first, then followed doctors."""
    # Followed doctor ids
    follows = await db.doc_com_follows.find({"follower_id": user["id"]}, {"_id": 0, "following_id": 1}).to_list(1000)
    followed_ids = {f["following_id"] for f in follows}
    followed_ids.add(user["id"])
    now = now_iso()
    stories = await db.doc_com_stories.find(
        {"doctor_id": {"$in": list(followed_ids)}, "expires_at": {"$gt": now}}
    ).sort("created_at", 1).to_list(500)
    # Views map
    story_ids = [s["id"] for s in stories]
    my_views = await db.doc_com_story_views.find(
        {"story_id": {"$in": story_ids}, "doctor_id": user["id"]}, {"_id": 0, "story_id": 1}
    ).to_list(len(story_ids) or 1)
    seen = {v["story_id"] for v in my_views}
    # Group
    grouped: Dict[str, Dict[str, Any]] = {}
    for s in stories:
        s.pop("_id", None)
        s["viewed_by_me"] = s["id"] in seen
        did = s["doctor_id"]
        if did not in grouped:
            grouped[did] = {"doctor": await _doctor_snapshot(did), "stories": [], "all_seen": True}
        grouped[did]["stories"].append(s)
        if not s["viewed_by_me"]:
            grouped[did]["all_seen"] = False
    # Own bucket first
    ordered: List[Dict[str, Any]] = []
    if user["id"] in grouped:
        own = grouped.pop(user["id"])
        own["is_me"] = True
        ordered.append(own)
    for bucket in grouped.values():
        bucket["is_me"] = False
        ordered.append(bucket)
    return {"items": ordered}


@api_router.get("/community/doctor/stories/by/{doctor_id}")
async def doc_com_stories_by_doctor(doctor_id: str, user: dict = Depends(require_doctor_community)):
    now = now_iso()
    stories = await db.doc_com_stories.find(
        {"doctor_id": doctor_id, "expires_at": {"$gt": now}}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    story_ids = [s["id"] for s in stories]
    my_views = await db.doc_com_story_views.find(
        {"story_id": {"$in": story_ids}, "doctor_id": user["id"]}, {"_id": 0, "story_id": 1}
    ).to_list(len(story_ids) or 1)
    seen = {v["story_id"] for v in my_views}
    for s in stories:
        s["viewed_by_me"] = s["id"] in seen
    author = await _doctor_snapshot(doctor_id)
    return {"author": author, "stories": stories, "is_me": doctor_id == user["id"]}


@api_router.post("/community/doctor/stories/{story_id}/view")
async def doc_com_view_story(story_id: str, user: dict = Depends(require_doctor_community)):
    s = await db.doc_com_stories.find_one({"id": story_id}, {"_id": 0, "doctor_id": 1, "expires_at": 1})
    if not s:
        raise HTTPException(status_code=404, detail="Story not found")
    if s["doctor_id"] == user["id"]:
        return {"ok": True, "self": True}
    existing = await db.doc_com_story_views.find_one({"story_id": story_id, "doctor_id": user["id"]})
    if existing:
        return {"ok": True, "already": True}
    await db.doc_com_story_views.insert_one({
        "id": str(uuid.uuid4()),
        "story_id": story_id, "doctor_id": user["id"], "at": now_iso(),
    })
    await db.doc_com_stories.update_one({"id": story_id}, {"$inc": {"views_count": 1}})
    return {"ok": True}


@api_router.delete("/community/doctor/stories/{story_id}")
async def doc_com_delete_story(story_id: str, user: dict = Depends(require_doctor_community)):
    s = await db.doc_com_stories.find_one({"id": story_id}, {"_id": 0, "doctor_id": 1})
    if not s:
        raise HTTPException(status_code=404, detail="Story not found")
    if s["doctor_id"] != user["id"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only author or admin can delete")
    await db.doc_com_stories.delete_one({"id": story_id})
    await db.doc_com_story_views.delete_many({"story_id": story_id})
    return {"deleted": True}


# ─────────────────────── DIRECT MESSAGES ───────────────────────

class DMStartIn(BaseModel):
    target_id: str = Field(..., min_length=1, max_length=100)


class DMSendIn(BaseModel):
    text: Optional[str] = Field(None, max_length=DM_MAX_MSG_LEN)
    image_url: Optional[str] = Field(None, max_length=DM_MAX_IMG_BYTES)


def _thread_key(a: str, b: str) -> List[str]:
    """Canonical sorted pair used to look up a 1:1 thread deterministically."""
    return sorted([a, b])


async def _hydrate_thread(t: Dict[str, Any], me_id: str) -> Dict[str, Any]:
    t.pop("_id", None)
    other_id = next((p for p in t.get("participants", []) if p != me_id), None)
    other = await _doctor_snapshot(other_id) if other_id else {"id": "", "name": "Doctor"}
    unread_key = f"unread_{me_id}"
    return {
        **t,
        "other": other,
        "unread": int(t.get(unread_key, 0)),
    }


@api_router.get("/community/doctor/dm/threads")
async def doc_com_dm_threads(user: dict = Depends(require_doctor_community)):
    threads = await db.doc_com_dm_threads.find(
        {"participants": user["id"]}
    ).sort("last_at", -1).to_list(200)
    out = [await _hydrate_thread(t, user["id"]) for t in threads]
    total_unread = sum(t["unread"] for t in out)
    return {"items": out, "unread_total": total_unread}


@api_router.post("/community/doctor/dm/threads")
async def doc_com_dm_start(body: DMStartIn, request: Request, user: dict = Depends(require_doctor_community)):
    # SEC-003: cap thread creation to prevent inbox spam
    await rate_limit(request, f"dcom:dm-start:{user['id']}", max_calls=30, window_seconds=3600)
    if body.target_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")
    target = await db.doctors.find_one({"user_id": body.target_id}, {"_id": 0, "verified": 1})
    if not target or not target.get("verified"):
        raise HTTPException(status_code=404, detail="Doctor not found")
    tu = await db.users.find_one({"id": body.target_id}, {"_id": 0, "community_banned": 1})
    if (tu or {}).get("community_banned"):
        raise HTTPException(status_code=403, detail="This doctor is not available for messages")
    key = _thread_key(user["id"], body.target_id)
    existing = await db.doc_com_dm_threads.find_one({"participants_sorted": key})
    if existing:
        return await _hydrate_thread(existing, user["id"])
    doc = {
        "id": str(uuid.uuid4()),
        "participants": [user["id"], body.target_id],
        "participants_sorted": key,
        "last_message": "",
        "last_sender_id": None,
        "last_at": now_iso(),
        "created_at": now_iso(),
        f"unread_{user['id']}": 0,
        f"unread_{body.target_id}": 0,
    }
    await db.doc_com_dm_threads.insert_one(doc.copy())
    return await _hydrate_thread(doc, user["id"])


@api_router.get("/community/doctor/dm/threads/{thread_id}/messages")
async def doc_com_dm_messages(thread_id: str, user: dict = Depends(require_doctor_community),
                              before: Optional[str] = None, limit: int = 60):
    limit = min(max(limit, 1), 100)
    t = await db.doc_com_dm_threads.find_one({"id": thread_id}, {"_id": 0, "participants": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    if user["id"] not in t["participants"]:
        raise HTTPException(status_code=403, detail="Not your conversation")
    q: Dict[str, Any] = {"thread_id": thread_id}
    if before:
        q["created_at"] = {"$lt": before}
    msgs = await db.doc_com_dm_messages.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    msgs.reverse()  # oldest → newest
    return {"items": msgs}


@api_router.post("/community/doctor/dm/threads/{thread_id}/messages")
async def doc_com_dm_send(thread_id: str, body: DMSendIn, request: Request,
                          user: dict = Depends(require_doctor_community)):
    await rate_limit(request, f"dcom:dm:{user['id']}", max_calls=180, window_seconds=3600)
    text = (body.text or "").strip()
    img = body.image_url or ""
    if not text and not img:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    # SEC-001: validate any attached media
    if img:
        img = _validate_media_uri(img, "image", max_bytes=DM_MAX_IMG_BYTES, field_name="attached image")
    t = await db.doc_com_dm_threads.find_one({"id": thread_id}, {"_id": 0, "participants": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    if user["id"] not in t["participants"]:
        raise HTTPException(status_code=403, detail="Not your conversation")
    other_id = next(p for p in t["participants"] if p != user["id"])
    msg = {
        "id": str(uuid.uuid4()),
        "thread_id": thread_id,
        "sender_id": user["id"],
        "text": text,
        "image_url": img,
        "created_at": now_iso(),
        "read_at": None,
    }
    await db.doc_com_dm_messages.insert_one(msg.copy())
    preview = (text or "📷 Photo")[:120]
    await db.doc_com_dm_threads.update_one(
        {"id": thread_id},
        {"$set": {"last_message": preview, "last_sender_id": user["id"], "last_at": msg["created_at"]},
         "$inc": {f"unread_{other_id}": 1}},
    )
    msg.pop("_id", None)
    return msg


@api_router.post("/community/doctor/dm/threads/{thread_id}/read")
async def doc_com_dm_read(thread_id: str, user: dict = Depends(require_doctor_community)):
    t = await db.doc_com_dm_threads.find_one({"id": thread_id}, {"_id": 0, "participants": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    if user["id"] not in t["participants"]:
        raise HTTPException(status_code=403, detail="Not your conversation")
    await db.doc_com_dm_threads.update_one(
        {"id": thread_id}, {"$set": {f"unread_{user['id']}": 0}}
    )
    await db.doc_com_dm_messages.update_many(
        {"thread_id": thread_id, "sender_id": {"$ne": user["id"]}, "read_at": None},
        {"$set": {"read_at": now_iso()}},
    )
    return {"ok": True}


# ─────────────────────── REELS (short video) ───────────────────────

class ReelIn(BaseModel):
    video_url: str = Field(..., min_length=8, max_length=REEL_MAX_VIDEO_BYTES)  # base64 data URI or http URL
    thumbnail_url: Optional[str] = Field(None, max_length=2_000_000)
    caption: Optional[str] = Field(None, max_length=REEL_MAX_CAPTION)
    hashtags: List[str] = Field(default_factory=list, max_length=MAX_HASHTAGS)
    duration_sec: Optional[float] = Field(None, ge=0, le=120)


async def _hydrate_reels(reels: List[Dict[str, Any]], me_id: str) -> List[Dict[str, Any]]:
    if not reels:
        return []
    doctor_ids = list({r["doctor_id"] for r in reels})
    doctors: Dict[str, Any] = {did: await _doctor_snapshot(did) for did in doctor_ids}
    reel_ids = [r["id"] for r in reels]
    likes = await db.doc_com_reel_likes.find(
        {"reel_id": {"$in": reel_ids}, "doctor_id": me_id}, {"_id": 0, "reel_id": 1}
    ).to_list(len(reel_ids))
    liked = {row["reel_id"] for row in likes}
    out = []
    for r in reels:
        r.pop("_id", None)
        r["author"] = doctors.get(r["doctor_id"], {"id": r["doctor_id"], "name": "Doctor"})
        r["liked_by_me"] = r["id"] in liked
        out.append(r)
    return out


@api_router.post("/community/doctor/reels")
async def doc_com_create_reel(body: ReelIn, request: Request, user: dict = Depends(require_doctor_community)):
    await rate_limit(request, f"dcom:reel:{user['id']}", max_calls=10, window_seconds=3600)
    # SEC-001: validate video & optional thumbnail
    validated_video = _validate_media_uri(body.video_url, "video", max_bytes=REEL_MAX_VIDEO_BYTES, field_name="reel video")
    validated_thumb = ""
    if body.thumbnail_url:
        validated_thumb = _validate_media_uri(body.thumbnail_url, "image", max_bytes=2_000_000, field_name="reel thumbnail")
    doc = {
        "id": str(uuid.uuid4()),
        "doctor_id": user["id"],
        "video_url": validated_video,
        "thumbnail_url": validated_thumb,
        "caption": (body.caption or "").strip(),
        "hashtags": _normalise_hashtags(body.hashtags),
        "duration_sec": float(body.duration_sec or 0),
        "likes_count": 0,
        "comments_count": 0,
        "views_count": 0,
        "hidden": False,
        "created_at": now_iso(),
    }
    await db.doc_com_reels.insert_one(doc.copy())
    doc.pop("_id", None)
    doc["author"] = await _doctor_snapshot(user["id"])
    doc["liked_by_me"] = False
    return doc


@api_router.get("/community/doctor/reels/feed")
async def doc_com_reels_feed(user: dict = Depends(require_doctor_community),
                             before: Optional[str] = None, limit: int = 20):
    limit = min(max(limit, 1), 40)
    q: Dict[str, Any] = {"hidden": {"$ne": True}}
    if before:
        q["created_at"] = {"$lt": before}
    reels = await db.doc_com_reels.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": await _hydrate_reels(reels, user["id"])}


@api_router.get("/community/doctor/reels/by/{doctor_id}")
async def doc_com_reels_by_doctor(doctor_id: str, user: dict = Depends(require_doctor_community), limit: int = 30):
    limit = min(max(limit, 1), 60)
    reels = await db.doc_com_reels.find(
        {"doctor_id": doctor_id, "hidden": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": await _hydrate_reels(reels, user["id"])}


@api_router.get("/community/doctor/reels/{reel_id}")
async def doc_com_get_reel(reel_id: str, user: dict = Depends(require_doctor_community)):
    r = await db.doc_com_reels.find_one({"id": reel_id, "hidden": {"$ne": True}}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reel not found")
    hydrated = await _hydrate_reels([r], user["id"])
    return hydrated[0]


@api_router.post("/community/doctor/reels/{reel_id}/like")
async def doc_com_reel_like(reel_id: str, user: dict = Depends(require_doctor_community)):
    r = await db.doc_com_reels.find_one({"id": reel_id}, {"_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Reel not found")
    existing = await db.doc_com_reel_likes.find_one({"reel_id": reel_id, "doctor_id": user["id"]})
    if existing:
        await db.doc_com_reel_likes.delete_one({"reel_id": reel_id, "doctor_id": user["id"]})
        await db.doc_com_reels.update_one({"id": reel_id}, {"$inc": {"likes_count": -1}})
        return {"liked": False}
    await db.doc_com_reel_likes.insert_one({
        "reel_id": reel_id, "doctor_id": user["id"], "at": now_iso(),
    })
    await db.doc_com_reels.update_one({"id": reel_id}, {"$inc": {"likes_count": 1}})
    return {"liked": True}


@api_router.post("/community/doctor/reels/{reel_id}/view")
async def doc_com_reel_view(reel_id: str, user: dict = Depends(require_doctor_community)):
    # SEC-003: dedupe views by (reel_id, doctor_id) so counts can't be inflated by refresh loops.
    exists = await db.doc_com_reels.find_one({"id": reel_id}, {"_id": 0, "id": 1})
    if not exists:
        return {"ok": True}  # silent no-op — reel gone
    existing = await db.doc_com_reel_views.find_one({"reel_id": reel_id, "doctor_id": user["id"]})
    if existing:
        return {"ok": True, "already": True}
    await db.doc_com_reel_views.insert_one({
        "id": str(uuid.uuid4()),
        "reel_id": reel_id, "doctor_id": user["id"], "at": now_iso(),
    })
    await db.doc_com_reels.update_one({"id": reel_id}, {"$inc": {"views_count": 1}})
    return {"ok": True}


@api_router.delete("/community/doctor/reels/{reel_id}")
async def doc_com_delete_reel(reel_id: str, user: dict = Depends(require_doctor_community)):
    r = await db.doc_com_reels.find_one({"id": reel_id}, {"_id": 0, "doctor_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Reel not found")
    if r["doctor_id"] != user["id"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only author or admin can delete")
    await db.doc_com_reels.delete_one({"id": reel_id})
    await db.doc_com_reel_likes.delete_many({"reel_id": reel_id})
    await db.doc_com_reel_views.delete_many({"reel_id": reel_id})
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════
# PATIENT ONBOARDING FUNNEL — PHASE 1a
# Sign-up (Google + Phone OTP mock) · Language · Prakriti Quiz ·
# Call preference · Post-quiz onboarding · Pre-sales lead
# ══════════════════════════════════════════════════════════════════

# ---- Configurable knobs (env-driven so operations can tune later) ----
CALLBACK_SLA_MINUTES = int(os.environ.get("CALLBACK_SLA_MINUTES", "10"))
WHATSAPP_NUMBER = os.environ.get("WHATSAPP_NUMBER", "+917290044081")
# SEC-001: OTP mock is DEV-ONLY. In production set OTP_MOCK_ENABLED=false and wire a real SMS provider.
# When APP_ENV=production we hard-refuse mock OTPs regardless of the OTP_MOCK_ENABLED flag,
# so a leaked/copied dev env can never accidentally ship a fixed-code account-takeover vector.
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV in ("production", "prod", "live")
OTP_MOCK_ENABLED = (
    os.environ.get("OTP_MOCK_ENABLED", "true").lower() in ("1", "true", "yes")
    and not IS_PRODUCTION
)
MOCK_OTP_CODE = os.environ.get("MOCK_OTP_CODE", "123456")
BRAND_TAGLINE = "Swasth Raho Hamesha"

# In-memory OTP store. Fine for dev; production will swap to Redis/DB.
_OTP_STORE: Dict[str, Dict[str, Any]] = {}
OTP_TTL_SECONDS = 300
OTP_COOLDOWN_SECONDS = 30
OTP_MAX_ATTEMPTS = 3
OTP_LOCK_MINUTES = 10


def _clean_indian_phone(p: str) -> str:
    """Normalise to 10-digit Indian mobile. Accepts '+91...', ' ', '-' formatting."""
    if not p:
        raise HTTPException(status_code=400, detail="Phone is required")
    digits = "".join(c for c in p if c.isdigit())
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit Indian mobile number")
    return digits


# ── Mock Phone OTP ────────────────────────────────────────────────
class PhoneOTPSendIn(BaseModel):
    phone: str = Field(..., min_length=6, max_length=20)


class PhoneOTPVerifyIn(BaseModel):
    phone: str = Field(..., min_length=6, max_length=20)
    otp: str = Field(..., min_length=4, max_length=8)
    name: Optional[str] = Field(None, max_length=120)
    email: Optional[EmailStr] = None
    role: Optional[Literal["patient", "doctor"]] = "patient"


@api_router.post("/auth/phone/send-otp")
async def phone_send_otp(body: PhoneOTPSendIn, request: Request):
    """Send an OTP over SMS via Twilio when configured, or fall back to the
    dev mock code so testing keeps working. Enforces 30s cooldown +
    3-attempt lock (10 min) matching the spec.
    """
    await rate_limit(request, "auth:otp-send", max_calls=30, window_seconds=3600)
    phone = _clean_indian_phone(body.phone)
    now = datetime.utcnow()
    row = _OTP_STORE.get(phone) or {}
    if row.get("locked_until"):
        try:
            lock_dt = datetime.fromisoformat(row["locked_until"].replace("Z", ""))
        except Exception:
            lock_dt = now
        if lock_dt > now:
            wait_mins = int((lock_dt - now).total_seconds() // 60) + 1
            raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait_mins} min.")
    if row.get("last_sent_at"):
        try:
            last = datetime.fromisoformat(row["last_sent_at"].replace("Z", ""))
        except Exception:
            last = now - timedelta(seconds=60)
        elapsed = (now - last).total_seconds()
        if elapsed < OTP_COOLDOWN_SECONDS:
            raise HTTPException(status_code=429, detail=f"Please wait {int(OTP_COOLDOWN_SECONDS - elapsed)}s before requesting again.")

    # Choose the OTP: fixed mock code when in mock mode + Twilio not configured,
    # random 6-digit otherwise (real SMS path).
    # Choose the OTP: fixed mock code only when no real provider exists AND mock is on.
    # Otherwise generate a fresh random 6-digit code so no two OTPs ever match.
    from otp_sender import twilio_configured, fast2sms_configured, send_otp_sms
    if fast2sms_configured() or twilio_configured():
        import secrets as _secrets
        otp = f"{_secrets.randbelow(1_000_000):06d}"
    else:
        otp = MOCK_OTP_CODE

    _OTP_STORE[phone] = {
        "otp": otp,
        "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat() + "Z",
        "attempts": 0,
        "locked_until": None,
        "last_sent_at": now.isoformat() + "Z",
    }

    # Ship the OTP. `send_otp_sms` handles Twilio-vs-mock internally and never raises.
    delivery = await send_otp_sms(phone, otp)
    if not delivery.get("ok"):
        # Delivery failed — clear the stored code so the user isn't stuck with an
        # unusable OTP they can't receive.
        _OTP_STORE.pop(phone, None)
        raise HTTPException(
            status_code=503,
            detail=delivery.get("error") or "OTP delivery failed. Please try again.",
        )

    resp: Dict[str, Any] = {"ok": True, "message": "OTP sent.", "provider": delivery.get("provider")}
    # SEC-001: only expose `dev_hint` in mock mode + dev env (never with real Twilio, never in prod).
    if OTP_MOCK_ENABLED and delivery.get("provider") == "mock" and not IS_PRODUCTION:
        resp["dev_hint"] = f"OTP is {otp} (mock mode — DO NOT enable in production)"
        # Loud warning so any operator who accidentally sees this in a prod log
        # knows the current deployment is dev-config.
        resp["warning"] = "TEST MODE — do not use this deployment for real users."
    return resp


@api_router.post("/auth/phone/verify-otp")
async def phone_verify_otp(body: PhoneOTPVerifyIn, request: Request):
    """Verify OTP; if user with this phone exists → login; else create user."""
    await rate_limit(request, "auth:otp-verify", max_calls=60, window_seconds=3600)
    phone = _clean_indian_phone(body.phone)
    row = _OTP_STORE.get(phone)
    if not row:
        raise HTTPException(status_code=400, detail="Please request an OTP first")
    now = datetime.utcnow()
    if row.get("locked_until"):
        try:
            lock_dt = datetime.fromisoformat(row["locked_until"].replace("Z", ""))
        except Exception:
            lock_dt = now
        if lock_dt > now:
            wait_mins = int((lock_dt - now).total_seconds() // 60) + 1
            raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait_mins} min.")
    try:
        exp = datetime.fromisoformat(row["expires_at"].replace("Z", ""))
    except Exception:
        exp = now
    if exp < now:
        raise HTTPException(status_code=400, detail="OTP expired. Please request a new one.")
    if body.otp.strip() != row["otp"]:
        row["attempts"] = int(row.get("attempts", 0)) + 1
        if row["attempts"] >= OTP_MAX_ATTEMPTS:
            row["locked_until"] = (now + timedelta(minutes=OTP_LOCK_MINUTES)).isoformat() + "Z"
            _OTP_STORE[phone] = row
            raise HTTPException(status_code=429, detail=f"Too many wrong attempts. Locked for {OTP_LOCK_MINUTES} min.")
        _OTP_STORE[phone] = row
        raise HTTPException(status_code=400, detail=f"Wrong OTP. {OTP_MAX_ATTEMPTS - row['attempts']} attempts left.")
    _OTP_STORE.pop(phone, None)  # single-use
    existing = await db.users.find_one({"phone": phone})
    if existing:
        existing.pop("_id", None)
        existing.pop("password", None)
        token = make_token(existing["id"], existing.get("role", "patient"))
        return {"token": token, "user": existing, "is_new": False}
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required for new signup")
    user_id = str(uuid.uuid4())
    doc: Dict[str, Any] = {
        "id": user_id,
        "name": body.name.strip(),
        "phone": phone,
        "email": (body.email or "").lower() if body.email else None,
        "role": body.role or "patient",
        "auth_provider": "phone",
        "phone_verified": True,
        "is_admin": False,
        "preferred_language": "en",
        "free_consult_available": True,
        "free_consult_used": False,
        "call_preference": None,
        "profile_photo": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc.copy())
    doc.pop("_id", None)
    token = make_token(user_id, doc["role"])
    await log_activity("patient_signup_phone", actor=doc, meta={"phone": phone})
    # Phase 1c: bilingual welcome email — only fires if the user shared an email.
    send_welcome_email_bg(doc)
    return {"token": token, "user": doc, "is_new": True}


# ── Emergent Google Auth (session_id exchange) ────────────────────
class GoogleSessionIn(BaseModel):
    session_id: str = Field(..., min_length=8, max_length=500)


@api_router.post("/auth/session")
async def auth_session(body: GoogleSessionIn, request: Request):
    """Exchange Emergent OAuth session_id for a JWT + user record."""
    await rate_limit(request, "auth:session", max_calls=60, window_seconds=3600)
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Auth provider unreachable: {e}") from e
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    data = resp.json() or {}
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="Google account did not return email")
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture") or data.get("profile_photo") or None
    existing = await db.users.find_one({"email": email})
    if existing:
        updates: Dict[str, Any] = {}
        if not existing.get("profile_photo") and picture:
            updates["profile_photo"] = picture
        if not existing.get("auth_provider"):
            updates["auth_provider"] = "google"
        if not existing.get("preferred_language"):
            updates["preferred_language"] = "en"
        if existing.get("free_consult_available") is None:
            updates["free_consult_available"] = True
            updates["free_consult_used"] = False
        if updates:
            await db.users.update_one({"id": existing["id"]}, {"$set": updates})
            existing.update(updates)
        existing.pop("_id", None)
        existing.pop("password", None)
        token = make_token(existing["id"], existing.get("role", "patient"))
        return {"token": token, "user": existing, "is_new": False}
    user_id = str(uuid.uuid4())
    doc: Dict[str, Any] = {
        "id": user_id,
        "name": name,
        "email": email,
        "phone": None,
        "role": "patient",
        "auth_provider": "google",
        "google_id": data.get("id") or data.get("sub") or None,
        "profile_photo": picture,
        "phone_verified": False,
        "is_admin": False,
        "preferred_language": "en",
        "free_consult_available": True,
        "free_consult_used": False,
        "call_preference": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc.copy())
    doc.pop("_id", None)
    token = make_token(user_id, doc["role"])
    await log_activity("patient_signup_google", actor=doc, meta={"email": email})
    # Phase 1c: bilingual welcome email.
    send_welcome_email_bg(doc)
    return {"token": token, "user": doc, "is_new": True}


# ─────────────────────────── Apple Sign In ────────────────────────────────
APPLE_AUDIENCES = {
    a.strip()
    for a in os.environ.get("APPLE_AUDIENCES", "").split(",")
    if a.strip()
}
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"


class AppleAuthIn(BaseModel):
    identity_token: str = Field(..., min_length=32)
    # Apple only returns these on FIRST sign-in. Backend must persist them
    # immediately — subsequent logins send `None`.
    full_name: Optional[str] = Field(None, max_length=120)
    email: Optional[EmailStr] = None


async def _verify_apple_identity_token(token: str) -> dict:
    """Validate an Apple identity token against Apple's public JWKS.
    Returns the decoded claims dict. Raises HTTPException on any failure."""
    try:
        from jwt import PyJWKClient  # local import so backend still starts without [crypto]
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="Apple sign-in is not configured on the server (pyjwt[crypto] missing)",
        )
    try:
        jwks = PyJWKClient(_APPLE_JWKS_URL)
        signing_key = jwks.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer="https://appleid.apple.com",
            options={
                "verify_aud": True, "verify_iss": True,
                "verify_exp": True, "require": ["exp", "iat", "sub"],
            },
            audience=list(APPLE_AUDIENCES) if APPLE_AUDIENCES else None,
        )
    except jwt.PyJWTError as e:
        logger.warning("Apple token verify failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid Apple identity token") from e
    except Exception as e:
        logger.error("Apple JWKS fetch error: %s", e)
        raise HTTPException(status_code=503, detail="Apple sign-in temporarily unavailable") from e
    return claims


@api_router.post("/auth/apple")
async def auth_apple(body: AppleAuthIn, request: Request):
    """Exchange an Apple identity token for a VaidyaJi JWT session.

    Mirrors the Google `/auth/session` flow. Users are keyed on `apple_sub`
    (never email — Apple may send a private-relay address that changes).
    """
    await rate_limit(request, "auth:apple", max_calls=30, window_seconds=3600)
    if not APPLE_AUDIENCES:
        raise HTTPException(
            status_code=503,
            detail="Apple sign-in is not configured on the server (APPLE_AUDIENCES missing)",
        )
    claims = await _verify_apple_identity_token(body.identity_token)
    apple_sub = claims["sub"]
    email = (claims.get("email") or (body.email or "")).strip().lower() or None
    email_verified = bool(claims.get("email_verified")) or bool(
        str(claims.get("email_verified") or "").lower() == "true"
    )

    user = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0, "password": 0})
    if user:
        # Persist first-sign-in name/email ONLY if we don't have them yet —
        # never overwrite existing values with the nulls Apple sends on later logins.
        updates: Dict[str, Any] = {}
        if body.full_name and not user.get("name"):
            updates["name"] = body.full_name
        if email and not user.get("email"):
            # Don't collide with an existing account
            existing = await db.users.find_one({"email": email, "id": {"$ne": user["id"]}})
            if not existing:
                updates["email"] = email
                if email_verified:
                    updates["email_verified"] = True
        if updates:
            await db.users.update_one({"id": user["id"]}, {"$set": updates})
            user.update(updates)
        token = make_token(user["id"], user["role"])
        await log_activity("patient_signin_apple", actor=user, meta={"apple_sub": apple_sub})
        return {"token": token, "user": user, "is_new": False}

    # New user via Apple.
    user_id = str(uuid.uuid4())
    derived_name = (
        (body.full_name or "").strip()
        or (email.split("@")[0] if email else "")
        or "Patient"
    )
    doc = {
        "id": user_id,
        "name": derived_name,
        "email": email,
        "email_verified": bool(email and email_verified),
        "phone": None,
        "password": None,
        "role": "patient",
        "is_admin": False,
        "auth_provider": "apple",
        "apple_sub": apple_sub,
        "preferred_language": None,
        "free_consult_available": True,
        "call_preference": None,
        "created_at": now_iso(),
        "last_login_at": now_iso(),
    }
    await db.users.insert_one(doc)
    token = make_token(user_id, "patient")
    await log_activity("patient_signup_apple", actor=doc, meta={"email": email})
    # Phase 1c: bilingual welcome email (fires only if we got a real email).
    if email:
        send_welcome_email_bg({k: v for k, v in doc.items() if k != "_id"})
    return {"token": token, "user": doc, "is_new": True}


# ── Update current user (language, call preference, profile) ──────
class UserUpdateIn(BaseModel):
    preferred_language: Optional[Literal["en", "hi"]] = None
    call_preference: Optional[Literal["video", "phone"]] = None
    name: Optional[str] = Field(None, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)


@api_router.patch("/users/me")
async def update_me(body: UserUpdateIn, user: dict = Depends(current_user)):
    updates: Dict[str, Any] = {}
    if body.preferred_language:
        updates["preferred_language"] = body.preferred_language
    if body.call_preference:
        updates["call_preference"] = body.call_preference
    if body.name and body.name.strip():
        updates["name"] = body.name.strip()
    if body.email:
        existing = await db.users.find_one({"email": body.email.lower(), "id": {"$ne": user["id"]}})
        if existing:
            raise HTTPException(status_code=400, detail="Email already used by another account")
        updates["email"] = body.email.lower()
    if body.phone:
        cleaned = _clean_indian_phone(body.phone)
        existing = await db.users.find_one({"phone": cleaned, "id": {"$ne": user["id"]}})
        if existing:
            raise HTTPException(status_code=400, detail="Phone already used by another account")
        updates["phone"] = cleaned
    if not updates:
        return {"ok": True, "no_change": True}
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password": 0})
    if "call_preference" in updates:
        await db.presales_leads.update_one(
            {"user_id": user["id"]}, {"$set": {"call_preference": updates["call_preference"]}}
        )
    return {"ok": True, "user": updated}


# ── Prakriti Quiz ─────────────────────────────────────────────────
KIT_CATALOG: Dict[str, Dict[str, str]] = {
    "madhu_niyantran": {"en": "Madhu Niyantran — Diabetes Care Kit", "hi": "Madhu Niyantran — Diabetes Care Kit"},
    "sandhi_sudha":    {"en": "Sandhi Sudha — Joint Pain Relief Kit", "hi": "Sandhi Sudha — Jodon ke Dard ka Kit"},
    "gut_vaidya":      {"en": "Gut Vaidya — Digestion Care Kit", "hi": "Gut Vaidya — Pet-Digestion Kit"},
    "sthul_haran":     {"en": "Sthul Haran — Weight Management Kit", "hi": "Sthul Haran — Weight Kam Karne ka Kit"},
    "kesh_raksha":     {"en": "Kesh Raksha — Hair Fall Control Kit", "hi": "Kesh Raksha — Baal Jhadne ka Kit"},
    "man_shanti":      {"en": "Man Shanti — Sleep & Stress Kit", "hi": "Man Shanti — Neend-Stress Kit"},
    "purush_shakti":   {"en": "Purush Shakti — Men's Health Kit", "hi": "Purush Shakti — Purush Health Kit"},
    "nari_shakti":     {"en": "Nari Shakti — Women's Health / PCOS Kit", "hi": "Nari Shakti — Mahila Health / PCOS Kit"},
    "yakrit_raksha":   {"en": "Yakrit Raksha — Liver Care Kit", "hi": "Yakrit Raksha — Liver ka Kit"},
    "shwas_raksha":    {"en": "Shwas Raksha — Cough & Immunity Kit", "hi": "Shwas Raksha — Khansi-Immunity Kit"},
}

PRAKRITI_COPY: Dict[str, Dict[str, Dict[str, str]]] = {
    "Vata": {
        "en": {"line1": "You're a Vata person — creative, quick-moving and lean by nature.",
                "line2": "Common issues: dry skin, gas or constipation, disturbed sleep, anxious mind.",
                "line3": "Warm cooked meals, oil massage and steady routines suit you best."},
        "hi": {"line1": "Aap Vata prakriti ke hain — creative, active aur natural roop se dubla-patla body type.",
                "line2": "Common problems: dry skin, gas ya kabz, halki neend, chinta.",
                "line3": "Garam pakaya khana, tel malish aur ek fixed routine aapko suit karta hai."},
    },
    "Pitta": {
        "en": {"line1": "You're a Pitta person — sharp, focused and naturally athletic.",
                "line2": "Common issues: acidity, skin sensitivity, irritability, burnout when overworked.",
                "line3": "Cooling foods, coconut water and calm evenings suit you best."},
        "hi": {"line1": "Aap Pitta prakriti ke hain — teekhi soch, focused aur naturally strong body.",
                "line2": "Common problems: acidity, sensitive skin, gussa, zyada kaam se burn-out.",
                "line3": "Thanda khana, nariyal paani aur shanti bhari shaam aapko suit karti hai."},
    },
    "Kapha": {
        "en": {"line1": "You're a Kapha person — grounded, calm and naturally strong-built.",
                "line2": "Common issues: slow digestion, weight gain, morning sluggishness, congestion.",
                "line3": "Light warm meals, brisk daily exercise and early mornings suit you best."},
        "hi": {"line1": "Aap Kapha prakriti ke hain — shant, strong aur naturally heavy build.",
                "line2": "Common problems: slow digestion, weight badhna, subah sust rehna, congestion.",
                "line3": "Halka garam khana, roz exercise aur jaldi subah uthna aapko suit karta hai."},
    },
    "Vata-Pitta": {
        "en": {"line1": "You're a Vata-Pitta blend — creative, sharp and always in motion.",
                "line2": "Common issues: irregular digestion, dry+sensitive skin, mind racing at night.",
                "line3": "Warm-but-cooling meals, steady routines and daily grounding rituals suit you."},
        "hi": {"line1": "Aap Vata-Pitta prakriti ke hain — creative, teekhi soch aur active.",
                "line2": "Common problems: irregular digestion, dry+sensitive skin, raat mein dimaag chalta rehna.",
                "line3": "Halka garam par cooling khana, ek fixed routine aur grounding rituals aapko suit karte hain."},
    },
    "Pitta-Kapha": {
        "en": {"line1": "You're a Pitta-Kapha blend — strong-built, focused and enduring.",
                "line2": "Common issues: acidity, weight around the middle, oily skin with breakouts.",
                "line3": "Light meals, regular exercise and cooling evening walks suit you."},
        "hi": {"line1": "Aap Pitta-Kapha prakriti ke hain — strong body, focused aur endurance wale.",
                "line2": "Common problems: acidity, pet ke aas-paas weight, oily skin par pimples.",
                "line3": "Halka khana, roz exercise aur shaam ki cooling walk aapko suit karti hai."},
    },
    "Vata-Kapha": {
        "en": {"line1": "You're a Vata-Kapha blend — creative yet grounded, with a gentle nature.",
                "line2": "Common issues: dry-cold hands, low mood in winter, sluggish digestion.",
                "line3": "Warm cooked meals, gentle morning yoga and daily sunlight suit you."},
        "hi": {"line1": "Aap Vata-Kapha prakriti ke hain — creative par grounded, shant swabhav.",
                "line2": "Common problems: dry aur thande haath, sardi mein low mood, slow digestion.",
                "line3": "Garam pakaya khana, subah ki halki yoga aur roz dhoop aapko suit karti hai."},
    },
    "Tridosha (Sam Prakriti)": {
        "en": {"line1": "You're a rare Sam Prakriti — balanced across Vata, Pitta and Kapha.",
                "line2": "Great baseline health — but any excess of one dosha shows up quickly.",
                "line3": "Seasonal routines, home-cooked meals and mindful lifestyle keep you in balance."},
        "hi": {"line1": "Aap Sam Prakriti (Tridosha) hain — Vata, Pitta, Kapha teenon balanced.",
                "line2": "Baseline health strong hai — par kisi bhi dosha ka excess jaldi dikhta hai.",
                "line3": "Seasonal routine, ghar ka khana aur mindful lifestyle aapko balance mein rakhti hai."},
    },
}


def _score_prakriti(answers: Dict[str, str]) -> Tuple[Dict[str, int], str]:
    """Sum A/B/C across Q1..Q8. Rules: all three within 1 => Tridosha. Top two
    tied or differ by 1 => dual (higher first; canonical Ayurvedic order
    Vata > Pitta > Kapha if tied so labels match PRAKRITI_COPY keys). Else top1.
    """
    scores = {"vata": 0, "pitta": 0, "kapha": 0}
    for i in range(1, 9):
        v = (answers.get(f"q{i}") or "").upper().strip()
        if v == "A": scores["vata"] += 1
        elif v == "B": scores["pitta"] += 1
        elif v == "C": scores["kapha"] += 1
    canonical_order = ["vata", "pitta", "kapha"]
    canon_rank = {k: i for i, k in enumerate(canonical_order)}
    # Sort by (-count, canonical_rank) so ties resolve in Vata > Pitta > Kapha order.
    sorted_doshas = sorted(scores.items(), key=lambda kv: (-kv[1], canon_rank[kv[0]]))
    top1_key, top1_val = sorted_doshas[0]
    top2_key, top2_val = sorted_doshas[1]
    top3_key, top3_val = sorted_doshas[2]
    if (top1_val - top3_val) <= 1:
        return scores, "Tridosha (Sam Prakriti)"
    if abs(top1_val - top2_val) <= 1:
        return scores, f"{top1_key.capitalize()}-{top2_key.capitalize()}"
    return scores, top1_key.capitalize()


class QuizSubmitIn(BaseModel):
    answers: Dict[str, str] = Field(..., description="{q1..q8: 'A'|'B'|'C'}")
    health_concern: str = Field(..., min_length=1, max_length=80)
    age_group: str = Field(..., min_length=3, max_length=10)
    utm_source: Optional[str] = Field(None, max_length=100)
    utm_medium: Optional[str] = Field(None, max_length=100)
    utm_campaign: Optional[str] = Field(None, max_length=100)


@api_router.post("/quiz/submit")
async def submit_prakriti_quiz(body: QuizSubmitIn, request: Request, user: dict = Depends(current_user)):
    # SEC-001: rate-limit per user (30 quiz submits / hour) to prevent
    # spamming duplicate welcome-emails at the user's own address.
    await rate_limit(request, f"quiz:submit:{user['id']}", max_calls=30, window_seconds=3600)
    if body.health_concern not in KIT_CATALOG:
        raise HTTPException(status_code=400, detail="Unknown health concern")
    scores, prakriti = _score_prakriti(body.answers or {})
    lang = user.get("preferred_language") or "en"
    kit = KIT_CATALOG[body.health_concern]
    copy_dict = PRAKRITI_COPY.get(prakriti) or PRAKRITI_COPY["Tridosha (Sam Prakriti)"]
    copy = copy_dict[lang]
    result_id = str(uuid.uuid4())
    quiz_doc = {
        "id": result_id, "user_id": user["id"], "answers": body.answers,
        "dosha_scores": scores, "prakriti_result": prakriti,
        "health_concern": body.health_concern,
        "recommended_kit_id": body.health_concern,
        "recommended_kit_name": kit[lang],
        "age_group": body.age_group,
        "utm_source": body.utm_source, "utm_medium": body.utm_medium, "utm_campaign": body.utm_campaign,
        "language": lang, "completed_at": now_iso(),
    }
    await db.quiz_results.update_one({"user_id": user["id"]}, {"$set": quiz_doc}, upsert=True)
    lead_existing = await db.presales_leads.find_one({"user_id": user["id"]})
    if lead_existing:
        await db.presales_leads.update_one(
            {"user_id": user["id"]},
            {"$set": {
                "prakriti_result": prakriti, "recommended_kit_id": body.health_concern,
                "recommended_kit_name": kit[lang], "health_concern": body.health_concern,
                "age_group": body.age_group, "language": lang, "updated_at": now_iso(),
            }},
        )
    else:
        await db.presales_leads.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"],
            "name": user.get("name"), "phone": user.get("phone"), "email": user.get("email"),
            "language": lang, "prakriti_result": prakriti, "health_concern": body.health_concern,
            "recommended_kit_id": body.health_concern, "recommended_kit_name": kit[lang],
            "age_group": body.age_group, "call_preference": user.get("call_preference"),
            "status": "not_contacted", "agent_name": None,
            "status_history": [{"status": "not_contacted", "timestamp": now_iso(), "agent": None}],
            "documents_uploaded": 0,
            "free_consult_available": bool(user.get("free_consult_available", True)),
            "utm_source": body.utm_source, "utm_medium": body.utm_medium, "utm_campaign": body.utm_campaign,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
    # Phase 1c: if the welcome email hasn't been sent yet (phone-signup + later
    # email addition), send it now enriched with prakriti + recommended kit.
    if user.get("email") and not user.get("welcome_email_sent_at"):
        send_welcome_email_bg(user, prakriti=prakriti, kit_name=kit[lang])
    # Also fire the richer post-quiz Prakriti Report email (idempotent per user).
    if user.get("email"):
        send_prakriti_report_email_bg(
            user,
            prakriti=prakriti,
            description=copy,
            dosha_scores=scores,
            kit_name=kit[lang],
            free_consult=bool(user.get("free_consult_available", True)),
        )
    return {
        "id": result_id, "prakriti": prakriti, "dosha_scores": scores,
        "description": copy,
        "recommended_kit": {"id": body.health_concern, "name": kit[lang]},
        "language": lang,
        "free_consult_available": bool(user.get("free_consult_available", True)),
        "callback_sla_minutes": CALLBACK_SLA_MINUTES,
    }


@api_router.get("/quiz/mine")
async def my_quiz_result(user: dict = Depends(current_user)):
    r = await db.quiz_results.find_one({"user_id": user["id"]}, {"_id": 0})
    if not r:
        return {"has_result": False}
    prakriti = r.get("prakriti_result", "Tridosha (Sam Prakriti)")
    lang = user.get("preferred_language") or r.get("language") or "en"
    copy_dict = PRAKRITI_COPY.get(prakriti) or PRAKRITI_COPY["Tridosha (Sam Prakriti)"]
    copy = copy_dict[lang]
    return {
        "has_result": True, "prakriti": prakriti,
        "dosha_scores": r.get("dosha_scores", {}), "description": copy,
        "recommended_kit": {"id": r.get("recommended_kit_id"), "name": r.get("recommended_kit_name")},
        "age_group": r.get("age_group"), "completed_at": r.get("completed_at"),
        "language": lang,
        "free_consult_available": bool(user.get("free_consult_available", True)),
        "callback_sla_minutes": CALLBACK_SLA_MINUTES,
    }


@api_router.get("/onboarding/config")
async def onboarding_config():
    return {
        "callback_sla_minutes": CALLBACK_SLA_MINUTES,
        "whatsapp_number": WHATSAPP_NUMBER,
        "whatsapp_url": f"https://wa.me/{WHATSAPP_NUMBER.lstrip('+').replace(' ', '')}",
        "tagline": BRAND_TAGLINE, "brand": "Online VaidyaJi",
        "kit_catalog": KIT_CATALOG,
    }




# ══════════════════════════════════════════════════════════════════
# HEALTH DOCUMENTS + PRE-SALES ADMIN QUEUE — PHASE 1b
# Emergent Object Storage for private medical documents.
# ══════════════════════════════════════════════════════════════════

import requests as _requests  # sync client for storage integration
import secrets
from fastapi import UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
STORAGE_APP_NAME = "online-vaidhyaji"
_storage_key: Optional[str] = None

DOC_ALLOWED_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"}
DOC_MAX_BYTES = 10 * 1024 * 1024  # 10 MB per spec
DOC_TYPES = ["blood_test", "prescription", "xray_scan", "other"]
DOC_STATUSES = ["pending_review", "sent_to_doctor", "reupload_requested"]
LEAD_STATUSES = ["not_contacted", "contacted", "consult_booked", "consult_done", "kit_ordered"]


def _init_storage_sync() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    if not _EMERGENT_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY missing — Object Storage unavailable")
    resp = _requests.post(f"{STORAGE_URL}/init", json={"emergent_key": _EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_object_sync(path: str, data: bytes, content_type: str) -> dict:
    key = _init_storage_sync()
    try:
        resp = _requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=180,
        )
        if resp.status_code == 503:
            # Possibly stale key — reset & retry once.
            globals()["_storage_key"] = None
            key = _init_storage_sync()
            resp = _requests.put(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key, "Content-Type": content_type},
                data=data, timeout=180,
            )
        resp.raise_for_status()
        return resp.json()
    except _requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 0
        if code == 402:
            raise HTTPException(status_code=402, detail="Storage credits exhausted — please contact support")
        if code in (401, 403):
            raise HTTPException(status_code=500, detail="Document storage misconfigured — please contact support")
        raise


def _get_object_sync(path: str) -> Tuple[bytes, str]:
    key = _init_storage_sync()
    try:
        resp = _requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
        if resp.status_code == 503:
            globals()["_storage_key"] = None
            key = _init_storage_sync()
            resp = _requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    except _requests.HTTPError:
        # Storage returns 500 for missing objects — surface a clean 404.
        raise HTTPException(status_code=404, detail="Document not found in storage")


# One-shot download tokens for web browsers that cannot send Authorization headers on <img>.
# {token: {"user_id": ..., "doc_id": ..., "expires_at": iso}}
_DL_TOKENS: Dict[str, Dict[str, Any]] = {}
DL_TOKEN_TTL_SECONDS = 900  # 15 min


def _make_dl_token(user_id: str, doc_id: str) -> str:
    tok = secrets.token_urlsafe(32)
    _DL_TOKENS[tok] = {
        "user_id": user_id,
        "doc_id": doc_id,
        "expires_at": (datetime.utcnow() + timedelta(seconds=DL_TOKEN_TTL_SECONDS)).isoformat() + "Z",
    }
    # Simple GC: drop expired tokens if the map gets big.
    if len(_DL_TOKENS) > 500:
        now = datetime.utcnow()
        for k in list(_DL_TOKENS.keys()):
            try:
                if datetime.fromisoformat(_DL_TOKENS[k]["expires_at"].replace("Z", "")) < now:
                    _DL_TOKENS.pop(k, None)
            except Exception:
                _DL_TOKENS.pop(k, None)
    return tok


async def _can_read_doc(doc: Dict[str, Any], user: Dict[str, Any]) -> bool:
    """Owner + admin + assigned doctor may read."""
    if doc.get("user_id") == user.get("id"):
        return True
    if user.get("is_admin") or user.get("role") == "admin":
        return True
    if user.get("role") == "doctor" and doc.get("assigned_doctor_id") == user.get("id"):
        return True
    return False


# ── Upload ────────────────────────────────────────────────────────
@api_router.post("/documents/upload")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
    user_note: Optional[str] = Form(None),
    user: dict = Depends(current_user),
):
    await rate_limit(request, f"docs:upload:{user['id']}", max_calls=30, window_seconds=3600)
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid doc_type. Use one of: {', '.join(DOC_TYPES)}")
    content_type = (file.content_type or "").lower()
    if content_type not in DOC_ALLOWED_MIMES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{content_type}'. Allowed: JPG, PNG, WEBP, PDF.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > DOC_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {DOC_MAX_BYTES // (1024 * 1024)} MB)")
    ext = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg",
           "image/png": "png", "image/webp": "webp"}.get(content_type, "bin")
    doc_id = str(uuid.uuid4())
    storage_path = f"{STORAGE_APP_NAME}/uploads/{user['id']}/{doc_id}.{ext}"
    try:
        await run_in_threadpool(_put_object_sync, storage_path, data, content_type)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Object storage upload failed: {e}")
        raise HTTPException(status_code=502, detail="Storage temporarily unavailable — please try again")
    doc_meta: Dict[str, Any] = {
        "id": doc_id,
        "user_id": user["id"],
        "storage_path": storage_path,
        "original_name": (file.filename or f"document.{ext}")[:200],
        "content_type": content_type,
        "size_bytes": len(data),
        "doc_type": doc_type,
        "user_note": (user_note or "").strip()[:500],
        "status": "pending_review",
        "reviewed_by": None,
        "assigned_doctor_id": None,
        "review_note": None,
        "uploaded_at": now_iso(),
        "reviewed_at": None,
    }
    await db.health_documents.insert_one(doc_meta.copy())
    # Bump presales lead documents_uploaded counter for the SLA queue.
    await db.presales_leads.update_one(
        {"user_id": user["id"]}, {"$inc": {"documents_uploaded": 1}, "$set": {"updated_at": now_iso()}}
    )
    doc_meta.pop("_id", None)
    return doc_meta


@api_router.get("/documents/mine")
async def list_my_documents(user: dict = Depends(current_user), limit: int = 100):
    rows = await db.health_documents.find(
        {"user_id": user["id"]}, {"_id": 0, "storage_path": 0}
    ).sort("uploaded_at", -1).limit(min(max(limit, 1), 200)).to_list(200)
    for r in rows:
        r["download_token"] = _make_dl_token(user["id"], r["id"])
    return {"items": rows, "total": len(rows)}


@api_router.get("/documents/{doc_id}")
async def get_document_meta(doc_id: str, user: dict = Depends(current_user)):
    doc = await db.health_documents.find_one({"id": doc_id}, {"_id": 0, "storage_path": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not await _can_read_doc(doc, user):
        raise HTTPException(status_code=403, detail="You cannot view this document")
    doc["download_token"] = _make_dl_token(user["id"], doc_id)
    return doc


@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(current_user)):
    doc = await db.health_documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Only the uploader can delete")
    if doc.get("status") != "pending_review":
        raise HTTPException(status_code=400, detail="Cannot delete a document once it has been reviewed")
    # Soft delete: mark as deleted; keep storage object (no delete API on emergent storage).
    await db.health_documents.update_one(
        {"id": doc_id}, {"$set": {"deleted": True, "deleted_at": now_iso()}}
    )
    return {"deleted": True}


# ── File download (auth via Bearer OR short-lived query token for web) ──
@api_router.get("/files/{doc_id}")
async def download_document(doc_id: str, request: Request, token: Optional[str] = Query(None)):
    # Path 1 — Bearer token (native app)
    caller_user: Optional[Dict[str, Any]] = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = jwt.decode(auth_header.split(" ", 1)[1], JWT_SECRET, algorithms=[JWT_ALGORITHM])
            caller_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password": 0})
        except Exception:
            caller_user = None
    # Path 2 — short-lived query token (web <img>)
    if not caller_user and token:
        entry = _DL_TOKENS.get(token)
        if entry:
            try:
                exp = datetime.fromisoformat(entry["expires_at"].replace("Z", ""))
                if exp > datetime.utcnow() and entry["doc_id"] == doc_id:
                    caller_user = await db.users.find_one({"id": entry["user_id"]}, {"_id": 0, "password": 0})
            except Exception:
                pass
    if not caller_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    doc = await db.health_documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc or doc.get("deleted"):
        raise HTTPException(status_code=404, detail="Document not found")
    if not await _can_read_doc(doc, caller_user):
        raise HTTPException(status_code=403, detail="You cannot view this document")
    content, mime = await run_in_threadpool(_get_object_sync, doc["storage_path"])
    return Response(content=content, media_type=mime, headers={
        "Content-Disposition": f'inline; filename="{doc.get("original_name", "document")}"',
        "Cache-Control": "private, max-age=300",
        # Hardening: block browser MIME sniffing that could reinterpret an uploaded file as HTML/JS
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    })


# ══════════════════════════════════════════════════════════════════
# PRE-SALES ADMIN QUEUE  (role=admin OR role=presales)
# ══════════════════════════════════════════════════════════════════

def _is_presales(user: Dict[str, Any]) -> bool:
    return bool(user.get("is_admin") or user.get("super_admin") or user.get("role") in ("admin", "presales"))


async def require_presales(user: dict = Depends(current_user)) -> Dict[str, Any]:
    if not _is_presales(user):
        raise HTTPException(status_code=403, detail="Admin/pre-sales role required")
    return user


@api_router.get("/admin/presales/leads")
async def admin_list_presales_leads(
    admin: dict = Depends(require_presales),
    status: Optional[str] = None,
    limit: int = 200,
):
    q: Dict[str, Any] = {}
    if status:
        if status not in LEAD_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        q["status"] = status
    rows = await db.presales_leads.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, 500)).to_list(500)
    now = datetime.now(timezone.utc)
    sla_secs = CALLBACK_SLA_MINUTES * 60
    out: List[Dict[str, Any]] = []
    for r in rows:
        # SLA calc — normalise stored timestamp to tz-aware UTC.
        raw = r.get("created_at") or now_iso()
        try:
            iso = raw.replace("Z", "+00:00") if raw.endswith("Z") else raw
            created = datetime.fromisoformat(iso)
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = now
        age_seconds = int((now - created).total_seconds())
        r["age_seconds"] = age_seconds
        r["sla_breached"] = (r.get("status") == "not_contacted" and age_seconds > sla_secs)
        r["tel_link"] = f"tel:{r.get('phone', '')}" if r.get("phone") else None
        out.append(r)
    # Counts
    today = datetime.utcnow().strftime("%Y-%m-%d")
    today_count = await db.presales_leads.count_documents({"created_at": {"$regex": f"^{today}"}})
    pending_calls = await db.presales_leads.count_documents({"status": "not_contacted"})
    booked_today = await db.presales_leads.count_documents({"status": "consult_booked", "updated_at": {"$regex": f"^{today}"}})
    pending_docs = await db.health_documents.count_documents({"status": "pending_review", "deleted": {"$ne": True}})
    return {
        "items": out,
        "stats": {
            "today_signups": today_count,
            "pending_calls": pending_calls,
            "consults_booked_today": booked_today,
            "pending_documents": pending_docs,
            "sla_minutes": CALLBACK_SLA_MINUTES,
        },
    }


class LeadStatusIn(BaseModel):
    status: Literal["not_contacted", "contacted", "consult_booked", "consult_done", "kit_ordered"]
    agent_name: Optional[str] = Field(None, max_length=120)
    note: Optional[str] = Field(None, max_length=500)


@api_router.patch("/admin/presales/leads/{lead_id}/status")
async def admin_update_lead_status(lead_id: str, body: LeadStatusIn, admin: dict = Depends(require_presales)):
    lead = await db.presales_leads.find_one({"id": lead_id}, {"_id": 0, "status_history": 1, "user_id": 1})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    entry = {
        "status": body.status,
        "timestamp": now_iso(),
        "agent": body.agent_name or admin.get("name") or admin.get("email"),
        "note": (body.note or "").strip() or None,
    }
    updates = {
        "status": body.status,
        "agent_name": entry["agent"],
        "updated_at": now_iso(),
    }
    if body.status == "consult_done":
        updates["free_consult_available"] = False
        # Guard: only update if we actually have a linked user_id (empty filter would match-all)
        linked_user_id = lead.get("user_id")
        if linked_user_id:
            await db.users.update_one(
                {"id": linked_user_id},
                {"$set": {"free_consult_used": True, "free_consult_available": False}},
            )
    await db.presales_leads.update_one(
        {"id": lead_id},
        {"$set": updates, "$push": {"status_history": entry}},
    )
    await log_activity("presales_lead_status", actor=admin, meta={"lead_id": lead_id, "status": body.status})
    return {"ok": True}


@api_router.get("/admin/presales/leads.csv")
async def admin_export_leads_csv(admin: dict = Depends(require_presales)):
    rows = await db.presales_leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    import io, csv
    # SEC-003: neutralise CSV formula-injection. Excel/Sheets/LibreOffice evaluate cells
    # starting with = + - @ (and tab/CR variants) as formulas. Prepend a single quote to
    # any user-supplied cell that begins with those chars so the cell becomes inert text.
    def _safe(v: Any) -> Any:
        if v is None:
            return ""
        s = str(v)
        if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + s
        return s
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["created_at", "name", "phone", "email", "language", "prakriti", "concern",
                "recommended_kit", "call_preference", "age_group", "status", "agent",
                "documents_uploaded", "utm_source", "utm_medium", "utm_campaign"])
    for r in rows:
        w.writerow([
            _safe(r.get("created_at")), _safe(r.get("name")), _safe(r.get("phone")), _safe(r.get("email")),
            _safe(r.get("language")), _safe(r.get("prakriti_result")), _safe(r.get("health_concern")),
            _safe(r.get("recommended_kit_name")), _safe(r.get("call_preference")), _safe(r.get("age_group")),
            _safe(r.get("status")), _safe(r.get("agent_name")), _safe(r.get("documents_uploaded", 0)),
            _safe(r.get("utm_source")), _safe(r.get("utm_medium")), _safe(r.get("utm_campaign")),
        ])
    return Response(content=buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="presales_leads.csv"'
    })


# ── Admin documents review queue ──────────────────────────────────
@api_router.get("/admin/documents/pending")
async def admin_pending_documents(admin: dict = Depends(require_presales), status: Optional[str] = "pending_review", limit: int = 200):
    q: Dict[str, Any] = {"deleted": {"$ne": True}}
    if status and status in DOC_STATUSES:
        q["status"] = status
    rows = await db.health_documents.find(q, {"_id": 0, "storage_path": 0}).sort("uploaded_at", -1).limit(min(limit, 500)).to_list(500)
    for r in rows:
        u = await db.users.find_one({"id": r.get("user_id")}, {"_id": 0, "name": 1, "phone": 1, "email": 1, "preferred_language": 1})
        r["user"] = u or {}
        r["download_token"] = _make_dl_token(admin["id"], r["id"])
    return {"items": rows}


class DocumentReviewIn(BaseModel):
    decision: Literal["approve", "reupload"]
    assigned_doctor_id: Optional[str] = Field(None, max_length=100)
    review_note: Optional[str] = Field(None, max_length=500)


@api_router.patch("/admin/documents/{doc_id}/review")
async def admin_review_document(doc_id: str, body: DocumentReviewIn, admin: dict = Depends(require_presales)):
    doc = await db.health_documents.find_one({"id": doc_id}, {"_id": 0, "user_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if body.decision == "approve":
        if not body.assigned_doctor_id:
            raise HTTPException(status_code=400, detail="Please assign a doctor")
        # Ensure the doctor exists & verified
        doctor = await db.doctors.find_one({"user_id": body.assigned_doctor_id}, {"_id": 0, "verified": 1})
        if not doctor:
            raise HTTPException(status_code=404, detail="Doctor not found")
        updates = {
            "status": "sent_to_doctor",
            "assigned_doctor_id": body.assigned_doctor_id,
            "reviewed_by": admin["id"],
            "reviewed_at": now_iso(),
            "review_note": (body.review_note or "").strip() or None,
        }
    else:
        updates = {
            "status": "reupload_requested",
            "reviewed_by": admin["id"],
            "reviewed_at": now_iso(),
            "review_note": (body.review_note or "Please re-upload — the document was unclear.").strip(),
        }
    await db.health_documents.update_one({"id": doc_id}, {"$set": updates})
    # Notify the user via existing _notify system (best-effort)
    try:
        await _notify(doc["user_id"], "document_review", admin["id"], doc_id,
                      snippet=("Your document was forwarded to your doctor." if body.decision == "approve" else "Please re-upload your document."))
    except Exception:
        pass
    await log_activity("presales_doc_review", actor=admin, meta={"doc_id": doc_id, "decision": body.decision})
    return {"ok": True, "status": updates["status"]}




@api_router.get("/")
async def root():
    return {"message": "Online VaidyaJi API", "version": "1.0"}


app.include_router(api_router)

cors_origins = os.environ.get("CORS_ORIGINS", "*")
allow_origins_list = [o.strip() for o in cors_origins.split(",")] if cors_origins != "*" else ["*"]
# Security: wildcard + credentials is disallowed by the CORS spec and unsafe.
# When origins are "*" we drop credentials automatically (JWT is sent via Authorization header,
# not cookies, so this is safe). Set CORS_ORIGINS to your explicit prod domain for stricter posture.
_allow_credentials = "*" not in allow_origins_list

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=allow_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
