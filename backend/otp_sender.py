"""OTP delivery module — WhatsApp ➜ Fast2SMS ➜ Twilio ➜ Mock, with automatic fallback.

Use `send_otp(phone, otp)`: it tries WhatsApp first and transparently falls back
to SMS when the recipient has no WhatsApp (or WhatsApp is disabled/misconfigured/
rate-limited). It returns the underlying provider result plus a `channel` field
(`whatsapp` | `sms` | `mock`) so callers can report how the code was delivered.

`send_otp_sms(phone, otp)` remains the SMS-only entry point used as the fallback.

SMS provider order (first configured provider wins; on failure we cascade):
1. **Fast2SMS** (India-only, Quick SMS route) — set FAST2SMS_API_KEY
2. **Twilio**   (global)                       — set TWILIO_* trio
3. **Mock**     (dev only, returns dev_hint)   — OTP_MOCK_ENABLED=true

WhatsApp-first is opt-in via WHATSAPP_ENABLED_OTP=true plus a
WHATSAPP_PROVIDER (meta | twilio | fast2sms) with its credentials.

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
from pathlib import Path
from typing import Optional, Dict, Any

import httpx
from dotenv import load_dotenv

# Resolve backend/.env explicitly rather than relying on the process CWD.
load_dotenv(Path(__file__).parent / ".env")

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
        "error": "OTP delivery is not configured on this server.",
    }
# --- WhatsApp-first OTP -----------------------------------------------------
# Delivery order for a login OTP: WhatsApp ➜ SMS ➜ (dev) mock. See `send_otp()`.
#
# There is NO way to ask "is this number on WhatsApp?" — no provider exposes a
# pre-flight check. Meta Cloud API in particular has no such endpoint. So the
# only reliable strategy is: attempt WhatsApp, and fall back to SMS on *any*
# failure (network error, undeliverable recipient, out-of-window template
# rejection, misconfiguration). That is what `send_otp()` does.
#
# WHATSAPP_ENABLED_OTP: opt-in switch for WhatsApp-first. Default follows
# WHATSAPP_ENABLED so operators only ever set one flag.
# WHATSAPP_PROVIDER:    'meta' (Cloud API) | 'twilio' | 'fast2sms' | 'none'
# META_WHATSAPP_OTP_TEMPLATE: strongly recommended. Meta rejects free-form text
#   for business-initiated messages (error 131047) unless the user messaged the
#   business in the last 24h. An approved *authentication* template makes OTP
#   delivery reliable. Without it, most first-time logins silently fall back to
#   SMS — correct, but WhatsApp-first will look like it "never works".
WHATSAPP_ENABLED_OTP = os.environ.get(
    "WHATSAPP_ENABLED_OTP", os.environ.get("WHATSAPP_ENABLED", "false")
).strip().lower() in ("1", "true", "yes")
WHATSAPP_PROVIDER = (os.environ.get("WHATSAPP_PROVIDER") or "none").strip().lower()
META_WHATSAPP_TOKEN = os.environ.get("META_WHATSAPP_TOKEN", "").strip()
META_PHONE_NUMBER_ID = os.environ.get("META_PHONE_NUMBER_ID", "").strip()
META_WHATSAPP_OTP_TEMPLATE = os.environ.get("META_WHATSAPP_OTP_TEMPLATE", "").strip()
META_WHATSAPP_OTP_LANG = os.environ.get("META_WHATSAPP_OTP_LANG", "en_US").strip()
TWILIO_WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "").strip()
_WHATSAPP_META_URL = "https://graph.facebook.com/v20.0/{sid}/messages"

# Meta error codes worth distinguishing in logs (delivery falls back either way).
_META_ERR_UNDELIVERABLE = 131026   # recipient not on WhatsApp / not opted in
_META_ERR_OUT_OF_WINDOW = 131047   # free-form text outside the 24h service window


def whatsapp_otp_configured() -> bool:
    """True iff WhatsApp-first OTP is enabled *and* the chosen provider is fully
    configured. A half-configured provider returns False so we skip straight to
    SMS instead of burning an API call on a guaranteed failure."""
    if not WHATSAPP_ENABLED_OTP:
        return False
    if WHATSAPP_PROVIDER == "meta":
        return bool(META_WHATSAPP_TOKEN and META_PHONE_NUMBER_ID)
    if WHATSAPP_PROVIDER == "twilio":
        return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM)
    if WHATSAPP_PROVIDER == "fast2sms":
        return bool(FAST2SMS_API_KEY)
    return False


def _meta_error_code(err: Any) -> Optional[int]:
    """Pull the numeric error code out of a Graph API error body, if present."""
    if isinstance(err, dict):
        inner = err.get("error")
        if isinstance(inner, dict):
            try:
                return int(inner.get("code"))
            except (TypeError, ValueError):
                return None
        try:
            return int(err.get("code"))
        except (TypeError, ValueError):
            return None
    return None


async def _send_otp_via_whatsapp(*, to: str, otp: str, body: str) -> Dict[str, Any]:
    """Try to deliver the OTP over WhatsApp. Never raises.

    Returns `{ok: True, provider: ...}` or `{ok: False, provider: ..., error: ...}`.
    """
    numbers = re.sub(r"\D", "", to or "")

    if WHATSAPP_PROVIDER == "meta":
        if not (META_WHATSAPP_TOKEN and META_PHONE_NUMBER_ID):
            return {"ok": False, "provider": "meta", "error": "missing config"}
        url = _WHATSAPP_META_URL.format(sid=META_PHONE_NUMBER_ID)
        headers = {"Authorization": f"Bearer {META_WHATSAPP_TOKEN}"}
        if META_WHATSAPP_OTP_TEMPLATE:
            payload: Dict[str, Any] = {
                "messaging_product": "whatsapp",
                "to": numbers,
                "type": "template",
                "template": {
                    "name": META_WHATSAPP_OTP_TEMPLATE,
                    "language": {"code": META_WHATSAPP_OTP_LANG or "en_US"},
                    "components": [
                        {
                            "type": "body",
                            "parameters": [{"type": "text", "text": otp}],
                        }
                    ],
                },
            }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "to": numbers,
                "type": "text",
                "text": {"body": body},
            }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(url, json=payload, headers=headers)
        except Exception as e:
            logger.error("WhatsApp(Meta) network error for %s: %s", _mask_phone(to), e)
            return {"ok": False, "provider": "meta", "error": "Network error"}
        if resp.status_code >= 400:
            try:
                err = resp.json()
            except Exception:
                err = {}
            code = _meta_error_code(err)
            if code == _META_ERR_UNDELIVERABLE:
                logger.info("WhatsApp(Meta) %s not deliverable — no WhatsApp", _mask_phone(to))
            elif code == _META_ERR_OUT_OF_WINDOW:
                logger.warning(
                    "WhatsApp(Meta) rejected free-form text for %s (code %s). "
                    "Set META_WHATSAPP_OTP_TEMPLATE to an approved authentication "
                    "template or WhatsApp-first will always fall back to SMS.",
                    _mask_phone(to), code,
                )
            else:
                logger.warning(
                    "WhatsApp(Meta) send failed %s for %s: code=%s",
                    resp.status_code, _mask_phone(to), code,
                )
            return {"ok": False, "provider": "meta",
                    "error": f"Meta send failed (code {code})"}
        logger.info("WhatsApp(Meta) OTP sent to %s", _mask_phone(to))
        return {"ok": True, "provider": "meta"}

    if WHATSAPP_PROVIDER == "twilio":
        if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM):
            return {"ok": False, "provider": "twilio", "error": "missing config"}
        url = _TWILIO_URL.format(sid=TWILIO_ACCOUNT_SID)
        data = {
            "From": TWILIO_WHATSAPP_FROM,
            "To": f"whatsapp:{to}",
            "Body": body,
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    url, data=data,
                    auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                )
        except Exception as e:
            logger.error("WhatsApp(Twilio) network error for %s: %s", _mask_phone(to), e)
            return {"ok": False, "provider": "twilio", "error": "Network error"}
        if resp.status_code >= 400:
            try:
                err = resp.json()
            except Exception:
                err = {}
            logger.warning(
                "WhatsApp(Twilio) send failed %s for %s: code=%s",
                resp.status_code, _mask_phone(to), err.get("code"),
            )
            return {"ok": False, "provider": "twilio",
                    "error": "Twilio WhatsApp send failed"}
        logger.info("WhatsApp(Twilio) OTP sent to %s", _mask_phone(to))
        return {"ok": True, "provider": "twilio"}

    if WHATSAPP_PROVIDER == "fast2sms":
        if not FAST2SMS_API_KEY:
            return {"ok": False, "provider": "fast2sms", "error": "missing key"}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    _FAST2SMS_URL,
                    data={
                        "route": "q",
                        "message": body,
                        "language": "english",
                        "flash": 0,
                        "numbers": numbers[2:] if numbers.startswith("91") else numbers,
                    },
                    headers={"authorization": FAST2SMS_API_KEY},
                )
        except Exception as e:
            logger.error("WhatsApp(Fast2SMS) network error for %s: %s", _mask_phone(to), e)
            return {"ok": False, "provider": "fast2sms", "error": "Network error"}
        if resp.status_code >= 400:
            return {"ok": False, "provider": "fast2sms", "error": "send failed"}
        logger.info("WhatsApp(Fast2SMS) OTP sent to %s", _mask_phone(to))
        return {"ok": True, "provider": "fast2sms"}

    return {"ok": False, "provider": "none", "error": "no provider"}


async def send_otp(phone: str, otp: str, *, template: Optional[str] = None) -> Dict[str, Any]:
    """Deliver a login OTP: WhatsApp first, SMS fallback.

    WhatsApp is attempted only when enabled and fully configured. Any WhatsApp
    failure — recipient has no WhatsApp, undeliverable number, template window
    rejection, network blip — falls through to `send_otp_sms()` so the user
    always gets their code.

    Returns the provider result plus a `channel` field so callers/telemetry can
    see how the code was actually delivered:
    - `{ok: True,  channel: "whatsapp", provider: "meta"|"twilio"|"fast2sms"}`
    - `{ok: True,  channel: "sms",      provider: "fast2sms"|"twilio"}`
    - `{ok: True,  channel: "mock",     provider: "mock", dev_hint: …}`
    - `{ok: False, provider: …, error: …}`
    """
    to = _to_e164_india(phone)
    body = template or (
        f"Your {OTP_SENDER_NAME} OTP is {otp}. "
        f"Valid for 5 minutes. Do not share it with anyone."
    )

    if whatsapp_otp_configured():
        wa = await _send_otp_via_whatsapp(to=to, otp=otp, body=body)
        if wa.get("ok"):
            return {**wa, "channel": "whatsapp"}
        logger.info(
            "WhatsApp OTP failed for %s (%s: %s) — falling back to SMS",
            _mask_phone(to), wa.get("provider"), wa.get("error"),
        )

    sms = await send_otp_sms(phone, otp, template=template)
    if not sms.get("ok"):
        return sms
    channel = "mock" if sms.get("provider") == "mock" else "sms"
    return {**sms, "channel": channel}
