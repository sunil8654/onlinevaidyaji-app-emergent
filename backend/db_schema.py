"""Database schema documentation + startup index creation.

This module is the single source of truth for the MongoDB collections used by
Online VaidyaJi. MongoDB is schemaless, but we still:
1. Document every collection with its fields, types, and purpose (below).
2. Create indexes at startup (`ensure_indexes(db)`) so every environment —
   local, staging, production — has the same fast-lookup shape.

Design rules:
- Every document has a `id: str` (UUID) — never rely on `_id` in the app layer.
- Timestamps are ISO 8601 strings in UTC (append "Z").
- Deletes are soft where possible (`deleted_at: str | None`).
- User PII lives ONLY in the `users` collection; other collections reference
  by `user_id` / `doctor_id` / `patient_id`.

Call `await ensure_indexes(db)` from the FastAPI startup event.
"""
from typing import Any, Dict, List
import logging

logger = logging.getLogger(__name__)

# Sort-direction constants — same values as pymongo so existing index specs
# (which use ASCENDING/DESCENDING) keep working against the msdb SQL layer.
ASCENDING = 1
DESCENDING = -1
TEXT = "text"

# ─────────────────── Collection descriptors (documentation) ───────────────
# Each entry: name -> {"description": str, "fields": {name: type}}
COLLECTIONS: Dict[str, Dict[str, Any]] = {
    # ─── AUTH & IDENTITY ─────────────────────────────────────────────────
    "users": {
        "description": "Patient/doctor/admin accounts. Single source of truth for identity.",
        "fields": {
            "id": "str (uuid)", "name": "str", "email": "str|null",
            "email_verified": "bool", "phone": "str|null",
            "password": "str|null (bcrypt hash — null for OAuth-only users)",
            "role": "'patient'|'doctor'|'admin'", "is_admin": "bool",
            "super_admin": "bool",
            "auth_provider": "'email'|'google'|'apple'|'phone'",
            "google_sub": "str|null", "apple_sub": "str|null",
            "preferred_language": "'en'|'hi'|null",
            "free_consult_available": "bool", "call_preference": "'video'|'phone'|null",
            "welcome_email_sent_at": "str (iso)|null",
            "prakriti_email_sent_at": "str (iso)|null",
            "created_at": "str (iso)", "last_login_at": "str (iso)",
            "must_change_password": "bool",
        },
    },
    "password_resets": {
        "description": "Short-lived password reset tokens (10 min TTL).",
        "fields": {"token": "str", "user_id": "str", "expires_at": "str (iso)"},
    },

    # ─── DOCTOR DIRECTORY ────────────────────────────────────────────────
    "doctors": {
        "description": "Doctor profile card (public projection filtered separately).",
        "fields": {
            "id": "str (uuid)", "user_id": "str (users.id)", "name": "str",
            "specialty": "str", "qualification": "str",
            "experience_years": "int", "languages": "list[str]",
            "consultation_fee": "int (₹)", "consultation_mode": "'video'|'phone'|'both'",
            "bio": "str", "avatar_url": "str", "rating": "float",
            "reviews": "int", "verified": "bool", "is_available": "bool",
            "registration_number": "str", "last_seen_at": "str (iso)|null",
        },
    },

    # ─── APPOINTMENTS & PRESCRIPTIONS ────────────────────────────────────
    "appointments": {
        "description": "Booked consultations (video/phone).",
        "fields": {
            "id": "str", "patient_id": "str", "doctor_id": "str",
            "slot": "str (iso)", "mode": "'video'|'phone'", "status": "str",
            "call_url": "str|null", "prescription": "dict|null",
            "created_at": "str (iso)",
        },
    },
    "prescriptions": {"description": "Prescription-only records (denormalised for admin views).", "fields": {}},

    # ─── ONBOARDING (Phase 1a/1b) ────────────────────────────────────────
    "quiz_results": {
        "description": "Prakriti quiz outcome per user (idempotent).",
        "fields": {"id": "str", "user_id": "str", "answers": "list",
                    "dosha_scores": "dict", "prakriti_result": "str",
                    "recommended_kit": "str", "language": "str",
                    "created_at": "str (iso)"},
    },
    "quiz_attempts": {"description": "Engagement quiz attempts (older gamification).", "fields": {}},
    "prakriti_assessments": {"description": "Doctor-issued prakriti reviews.", "fields": {}},
    "health_documents": {
        "description": "Patient-uploaded lab reports / files in Emergent Object Storage.",
        "fields": {"id": "str", "user_id": "str", "file_url": "str",
                    "file_type": "str", "doc_type": "str",
                    "status": "'pending'|'reviewed'|'forwarded'",
                    "assigned_doctor_id": "str|null", "uploaded_at": "str (iso)"},
    },
    "presales_leads": {
        "description": "Admin CRM queue for new signups awaiting first-call.",
        "fields": {"id": "str", "user_id": "str",
                    "status": "'new'|'contacted'|'converted'|'lost'",
                    "agent_name": "str|null",
                    "status_history": "list[{status, at, by}]"},
    },
    "leads": {"description": "Legacy lead-form submissions.", "fields": {}},

    # ─── PAYMENTS ────────────────────────────────────────────────────────
    "payments": {"description": "Razorpay order + capture records.",
                  "fields": {"id": "str", "user_id": "str", "amount": "int",
                              "currency": "str", "order_id": "str",
                              "payment_id": "str|null", "status": "str"}},

    # ─── PATIENT SIDE ────────────────────────────────────────────────────
    "patient_profiles": {"description": "Editable patient bio (age, gender, address).", "fields": {}},
    "family_members": {"description": "Family accounts under one patient.", "fields": {}},
    "reminders": {"description": "Medication reminders (push).", "fields": {}},
    "chat_messages": {"description": "AI chatbot (Claude) message history.", "fields": {}},
    "wellness_logs": {"description": "Daily wellness diary entries.", "fields": {}},
    "women_cycles": {"description": "Women's health — period tracking.", "fields": {}},
    "women_pregnancy": {"description": "Women's health — pregnancy tracker.", "fields": {}},
    "women_gynae": {"description": "Women's health — gynae Q&A.", "fields": {}},

    # ─── CATALOG (mocked / partial) ──────────────────────────────────────
    "medicines": {"description": "Ayurvedic shop catalog (Coming Soon).", "fields": {}},
    "medicine_orders": {"description": "Shop orders.", "fields": {}},
    "lab_tests": {"description": "Lab test catalog.", "fields": {}},
    "lab_bookings": {"description": "Lab test bookings.", "fields": {}},

    # ─── CONTENT & GAMIFICATION ──────────────────────────────────────────
    "blogs": {"description": "Wellness articles.", "fields": {}},
    "yoga_sessions": {"description": "Yoga video / session catalog.", "fields": {}},
    "diet_plans": {"description": "AI-generated diet plans.", "fields": {}},
    "challenges": {"description": "Gamification: 30-day challenges catalog.", "fields": {}},
    "user_challenges": {"description": "Per-user challenge progress.", "fields": {}},
    "user_engagement": {"description": "Streaks + coins + points ledger.", "fields": {}},

    # ─── PATIENT COMMUNITY (open) ────────────────────────────────────────
    "community_posts": {"description": "Public community posts (patients).", "fields": {}},
    "community_comments": {"description": "Comments on community posts.", "fields": {}},
    "community_likes": {"description": "Likes on community posts.", "fields": {}},

    # ─── DOCTOR-ONLY COMMUNITY (Vaidya Charcha, Phase B) ─────────────────
    "doc_com_posts":         {"description": "Text/image posts in Vaidya Charcha.", "fields": {}},
    "doc_com_comments":      {"description": "Comments on doctor community posts.", "fields": {}},
    "doc_com_likes":         {"description": "Likes on doctor community posts.", "fields": {}},
    "doc_com_saves":         {"description": "Bookmarked doctor posts.", "fields": {}},
    "doc_com_follows":       {"description": "Doctor -> Doctor follow graph.", "fields": {}},
    "doc_com_reels":         {"description": "Short-video reels.", "fields": {}},
    "doc_com_reel_likes":    {"description": "Reel likes.", "fields": {}},
    "doc_com_reel_views":    {"description": "Reel view counters.", "fields": {}},
    "doc_com_stories":       {"description": "24h ephemeral stories.", "fields": {}},
    "doc_com_story_views":   {"description": "Story view receipts.", "fields": {}},
    "doc_com_dm_threads":    {"description": "1:1 DM threads between doctors.", "fields": {}},
    "doc_com_dm_messages":   {"description": "DM message bodies.", "fields": {}},
    "doc_com_notifications": {"description": "In-app notifications for doctor community.", "fields": {}},
    "doc_com_reports":       {"description": "Moderation reports (Phase B security).", "fields": {}},

    # ─── ADMIN / ANALYTICS / INTERNAL ────────────────────────────────────
    "activity":         {"description": "Immutable admin audit log (`log_activity`).", "fields": {}},
    "analytics":        {"description": "Rollup counters + timestamps for the dashboard.", "fields": {}},
    "support_messages": {"description": "Contact-form submissions.", "fields": {}},
    "feed":             {"description": "Legacy home-screen feed items.", "fields": {}},
    "reports":          {"description": "Admin-side incident reports.", "fields": {}},
}


# ─────────────────── Index definitions (created on startup) ──────────────
# Each entry: collection -> list of (keys, kwargs).
INDEX_SPEC: Dict[str, List[Any]] = {
    "users": [
        ([("id", ASCENDING)], {"unique": True, "name": "id_unique"}),
        ([("email", ASCENDING)], {"unique": True, "sparse": True, "name": "email_unique"}),
        ([("phone", ASCENDING)], {"unique": True, "sparse": True, "name": "phone_unique"}),
        ([("google_sub", ASCENDING)], {"unique": True, "sparse": True, "name": "google_sub"}),
        ([("apple_sub", ASCENDING)], {"unique": True, "sparse": True, "name": "apple_sub"}),
        ([("role", ASCENDING)], {"name": "role"}),
    ],
    "password_resets": [
        ([("token", ASCENDING)], {"unique": True, "name": "token"}),
    ],
    "doctors": [
        ([("id", ASCENDING)], {"unique": True, "name": "id_unique"}),
        ([("user_id", ASCENDING)], {"unique": True, "name": "user_id"}),
        ([("specialty", ASCENDING), ("verified", ASCENDING)], {"name": "specialty_verified"}),
        ([("last_seen_at", DESCENDING)], {"name": "last_seen_at"}),
    ],
    "appointments": [
        ([("id", ASCENDING)], {"unique": True, "name": "id_unique"}),
        ([("patient_id", ASCENDING), ("slot", DESCENDING)], {"name": "patient_slot"}),
        ([("doctor_id", ASCENDING), ("slot", DESCENDING)], {"name": "doctor_slot"}),
    ],
    "quiz_results": [
        ([("id", ASCENDING)], {"unique": True, "name": "id_unique"}),
        ([("user_id", ASCENDING), ("created_at", DESCENDING)], {"name": "user_created"}),
    ],
    "health_documents": [
        ([("id", ASCENDING)], {"unique": True, "name": "id_unique"}),
        ([("user_id", ASCENDING), ("uploaded_at", DESCENDING)], {"name": "user_uploaded"}),
        ([("status", ASCENDING), ("uploaded_at", ASCENDING)], {"name": "status_uploaded"}),
    ],
    "presales_leads": [
        ([("id", ASCENDING)], {"unique": True, "name": "id_unique"}),
        ([("user_id", ASCENDING)], {"unique": True, "name": "user_id"}),
        ([("status", ASCENDING), ("created_at", DESCENDING)], {"name": "status_created"}),
    ],
    "payments": [
        ([("id", ASCENDING)], {"unique": True, "name": "id_unique"}),
        ([("order_id", ASCENDING)], {"unique": True, "name": "order_id"}),
        ([("user_id", ASCENDING), ("status", ASCENDING)], {"name": "user_status"}),
    ],
    "reminders": [
        ([("user_id", ASCENDING), ("scheduled_at", ASCENDING)], {"name": "user_scheduled"}),
    ],
    "activity": [
        ([("at", DESCENDING)], {"name": "at_desc"}),
        ([("actor_id", ASCENDING), ("at", DESCENDING)], {"name": "actor_at"}),
    ],
    # Doctor community — heaviest read paths
    "doc_com_posts":       [([("created_at", DESCENDING)], {"name": "created_desc"})],
    "doc_com_reels":       [([("created_at", DESCENDING)], {"name": "created_desc"})],
    "doc_com_stories":     [([("expires_at", ASCENDING)], {"name": "expires_at"})],
    "doc_com_dm_threads":  [([("participants", ASCENDING)], {"name": "participants"})],
    "doc_com_dm_messages": [([("thread_id", ASCENDING), ("at", ASCENDING)], {"name": "thread_time"})],
    "doc_com_notifications": [
        ([("user_id", ASCENDING), ("at", DESCENDING)], {"name": "user_time"}),
    ],
    "chat_messages": [
        ([("user_id", ASCENDING), ("at", DESCENDING)], {"name": "user_time"}),
    ],
}


async def ensure_indexes(db) -> Dict[str, int]:
    """Create all indexes idempotently. Returns per-collection counts."""
    counts: Dict[str, int] = {}
    for coll, specs in INDEX_SPEC.items():
        created = 0
        for keys, kwargs in specs:
            try:
                await db[coll].create_index(keys, **kwargs)
                created += 1
            except Exception as e:
                logger.warning("Index skipped for %s.%s: %s", coll, kwargs.get("name"), e)
        counts[coll] = created
    logger.info("ensure_indexes done: %s", counts)
    return counts


def describe_collection(name: str) -> Dict[str, Any]:
    """Return the human-readable descriptor for a collection (for /admin docs)."""
    return COLLECTIONS.get(name, {"description": "(undocumented)", "fields": {}})


def list_collections() -> List[str]:
    return sorted(COLLECTIONS.keys())
