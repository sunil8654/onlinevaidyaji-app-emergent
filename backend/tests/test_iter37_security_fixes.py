"""Regression tests for the Iteration 37 security audit fixes.

- SEC-001-P0: APP_ENV=production hard-disables OTP mock mode, even if
  OTP_MOCK_ENABLED=true is left in the env.
- SEC-001-P0: `warning` field is added to the send-otp response whenever we
  ship a mock code, so any human seeing that response in a prod-like context
  is loudly warned.
"""
import os
import sys
import importlib
import asyncio

sys.path.insert(0, "/app/backend")


class TestProductionForceDisablesMock:
    def _reload(self, env_overrides: dict):
        # Snapshot then override + reload
        keys = ("APP_ENV", "OTP_MOCK_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM")
        snap = {k: os.environ.get(k) for k in keys}
        for k, v in env_overrides.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        import otp_sender
        importlib.reload(otp_sender)
        return otp_sender, snap

    def _restore(self, snap):
        for k, v in snap.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_dev_env_allows_mock(self):
        m, snap = self._reload({"APP_ENV": "development", "OTP_MOCK_ENABLED": "true",
                                "TWILIO_ACCOUNT_SID": "", "TWILIO_AUTH_TOKEN": "", "TWILIO_FROM": ""})
        try:
            assert m.OTP_MOCK_ENABLED is True
            out = asyncio.run(m.send_otp_sms("+919876543210", "123456"))
            assert out["ok"] is True and out["provider"] == "mock"
        finally:
            self._restore(snap)
            importlib.reload(m)

    def test_production_hard_refuses_mock(self):
        m, snap = self._reload({"APP_ENV": "production", "OTP_MOCK_ENABLED": "true",
                                "TWILIO_ACCOUNT_SID": "", "TWILIO_AUTH_TOKEN": "", "TWILIO_FROM": ""})
        try:
            assert m.OTP_MOCK_ENABLED is False, (
                "APP_ENV=production must force-disable OTP_MOCK_ENABLED"
            )
            out = asyncio.run(m.send_otp_sms("+919876543210", "999999"))
            assert out["ok"] is False, "prod without Twilio must NOT ship a mock OTP"
            assert "not configured" in out["error"].lower()
        finally:
            self._restore(snap)
            importlib.reload(m)

    def test_production_with_twilio_still_works(self):
        # Twilio configured — production is fine.
        m, snap = self._reload({"APP_ENV": "production", "OTP_MOCK_ENABLED": "true",
                                "TWILIO_ACCOUNT_SID": "ACfake", "TWILIO_AUTH_TOKEN": "toke",
                                "TWILIO_FROM": "+15551230000"})
        try:
            assert m.OTP_MOCK_ENABLED is False
            assert m.twilio_configured() is True
        finally:
            self._restore(snap)
            importlib.reload(m)


class TestServerSendOtpWarning:
    """The send-otp route now adds a loud `warning` field when in mock mode so a
    prod operator can't miss that they've shipped a dev-config."""

    def test_warning_present_in_dev_response(self):
        os.environ["OTP_MOCK_ENABLED"] = "true"
        os.environ["APP_ENV"] = "development"
        os.environ["TWILIO_ACCOUNT_SID"] = ""
        os.environ["TWILIO_AUTH_TOKEN"] = ""
        os.environ["TWILIO_FROM"] = ""
        import server
        importlib.reload(server)
        from fastapi.testclient import TestClient
        c = TestClient(server.app)
        r = c.post("/api/auth/phone/send-otp", json={"phone": "+919876543210"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("provider") == "mock"
        assert "dev_hint" in data and "123456" in data["dev_hint"]
        assert "warning" in data and "TEST" in data["warning"].upper()


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
