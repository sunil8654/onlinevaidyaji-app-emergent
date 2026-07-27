from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, validator
from typing import List, Optional, Literal, Dict, Any
import uuid
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
import asyncio
import time
import jwt
import bcrypt

from emergentintegrations.llm.chat import LlmChat, UserMessage
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Auth
JWT_SECRET = os.environ['JWT_SECRET']
# Guard against weak/default secrets in production
if len(JWT_SECRET) < 32 or "change-me" in JWT_SECRET.lower() or JWT_SECRET.lower() in {"secret", "changeme", "vaidhyaji"}:
    raise RuntimeError(
        "JWT_SECRET is too weak or a known default. Set a strong random value (>=32 chars) in .env"
    )
JWT_ALGORITHM = os.environ['JWT_ALGORITHM']
JWT_EXPIRE_DAYS = int(os.environ.get('JWT_EXPIRE_DAYS', 30))
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')
# Guard against missing / weak / well-known admin creds (prevents SEC-001)
_WEAK_ADMIN_PWDS = {"admin", "admin123", "admin@123", "password", "changeme", "vaidhyaji", "admin@vaidhyaji"}
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

app = FastAPI(title="Online Vaidhyaji API")
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
    phone: str  # MANDATORY — 10-digit Indian mobile
    role: Literal["patient", "doctor"] = "patient"
    registration_number: Optional[str] = Field(None, max_length=100)  # for doctors

    @validator("phone")
    def validate_phone(cls, v: str) -> str:
        # Normalise: strip spaces, plus, hyphens, and country code 91
        raw = "".join(ch for ch in (v or "") if ch.isdigit())
        if raw.startswith("91") and len(raw) == 12:
            raw = raw[2:]
        if len(raw) != 10 or not raw[0] in "6789":
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
    # Deliberately NOT included: phone, email, registration_number, user_id.
}


@api_router.get("/doctors")
async def list_doctors(specialty: Optional[str] = None):
    q = {"verified": True}
    if specialty and specialty.lower() != "all":
        q["specialty"] = specialty
    docs = await db.doctors.find(q, _PUBLIC_DOCTOR_PROJECTION).to_list(200)
    for d in docs:
        d.setdefault("is_available", True)
        d.setdefault("consultation_mode", "both")
    return docs


@api_router.get("/doctors/{doctor_id}")
async def get_doctor(doctor_id: str):
    doc = await db.doctors.find_one({"id": doctor_id}, _PUBLIC_DOCTOR_PROJECTION)
    if not doc:
        raise HTTPException(status_code=404, detail="Doctor not found")
    return doc


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
  <title>Online Vaidhyaji Consultation</title>
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
    name: str = "Online Vaidhyaji",
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
  <title>Vaidhyaji Checkout</title>
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
    {"key": "first_step",       "title": "First Step",       "desc": "Signed up for Vaidhyaji",           "icon": "star",          "points": 20},
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
    "You are 'AI Vaidhyaji', a warm, knowledgeable AYUSH health companion inspired by the "
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
             "author": "Vaidhyaji Editorial", "read_min": 3, "created_at": now_iso()},
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
    # Seed / upsert single admin
    existing = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Vaidhyaji Admin",
            "email": ADMIN_EMAIL.lower(),
            "password": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "is_admin": True,
            "phone": None,
            "created_at": now_iso(),
        })
    else:
        # ALWAYS sync stored password with current env ADMIN_PASSWORD at startup so
        # rotating the env value invalidates any previously-known credential (SEC-001).
        # Skip only if the current env password already matches (avoids needless writes).
        set_doc = {"is_admin": True, "role": "admin"}
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
                    "message": f"Welcome to Online Vaidhyaji, Dr. {d.get('name', 'Vaidya')}. Start seeing patients now.",
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
        {"$match": {"role": "patient"}},
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
    "You are 'Vaidhyaji Support' — a warm, helpful assistant for the Online Vaidhyaji app. "
    "Your job is TWO-fold: "
    "(1) Answer user questions about how to use the app (booking doctors, AYUSH specialties, symptom checker, medicine reminders, wellness challenges, pricing, health records). "
    "(2) Gently collect the user's name, phone/email and their goal (e.g., 'need Ayurvedic consultation for acidity') so our team can follow up — but ONLY if they haven't shared this yet and only after answering their query. "
    "Keep responses concise (2-3 short paragraphs), warm, and India-focused. Use occasional Hindi phrases (Namaste, Dhanyavaad, Aap ki seva mein). "
    "If a user shares contact details, respond with: 'Got it! We will follow up soon.' and end that message with a marker on a new line: LEAD_CAPTURED. "
    "Never give medical diagnoses — for medical queries, gently redirect them to the AI Vaidhyaji chatbot inside the app or a real doctor."
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
    target_type: Literal["post", "comment"]
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
        raise HTTPException(status_code=403, detail="Your doctor account is not yet verified. Please contact the Vaidhyaji admin team.")
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
        {"_id": 0, "name": 1, "specialty": 1, "qualification": 1, "avatar_url": 1, "verified": 1, "clinic_name": 1},
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
    # Cap total payload per image ~4 MB
    for i, img in enumerate(body.images):
        if not isinstance(img, str) or len(img) > 4_500_000:
            raise HTTPException(status_code=400, detail=f"Image {i+1} too large (max 4 MB)")
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
    p = await db.doc_com_posts.find_one({"id": post_id}, {"_id": 0, "id": 1, "doctor_id": 1})
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
    p = await db.doc_com_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
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
    p = await db.doc_com_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
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
    p = await db.doc_com_posts.find_one({"id": post_id}, {"_id": 0, "id": 1, "doctor_id": 1})
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
    q = (q or "").strip()
    if not q or len(q) < 2:
        return {"doctors": [], "hashtags": [], "posts": []}
    limit = min(max(limit, 1), 40)
    # Doctors by name / specialty
    doc_query = {
        "verified": True,
        "$or": [
            {"name": {"$regex": q, "$options": "i"}},
            {"specialty": {"$regex": q, "$options": "i"}},
        ],
    }
    doc_rows = await db.doctors.find(
        doc_query,
        {"_id": 0, "user_id": 1, "name": 1, "specialty": 1, "avatar_url": 1, "verified": 1, "clinic_name": 1},
    ).limit(limit).to_list(limit)
    doctors = [{
        "id": r["user_id"], "name": r["name"], "specialty": r.get("specialty", ""),
        "avatar_url": r.get("avatar_url", ""), "verified": True, "clinic_name": r.get("clinic_name", ""),
    } for r in doc_rows]
    # Hashtag search
    tag = q.lstrip("#").lower()
    pipeline = [
        {"$match": {"hidden": {"$ne": True}}},
        {"$unwind": "$hashtags"},
        {"$match": {"hashtags": {"$regex": f"^{tag}"}}},
        {"$group": {"_id": "$hashtags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ]
    tag_rows = await db.doc_com_posts.aggregate(pipeline).to_list(limit)
    hashtags = [{"tag": r["_id"], "count": r["count"]} for r in tag_rows]
    # Recent posts matching caption
    post_rows = await db.doc_com_posts.find(
        {"hidden": {"$ne": True}, "caption": {"$regex": q, "$options": "i"}}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    posts = await _hydrate_posts(post_rows, user["id"])
    return {"doctors": doctors, "hashtags": hashtags, "posts": posts}


@api_router.get("/community/doctor/hashtag/{tag}")
async def doc_com_by_hashtag(tag: str, user: dict = Depends(require_doctor_community), limit: int = 30):
    tag = tag.lstrip("#").lower()
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
        {"verified": True, "user_id": {"$nin": list(excluded)}},
        {"_id": 0, "user_id": 1, "name": 1, "specialty": 1, "avatar_url": 1, "verified": 1},
    ).limit(limit).to_list(limit)
    return [{
        "id": d["user_id"], "name": d.get("name", "Doctor"),
        "specialty": d.get("specialty", ""), "avatar_url": d.get("avatar_url", ""), "verified": True,
    } for d in docs]


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
async def doc_com_report(body: DoctorReportIn, user: dict = Depends(require_doctor_community)):
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
        if r["target_type"] == "post":
            p = await db.doc_com_posts.find_one({"id": r["target_id"]}, {"_id": 0, "id": 1, "doctor_id": 1, "caption": 1, "hidden": 1})
            r["post"] = p
        else:
            c = await db.doc_com_comments.find_one({"id": r["target_id"]}, {"_id": 0})
            r["comment"] = c
    return {"items": rows}


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
    doctors = await db.users.find({"role": "doctor"}, {"_id": 0, "id": 1}).to_list(2000)
    for d in doctors:
        await _notify(d["id"], "announcement", admin["id"], doc["id"], snippet=body.message[:120])
    await log_activity("doc_community_broadcast", actor=admin, meta={"post_id": doc["id"]})
    doc.pop("_id", None)
    return doc


@api_router.get("/")
async def root():
    return {"message": "Online Vaidhyaji API", "version": "1.0"}


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
