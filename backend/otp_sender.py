"""OTP delivery module — Fast2SMS ➜ Twilio ➜ Mock, with automatic fallback.

The API surface (`send_otp_sms(phone, otp) -> {ok, provider, error?}`) hides
which provider actually delivered the SMS, so the rest of the app doesn't
have to care.

Provider order (first configured provider wins; on failure we cascade):
1. **Fast2SMS** (India-only, Quick SMS route) — set FAST2SMS_API_KEY
2. **Twilio**   (global)                       — set TWILIO_* trio
3. **Mock**     (dev only, returns dev_hint)   — OTP_MOCK_ENABLED=true

Env vars (all optional — missing any just skips that provider):
- FAST2SMS_API_KEY       Dev-API key from fast2sms.com dashboard
- FAST2SMS_SENDER_ID     Optional 6-char sender ID (else Fast2SMS default)
- TWILIO_ACCOUNT_SID     (AC…)
- TWILIO_AUTH_TOKEN
- TWILIO_FROM            +1234567890 OR Messaging Service SID (MG…)
- OTP_MOCK_ENABLED=true  Dev fallback — hard-disabled in production.
"""
import os
import re
import logging
from typing import Optional, Dict, Any

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

FAST2SMS_API_KEY = os.environ.get("FAST2SMS_API_KEY", "").strip()
FAST2SMS_SENDER_ID = os.environ.get("FAST2SMS_SENDER_ID", "").strip()
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_FROM = os.environ.get("TWILIO_FROM", "").strip()
# SEC-001 (Iter 37 audit): mock mode is HARD-DISABLED when APP_ENV=production so a
# stale dev config can never accidentally allow account-takeover in prod.
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
_IS_PRODUCTION = APP_ENV in ("production", "prod", "live")
OTP_MOCK_ENABLED = (
    os.environ.get("OTP_MOCK_ENABLED", "true").lower() in ("1", "true", "yes")
    and not _IS_PRODUCTION
)
OTP_SENDER_NAME = os.environ.get("OTP_SENDER_NAME", "Online VaidyaJi")

_TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
_FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"


def fast2sms_configured() -> bool:
    return bool(FAST2SMS_API_KEY)


def twilio_configured() -> bool:
    """True iff we have all three Twilio env vars set to something non-empty."""
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM)


def _mask_phone(phone: str) -> str:
    """`+919876543210` -> `+9198******10` (SEC: no full number in logs)."""
    p = re.sub(r"\D", "", phone or "")
    if len(p) < 6:
        return "***"
    return "+" + p[:4] + "*" * (len(p) - 6) + p[-2:]


def _to_e164_india(phone: str) -> str:
    """Normalise a phone to E.164 (+91…). Accepts 98…, 91…, +91… inputs."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("91") and len(digits) == 12:
        return "+" + digits
    if len(digits) == 10:
        return "+91" + digits
    return "+" + digits  # trust upstream validation


async def _send_via_fast2sms(*, to: str, body: str) -> Dict[str, Any]:
    """Push an OTP through the Fast2SMS Quick SMS route.

    Fast2SMS accepts 10-digit Indian phone numbers only. We strip the +91
    prefix before the POST.
    """
    numbers = re.sub(r"\D", "", to or "")
    if numbers.startswith("91") and len(numbers) == 12:
        numbers = numbers[2:]
    if len(numbers) != 10:
        return {"ok": False, "provider": "fast2sms",
                "error": "Fast2SMS only supports 10-digit Indian numbers."}

    payload = {
        "route": "q",              # Quick SMS (no DLT template required)
        "message": body,
        "language": "english",
        "flash": 0,
        "numbers": numbers,
    }
    if FAST2SMS_SENDER_ID:
        payload["sender_id"] = FAST2SMS_SENDER_ID

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                _FAST2SMS_URL,
                headers={
                    "authorization": FAST2SMS_API_KEY,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
            )
    except Exception as e:
        logger.error("Fast2SMS network error for %s: %s", _mask_phone(to), e)
        return {"ok": False, "provider": "fast2sms", "error": "Network error"}

    try:
        data = resp.json()
    except Exception:
        data = {"return": False, "message": resp.text[:200]}

    if resp.status_code >= 400 or not data.get("return"):
        # Their error messages sometimes include the key — never surface verbatim.
        raw_msg = data.get("message")
        if isinstance(raw_msg, list):
            raw_msg = " ".join(str(m) for m in raw_msg)
        logger.warning(
            "Fast2SMS send failed %s for %s: %s",
            resp.status_code, _mask_phone(to), str(raw_msg)[:200],
        )
        return {"ok": False, "provider": "fast2sms",
                "error": "Could not send SMS via Fast2SMS. Please try again."}

    request_id = data.get("request_id")
    logger.info("Fast2SMS OTP sent to %s (request_id=%s)", _mask_phone(to), request_id)
    return {"ok": True, "provider": "fast2sms", "request_id": request_id}


async def _send_via_twilio(*, to: str, body: str) -> Dict[str, Any]:
    """Send an OTP via Twilio Programmable Messaging."""
    data = {"To": to, "Body": body}
    if TWILIO_FROM.startswith("MG"):
        data["MessagingServiceSid"] = TWILIO_FROM
    else:
        data["From"] = TWILIO_FROM
    url = _TWILIO_URL.format(sid=TWILIO_ACCOUNT_SID)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url, data=data,
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
            )
    except Exception as e:
        logger.error("Twilio network error for %s: %s", _mask_phone(to), e)
        return {"ok": False, "provider": "twilio", "error": "Network error"}
    if resp.status_code >= 400:
        try:
            err = resp.json()
        except Exception:
            err = {"message": resp.text[:200]}
        logger.warning(
            "Twilio send failed %s for %s: code=%s message=%s",
            resp.status_code, _mask_phone(to),
            err.get("code"), (err.get("message") or "")[:200],
        )
        return {"ok": False, "provider": "twilio",
                "error": "Could not send SMS. Please try again in a minute."}
    payload = resp.json() if resp.content else {}
    logger.info("Twilio OTP sent to %s (sid=%s)", _mask_phone(to), payload.get("sid"))
    return {"ok": True, "provider": "twilio", "sid": payload.get("sid")}


async def send_otp_sms(phone: str, otp: str, *, template: Optional[str] = None) -> Dict[str, Any]:
    """Send an OTP over SMS. Cascades Fast2SMS ➜ Twilio ➜ Mock.

    Returns one of:
    - `{ok: True, provider: "fast2sms", request_id: "…"}` on Fast2SMS delivery
    - `{ok: True, provider: "twilio",   sid: "SM…"}`      on Twilio delivery
    - `{ok: True, provider: "mock",     dev_hint: "…"}`   in dev mock mode
    - `{ok: False, provider: "…",       error: "…"}`      on hard failure

    Callers must NEVER return `dev_hint` outside dev mock mode — the send-otp
    route already gates that.
    """
    to = _to_e164_india(phone)
    body = template or (
        f"Your {OTP_SENDER_NAME} OTP is {otp}. "
        f"Valid for 5 minutes. Do not share it with anyone."
    )

    # 1. Fast2SMS — India-first, cheap, no DLT for Quick route.
    if fast2sms_configured():
        result = await _send_via_fast2sms(to=to, body=body)
        if result.get("ok"):
            return result
        # If Fast2SMS failed AND Twilio is configured, cascade — else return the
        # Fast2SMS error verbatim so the operator can debug.
        if not twilio_configured():
            if OTP_MOCK_ENABLED:
                logger.info("Fast2SMS failed, falling back to mock: %s", _mask_phone(to))
                return {"ok": True, "provider": "mock",
                        "dev_hint": f"OTP for {to}: {otp}"}
            return result

    # 2. Twilio
    if twilio_configured():
        result = await _send_via_twilio(to=to, body=body)
        if result.get("ok"):
            return result
        # Failure — fall through to mock only if enabled
        if OTP_MOCK_ENABLED:
            logger.info("Twilio failed, falling back to mock: %s", _mask_phone(to))
            return {"ok": True, "provider": "mock",
                    "dev_hint": f"OTP for {to}: {otp}"}
        return result

    # 3. Mock (dev only)
    if OTP_MOCK_ENABLED:
        logger.info("OTP mock: %s -> %s", _mask_phone(to), otp)
        return {"ok": True, "provider": "mock",
                "dev_hint": f"OTP for {to}: {otp}"}

    logger.error("No SMS provider configured and mock disabled — cannot send OTP")
    return {
        "ok": False,
        "provider": "none",
        "error": "OTP delivery is not configured on the server.",
    }
