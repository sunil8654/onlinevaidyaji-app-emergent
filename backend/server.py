from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
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

app = FastAPI(title="Online Vaidhyaji API")
api_router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


# ----------------- Models -----------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["patient", "doctor"] = "patient"
    phone: Optional[str] = None


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
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
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
    q = {}
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
        "created_at": now_iso(),
    }
    await db.appointments.insert_one(appt)
    appt.pop("_id", None)
    return appt


@api_router.get("/appointments")
async def list_appointments(user: dict = Depends(current_user)):
    q = {"patient_id": user["id"]} if user["role"] == "patient" else {"doctor_id": user["id"]}
    items = await db.appointments.find(q, {"_id": 0}).sort("slot", 1).to_list(200)
    return items


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
             "rating": 4.8, "reviews": 214},
            {"id": str(uuid.uuid4()), "name": "Dr. Arjun Nair", "specialty": "Homoeopathy",
             "qualification": "BHMS", "experience_years": 9,
             "languages": ["English", "Malayalam", "Hindi"], "consultation_fee": 499,
             "bio": "Chronic skin & respiratory conditions with individualised remedies.",
             "avatar_url": "https://images.pexels.com/photos/5888168/pexels-photo-5888168.jpeg",
             "rating": 4.7, "reviews": 158},
            {"id": str(uuid.uuid4()), "name": "Yogacharya Riya Patel", "specialty": "Yoga",
             "qualification": "MSc Yoga Therapy", "experience_years": 15,
             "languages": ["Hindi", "Gujarati", "English"], "consultation_fee": 399,
             "bio": "Therapeutic yoga for back pain, PCOS, and anxiety.",
             "avatar_url": "https://images.pexels.com/photos/5938358/pexels-photo-5938358.jpeg",
             "rating": 4.9, "reviews": 302},
            {"id": str(uuid.uuid4()), "name": "Hakim Zaid Ahmad", "specialty": "Unani",
             "qualification": "BUMS", "experience_years": 20,
             "languages": ["Urdu", "Hindi", "English"], "consultation_fee": 549,
             "bio": "Traditional Unani mizaj-based diagnosis and treatment.",
             "avatar_url": "https://images.pexels.com/photos/6749773/pexels-photo-6749773.jpeg",
             "rating": 4.6, "reviews": 121},
            {"id": str(uuid.uuid4()), "name": "Dr. Kavitha Iyer", "specialty": "Siddha",
             "qualification": "BSMS", "experience_years": 11,
             "languages": ["Tamil", "English"], "consultation_fee": 449,
             "bio": "Siddha herbal & mineral therapies for chronic ailments.",
             "avatar_url": "https://images.pexels.com/photos/5407206/pexels-photo-5407206.jpeg",
             "rating": 4.7, "reviews": 96},
            {"id": str(uuid.uuid4()), "name": "Dr. Rohan Deshmukh", "specialty": "Ayurveda",
             "qualification": "BAMS, MD (Kayachikitsa)", "experience_years": 8,
             "languages": ["Marathi", "Hindi", "English"], "consultation_fee": 449,
             "bio": "Gut health, immunity and metabolic disorders.",
             "avatar_url": "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg",
             "rating": 4.5, "reviews": 74},
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


# ----------------- App wiring -----------------
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

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
