"""Iter 42: Fast2SMS integration + provider cascade."""
import sys
import asyncio
from unittest.mock import patch, AsyncMock

sys.path.insert(0, "/app/backend")

import otp_sender as ot


async def _ok(**kw):
    return {"ok": True, "provider": "fast2sms", "request_id": "req-1"}


async def _twilio_ok(**kw):
    return {"ok": True, "provider": "twilio", "sid": "SM-1"}


async def _fast_fail(**kw):
    return {"ok": False, "provider": "fast2sms", "error": "boom"}


class TestFast2SmsFirst:
    def test_fast2sms_wins_when_configured(self):
        with patch.object(ot, "FAST2SMS_API_KEY", "abcd"), \
             patch.object(ot, "_send_via_fast2sms", side_effect=_ok):
            out = asyncio.run(ot.send_otp_sms("+919876543210", "111111"))
            assert out["provider"] == "fast2sms"

    def test_fast2sms_fail_cascades_to_twilio(self):
        with patch.object(ot, "FAST2SMS_API_KEY", "abcd"), \
             patch.object(ot, "TWILIO_ACCOUNT_SID", "AC"), \
             patch.object(ot, "TWILIO_AUTH_TOKEN", "t"), \
             patch.object(ot, "TWILIO_FROM", "+1"), \
             patch.object(ot, "_send_via_fast2sms", side_effect=_fast_fail), \
             patch.object(ot, "_send_via_twilio", side_effect=_twilio_ok):
            out = asyncio.run(ot.send_otp_sms("+919876543210", "222222"))
            assert out["provider"] == "twilio"

    def test_fast2sms_fail_cascades_to_mock_in_dev(self):
        with patch.object(ot, "FAST2SMS_API_KEY", "abcd"), \
             patch.object(ot, "TWILIO_ACCOUNT_SID", ""), \
             patch.object(ot, "TWILIO_AUTH_TOKEN", ""), \
             patch.object(ot, "TWILIO_FROM", ""), \
             patch.object(ot, "OTP_MOCK_ENABLED", True), \
             patch.object(ot, "_send_via_fast2sms", side_effect=_fast_fail):
            out = asyncio.run(ot.send_otp_sms("+919876543210", "333333"))
            assert out["provider"] == "mock"
            assert "333333" in out["dev_hint"]

    def test_fast2sms_fail_no_fallback_returns_error_in_prod(self):
        with patch.object(ot, "FAST2SMS_API_KEY", "abcd"), \
             patch.object(ot, "TWILIO_ACCOUNT_SID", ""), \
             patch.object(ot, "TWILIO_AUTH_TOKEN", ""), \
             patch.object(ot, "TWILIO_FROM", ""), \
             patch.object(ot, "OTP_MOCK_ENABLED", False), \
             patch.object(ot, "_send_via_fast2sms", side_effect=_fast_fail):
            out = asyncio.run(ot.send_otp_sms("+919876543210", "444444"))
            assert out["ok"] is False and out["provider"] == "fast2sms"


class TestFast2SmsRequestShape:
    """Verify we build the correct payload for Fast2SMS Quick SMS route."""

    def test_payload_strips_country_code_and_includes_route_q(self):
        captured = {}
        class FakeResp:
            status_code = 200
            content = b'{"return":true,"request_id":"r-1"}'
            def json(self): return {"return": True, "request_id": "r-1"}
        class FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, url, headers=None, json=None):
                captured["url"] = url
                captured["headers"] = headers
                captured["json"] = json
                return FakeResp()

        with patch.object(ot, "FAST2SMS_API_KEY", "myfast2smskey"), \
             patch.object(ot, "FAST2SMS_SENDER_ID", "VAIDYA"), \
             patch.object(ot, "httpx",
                          type("H", (), {"AsyncClient": lambda *a, **k: FakeClient()})):
            asyncio.run(ot._send_via_fast2sms(to="+919876543210", body="Your OTP is 123456"))
            assert captured["url"].endswith("/dev/bulkV2")
            assert captured["headers"]["authorization"] == "myfast2smskey"
            assert captured["json"]["route"] == "q"
            assert captured["json"]["numbers"] == "9876543210"    # +91 stripped
            assert captured["json"]["sender_id"] == "VAIDYA"
            assert "123456" in captured["json"]["message"]

    def test_rejects_non_indian_numbers(self):
        with patch.object(ot, "FAST2SMS_API_KEY", "k"):
            out = asyncio.run(ot._send_via_fast2sms(to="+15551234567", body="hi"))
            assert out["ok"] is False
            assert "10-digit indian" in out["error"].lower()


class TestConfiguredHelpers:
    def test_fast2sms_configured_reflects_env(self):
        with patch.object(ot, "FAST2SMS_API_KEY", ""):
            assert ot.fast2sms_configured() is False
        with patch.object(ot, "FAST2SMS_API_KEY", "x"):
            assert ot.fast2sms_configured() is True
