"""Smoke tests for Phase 1c Welcome Email guardrails + templates."""
import sys
sys.path.insert(0, "/app/backend")
import asyncio
from emails import (
    _assert_safe_email,
    render_patient_welcome_html,
    render_doctor_welcome_html,
    send_email,
)


def test_patient_template_en_passes_gate():
    html = render_patient_welcome_html(
        name="Priya Sharma", lang="en",
        prakriti="Vata-Pitta", kit_name="Digestion & Detox",
    )
    _assert_safe_email("Welcome to Online Vaidhyaji 🌿", html)


def test_patient_template_hi_passes_gate():
    html = render_patient_welcome_html(name="Rahul", lang="hi")
    _assert_safe_email("Swagat", html)


def test_doctor_template_en_passes_gate():
    html = render_doctor_welcome_html(name="Ayush Verma", lang="en")
    _assert_safe_email("Welcome Doctor", html)


def test_doctor_template_hi_passes_gate():
    html = render_doctor_welcome_html(name="Anjali", lang="hi")
    _assert_safe_email("Swagat", html)


def test_gate_blocks_form():
    try:
        _assert_safe_email("s", "<form><input name='pw'/></form>")
    except ValueError as e:
        assert "G2" in str(e)
        return
    raise AssertionError("Gate should reject <form>")


def test_gate_blocks_credential_ask():
    try:
        _assert_safe_email("Verify", "<p>Please reply with your password to verify.</p>")
    except ValueError as e:
        assert "G2" in str(e)
        return
    raise AssertionError("Gate should reject credential-ask phrasing")


def test_gate_blocks_non_https_href():
    try:
        _assert_safe_email("Hi", '<a href="http://evil.com">click</a>')
    except ValueError as e:
        assert "G3" in str(e)
        return
    raise AssertionError("Gate should reject http:// links")


def test_send_email_delivered_smoke():
    """Optional live send to delivered@resend.dev — proves the send helper wires up."""
    html = render_patient_welcome_html(name="Test User", lang="en")
    email_id = asyncio.run(send_email(
        to="delivered@resend.dev",
        subject="[TEST] Online Vaidhyaji welcome smoke",
        html=html,
    ))
    print("Email queued id:", email_id)
    assert email_id, "send_email should return a delivery id"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("OK  ", name)
            except Exception as e:
                print("FAIL", name, "-", e)
