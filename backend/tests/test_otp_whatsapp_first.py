"""WhatsApp-first login OTP with automatic SMS fallback.

Covers the delivery contract in `otp_sender.send_otp()`:

1. WhatsApp is only attempted when `WHATSAPP_ENABLED_OTP` is on *and* the chosen
   provider is fully configured (a half-configured provider must be skipped, not
   burned as a guaranteed-failure API call).
2. A successful WhatsApp send short-circuits the SMS fallback entirely.
3. A WhatsApp failure of ANY kind (recipient has no WhatsApp, undeliverable
   number, out-of-window template rejection, network blip) falls through to SMS.
   The user always gets their code — "no WhatsApp" is not an error state.
4. The returned `channel` field tells the caller how the code was delivered.
5. Nothing configured at all still degrades to the dev mock in dev.

These are unit tests: `httpx.AsyncClient` is replaced so no network is touched.

SEC: no test asserts on a real credential or a full phone number.
"""
import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import otp_sender  # noqa: E402


# --------------------------------------------------------------------------
# httpx test double
# --------------------------------------------------------------------------
class _FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text
        self.content = b'{"ok":true}'

    def json(self):
        return self._payload


class _FakeClient:
    """Stands in for httpx.AsyncClient. Routes canned responses by URL fragment."""

    responses: dict = {}
    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        _FakeClient.calls.append({"url": url, **kwargs})
        for fragment, resp in _FakeClient.responses.items():
            if fragment in url:
                if isinstance(resp, Exception):
                    raise resp
                return resp
        raise AssertionError(f"unexpected POST to {url}")


@pytest.fixture(autouse=True)
def fake_http(monkeypatch):
    """Reset module config + route all HTTP through the double."""
    _FakeClient.responses = {}
    _FakeClient.calls = []
    monkeypatch.setattr(otp_sender.httpx, "AsyncClient", _FakeClient)

    # Neutral starting point: nothing enabled, no providers.
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", False)
    monkeypatch.setattr(otp_sender, "WHATSAPP_PROVIDER", "none")
    monkeypatch.setattr(otp_sender, "META_WHATSAPP_TOKEN", "")
    monkeypatch.setattr(otp_sender, "META_PHONE_NUMBER_ID", "")
    monkeypatch.setattr(otp_sender, "META_WHATSAPP_OTP_TEMPLATE", "")
    monkeypatch.setattr(otp_sender, "TWILIO_WHATSAPP_FROM", "")
    monkeypatch.setattr(otp_sender, "TWILIO_ACCOUNT_SID", "")
    monkeypatch.setattr(otp_sender, "TWILIO_AUTH_TOKEN", "")
    monkeypatch.setattr(otp_sender, "FAST2SMS_API_KEY", "")
    monkeypatch.setattr(otp_sender, "FAST2SMS_SENDER_ID", "")
    monkeypatch.setattr(otp_sender, "OTP_MOCK_ENABLED", False)
    yield


def _enable_meta(monkeypatch, template=""):
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", True)
    monkeypatch.setattr(otp_sender, "WHATSAPP_PROVIDER", "meta")
    monkeypatch.setattr(otp_sender, "META_WHATSAPP_TOKEN", "test-token-not-real")
    monkeypatch.setattr(otp_sender, "META_PHONE_NUMBER_ID", "1234567890")
    monkeypatch.setattr(otp_sender, "META_WHATSAPP_OTP_TEMPLATE", template)


def _enable_fast2sms(monkeypatch):
    monkeypatch.setattr(otp_sender, "FAST2SMS_API_KEY", "test-fast2sms-key-not-real")


def _urls_called():
    return [c["url"] for c in _FakeClient.calls]


# --------------------------------------------------------------------------
# whatsapp_otp_configured gating
# --------------------------------------------------------------------------
def test_disabled_means_not_configured(monkeypatch):
    _enable_meta(monkeypatch)
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", False)
    assert otp_sender.whatsapp_otp_configured() is False


def test_provider_none_is_not_configured(monkeypatch):
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", True)
    monkeypatch.setattr(otp_sender, "WHATSAPP_PROVIDER", "none")
    assert otp_sender.whatsapp_otp_configured() is False


@pytest.mark.parametrize(
    "provider,setup,attr,value",
    [
        ("meta", "token", "META_WHATSAPP_TOKEN", ""),
        ("meta", "phone_id", "META_PHONE_NUMBER_ID", ""),
        ("twilio", "from", "TWILIO_WHATSAPP_FROM", ""),
        ("twilio", "sid", "TWILIO_ACCOUNT_SID", ""),
        ("twilio", "auth", "TWILIO_AUTH_TOKEN", ""),
    ],
)
def test_partially_configured_provider_is_skipped(monkeypatch, provider, setup, attr, value):
    """A half-configured provider must be skipped up front, not called and failed."""
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", True)
    monkeypatch.setattr(otp_sender, "WHATSAPP_PROVIDER", provider)
    monkeypatch.setattr(otp_sender, "META_WHATSAPP_TOKEN", "t")
    monkeypatch.setattr(otp_sender, "META_PHONE_NUMBER_ID", "p")
    monkeypatch.setattr(otp_sender, "TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setattr(otp_sender, "TWILIO_AUTH_TOKEN", "auth")
    monkeypatch.setattr(otp_sender, "TWILIO_WHATSAPP_FROM", "whatsapp:+1415")
    monkeypatch.setattr(otp_sender, attr, value)
    assert otp_sender.whatsapp_otp_configured() is False


def test_fully_configured_meta_is_configured(monkeypatch):
    _enable_meta(monkeypatch)
    assert otp_sender.whatsapp_otp_configured() is True


def test_fully_configured_twilio_is_configured(monkeypatch):
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", True)
    monkeypatch.setattr(otp_sender, "WHATSAPP_PROVIDER", "twilio")
    monkeypatch.setattr(otp_sender, "TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setattr(otp_sender, "TWILIO_AUTH_TOKEN", "auth")
    monkeypatch.setattr(otp_sender, "TWILIO_WHATSAPP_FROM", "whatsapp:+1415")
    assert otp_sender.whatsapp_otp_configured() is True


# --------------------------------------------------------------------------
# send_otp: WhatsApp-first
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_whatsapp_success_skips_sms(monkeypatch):
    _enable_meta(monkeypatch)
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {
        "graph.facebook.com": _FakeResponse(200, {"messaging_product": "whatsapp"}),
        "fast2sms.com": _FakeResponse(200, {"return": True, "request_id": "1"}),
    }

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is True
    assert res["channel"] == "whatsapp"
    assert res["provider"] == "meta"
    # SMS fallback must NOT have been attempted.
    assert not any("fast2sms" in u for u in _urls_called())


@pytest.mark.asyncio
async def test_meta_receives_international_digits_without_plus(monkeypatch):
    """Meta Cloud API wants country code + number, with no '+' prefix."""
    _enable_meta(monkeypatch)
    _FakeClient.responses = {"graph.facebook.com": _FakeResponse(200, {})}

    await otp_sender.send_otp("9876543210", "123456")

    post = next(c for c in _FakeClient.calls if "graph.facebook.com" in c["url"])
    assert post["json"]["to"] == "919876543210"


@pytest.mark.asyncio
async def test_meta_uses_template_when_configured(monkeypatch):
    _enable_meta(monkeypatch, template="otp_authentication")
    _FakeClient.responses = {"graph.facebook.com": _FakeResponse(200, {})}

    res = await otp_sender.send_otp("9876543210", "424242")

    assert res["ok"] is True
    post = next(c for c in _FakeClient.calls if "graph.facebook.com" in c["url"])
    payload = post["json"]
    assert payload["type"] == "template"
    assert payload["template"]["name"] == "otp_authentication"
    # The OTP must travel as the template body parameter, not inline in the body.
    params = payload["template"]["components"][0]["parameters"]
    assert params[0]["text"] == "424242"


@pytest.mark.asyncio
async def test_meta_freeform_used_when_no_template(monkeypatch):
    _enable_meta(monkeypatch, template="")
    _FakeClient.responses = {"graph.facebook.com": _FakeResponse(200, {})}

    res = await otp_sender.send_otp("9876543210", "424242")

    assert res["ok"] is True
    post = next(c for c in _FakeClient.calls if "graph.facebook.com" in c["url"])
    assert post["json"]["type"] == "text"
    assert "424242" in post["json"]["text"]["body"]


# --------------------------------------------------------------------------
# send_otp: fallback to SMS
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_recipient_without_whatsapp_falls_back_to_sms(monkeypatch):
    """Meta 131026 = undeliverable (number not on WhatsApp). Must land on SMS."""
    _enable_meta(monkeypatch)
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {
        "graph.facebook.com": _FakeResponse(
            400, {"error": {"code": 131026, "message": "Message undeliverable"}}
        ),
        "fast2sms.com": _FakeResponse(200, {"return": True, "request_id": "abc"}),
    }

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is True
    assert res["channel"] == "sms"
    assert res["provider"] == "fast2sms"
    # Both channels were tried, WhatsApp first.
    assert any("graph.facebook.com" in u for u in _urls_called())
    assert any("fast2sms" in u for u in _urls_called())
    assert _urls_called()[0].find("graph.facebook.com") != -1


@pytest.mark.asyncio
async def test_out_of_window_template_rejection_falls_back_to_sms(monkeypatch):
    """Meta 131047 = free-form text outside the 24h window -> SMS."""
    _enable_meta(monkeypatch)
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {
        "graph.facebook.com": _FakeResponse(
            400, {"error": {"code": 131047, "message": "Re-engagement message"}}
        ),
        "fast2sms.com": _FakeResponse(200, {"return": True}),
    }

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is True
    assert res["channel"] == "sms"


@pytest.mark.asyncio
async def test_whatsapp_network_error_falls_back_to_sms(monkeypatch):
    _enable_meta(monkeypatch)
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {
        "graph.facebook.com": RuntimeError("connection reset"),
        "fast2sms.com": _FakeResponse(200, {"return": True}),
    }

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is True
    assert res["channel"] == "sms"


@pytest.mark.asyncio
async def test_twilio_whatsapp_failure_falls_back_to_fast2sms(monkeypatch):
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", True)
    monkeypatch.setattr(otp_sender, "WHATSAPP_PROVIDER", "twilio")
    monkeypatch.setattr(otp_sender, "TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setattr(otp_sender, "TWILIO_AUTH_TOKEN", "auth")
    monkeypatch.setattr(otp_sender, "TWILIO_WHATSAPP_FROM", "whatsapp:+14150000000")
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {
        "api.twilio.com": _FakeResponse(400, {"code": 21617}),
        "fast2sms.com": _FakeResponse(200, {"return": True}),
    }

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is True
    assert res["channel"] == "sms"
    assert res["provider"] == "fast2sms"


@pytest.mark.asyncio
async def test_both_channels_fail_reports_error(monkeypatch):
    _enable_meta(monkeypatch)
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {
        "graph.facebook.com": _FakeResponse(400, {"error": {"code": 131026}}),
        "fast2sms.com": _FakeResponse(400, {"return": False, "message": "invalid"}),
    }

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is False
    assert res.get("error")


# --------------------------------------------------------------------------
# send_otp: disabled / unconfigured paths must not touch WhatsApp at all
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_whatsapp_disabled_goes_straight_to_sms(monkeypatch):
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {"fast2sms.com": _FakeResponse(200, {"return": True})}

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["channel"] == "sms"
    assert not any("graph.facebook.com" in u for u in _urls_called())


@pytest.mark.asyncio
async def test_enabled_but_unconfigured_provider_skips_whatsapp_call(monkeypatch):
    """Flag on, no credentials -> must not fire a doomed Meta request."""
    monkeypatch.setattr(otp_sender, "WHATSAPP_ENABLED_OTP", True)
    monkeypatch.setattr(otp_sender, "WHATSAPP_PROVIDER", "meta")
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {"fast2sms.com": _FakeResponse(200, {"return": True})}

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["channel"] == "sms"
    assert not any("graph.facebook.com" in u for u in _urls_called())


@pytest.mark.asyncio
async def test_nothing_configured_falls_back_to_mock(monkeypatch):
    monkeypatch.setattr(otp_sender, "OTP_MOCK_ENABLED", True)

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is True
    assert res["channel"] == "mock"
    assert res["provider"] == "mock"
    assert res["dev_hint"]
    assert _FakeClient.calls == []


@pytest.mark.asyncio
async def test_no_provider_and_mock_disabled_is_a_clean_failure(monkeypatch):
    monkeypatch.setattr(otp_sender, "OTP_MOCK_ENABLED", False)

    res = await otp_sender.send_otp("9876543210", "123456")

    assert res["ok"] is False
    assert res["provider"] == "none"


# --------------------------------------------------------------------------
# The fallback must carry the SAME OTP code
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_same_otp_code_used_on_both_channels(monkeypatch):
    """A fallback that re-generated a different code would lock users out."""
    _enable_meta(monkeypatch)
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {
        "graph.facebook.com": _FakeResponse(400, {"error": {"code": 131026}}),
        "fast2sms.com": _FakeResponse(200, {"return": True}),
    }

    otp = "135790"
    await otp_sender.send_otp("9876543210", otp)

    wa_post = next(c for c in _FakeClient.calls if "graph.facebook.com" in c["url"])
    assert otp in wa_post["json"]["text"]["body"]

    sms_post = next(c for c in _FakeClient.calls if "fast2sms" in c["url"])
    assert otp in str(sms_post["json"]["message"])


@pytest.mark.asyncio
async def test_fast2sms_stripped_to_10_digits(monkeypatch):
    """Fast2SMS is India-only and rejects the +91 prefix."""
    monkeypatch.setattr(otp_sender, "OTP_MOCK_ENABLED", False)
    _enable_fast2sms(monkeypatch)
    _FakeClient.responses = {"fast2sms.com": _FakeResponse(200, {"return": True})}

    await otp_sender.send_otp("9876543210", "123456")

    post = next(c for c in _FakeClient.calls if "fast2sms" in c["url"])
    assert post["json"]["numbers"] == "9876543210"
