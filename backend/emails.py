"""Emergent-managed Resend integration for Online Vaidhyaji.

Sends bilingual welcome emails after signup/quiz completion.

Guardrails (per Emergent playbook):
- G1: from_name = "Online Vaidhyaji" only. No impersonation.
- G2: no credential asks, no forms/inputs in body.
- G3: every link is absolute https to our own app.
- G4: recipients + templates are server-side only.
- G5: transactional welcome flow only, never bulk.
"""
import os
import re
import asyncio
import ipaddress
import logging
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from typing import Optional, Any, Dict

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


def _mask_email(addr: str) -> str:
    """Mask a recipient address for log lines. `alice@example.com` -> `a***@example.com`.

    SEC-002: prevents PII (customer email) from spreading into log storage
    while still leaving enough breadcrumbs to trace individual send failures.
    """
    try:
        local, _, domain = (addr or "").partition("@")
        if not local or not domain:
            return "***"
        if len(local) <= 1:
            masked_local = local + "***"
        else:
            masked_local = local[0] + "***"
        return f"{masked_local}@{domain}"
    except Exception:
        return "***"

# Constant — deliberately NOT read from env (survives deploy).
EMAIL_BASE_URL = "https://integrations.emergentagent.com"

EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Online Vaidhyaji")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

# Where the welcome email's "Open the app" CTA points to.
APP_HTTPS_URL = os.environ.get("APP_HTTPS_URL", "https://onlinevaidhyaji.emergent.host")

# ─────────────────────────── Guardrail Gate ────────────────────────────────
_SHORTENERS = (
    "bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly",
)
_CRED_ASK = (
    "reply with your password", "reply with the code", "send your password", "cvv",
    "send us your password", "enter your password below", "confirm your card number",
    "your full card number", "seed phrase", "recovery phrase", "verify your card",
    "social security number", "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        parsed = urlparse(low)
        host = parsed.hostname or ""
        if not _host_ok(host) or parsed.username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


# ─────────────────────────── Send helper ───────────────────────────────────
async def send_email(*, to: str, subject: str, html: str, reply_to: Optional[str] = None) -> Optional[str]:
    """Send a single transactional email via Emergent-managed Resend.

    Raises on send failure. Callers that want fire-and-forget should use
    `send_welcome_email_bg`.
    """
    if not EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY missing — skipping email send")
        return None
    _assert_safe_email(subject, html)
    payload: Dict[str, Any] = {
        "to": [to],
        "subject": subject,
        "html": html,
        "from_name": EMAIL_FROM_NAME,
    }
    if reply_to or EMAIL_REPLY_TO:
        payload["contact_email"] = reply_to or EMAIL_REPLY_TO
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{EMAIL_BASE_URL}/api/v1/email/send",
            headers={"X-Email-Key": EMAIL_KEY},
            json=payload,
        )
    if resp.status_code >= 400:
        logger.error("Email send failed %s: %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
    try:
        return resp.json().get("id")
    except Exception:
        return None


# ─────────────────────────── Bilingual templates ───────────────────────────
_STYLE = (
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"
    "font-size:15px;line-height:1.6;color:#1c2b23;"
)
_BRAND = "#0F4C36"      # Deep Forest Green
_ACCENT = "#D9663D"     # Terracotta
_BG = "#faf6ee"         # Warm Sand


def _wrap_layout(inner_html: str, footer: str) -> str:
    return (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'style="background:{_BG};padding:24px 12px">'
        f'<tr><td align="center">'
        f'<table role="presentation" width="560" cellspacing="0" cellpadding="0" '
        f'style="max-width:560px;background:#ffffff;border-radius:14px;'
        f'border:1px solid #e6dfd0;overflow:hidden;{_STYLE}">'
        f'<tr><td style="background:{_BRAND};padding:22px 24px;color:#fff">'
        f'<div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;'
        f'opacity:.85">ॐ Online Vaidhyaji</div>'
        f'<div style="font-size:22px;font-weight:700;margin-top:4px">'
        f'{escape(EMAIL_FROM_NAME)}</div></td></tr>'
        f'<tr><td style="padding:26px 26px 8px 26px">{inner_html}</td></tr>'
        f'<tr><td style="padding:16px 26px 26px 26px;border-top:1px solid #efe7d3;'
        f'font-size:12px;color:#7b6b53">{footer}</td></tr>'
        f'</table></td></tr></table>'
    )


def _cta(label: str, href: str = APP_HTTPS_URL) -> str:
    return (
        f'<div style="text-align:center;margin:22px 0 6px 0">'
        f'<a href="{escape(href)}" '
        f'style="display:inline-block;background:{_BRAND};color:#ffffff;'
        f'text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">'
        f'{escape(label)}</a></div>'
    )


def render_patient_welcome_html(*, name: str, lang: str = "en",
                                 prakriti: Optional[str] = None,
                                 kit_name: Optional[str] = None) -> str:
    n = escape(name.split()[0] if name else "there")
    if lang == "hi":
        prak_line = (
            f'<p><strong>Aapki Prakriti:</strong> {escape(prakriti)}. '
            f'Hamare AYUSH doctors is samajh se aapke liye personalized advice denge.</p>'
            if prakriti else ""
        )
        kit_line = (
            f'<p><strong>Recommended kit:</strong> {escape(kit_name)}.</p>'
            if kit_name else ""
        )
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Namaste {n} 🙏</h2>'
            f'<p><strong>Online Vaidhyaji</strong> mein aapka swagat hai — verified '
            f'AYUSH doctors ke saath ghar baithe consultation.</p>'
            f'{prak_line}{kit_line}'
            f'<p>Aapka <strong>pehla consultation FREE</strong> hai 🎁 Hamari team '
            f'jaldi hi aapse contact karegi. Tab tak app kholein aur apni health '
            f'documents upload karein.</p>'
            f'{_cta("App Kholein", APP_HTTPS_URL)}'
            f'<p style="color:#7b6b53;font-size:13px">Hum kabhi bhi email ke through '
            f'password ya OTP nahi maangte.</p>'
        )
        footer = (
            f'Sent by {escape(EMAIL_FROM_NAME)} · Aap yeh email is liye pa rahe hain '
            f'kyunki aapne abhi hamari app par account banaya hai. Reply karke hum se '
            f'baat karein.'
        )
    else:
        prak_line = (
            f'<p><strong>Your Prakriti:</strong> {escape(prakriti)}. Our AYUSH '
            f'doctors will use this to personalise your care.</p>' if prakriti else ""
        )
        kit_line = (
            f'<p><strong>Recommended kit:</strong> {escape(kit_name)}.</p>'
            if kit_name else ""
        )
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Welcome, {n} 🌿</h2>'
            f'<p>You\'re now part of <strong>Online Vaidhyaji</strong> — verified '
            f'AYUSH doctors, in Hindi and English, from the comfort of home.</p>'
            f'{prak_line}{kit_line}'
            f'<p>Your <strong>first consultation is FREE</strong> 🎁 Our team will '
            f'reach out shortly. In the meantime, open the app and upload any '
            f'health documents you\'d like your doctor to review.</p>'
            f'{_cta("Open the App", APP_HTTPS_URL)}'
            f'<p style="color:#7b6b53;font-size:13px">We will never ask for your '
            f'password or an OTP over email.</p>'
        )
        footer = (
            f'Sent by {escape(EMAIL_FROM_NAME)} · You received this because you '
            f'just created an account with us. Reply to this email if you need help.'
        )
    return _wrap_layout(inner, footer)


def render_doctor_welcome_html(*, name: str, lang: str = "en") -> str:
    n = escape(name.split()[0] if name else "Doctor")
    if lang == "hi":
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Namaste Dr. {n} 🙏</h2>'
            f'<p><strong>Online Vaidhyaji</strong> mein aapka swagat hai. Aapka '
            f'account admin verification ke liye submit ho gaya hai.</p>'
            f'<ul><li>1-2 business days mein hamari team aapki registration number '
            f'verify karegi.</li>'
            f'<li>Verification ke baad aap patients ko consult kar sakte hain aur '
            f'sirf doctors ki community <strong>Vaidya Charcha</strong> join kar '
            f'sakte hain.</li></ul>'
            f'{_cta("Doctor Dashboard Kholein", APP_HTTPS_URL)}'
        )
        footer = (
            f'Sent by {escape(EMAIL_FROM_NAME)} · Kisi bhi query ke liye is email '
            f'ka reply karein.'
        )
    else:
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Welcome, Dr. {n} 🌿</h2>'
            f'<p>Thanks for joining <strong>Online Vaidhyaji</strong>. Your account '
            f'has been submitted for admin verification.</p>'
            f'<ul><li>Our team will verify your registration number within '
            f'1-2 business days.</li>'
            f'<li>Once verified, you can consult patients and access the '
            f'doctors-only community, <strong>Vaidya Charcha</strong>.</li></ul>'
            f'{_cta("Open Doctor Dashboard", APP_HTTPS_URL)}'
        )
        footer = (
            f'Sent by {escape(EMAIL_FROM_NAME)} · Reply to this email for any '
            f'onboarding questions.'
        )
    return _wrap_layout(inner, footer)


# ─────────────────────────── High-level welcome API ────────────────────────
async def send_welcome_email(
    user: Dict[str, Any],
    *,
    prakriti: Optional[str] = None,
    kit_name: Optional[str] = None,
    force: bool = False,
) -> Optional[str]:
    """Send a bilingual welcome email once per user.

    SEC-001: atomically claims `welcome_email_sent_at` BEFORE dispatch. If the
    send later fails we roll back the claim so a legitimate retry can succeed,
    while concurrent invocations lose the compare-and-set and short-circuit.

    Skips silently if:
    - user has no email address (phone-only signup)
    - the atomic claim was already taken (concurrent send already in flight)
    """
    email = (user.get("email") or "").strip()
    if not email or not user.get("id"):
        return None

    # Local import to avoid a circular import at module load.
    from server import db  # type: ignore
    from datetime import datetime
    now = datetime.utcnow().isoformat() + "Z"

    if not force:
        # SEC-001: compare-and-set — only the first caller wins the claim.
        # This closes the "two duplicate signups race the flag" window.
        claim = await db.users.update_one(
            {"id": user.get("id"), "welcome_email_sent_at": {"$exists": False}},
            {"$set": {"welcome_email_sent_at": now}},
        )
        if claim.modified_count == 0:
            # Someone else already claimed the send (or it was previously sent).
            return None

    lang = (user.get("preferred_language") or "en").lower()
    if lang not in ("en", "hi"):
        lang = "en"
    role = user.get("role") or "patient"
    name = user.get("name") or ("Doctor" if role == "doctor" else "there")

    if role == "doctor":
        subject = (
            "Welcome to Online Vaidhyaji — Doctor onboarding"
            if lang == "en"
            else "Online Vaidhyaji: Doctor onboarding shuru"
        )
        html = render_doctor_welcome_html(name=name, lang=lang)
    else:
        subject = (
            "Welcome to Online Vaidhyaji 🌿 Your first consultation is on us"
            if lang == "en"
            else "Online Vaidhyaji mein swagat hai 🌿 Pehla consultation FREE"
        )
        html = render_patient_welcome_html(
            name=name, lang=lang, prakriti=prakriti, kit_name=kit_name,
        )

    try:
        email_id = await send_email(to=email, subject=subject, html=html)
        return email_id
    except Exception as e:
        # SEC-002: mask the recipient in logs to avoid leaking PII.
        logger.warning("Welcome email failed for %s: %s", _mask_email(email), e)
        # Roll back the claim so a legitimate retry (via another trigger) can proceed.
        try:
            await db.users.update_one(
                {"id": user.get("id"), "welcome_email_sent_at": now},
                {"$unset": {"welcome_email_sent_at": ""}},
            )
        except Exception as rollback_err:
            logger.warning("Could not roll back welcome_email claim: %s", rollback_err)
        return None


# Keep strong references to in-flight welcome-email tasks so the event loop
# does not garbage-collect them mid-flight (which would surface as
# "task exception never retrieved" warnings). We discard the reference
# once the task is done.
_pending_email_tasks: set = set()


def send_welcome_email_bg(
    user: Dict[str, Any],
    *,
    prakriti: Optional[str] = None,
    kit_name: Optional[str] = None,
) -> None:
    """Fire-and-forget welcome email. Safe to call from any async route.

    Any exception thrown during template rendering OR dispatch is swallowed
    and logged — signup responses must never fail because of email trouble.
    """
    async def _runner():
        try:
            await send_welcome_email(user, prakriti=prakriti, kit_name=kit_name)
        except Exception as e:
            logger.warning("Welcome email dispatcher crashed: %s", e)

    try:
        task = asyncio.create_task(_runner())
        _pending_email_tasks.add(task)
        task.add_done_callback(_pending_email_tasks.discard)
    except RuntimeError:
        # No running event loop — happens in some test contexts. Ignore.
        pass
