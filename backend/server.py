from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt

from emergentintegrations.llm.chat import LlmChat, UserMessage

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
    await db.appointments.insert_one(appt)
    appt.pop("_id", None)
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
    users = await db.users.find({"role": "patient"}, {"_id": 0, "password": 0}).sort("created_at", -1).to_list(1000)
    for u in users:
        u["appointments"] = await db.appointments.count_documents({"patient_id": u["id"]})
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


@api_router.get("/")
async def root():
    return {"message": "Online Vaidhyaji API", "version": "1.0"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
