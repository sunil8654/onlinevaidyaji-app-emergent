"""OTP delivery module — real Twilio SMS with graceful mock fallback.

The API surface (`send_otp_sms(phone, otp) -> {ok, provider, error?}`) hides
whether the OTP was actually sent over Twilio or just returned as a dev hint,
so the rest of the app doesn't have to care.

Env vars (all optional — missing any triggers the mock path):
- TWILIO_ACCOUNT_SID     (AC…)
- TWILIO_AUTH_TOKEN
- TWILIO_FROM            either +1234567890 OR a Messaging Service SID (MG…)
- OTP_MOCK_ENABLED=true  legacy dev switch — when true (and Twilio creds are
                        missing) we skip network and return the OTP via
                        `dev_hint`. When false + Twilio missing => 503.
"""
import os
import re
import logging
from typing import Optional, Dict, Any

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

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
OTP_SENDER_NAME = os.environ.get("OTP_SENDER_NAME", "Online Vaidhyaji")

_TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"


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


async def send_otp_sms(phone: str, otp: str, *, template: Optional[str] = None) -> Dict[str, Any]:
    """Send an OTP over SMS. Returns:

    - `{ok: True, provider: "twilio", sid: "SM…"}` on real Twilio delivery
    - `{ok: True, provider: "mock",   dev_hint: "OTP for +91…: 123456"}` in dev
    - `{ok: False, provider: "twilio", error: "…"}` on hard failure

    Callers should NEVER include `dev_hint` in production API responses when
    Twilio is configured — the send-otp route already gates that.
    """
    to = _to_e164_india(phone)
    body = template or (
        f"Your {OTP_SENDER_NAME} OTP is {otp}. "
        f"Valid for 5 minutes. Do not share it with anyone."
    )

    if not twilio_configured():
        if OTP_MOCK_ENABLED:
            logger.info("OTP mock: %s -> %s", _mask_phone(to), otp)
            return {
                "ok": True,
                "provider": "mock",
                "dev_hint": f"OTP for {to}: {otp}",
            }
        logger.error("Twilio not configured and mock disabled — cannot send OTP")
        return {
            "ok": False,
            "provider": "none",
            "error": "OTP delivery is not configured on the server.",
        }

    # Real Twilio Programmable Messaging via basic-auth POST — no SDK dep needed.
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
        # Twilio surfaces its own error_code + message we can safely log at debug
        try:
            err = resp.json()
        except Exception:
            err = {"message": resp.text[:200]}
        logger.warning(
            "Twilio send failed %s for %s: code=%s message=%s",
            resp.status_code, _mask_phone(to),
            err.get("code"), (err.get("message") or "")[:200],
        )
        # Never surface Twilio's internal error to the client verbatim — map to a
        # user-friendly summary.
        return {
            "ok": False,
            "provider": "twilio",
            "error": "Could not send SMS. Please try again in a minute.",
        }

    payload = resp.json() if resp.content else {}
    logger.info("Twilio OTP sent to %s (sid=%s)", _mask_phone(to), payload.get("sid"))
    return {"ok": True, "provider": "twilio", "sid": payload.get("sid")}
