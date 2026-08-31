"""Iteration 39: verify SMTP-preferred email path + live Razorpay key wiring."""
import os
import sys
import asyncio
from unittest.mock import patch, MagicMock

sys.path.insert(0, "/app/backend")


class TestSmtpPreference:
    """`send_email` must try SMTP first when configured, and fall back to
    Resend when SMTP fails."""

    def test_smtp_configured_prefers_smtp(self):
        import emails as em
        with patch.object(em, "SMTP_HOST", "smtp.example.com"), \
             patch.object(em, "SMTP_USER", "u@example.com"), \
             patch.object(em, "SMTP_PASSWORD", "pw"), \
             patch.object(em, "SMTP_FROM", "u@example.com"):
            assert em.smtp_configured() is True

    def test_smtp_success_short_circuits_resend(self):
        import emails as em
        with patch.object(em, "SMTP_HOST", "smtp.example.com"), \
             patch.object(em, "SMTP_USER", "u@example.com"), \
             patch.object(em, "SMTP_PASSWORD", "pw"), \
             patch.object(em, "SMTP_FROM", "u@example.com"), \
             patch.object(em, "_send_email_smtp",
                          MagicMock(return_value=asyncio.sleep(0, result="mid-123"))) as smtp_mock:
            # Async wrapper: `_send_email_smtp` must be awaited, so wrap in
            # an async fn.
            async def _stub(**kw):
                return "mid-123"
            with patch.object(em, "_send_email_smtp", side_effect=_stub) as s2, \
                 patch.object(em, "httpx", MagicMock()) as http_mock:
                out = asyncio.run(em.send_email(
                    to="test@example.com",
                    subject="hi", html="<p>ok</p>",
                ))
                assert out == "mid-123"
                s2.assert_awaited_once() if hasattr(s2, "assert_awaited_once") else s2.assert_called_once()
                # Resend proxy MUST NOT have been touched
                http_mock.AsyncClient.assert_not_called()

    def test_smtp_failure_falls_back_to_resend(self):
        import emails as em
        # Fake a passing Resend HTTP call.
        class FakeResp:
            status_code = 202
            content = b'{"id":"fallback-id"}'
            def json(self): return {"id": "fallback-id"}
            def raise_for_status(self): pass
        class FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, url, headers=None, json=None):
                return FakeResp()
        async def _boom(**kw):
            raise RuntimeError("SMTP down")

        with patch.object(em, "SMTP_HOST", "smtp.example.com"), \
             patch.object(em, "SMTP_USER", "u@example.com"), \
             patch.object(em, "SMTP_PASSWORD", "pw"), \
             patch.object(em, "SMTP_FROM", "u@example.com"), \
             patch.object(em, "EMAIL_KEY", "ek_fake"), \
             patch.object(em, "_send_email_smtp", side_effect=_boom), \
             patch.object(em, "httpx", MagicMock(AsyncClient=lambda *a, **k: FakeClient())):
            out = asyncio.run(em.send_email(
                to="test@example.com", subject="hi", html="<p>ok</p>",
            ))
            assert out == "fallback-id"


class TestRazorpayLive:
    """The live key must be loaded into the process env."""
    def test_key_id_is_live(self):
        assert os.environ.get("RAZORPAY_KEY_ID", "").startswith("rzp_live_"), (
            "Live Razorpay key must be configured (env starts with rzp_live_)"
        )

    def test_client_authenticated(self):
        import server
        assert server._rzp_client is not None, "Razorpay client must be initialised"


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
