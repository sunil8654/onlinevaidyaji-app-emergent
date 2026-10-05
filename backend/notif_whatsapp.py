"""WhatsApp notifications for transactional events.

Adds a provider-agnostic WhatsApp sender (non-blocking) and helpers to send
the same 5 transactional notifications (appointment cancelled, booking paid,
doctor submitted, doctor verified/rejected, prescription ready). Designed to be
safe: missing env vars = silent skip, never throws, failures logged only.

Env vars (all optional):
- WHATSAPP_PROVIDER: 'meta' (Cloud API) | 'twilio' | 'fast2sms' | 'none'
- META_WHATSAPP_TOKEN
- META_PHONE_NUMBER_ID
- META_WHATSAPP_VERIFY_TOKEN
- TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM (e.g. 'whatsapp:+1415...')
- FAST2SMS_API_KEY (uses WhatsApp template mode if provider configured)
- WHATSAPP_ENABLED: 'true'/'false' (default false)
- WHATSAPP_DEFAULT_COUNTRY: 'IN' (default)
"""
import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import httpx
from dotenv import load_dotenv

# Load backend/.env explicitly. server.py imports this module BEFORE its own
# `load_dotenv(ROOT_DIR / ".env")` call, and every provider var below is
# snapshotted at import time — so a bare `load_dotenv()` (which resolves against
# the current working directory) left the whole module reading empty config.
load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger(__name__)

# Strong refs for fire-and-forget sends so tasks are not GC'd mid-flight.
_pending_tasks: Set[asyncio.Task] = set()

# Provider selection
WHATSAPP_PROVIDER = (os.environ.get("WHATSAPP_PROVIDER") or "none").strip().lower()
WHATSAPP_ENABLED = os.environ.get("WHATSAPP_ENABLED", "false").strip().lower() in (
    "1",
    "true",
    "yes",
)
WHATSAPP_DEFAULT_COUNTRY = (os.environ.get("WHATSAPP_DEFAULT_COUNTRY") or "IN").upper()

# Meta (Cloud API)
META_WHATSAPP_TOKEN = os.environ.get("META_WHATSAPP_TOKEN", "")
META_PHONE_NUMBER_ID = os.environ.get("META_PHONE_NUMBER_ID", "")
META_WHATSAPP_VERIFY_TOKEN = os.environ.get("META_WHATSAPP_VERIFY_TOKEN", "")

# Twilio
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "")

# Fast2SMS
FAST2SMS_API_KEY = os.environ.get("FAST2SMS_API_KEY", "")

# Only send WhatsApp for high-signal events to avoid spam
IMPORTANT_WHATSAPP_EVENTS = {
    "appointment_cancelled",
    "booking_paid",
    "doctor_verified",
    "prescription_ready",
}

def _should_send(event: str) -> bool:
    if not WHATSAPP_ENABLED:
        return False
    if event not in IMPORTANT_WHATSAPP_EVENTS:
        return False
    return True


def _clean_phone(phone: Any) -> Optional[str]:
    if not phone or not isinstance(phone, str):
        return None
    p = re.sub(r"[^0-9+]", "", phone)
    if p.startswith("+"):
        if len(p) < 10:
            return None
        return p
    # Indian default
    if len(p) == 10:
        return f"+91{p}"
    if len(p) == 11 and p.startswith("0"):
        return f"+91{p[1:]}"
    if len(p) >= 10 and p.startswith("91"):
        return f"+{p}" if not p.startswith("+") else p
    return p if len(p) > 8 else None


def _mask_phone(p: str) -> str:
    if len(p) < 4:
        return "***"
    return p[:-4] + "****"


def _safe_send(text: str, phone: Any, event: str = "generic") -> None:
    if not _should_send(event):
        return
    to = _clean_phone(phone)
    if not to:
        logger.debug("whatsapp skipped: invalid number")
        return
    if len(text) > 4000:
        text = text[:3997] + "..."

    async def _runner():
        try:
            res = await send_whatsapp(to, text)
            if not res.get("ok"):
                logger.info("whatsapp not sent (%s): %s", res.get("provider"), res.get("error"))
        except Exception as e:  # noqa: BLE001
            logger.warning("whatsapp send exception: %s", e)

    try:
        t = asyncio.create_task(_runner())
        _pending_tasks.add(t)
        t.add_done_callback(_pending_tasks.discard)
    except RuntimeError:
        logger.debug("no event loop for whatsapp send")


async def send_whatsapp(to_e164: str, text: str) -> Dict[str, Any]:
    provider = WHATSAPP_PROVIDER
    if provider == "meta":
        return await _send_meta(to_e164, text)
    if provider == "twilio":
        return await _send_twilio_wa(to_e164, text)
    if provider == "fast2sms":
        return await _send_fast2sms_wa(to_e164, text)
    return {"ok": False, "provider": "none", "error": "no provider"}


async def _send_meta(to: str, text: str) -> Dict[str, Any]:
    if not (META_WHATSAPP_TOKEN and META_PHONE_NUMBER_ID):
        return {"ok": False, "provider": "meta", "error": "missing config"}
    url = f"https://graph.facebook.com/v20.0/{META_PHONE_NUMBER_ID}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to.lstrip("+"),
        "type": "text",
        "text": {"body": text},
    }
    headers = {"Authorization": f"Bearer {META_WHATSAPP_TOKEN}"}
    async with httpx.AsyncClient(timeout=15) as c:
        try:
            r = await c.post(url, json=payload, headers=headers)
        except Exception as e:
            return {"ok": False, "provider": "meta", "error": str(e)[:60]}
    if r.status_code >= 400:
        try:
            j = r.json()
        except Exception:
            j = {"error": r.text[:120]}
        return {"ok": False, "provider": "meta", "error": str(j.get("error"))[:80]}
    return {"ok": True, "provider": "meta"}


async def _send_twilio_wa(to: str, text: str) -> Dict[str, Any]:
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM):
        return {"ok": False, "provider": "twilio", "error": "missing config"}
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    data = {"From": TWILIO_WHATSAPP_FROM, "To": to.replace("+", "whatsapp:+"), "Body": text}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, data=data, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN))
    except Exception as e:
        return {"ok": False, "provider": "twilio", "error": str(e)[:60]}
    if r.status_code >= 400:
        return {"ok": False, "provider": "twilio", "error": "send failed"}
    return {"ok": True, "provider": "twilio"}


async def _send_fast2sms_wa(to: str, text: str) -> Dict[str, Any]:
    if not FAST2SMS_API_KEY:
        return {"ok": False, "provider": "fast2sms", "error": "missing key"}
    url = "https://www.fast2sms.com/dev/bulkV2"
    payload = {"route": "q", "message": text, "language": "english", "flash": 0, "numbers": to.lstrip("+")}
    headers = {"authorization": FAST2SMS_API_KEY}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, data=payload, headers=headers)
    except Exception as e:
        return {"ok": False, "provider": "fast2sms", "error": str(e)[:60]}
    if r.status_code >= 400:
        return {"ok": False, "provider": "fast2sms", "error": "send failed"}
    return {"ok": True, "provider": "fast2sms"}


# Event helpers (short, actionable messages per the same 5 events)
def wa_appointment_cancelled(patient_phone, doctor_phone, when: str):
    msg = f"Your appointment ({when}) was cancelled."
    for p in (patient_phone, doctor_phone):
        _safe_send(msg, p, event="appointment_cancelled")


def wa_booking_paid(patient_phone, doctor_phone, when: str, amount_rs: Optional[float]):
    amt = f"₹{float(amount_rs):.0f} paid" if amount_rs is not None else "payment received"
    for p in (patient_phone, doctor_phone):
        _safe_send(f"Appointment confirmed ({when}) — {amt}.", p, event="booking_paid")


def wa_doctor_submitted(doctor_phone):
    # Not marked important by default; skip
    return


def wa_doctor_verified(doctor_phone, approved: bool):
    if approved:
        _safe_send("Your account has been verified. You can start seeing patients.", doctor_phone, event="doctor_verified")
    else:
        # Not marking rejection as important WhatsApp by default
        return


def wa_prescription_ready(patient_phone, doctor_name: str, when: str):
    _safe_send(f"Dr. {doctor_name} added a prescription for {when}.", patient_phone, event="prescription_ready")
