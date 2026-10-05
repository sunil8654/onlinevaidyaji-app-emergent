"""Transactional notification emails for the doctor/patient/admin flows.

The app previously emailed only on signup (welcome + Prakriti report), so
booking, payment, cancellation, verification and prescription events were push-only
and the admin was never told about anything. This module adds the same events the
website sends (OnlineVaidhyaJi.com/backend/routes/{appointments,payments,doctors,
admin,pharmacy}.js), reusing the same SMTP transport as `emails.py` so the
operator's branded From address is used.

Design rules:
- Every send is fire-and-forget. A mail failure must never fail a booking, a
  payment, or a prescription. Failures are logged, never raised to the caller.
- Recipients are resolved from the shared DB (`users.email` / `doctors.user_id`),
  never from client input, so this cannot be used to mail an arbitrary address.
- Templates are server-side only, contain no forms, and every link is absolute
  https to our own domain (the G1-G5 guardrails `emails._assert_safe_email`
  enforces are re-checked for free on every send).
"""
import asyncio
import logging
from html import escape
from typing import Any, Dict, List, Optional

import emails as _emails
from emails import _ACCENT, _BRAND, _STYLE, _wrap_layout

logger = logging.getLogger(__name__)

_pending_tasks: set = set()

# Base URL for deep links. Kept in emails.py so both share one source of truth.
APP_URL = _emails.APP_HTTPS_URL.rstrip("/")

_BRAND_FOOTER = (
    "You are receiving this because you have an account on Online VaidyaJi. "
    "This is a transactional message and cannot be unsubscribed."
)


def _is_valid_email(addr: Any) -> bool:
    """Cheap structural check. We never send to anything that fails this."""
    if not addr or not isinstance(addr, str):
        return False
    a = addr.strip()
    if a.count("@") != 1:
        return False
    local, _, domain = a.partition("@")
    if not local or not domain or "." not in domain:
        return False
    if domain.startswith(".") or domain.endswith("."):
        return False
    return " " not in a and "\n" not in a and "\r" not in a


def _first_name(full_name: Any) -> str:
    name = str(full_name or "").strip()
    if not name:
        return "there"
    first = name.split()[0]
    # The shared DB stores display names inconsistently ('sunil singh', 'Dr. X').
    return first


def _fmt_when(date_str: Any, time_str: Any) -> str:
    """Human-ish appointment datetime. Never fabricates a value: an unknown
    piece is simply omitted rather than defaulted to today."""
    parts = []
    if date_str:
        d = str(date_str)[:10]
        parts.append(d)
    if time_str:
        t = str(time_str)[:5]
        parts.append(t)
    return " on ".join([parts[0], " ".join(parts[1:])]) if len(parts) > 1 else (
        parts[0] if parts else "the scheduled time"
    )


def _mail(to: Any, subject: str, inner: str) -> None:
    """Queue one email. Never raises, never blocks the caller."""
    if not _is_valid_email(to):
        logger.info("email skipped: no valid recipient (subject=%s)", subject)
        return
    html = _wrap_layout(inner, _BRAND_FOOTER)

    async def _runner():
        try:
            await _emails.send_email(to=str(to).strip(), subject=subject, html=html)
        except Exception as e:  # noqa: BLE001 - mail must never break a request
            logger.warning(
                "transactional email failed (%s -> %s): %s",
                _emails._mask_email(str(to)), subject, e,
            )

    try:
        task = asyncio.create_task(_runner())
        _pending_tasks.add(task)
        task.add_done_callback(_pending_tasks.discard)
    except RuntimeError:
        # No running loop (e.g. a sync test calling a route helper directly).
        logger.debug("no event loop; email %r not dispatched", subject)


# --------------------------------------------------------------------------- #
# Templates
# --------------------------------------------------------------------------- #
def _card(rows: List[str]) -> str:
    body = "".join(
        f'<tr><td style="padding:5px 0;color:#5c6b62;font-size:14px">{r}</td></tr>'
        for r in rows
    )
    return f'<table role="presentation" width="100%" style="margin:16px 0">{body}</table>'


def _cta(label: str, href: str) -> str:
    return (
        f'<div style="text-align:center;margin:22px 0 6px 0">'
        f'<a href="{escape(href)}" '
        f'style="display:inline-block;background:{_BRAND};color:#ffffff;'
        f'text-decoration:none;font-weight:700;padding:12px 22px;'
        f'border-radius:999px">{escape(label)}</a></div>'
    )


# --------------------------------------------------------------------------- #
# 1. Appointment cancelled -> patient AND doctor  (website routes/appointments.js)
# --------------------------------------------------------------------------- #
def send_appointment_cancelled_emails(
    *,
    patient_email: Any, patient_name: Any,
    doctor_email: Any, doctor_name: Any,
    when: str,
    cancelled_by: str,
) -> None:
    subject = "Appointment Cancelled - Online VaidyaJi"
    for addr, who, other in (
        (patient_email, patient_name, doctor_name),
        (doctor_email, doctor_name, patient_name),
    ):
        if not _is_valid_email(addr):
            continue
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Appointment Cancelled</h2>'
            f'<p style="margin:0 0 6px 0">Hi {escape(_first_name(who))},</p>'
            f'<p style="margin:0">Your appointment with '
            f'<strong>Dr. {escape(str(other) or "your doctor")}</strong> '
            f'{escape(when)} has been cancelled.</p>'
            + _card([
                f"<strong>Cancelled by:</strong> {escape(cancelled_by)}",
                f"<strong>Doctor:</strong> Dr. {escape(str(doctor_name))}",
            ])
            + _cta("View my appointments", f"{APP_URL}/appointments")
        )
        _mail(addr, subject, inner)


# --------------------------------------------------------------------------- #
# 2. Booking + payment received -> patient, doctor AND admin
#    (website routes/payments.js)
# --------------------------------------------------------------------------- #
def send_booking_paid_emails(
    *,
    patient_email: Any, patient_name: Any,
    doctor_email: Any, doctor_name: Any,
    when: str, amount_rs: Optional[float], mode: str,
    admin_emails: Optional[List[Any]] = None,
) -> None:
    mode_label = "Online consultation" if mode == "online" else "In-clinic visit"
    rows = [
        f"<strong>Doctor:</strong> Dr. {escape(str(doctor_name))}",
        f"<strong>When:</strong> {escape(when)}",
        f"<strong>Mode:</strong> {escape(mode_label)}",
    ]
    if amount_rs is not None:
        rows.append(f"<strong>Amount paid:</strong> ₹{float(amount_rs):.0f}")

    _mail(
        patient_email,
        "Appointment Booked & Payment Received - Online VaidyaJi",
        f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Your appointment is confirmed</h2>'
        f'<p style="margin:0 0 6px 0">Hi {escape(_first_name(patient_name))},</p>'
        f'<p style="margin:0">Your booking is confirmed and your payment was received.</p>'
        + _card(rows) + _cta("Open my appointments", f"{APP_URL}/appointments"),
    )
    _mail(
        doctor_email,
        "New Booking & Payment Received - Online VaidyaJi",
        f'<h2 style="color:{_BRAND};margin:0 0 10px 0">New appointment booked</h2>'
        f'<p style="margin:0 0 6px 0">Hi Dr. {escape(str(doctor_name))},</p>'
        f'<p style="margin:0"><strong>{escape(str(patient_name))}</strong> booked a '
        f'consultation with you and payment was received.</p>'
        + _card(rows + [f"<strong>Patient:</strong> {escape(str(patient_name))}"])
        + _cta("Open dashboard", f"{APP_URL}/doctor/home"),
    )
    for admin_addr in admin_emails or []:
        _mail(
            admin_addr,
            "New Appointment Booked & Payment Received - Online VaidyaJi",
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">New booking</h2>'
            f'<p style="margin:0 0 6px 0">A new paid appointment was booked.</p>'
            + _card(rows + [
                f"<strong>Patient:</strong> {escape(str(patient_name))}",
                f"<strong>Doctor:</strong> Dr. {escape(str(doctor_name))}",
            ])
            + _cta("Admin dashboard", f"{APP_URL}/admin"),
        )


# --------------------------------------------------------------------------- #
# 3. Doctor profile submitted -> doctor AND admin
#    (website routes/doctors.js)
# --------------------------------------------------------------------------- #
def send_doctor_submitted_emails(
    *, doctor_email: Any, doctor_name: Any, admin_emails: Optional[List[Any]] = None
) -> None:
    _mail(
        doctor_email,
        "Profile Submitted - Pending Verification - Online VaidyaJi",
        f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Profile received</h2>'
        f'<p style="margin:0 0 6px 0">Hi Dr. {escape(_first_name(doctor_name))},</p>'
        f'<p style="margin:0">Your profile has been submitted and is now pending '
        f'verification by our team. You will get an email as soon as it is approved.</p>'
        + _cta("Complete your profile", f"{APP_URL}/doctor/edit-profile"),
    )
    for admin_addr in admin_emails or []:
        _mail(
            admin_addr,
            "New Doctor Verification Request - Online VaidyaJi",
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Verification request</h2>'
            f'<p style="margin:0 0 6px 0">A doctor has submitted their profile for verification.</p>'
            + _card([
                f"<strong>Doctor:</strong> Dr. {escape(str(doctor_name))}",
                "<strong>Status:</strong> pending",
            ])
            + _cta("Review doctor", f"{APP_URL}/admin/doctors"),
        )


# --------------------------------------------------------------------------- #
# 4. Account verified / rejected -> doctor
#    (website routes/admin.js)
# --------------------------------------------------------------------------- #
def send_doctor_verified_email(
    *, doctor_email: Any, doctor_name: Any, approved: bool
) -> None:
    if approved:
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Account Verified</h2>'
            f'<p style="margin:0 0 6px 0">Hi Dr. {escape(_first_name(doctor_name))},</p>'
            f'<p style="margin:0">Your account has been verified. You can now start '
            f'seeing patients on Online VaidyaJi.</p>'
            + _cta("Open dashboard", f"{APP_URL}/doctor/home")
        )
        _mail(doctor_email, "Account Verified - Online VaidyaJi", inner)
    else:
        inner = (
            f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Profile needs attention</h2>'
            f'<p style="margin:0 0 6px 0">Hi Dr. {escape(_first_name(doctor_name))},</p>'
            f'<p style="margin:0">Your profile could not be approved yet. Please review '
            f'your details and resubmit your documents.</p>'
            + _cta("Update profile", f"{APP_URL}/doctor/edit-profile")
        )
        _mail(doctor_email, "Profile Rejected - Online VaidyaJi", inner)


# --------------------------------------------------------------------------- #
# 5. Prescription ready -> patient  (website routes/pharmacy.js)
# --------------------------------------------------------------------------- #
def send_prescription_email(
    *, patient_email: Any, patient_name: Any, doctor_name: Any, when: str
) -> None:
    _mail(
        patient_email,
        "Prescription Ready - Online VaidyaJi",
        f'<h2 style="color:{_BRAND};margin:0 0 10px 0">Your prescription is ready</h2>'
        f'<p style="margin:0 0 6px 0">Hi {escape(_first_name(patient_name))},</p>'
        f'<p style="margin:0">Dr. {escape(str(doctor_name))} has added a prescription '
        f'for your consultation {escape(when)}.</p>'
        + _card([
            f"<strong>Prescribed by:</strong> Dr. {escape(str(doctor_name))}",
            f"<strong>Consultation:</strong> {escape(when)}",
        ])
        + _cta("View prescription", f"{APP_URL}/appointments"),
    )


# --------------------------------------------------------------------------- #
# Recipients — resolved server-side from the shared DB
# --------------------------------------------------------------------------- #
async def admin_email_addresses() -> List[str]:
    """Every admin in the shared `users` table, matching the website's
    `SELECT id, email, name FROM users WHERE role = 'admin'`."""
    try:
        rows = await _db().users.find(
            {"role": "admin", "is_active": {"$ne": False}}, {"_id": 0, "email": 1}
        ).to_list(50)
    except Exception as e:  # noqa: BLE001
        logger.warning("could not resolve admin emails: %s", e)
        return []
    return [r["email"] for r in rows if _is_valid_email(r.get("email"))]


async def user_email(user_id: Any) -> Optional[str]:
    if not user_id:
        return None
    try:
        row = await _db().users.find_one(
            {"id": user_id}, {"_id": 0, "email": 1, "name": 1}
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("could not resolve user email for %s: %s", user_id, e)
        return None
    return row.get("email") if _is_valid_email(row.get("email")) else None


async def doctor_email(doctor_id: Any) -> Optional[str]:
    """Resolve a doctor's email from `doctors.id`.

    `appointments.doctor_id` points at `doctors.id`, NOT `users.id`, so passing
    it to `user_email()` silently returns None (or worse, another user's
    address when the two id spaces overlap). Go through `doctors.user_id`.
    """
    if not doctor_id:
        return None
    try:
        row = await _db().doctors.find_one(
            {"id": doctor_id}, {"_id": 0, "user_id": 1}
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("could not resolve doctor %s: %s", doctor_id, e)
        return None
    if not row:
        return None
    return await user_email(row.get("user_id"))


def _db():
    """Lazily import to avoid a circular import (server imports this module)."""
    import server
    return server.db
