"""Emergent-managed Resend integration for Online VaidyaJi.

Sends bilingual welcome emails after signup/quiz completion.

Guardrails (per Emergent playbook):
- G1: from_name = "Online VaidyaJi" only. No impersonation.
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
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Online VaidyaJi")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

# ── Optional SMTP (Hostinger / Gmail / any TLS provider) ──────────────────
# When SMTP_HOST is present we send via SMTP with STARTTLS and the branded
# From address the operator owns. If it fails or isn't configured we fall back
# to the Emergent-managed Resend proxy (which uses a platform sender address).
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587") or "587")
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = (os.environ.get("SMTP_FROM") or SMTP_USER or "").strip()
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", EMAIL_FROM_NAME)
SMTP_STARTTLS = os.environ.get("SMTP_STARTTLS", "true").lower() in ("1", "true", "yes")

# Where the welcome email's "Open the app" CTA points to.
APP_HTTPS_URL = os.environ.get("APP_HTTPS_URL", "https://onlinevaidhyaji.emergent.host")


def smtp_configured() -> bool:
    """True iff SMTP env vars are all set — i.e. we should prefer SMTP."""
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)

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
async def _send_email_smtp(*, to: str, subject: str, html: str,
                            reply_to: Optional[str] = None) -> Optional[str]:
    """Send via SMTP (STARTTLS on 587 by default). Runs the sync smtplib
    call in a threadpool so the FastAPI event loop stays non-blocking.

    Returns the RFC 5322 Message-Id on success. Raises on failure.
    """
    import smtplib
    import ssl
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.utils import formataddr, make_msgid
    from starlette.concurrency import run_in_threadpool

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((SMTP_FROM_NAME, SMTP_FROM))
    msg["To"] = to
    if reply_to or EMAIL_REPLY_TO:
        msg["Reply-To"] = (reply_to or EMAIL_REPLY_TO)
    msg_id = make_msgid(domain=SMTP_FROM.split("@", 1)[-1])
    msg["Message-Id"] = msg_id
    # Plain-text fallback derived from the HTML — improves inbox placement.
    text_fallback = re.sub(r"<[^>]+>", " ", html)
    text_fallback = re.sub(r"\s+", " ", text_fallback).strip()
    msg.attach(MIMEText(text_fallback[:5000] or " ", "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    def _blocking_send():
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as srv:
            srv.ehlo()
            if SMTP_STARTTLS:
                srv.starttls(context=ctx)
                srv.ehlo()
            srv.login(SMTP_USER, SMTP_PASSWORD)
            srv.sendmail(SMTP_FROM, [to], msg.as_string())

    await run_in_threadpool(_blocking_send)
    return msg_id.strip("<>")


async def send_email(*, to: str, subject: str, html: str, reply_to: Optional[str] = None) -> Optional[str]:
    """Send a single transactional email.

    Delivery preference:
    1. SMTP (Hostinger / any TLS provider) when SMTP_HOST is configured —
       preserves the branded From address (info@onlinevaidyaji.com).
    2. Emergent-managed Resend proxy as a fallback (platform-owned sender).

    Raises on complete send failure. Callers that want fire-and-forget should
    use `send_welcome_email_bg`.
    """
    _assert_safe_email(subject, html)

    # Prefer SMTP if configured — that's the domain-branded path.
    if smtp_configured():
        try:
            return await _send_email_smtp(to=to, subject=subject, html=html, reply_to=reply_to)
        except Exception as e:
            # Fall back to Resend rather than dropping the email entirely.
            logger.warning(
                "SMTP send failed for %s (%s); falling back to Emergent Resend",
                _mask_email(to), e,
            )

    if not EMAIL_KEY:
        logger.warning("No email transport available (SMTP failed, EMERGENT_EMAIL_KEY missing)")
        return None
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


# Keep strong references to in-flight email tasks so the event loop
# does not garbage-collect them mid-flight. Removed when the task finishes.
_pending_email_tasks: set = set()


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
        f'opacity:.85">ॐ Online VaidyaJi</div>'
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
            f'<p><strong>Online VaidyaJi</strong> mein aapka swagat hai — verified '
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
            f'<p>You\'re now part of <strong>Online VaidyaJi</strong> — verified '
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
            f'<p><strong>Online VaidyaJi</strong> mein aapka swagat hai. Aapka '
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
            f'<p>Thanks for joining <strong>Online VaidyaJi</strong>. Your account '
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


# ─────────────────────────── Prakriti Report template ──────────────────────
def render_prakriti_report_html(
    *,
    name: str,
    lang: str = "en",
    prakriti: str,
    description: str,
    dosha_scores: Dict[str, int],
    kit_name: Optional[str] = None,
    free_consult: bool = True,
) -> str:
    """Post-quiz Prakriti report — richer than the welcome email."""
    n = escape(name.split()[0] if name else ("dost" if lang == "hi" else "there"))
    total = max(1, sum(dosha_scores.values() or [1]))
    # Simple dosha bar rows
    rows = []
    for dosha in ("vata", "pitta", "kapha"):
        pct = int(round(100 * (dosha_scores.get(dosha, 0) / total)))
        rows.append(
            f'<tr><td style="padding:4px 8px 4px 0;color:{_BRAND};'
            f'font-weight:700;width:70px">{escape(dosha.title())}</td>'
            f'<td style="padding:4px 0"><div style="background:#efe7d3;'
            f'border-radius:8px;height:10px;overflow:hidden;width:100%">'
            f'<div style="background:{_ACCENT};height:10px;width:{pct}%"></div>'
            f'</div></td>'
            f'<td style="padding:4px 0 4px 8px;color:#7b6b53;width:44px;'
            f'text-align:right">{pct}%</td></tr>'
        )
    bar_table = (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'style="margin:14px 0 6px 0">{"".join(rows)}</table>'
    )
    kit_line = (
        f'<p><strong>{("Aapke liye recommended kit" if lang == "hi" else "Recommended for you")}:</strong> '
        f'{escape(kit_name)}.</p>' if kit_name else ""
    )
    free_line = (
        f'<p style="color:{_BRAND};font-weight:700">'
        f'{"🎁 Aapka pehla consultation FREE hai." if lang == "hi" else "🎁 Your first consultation is free."}</p>'
        if free_consult else ""
    )
    if lang == "hi":
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 6px 0">Namaste {n} 🙏</h2>'
            f'<p style="color:#7b6b53;margin:0">Aapki personal Prakriti report taiyaar hai.</p>'
            f'<h3 style="color:{_ACCENT};margin:18px 0 4px 0">Aapki Prakriti: '
            f'{escape(prakriti)}</h3>'
            f'{bar_table}'
            f'<p>{escape(description)}</p>'
            f'{kit_line}{free_line}'
            f'{_cta("Doctor se Book Karein", APP_HTTPS_URL)}'
        )
        subject_footer = (
            f'Sent by {escape(EMAIL_FROM_NAME)} · Yeh report aapke quiz answers par '
            f'aadharit hai. Doctor consultation ke baad aap aur bhi guidance paayenge.'
        )
    else:
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 6px 0">Hi {n} 🌿</h2>'
            f'<p style="color:#7b6b53;margin:0">Your personal Prakriti report is ready.</p>'
            f'<h3 style="color:{_ACCENT};margin:18px 0 4px 0">Your Prakriti: '
            f'{escape(prakriti)}</h3>'
            f'{bar_table}'
            f'<p>{escape(description)}</p>'
            f'{kit_line}{free_line}'
            f'{_cta("Book a Doctor", APP_HTTPS_URL)}'
        )
        subject_footer = (
            f'Sent by {escape(EMAIL_FROM_NAME)} · This report is based on your quiz '
            f'answers. Your doctor will personalise it further during your consultation.'
        )
    return _wrap_layout(inner, subject_footer)


async def send_prakriti_report_email(
    user: Dict[str, Any],
    *,
    prakriti: str,
    description: str,
    dosha_scores: Dict[str, int],
    kit_name: Optional[str] = None,
    free_consult: bool = True,
) -> Optional[str]:
    """Send the post-quiz Prakriti Report. Idempotent per quiz result via a
    server-side flag (`prakriti_email_sent_at`). Never raises."""
    email = (user.get("email") or "").strip()
    if not email or not user.get("id"):
        return None
    lang = (user.get("preferred_language") or "en").lower()
    if lang not in ("en", "hi"):
        lang = "en"
    name = user.get("name") or ("dost" if lang == "hi" else "there")

    # Local import to avoid circular at module load.
    from server import db  # type: ignore
    from datetime import datetime
    now = datetime.utcnow().isoformat() + "Z"

    # Atomic claim per user — same CAS pattern as the welcome email.
    claim = await db.users.update_one(
        {"id": user["id"], "prakriti_email_sent_at": {"$exists": False}},
        {"$set": {"prakriti_email_sent_at": now}},
    )
    if claim.modified_count == 0:
        return None

    subject = (
        "Your Prakriti report from Online VaidyaJi 🌿"
        if lang == "en"
        else "Aapki Prakriti report — Online VaidyaJi 🌿"
    )
    html = render_prakriti_report_html(
        name=name, lang=lang, prakriti=prakriti, description=description,
        dosha_scores=dosha_scores, kit_name=kit_name, free_consult=free_consult,
    )
    try:
        return await send_email(to=email, subject=subject, html=html)
    except Exception as e:
        logger.warning("Prakriti report failed for %s: %s", _mask_email(email), e)
        try:
            await db.users.update_one(
                {"id": user["id"], "prakriti_email_sent_at": now},
                {"$unset": {"prakriti_email_sent_at": ""}},
            )
        except Exception as rollback_err:
            logger.warning("Could not roll back prakriti claim: %s", rollback_err)
        return None


def send_prakriti_report_email_bg(user: Dict[str, Any], **kwargs) -> None:
    """Fire-and-forget Prakriti Report dispatch."""
    async def _runner():
        try:
            await send_prakriti_report_email(user, **kwargs)
        except Exception as e:
            logger.warning("Prakriti report dispatcher crashed: %s", e)
    try:
        task = asyncio.create_task(_runner())
        _pending_email_tasks.add(task)
        task.add_done_callback(_pending_email_tasks.discard)
    except RuntimeError:
        pass


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
            "Welcome to Online VaidyaJi — Doctor onboarding"
            if lang == "en"
            else "Online VaidyaJi: Doctor onboarding shuru"
        )
        html = render_doctor_welcome_html(name=name, lang=lang)
    else:
        subject = (
            "Welcome to Online VaidyaJi 🌿 Your first consultation is on us"
            if lang == "en"
            else "Online VaidyaJi mein swagat hai 🌿 Pehla consultation FREE"
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
