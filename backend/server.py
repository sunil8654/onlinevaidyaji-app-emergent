from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, timezone
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
JWT_ALGORITHM = os.environ['JWT_ALGORITHM']
JWT_EXPIRE_DAYS = int(os.environ.get('JWT_EXPIRE_DAYS', 30))
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@vaidhyaji.com')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Admin@123')

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


# ----------------- Models -----------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["patient", "doctor"] = "patient"
    phone: Optional[str] = None
    registration_number: Optional[str] = None  # for doctors


class LoginInput(BaseModel):
    email: EmailStr
    password: str


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
    session_id: str
    message: str


class ChallengeJoinInput(BaseModel):
    challenge_id: str


class PrescriptionInput(BaseModel):
    diagnosis: str
    medicines: str  # multi-line text
    notes: Optional[str] = None


class ReportInput(BaseModel):
    title: str
    kind: str = "lab"  # lab | scan | note
    date: Optional[str] = None
    notes: Optional[str] = None
    image_base64: Optional[str] = None  # optional


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


# ----------------- Auth Routes -----------------
@api_router.post("/auth/register")
async def register(body: RegisterInput):
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
async def login(body: LoginInput):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = make_token(user["id"], user["role"])
    user.pop("_id", None)
    user.pop("password", None)
    return {"token": token, "user": user}


@api_router.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return user


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
@api_router.get("/doctors")
async def list_doctors(specialty: Optional[str] = None):
    q = {"verified": True}
    if specialty and specialty.lower() != "all":
        q["specialty"] = specialty
    docs = await db.doctors.find(q, {"_id": 0}).to_list(200)
    return docs


@api_router.get("/doctors/{doctor_id}")
async def get_doctor(doctor_id: str):
    doc = await db.doctors.find_one({"id": doctor_id}, {"_id": 0})
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
    return appt


@api_router.get("/appointments")
async def list_appointments(user: dict = Depends(current_user)):
    q = {"patient_id": user["id"]} if user["role"] == "patient" else {"doctor_id": user["id"]}
    items = await db.appointments.find(q, {"_id": 0}).sort("slot", 1).to_list(200)
    return items


@api_router.post("/appointments/{appt_id}/pay")
async def pay_appointment(appt_id: str, user: dict = Depends(current_user)):
    r = await db.appointments.update_one(
        {"id": appt_id, "patient_id": user["id"]},
        {"$set": {"paid": True, "paid_at": now_iso()}}
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Appointment not found")
    appt = await db.appointments.find_one({"id": appt_id}, {"_id": 0})
    return appt


@api_router.post("/appointments/{appt_id}/prescription")
async def add_prescription(appt_id: str, body: PrescriptionInput, user: dict = Depends(current_user)):
    # Either the patient (demo) or the doctor of the appt can add — for MVP demo flexibility
    appt = await db.appointments.find_one({"id": appt_id}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if user["id"] not in (appt.get("patient_id"), appt.get("doctor_id")):
        raise HTTPException(status_code=403, detail="Not allowed")
    prescription = {
        **body.dict(),
        "written_at": now_iso(),
        "author_id": user["id"],
        "author_name": user["name"],
    }
    await db.appointments.update_one({"id": appt_id}, {"$set": {"prescription": prescription}})
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
    if r.status_code == 409:
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
        # Authorization: only linked patient or doctor
        if user["id"] not in (appt.get("patient_id"), appt.get("doctor_id")):
            raise HTTPException(status_code=403, detail="Not part of this appointment")
        room_name = appt.get("daily_room_name") or f"vaidhya-appt-{appt['id']}"[:60]
        is_owner = user["id"] == appt.get("doctor_id")
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
    if not safe_room:
        raise HTTPException(status_code=400, detail="Invalid room name")
    room_url_js = json.dumps(f"https://{safe_domain}.daily.co/{safe_room}")
    token_js = json.dumps(token)
    user_name_js = json.dumps(user_name or "Guest")

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
    return {"ok": True, "streak": 1}


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
async def chat_message(body: ChatMessageInput, user: dict = Depends(current_user)):
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
        raise HTTPException(status_code=502, detail=f"AI error: {str(e)}")

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
        await db.users.update_one({"email": ADMIN_EMAIL.lower()}, {"$set": {"is_admin": True, "role": "admin"}})


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
    session_id: str
    message: str


class LeadInput(BaseModel):
    name: str
    contact: str  # phone or email
    goal: Optional[str] = None
    source: Optional[str] = "support-chat"


@api_router.post("/support/chat")
async def support_chat(body: SupportChatInput):
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
        raise HTTPException(status_code=502, detail=f"AI error: {str(e)}")
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
        qty = int(it.get("qty", 1))
        if not m:
            continue
        line = qty * m.get("price", 0)
        total += line
        resolved.append({"medicine_id": m["id"], "name": m["name"], "qty": qty, "unit_price": m["price"], "line_total": line})
    order = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "items": resolved,
        "address": body.address,
        "total": total,
        "status": "paid",  # mock
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


@api_router.post("/diet-plan")
async def generate_diet_plan(body: DietPlanInput, user: dict = Depends(current_user)):
    prompt = (
        f"Create a personalised 1-day AYUSH diet plan.\n"
        f"Goal: {body.goal}\n"
        f"Dosha: {body.dosha or 'unknown'}\n"
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
    plan = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "goal": body.goal,
        "dosha": body.dosha,
        "plan": text,
        "created_at": now_iso(),
    }
    await db.diet_plans.insert_one(plan)
    plan.pop("_id", None)
    await log_activity("diet_plan_generated", actor=user, meta={"goal": body.goal})
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
    upd["onboarded_at"] = now_iso()
    upd["documents_uploaded"] = bool(body.documents) or bool(body.registration_number)
    r = await db.doctors.update_one({"user_id": user["id"]}, {"$set": upd}, upsert=True)
    d = await db.doctors.find_one({"user_id": user["id"]}, {"_id": 0})
    await log_activity("doctor_onboarded", actor=user, meta={"specialty": body.specialty})
    return d


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


# ----------------- Push notifications -----------------
class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
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


# ----------------- End new features -----------------


@api_router.get("/")
async def root():
    return {"message": "Online Vaidhyaji API", "version": "1.0"}


app.include_router(api_router)

cors_origins = os.environ.get("CORS_ORIGINS", "*")
allow_origins_list = [o.strip() for o in cors_origins.split(",")] if cors_origins != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=allow_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
