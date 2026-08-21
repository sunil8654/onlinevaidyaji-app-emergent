"""Regression tests for Iteration 36 security-audit fixes.

Verifies:
- SEC-001a: /api/quiz/submit is rate-limited per user.
- SEC-001b: welcome_email_sent_at is claimed atomically BEFORE dispatch.
- SEC-002 : recipient PII is masked in log lines.
- SEC-003 : /signup/index.tsx warns doctors that Google sign-in yields a patient role.
- Hardening: send_welcome_email_bg retains task refs + swallows crashes.
"""
import re
import sys
import asyncio
import uuid
import logging
from pathlib import Path
from unittest.mock import patch, AsyncMock

sys.path.insert(0, "/app/backend")


# ─────────────────────── SEC-001a — quiz rate limit ────────────────────────
class TestSEC001a_QuizRateLimit:
    def test_quiz_submit_calls_rate_limit(self):
        src = Path("/app/backend/server.py").read_text(encoding="utf-8")
        m = re.search(
            r"@api_router\.post\(\"/quiz/submit\"\)([\s\S]{0,1200})",
            src,
        )
        assert m, "quiz/submit route not found"
        block = m.group(1)
        assert 'rate_limit(request' in block, (
            "SEC-001a: /quiz/submit must call rate_limit() to prevent spammy resubmits"
        )
        assert "quiz:submit:" in block, (
            "SEC-001a: rate-limit key should be per-user (quiz:submit:<user_id>)"
        )


# ─────────────────────── SEC-001b — atomic idempotency ─────────────────────
class TestSEC001b_AtomicIdempotency:
    def test_welcome_claim_uses_compare_and_set(self):
        src = Path("/app/backend/emails.py").read_text(encoding="utf-8")
        # The atomic claim must be an update_one that filters on
        # welcome_email_sent_at NOT existing (compare-and-set semantics).
        assert "welcome_email_sent_at" in src
        assert '"welcome_email_sent_at": {"$exists": False}' in src, (
            "SEC-001b: welcome_email_sent_at must be claimed via compare-and-set"
        )
        # Fallback must roll back the claim on send failure.
        assert '"$unset": {"welcome_email_sent_at": ""}' in src, (
            "SEC-001b: claim must be rolled back if the underlying send fails"
        )

    def test_second_send_short_circuits(self):
        """When the CAS update reports 0 modified, send_welcome_email must
        short-circuit and NOT dispatch the email."""
        import emails as em
        user = {
            "id": "u-race-1", "email": "delivered@resend.dev",
            "name": "R", "role": "patient", "preferred_language": "en",
        }
        with patch.object(em, "send_email", AsyncMock(return_value="fake-id")) as sender:
            fake_db = type("FakeDB", (), {})()
            fake_db.users = type("FakeUsers", (), {})()

            class LosingUpdate:
                async def __call__(self, *a, **kw):
                    class R:
                        modified_count = 0
                    return R()

            fake_db.users.update_one = LosingUpdate()

            import sys as _sys
            fake_server = type("FakeSrv", (), {"db": fake_db})()
            _sys.modules["server"] = fake_server
            try:
                out = asyncio.run(em.send_welcome_email(user))
            finally:
                _sys.modules.pop("server", None)
            assert out is None
            sender.assert_not_called()


# ─────────────────────────── SEC-002 — mask emails ─────────────────────────
class TestSEC002_MaskEmails:
    def test_mask_helper_masks_local_part(self):
        from emails import _mask_email
        assert _mask_email("alice@example.com") == "a***@example.com"
        assert _mask_email("a@b.co").startswith("a***@")
        assert _mask_email("") == "***"
        assert _mask_email("no-at-sign") == "***"

    def test_failure_logs_mask_recipient(self, caplog=None):
        # Capture our logger output while forcing send_email to fail.
        import emails as em
        user = {
            "id": f"u-{uuid.uuid4().hex[:6]}",
            "email": "alice@example.com",
            "name": "Alice", "role": "patient",
        }

        class LogSink(logging.Handler):
            def __init__(self):
                super().__init__()
                self.records = []
            def emit(self, r):
                self.records.append(self.format(r))

        # DB stub — winning CAS + rollback both no-ops.
        fake_db = type("FakeDB", (), {})()
        class Winner:
            def __init__(self): self.modified_count = 1
        class DBUsers:
            async def update_one(self, *a, **kw): return Winner()
        fake_db.users = DBUsers()
        import sys as _sys
        _sys.modules["server"] = type("Srv", (), {"db": fake_db})()

        sink = LogSink()
        em.logger.addHandler(sink)
        em.logger.setLevel(logging.WARNING)
        try:
            with patch.object(em, "send_email", AsyncMock(side_effect=RuntimeError("boom"))):
                asyncio.run(em.send_welcome_email(user))
        finally:
            em.logger.removeHandler(sink)
            _sys.modules.pop("server", None)

        combined = "\n".join(sink.records)
        assert "alice@example.com" not in combined, (
            "SEC-002: raw recipient email must NOT appear in logs"
        )
        assert "a***@example.com" in combined, (
            "SEC-002: masked recipient must appear in logs"
        )


# ─────────────────────────── SEC-003 — doctor UX hint ──────────────────────
class TestSEC003_DoctorGoogleHint:
    def test_signup_shows_warning_below_doctor_google(self):
        src = Path("/app/frontend/app/signup/index.tsx").read_text(encoding="utf-8")
        # Must have both a Google button labelled for doctors AND a hint that
        # steers new doctors toward the Register form (SEC-003 mitigation).
        assert 'testID="doctor-google"' in src
        assert "Register as Doctor" in src, (
            "SEC-003: doctor tab must nudge new doctors toward the Register form"
        )
        assert "verify" in src.lower(), (
            "SEC-003: hint must mention verification (of registration number)"
        )


# ─────────────────────────── Hardening — task refs ─────────────────────────
class TestHardening_TaskRefs:
    def test_send_bg_retains_task_ref(self):
        src = Path("/app/backend/emails.py").read_text(encoding="utf-8")
        assert "_pending_email_tasks" in src, (
            "Hardening: send_welcome_email_bg must retain a strong task ref set"
        )
        assert "add_done_callback" in src, (
            "Hardening: the task ref must be released via add_done_callback"
        )


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
