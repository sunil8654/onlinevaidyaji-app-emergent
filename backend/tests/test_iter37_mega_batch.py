"""Regression tests for Iteration 37 mega-batch:
- Prakriti Report Email templates + idempotent dispatch
- Doctor Availability Badge (heartbeat + is_online computation)
- Twilio OTP sender with graceful mock fallback
- Wiring smoke through the FastAPI app.
"""
import os
import sys
import time
import asyncio
import uuid
from unittest.mock import patch, AsyncMock

sys.path.insert(0, "/app/backend")

os.environ.setdefault("OTP_MOCK_ENABLED", "true")

from fastapi.testclient import TestClient
import emails as em
import otp_sender as ot


# ─────────────────────────── Prakriti Report ────────────────────────────
class TestPrakritiReport:
    def test_report_template_gate_ok(self):
        html = em.render_prakriti_report_html(
            name="Kavya", lang="en", prakriti="Vata-Pitta",
            description="Balanced, energetic constitution.",
            dosha_scores={"vata": 12, "pitta": 10, "kapha": 6},
            kit_name="Digestion & Detox",
        )
        em._assert_safe_email("Your Prakriti report", html)
        assert "Vata-Pitta" in html and "%" in html

    def test_report_template_hi_gate_ok(self):
        html = em.render_prakriti_report_html(
            name="Ravi", lang="hi", prakriti="Kapha",
            description="Sthir, balwan Prakriti.",
            dosha_scores={"vata": 4, "pitta": 6, "kapha": 14},
        )
        em._assert_safe_email("Aapki Prakriti", html)

    def test_report_dispatch_is_idempotent(self):
        user = {
            "id": f"u-{uuid.uuid4().hex[:6]}",
            "email": "delivered@resend.dev",
            "name": "Idempotent", "preferred_language": "en", "role": "patient",
        }
        # Fake DB: first CAS wins, second loses
        class FakeUsers:
            def __init__(self): self.calls = 0
            async def update_one(self, filt, upd, *a, **k):
                self.calls += 1
                class R: pass
                r = R()
                # First call sets, second sees existing → 0
                r.modified_count = 1 if self.calls == 1 else 0
                return r
        fake_db = type("D", (), {})()
        fake_db.users = FakeUsers()
        sys.modules["server"] = type("S", (), {"db": fake_db})()
        try:
            with patch.object(em, "send_email", AsyncMock(return_value="pk-1")) as s:
                out1 = asyncio.run(em.send_prakriti_report_email(
                    user, prakriti="Vata", description="d", dosha_scores={"vata": 1, "pitta": 1, "kapha": 1}
                ))
                out2 = asyncio.run(em.send_prakriti_report_email(
                    user, prakriti="Vata", description="d", dosha_scores={"vata": 1, "pitta": 1, "kapha": 1}
                ))
                assert out1 == "pk-1"
                assert out2 is None
                assert s.call_count == 1
        finally:
            sys.modules.pop("server", None)


# ─────────────────────────── Twilio OTP sender ────────────────────────────
class TestOtpSender:
    def test_mock_fallback_when_no_twilio(self):
        # Force env to be empty for twilio
        with patch.object(ot, "TWILIO_ACCOUNT_SID", ""), \
             patch.object(ot, "TWILIO_AUTH_TOKEN", ""), \
             patch.object(ot, "TWILIO_FROM", ""), \
             patch.object(ot, "OTP_MOCK_ENABLED", True):
            out = asyncio.run(ot.send_otp_sms("+919876543210", "123456"))
            assert out["ok"] is True
            assert out["provider"] == "mock"
            assert "123456" in out["dev_hint"]

    def test_hard_fail_when_no_creds_and_mock_off(self):
        with patch.object(ot, "TWILIO_ACCOUNT_SID", ""), \
             patch.object(ot, "TWILIO_AUTH_TOKEN", ""), \
             patch.object(ot, "TWILIO_FROM", ""), \
             patch.object(ot, "OTP_MOCK_ENABLED", False):
            out = asyncio.run(ot.send_otp_sms("+919876543210", "123456"))
            assert out["ok"] is False
            assert "not configured" in out["error"].lower()

    def test_twilio_path_uses_basic_auth(self):
        # Fake TWILIO_* env + fake httpx POST to assert we build the right request.
        with patch.object(ot, "TWILIO_ACCOUNT_SID", "ACfake"), \
             patch.object(ot, "TWILIO_AUTH_TOKEN", "tokenfake"), \
             patch.object(ot, "TWILIO_FROM", "MGmsgsvc123"):
            captured = {}
            class FakeResp:
                status_code = 201
                content = b"{}"
                def json(self): return {"sid": "SM123"}
            class FakeClient:
                async def __aenter__(self): return self
                async def __aexit__(self, *a): return False
                async def post(self, url, data=None, auth=None):
                    captured["url"] = url
                    captured["data"] = data
                    captured["auth"] = auth
                    return FakeResp()
            with patch.object(ot, "httpx", type("H", (), {"AsyncClient": lambda *a, **k: FakeClient()})):
                out = asyncio.run(ot.send_otp_sms("9876543210", "654321"))
                assert out["ok"] is True and out["sid"] == "SM123"
                assert captured["data"].get("MessagingServiceSid") == "MGmsgsvc123"
                assert captured["data"]["To"] == "+919876543210"
                assert "654321" in captured["data"]["Body"]
                assert captured["auth"] == ("ACfake", "tokenfake")

    def test_mask_phone(self):
        assert ot._mask_phone("+919876543210") == "+9198******10"
        assert ot._mask_phone("") == "***"


# ─────────────────────────── Doctor availability ────────────────────────────
class TestDoctorAvailability:
    def test_is_online_boundary(self):
        # Import from server so this covers the actual production helper
        import server
        from datetime import datetime, timedelta
        recent = (datetime.utcnow() - timedelta(seconds=30)).isoformat() + "Z"
        stale = (datetime.utcnow() - timedelta(seconds=600)).isoformat() + "Z"
        assert server._compute_is_online(recent) is True
        assert server._compute_is_online(stale) is False
        assert server._compute_is_online(None) is False
        assert server._compute_is_online("garbage") is False

    def test_decorate_doctor_removes_raw_timestamp(self):
        import server
        d = {"id": "x", "last_seen_at": "not-a-real-timestamp"}
        out = server._decorate_doctor(d)
        assert "last_seen_at" not in out, (
            "raw last_seen_at must not leak to public callers"
        )
        assert out["is_online"] is False

    def test_heartbeat_requires_doctor_role(self):
        # Use a mock user via the TestClient dep-override hook
        import server
        app = server.app
        client = TestClient(app)
        async def patient_user():
            return {"id": "p1", "role": "patient", "name": "P"}
        app.dependency_overrides[server.current_user] = patient_user
        try:
            r = client.post("/api/doctors/heartbeat")
            assert r.status_code == 403
        finally:
            app.dependency_overrides.pop(server.current_user, None)


if __name__ == "__main__":
    import traceback
    passed = failed = 0
    for cls_name, cls in list(globals().items()):
        if not (cls_name.startswith("Test") and isinstance(cls, type)):
            continue
        inst = cls()
        for m in dir(inst):
            if not m.startswith("test_"):
                continue
            try:
                getattr(inst, m)()
                print("OK  ", cls_name, m)
                passed += 1
            except Exception:
                traceback.print_exc()
                print("FAIL", cls_name, m)
                failed += 1
    print(f"\n{passed} passed, {failed} failed")
