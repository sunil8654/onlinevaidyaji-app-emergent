"""
Iteration 33 — Security fixes retest
====================================

SEC-001 (CRITICAL): Mock OTP was echoed in the API response (account takeover risk).
  Fix — `dev_hint` is only returned when env `OTP_MOCK_ENABLED` is truthy.
  Default in dev images is "true", prod must set it to "false".

SEC-002 (MEDIUM): Google session_id leaked to browser URL history / referrer.
  Fix — /signup/index.tsx `handleGoogleCallback` calls
  window.history.replaceState the moment a session_id is captured.

SEC-003 (MEDIUM): CSV export vulnerable to formula injection.
  Fix — cells starting with `=`, `+`, `-`, `@`, tab, CR are prefixed
  with a single quote before being written to the CSV response.

Hardening: `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`
on GET /api/files/{doc_id}.

Regression: send-otp 30s cooldown + 3-attempt lock still work, and a
representative subset of Phase 1a/1b endpoints still respond correctly
(quiz submit, docs upload, presales list).

BASE_URL comes from `EXPO_PUBLIC_BACKEND_URL` via conftest.
"""
from __future__ import annotations

import io
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import pytest
import requests
from pymongo import MongoClient

# Direct Mongo (needed to seed CSV row + verify OTP cooldown internals)
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
_mc = MongoClient(MONGO_URL)
_db = _mc[DB_NAME]

# For SEC-001 prod-mode we need in-process access to the server module.
# Make /app/backend importable so `import server` resolves.
_BACKEND_DIR = str(Path(__file__).resolve().parents[1])
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)


# ────────────────────── helpers ──────────────────────
def _rand_phone() -> str:
    import random
    return random.choice("6789") + "".join(random.choices("0123456789", k=9))


def _register(base_url: str, role: str = "patient") -> Dict[str, Any]:
    email = f"test_iter33_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_iter33_{role}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": _rand_phone(),
    }
    r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "email": payload["email"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


def _admin_login(base_url: str) -> Dict[str, Any]:
    email = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
    pwd = os.environ.get("ADMIN_PASSWORD", "")
    assert pwd, "ADMIN_PASSWORD not set — cannot run admin tests"
    r = requests.post(f"{base_url}/api/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["token"], "headers": {"Authorization": f"Bearer {data['token']}"}, "user": data["user"]}


def _make_jpg_bytes() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color=(200, 120, 40)).save(buf, format="JPEG", quality=70)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════
# SEC-001 — Mock OTP echo (dev + prod modes)
# ══════════════════════════════════════════════════════════════
class TestSEC001_OTPMockEcho:
    """OTP send response must include `dev_hint` iff OTP_MOCK_ENABLED is true."""

    def test_dev_mode_returns_dev_hint(self, base_url):
        """Default env (unset / 'true'): response has dev_hint with '123456' & message."""
        phone = _rand_phone()
        r = requests.post(
            f"{base_url}/api/auth/phone/send-otp",
            json={"phone": phone}, timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert isinstance(data.get("message"), str) and data["message"]
        # dev_hint MUST be present in dev mode and MUST include the mock OTP code
        assert "dev_hint" in data, f"dev_hint missing from response: {data}"
        assert "123456" in data["dev_hint"], f"dev_hint should echo mock OTP: {data['dev_hint']}"

    def test_dev_mode_verify_still_works(self, base_url):
        """In dev mode, 123456 still verifies (regression)."""
        phone = _rand_phone()
        r = requests.post(f"{base_url}/api/auth/phone/send-otp", json={"phone": phone}, timeout=30)
        assert r.status_code == 200, r.text
        r2 = requests.post(
            f"{base_url}/api/auth/phone/verify-otp",
            json={"phone": phone, "otp": "123456", "name": "TEST_iter33"},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert "token" in body and "user" in body
        # cleanup the auto-created user
        try:
            _db.users.delete_many({"id": body["user"]["id"]})
        except Exception:
            pass

    def test_prod_mode_omits_dev_hint(self):
        """Patch `server.OTP_MOCK_ENABLED = False` and call via in-process TestClient.
        `dev_hint` MUST be absent, but the response shape (ok/message) stays intact.
        """
        # Import lazily and inside the test so failures here don't skip the whole suite
        import importlib
        import server as srv  # backend/server.py
        importlib.reload  # ref only — we don't reload; we simply flip the module-global
        from fastapi.testclient import TestClient

        # Snapshot & flip
        original = srv.OTP_MOCK_ENABLED
        srv.OTP_MOCK_ENABLED = False
        try:
            client = TestClient(srv.app)
            phone = _rand_phone()
            r = client.post("/api/auth/phone/send-otp", json={"phone": phone})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data.get("ok") is True
            assert isinstance(data.get("message"), str) and data["message"]
            assert "dev_hint" not in data, f"dev_hint LEAKED in prod-mode response: {data}"
            # A tighter guard: no 6-digit mock OTP anywhere in the serialized body
            assert "123456" not in r.text, f"OTP echoed in prod-mode body: {r.text!r}"

            # And verify-otp still succeeds with the mock OTP (fix is about NOT echoing,
            # not about disabling mock verification).
            r2 = client.post(
                "/api/auth/phone/verify-otp",
                json={"phone": phone, "otp": "123456", "name": "TEST_iter33_prod"},
            )
            assert r2.status_code == 200, r2.text
            body = r2.json()
            assert "token" in body and "user" in body
            try:
                _db.users.delete_many({"id": body["user"]["id"]})
            except Exception:
                pass
        finally:
            srv.OTP_MOCK_ENABLED = original


# ══════════════════════════════════════════════════════════════
# SEC-002 — signup/index.tsx must scrub session_id from URL
# ══════════════════════════════════════════════════════════════
class TestSEC002_GoogleSessionUrlScrub:
    """This is a frontend behavior — assert the fix exists in source."""

    def test_replaceState_called_in_handleGoogleCallback(self):
        # After Iteration 34 the Emergent-auth flow was extracted into a shared
        # hook so it can be reused by /signup and /auth/login. Assert the SEC-002
        # scrub still lives inside handleGoogleCallback in the hook.
        p = Path("/app/frontend/src/hooks/useGoogleAuth.ts")
        assert p.exists(), f"useGoogleAuth hook missing at {p}"
        src = p.read_text(encoding="utf-8")
        assert "handleGoogleCallback" in src, "handleGoogleCallback fn missing"
        assert "window.history.replaceState" in src, (
            "window.history.replaceState call missing — SEC-002 fix not applied"
        )
        m = re.search(
            r"handleGoogleCallback\s*=\s*useCallback\(([\s\S]*?)\}\s*,\s*\[",
            src,
        )
        assert m, "Could not locate handleGoogleCallback body"
        body = m.group(1)
        assert "window.history.replaceState" in body, (
            "replaceState is present in the file but NOT inside handleGoogleCallback"
        )
        idx_replace = body.find("window.history.replaceState")
        idx_google = body.find("googleSession")
        assert idx_replace != -1 and idx_google != -1, "expected both symbols in cb body"
        assert idx_replace < idx_google, (
            "replaceState should run BEFORE api.googleSession so session_id "
            "cannot leak via history/referrer if the fetch fails"
        )

        # Also verify BOTH consumers still import the hook (login + signup).
        for consumer in (
            "/app/frontend/app/signup/index.tsx",
            "/app/frontend/app/auth/login.tsx",
        ):
            cp = Path(consumer)
            assert cp.exists(), f"{consumer} missing"
            csrc = cp.read_text(encoding="utf-8")
            assert "useGoogleAuth" in csrc, (
                f"{consumer} must consume useGoogleAuth for SEC-002 scrub"
            )


# ══════════════════════════════════════════════════════════════
# SEC-003 — CSV formula injection
# ══════════════════════════════════════════════════════════════
class TestSEC003_CSVFormulaInjection:
    MALICIOUS_NAME = "=cmd|' /C calc'!A0"
    MALICIOUS_EMAIL = "+attacker@example.com"
    MALICIOUS_UTM = "@sum(1+9)"
    MALICIOUS_MINUS = "-2+3+cmd|' /C calc'!A0"
    MALICIOUS_TAB = "\tinjected"

    @pytest.fixture(scope="class")
    def seeded_lead(self, base_url):
        lead_id = str(uuid.uuid4())
        _db.presales_leads.insert_one({
            "id": lead_id,
            "user_id": None,
            "name": self.MALICIOUS_NAME,
            "phone": "9999900001",
            "email": self.MALICIOUS_EMAIL,
            "language": "en",
            "prakriti_result": self.MALICIOUS_MINUS,   # tests `-` prefix
            "health_concern": "diabetes",
            "recommended_kit_id": "diabetes",
            "recommended_kit_name": "Kit",
            "age_group": "26-40",
            "call_preference": None,
            "status": "not_contacted",
            "agent_name": self.MALICIOUS_TAB,          # tests `\t` prefix
            "status_history": [{"status": "not_contacted", "timestamp": datetime.utcnow().isoformat() + "Z"}],
            "documents_uploaded": 0,
            "utm_source": self.MALICIOUS_UTM,
            "utm_medium": None,
            "utm_campaign": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "_test_iter33_": True,
        })
        yield lead_id
        _db.presales_leads.delete_one({"id": lead_id})

    def test_csv_export_prefixes_dangerous_cells(self, base_url, seeded_lead):
        admin = _admin_login(base_url)
        r = requests.get(f"{base_url}/api/admin/presales/leads.csv",
                         headers=admin["headers"], timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("text/csv"), r.headers
        body = r.text
        # Locate the exact row (contains the phone we seeded)
        matching = [ln for ln in body.splitlines() if "9999900001" in ln]
        assert matching, f"seeded row not present in CSV export.\nBody head:\n{body[:1000]}"
        row = matching[0]

        # `=cmd...` must become `'=cmd...`
        assert "'=cmd|' /C calc'!A0".replace("'", "'", 1) in row or "'=cmd" in row, (
            f"name cell not neutralised — row was: {row}"
        )
        # `+attacker@example.com` must become `'+attacker...`
        assert "'+attacker@example.com" in row, f"email cell not neutralised — row: {row}"
        # `@sum(1+9)` must become `'@sum(1+9)`
        assert "'@sum(1+9)" in row, f"utm_source cell not neutralised — row: {row}"
        # `-2+3...` must become `'-2+3...`
        assert "'-2+3" in row, f"prakriti (`-` prefix) cell not neutralised — row: {row}"
        # `\tinjected` must become `'\tinjected`  (agent_name) — csv writer keeps the tab
        # so we look for the single-quote-then-tab combo:
        assert "'\tinjected" in row, f"agent_name (tab prefix) cell not neutralised — row: {row!r}"

        # And bare dangerous prefixes MUST NOT appear at the start of any cell in the row.
        cells = next(iter(_iter_csv_rows(row)))
        for c in cells:
            if not c:
                continue
            assert c[0] not in ("=", "+", "@", "\t", "\r"), f"un-neutralised cell: {c!r}"
            # `-` on its own (like a real number "-2") should still be prefixed because
            # the sanitiser is intentionally aggressive.
            if c.startswith("-") and c != "":
                pytest.fail(f"cell starts with `-` — should have been prefixed: {c!r}")


def _iter_csv_rows(row_str: str):
    import csv
    yield next(csv.reader(io.StringIO(row_str)))


# ══════════════════════════════════════════════════════════════
# Hardening — file download response headers
# ══════════════════════════════════════════════════════════════
class TestFileDownloadHardening:
    @pytest.fixture(scope="class")
    def patient_with_doc(self, base_url):
        ctx = _register(base_url, "patient")
        jpg = _make_jpg_bytes()
        files = {"file": ("report.jpg", jpg, "image/jpeg")}
        data = {"doc_type": "blood_test", "user_note": "TEST_iter33"}
        r = requests.post(
            f"{base_url}/api/documents/upload",
            headers=ctx["headers"], files=files, data=data, timeout=60,
        )
        assert r.status_code == 200, r.text
        doc_id = r.json()["id"]
        ctx["doc_id"] = doc_id
        yield ctx
        # cleanup
        try:
            _db.health_documents.delete_many({"user_id": ctx["user"]["id"]})
            _db.presales_leads.delete_many({"user_id": ctx["user"]["id"]})
            _db.users.delete_many({"id": ctx["user"]["id"]})
        except Exception:
            pass

    def test_download_headers_include_hardening(self, base_url, patient_with_doc):
        r = requests.get(
            f"{base_url}/api/files/{patient_with_doc['doc_id']}",
            headers=patient_with_doc["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # Header names are case-insensitive; requests normalises them.
        h = {k.lower(): v for k, v in r.headers.items()}
        assert h.get("x-content-type-options") == "nosniff", (
            f"X-Content-Type-Options missing / wrong: {r.headers}"
        )
        assert h.get("referrer-policy") == "no-referrer", (
            f"Referrer-Policy missing / wrong: {r.headers}"
        )
        assert r.headers.get("Content-Type", "").startswith("image/"), r.headers


# ══════════════════════════════════════════════════════════════
# Regression — OTP cooldown & lock, plus Phase 1a/1b smoke
# ══════════════════════════════════════════════════════════════
class TestOTPRegression:
    def test_send_otp_cooldown_30s(self, base_url):
        phone = _rand_phone()
        r1 = requests.post(f"{base_url}/api/auth/phone/send-otp", json={"phone": phone}, timeout=30)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{base_url}/api/auth/phone/send-otp", json={"phone": phone}, timeout=30)
        assert r2.status_code == 429, f"expected 429 cooldown, got {r2.status_code}: {r2.text}"
        assert "wait" in r2.text.lower() or "30" in r2.text

    def test_verify_otp_3_attempts_then_lock(self, base_url):
        phone = _rand_phone()
        s = requests.post(f"{base_url}/api/auth/phone/send-otp", json={"phone": phone}, timeout=30)
        assert s.status_code == 200
        # 3 wrong attempts
        codes_seen = []
        for i in range(3):
            r = requests.post(
                f"{base_url}/api/auth/phone/verify-otp",
                json={"phone": phone, "otp": "000000", "name": "x"},
                timeout=30,
            )
            codes_seen.append(r.status_code)
            assert r.status_code in (400, 401, 429), r.text
        # 4th attempt (even with correct OTP) should be locked
        r4 = requests.post(
            f"{base_url}/api/auth/phone/verify-otp",
            json={"phone": phone, "otp": "123456", "name": "x"},
            timeout=30,
        )
        assert r4.status_code == 429, (
            f"expected 429 lock after 3 wrong attempts, got {r4.status_code}: {r4.text} "
            f"(prior codes: {codes_seen})"
        )


class TestPhase1Smoke:
    """Light regression on the endpoints named in the review: quiz submit,
    docs upload (verified inline above), presales leads list."""

    def test_quiz_submit(self, base_url):
        ctx = _register(base_url, "patient")
        try:
            r = requests.post(
                f"{base_url}/api/quiz/submit",
                headers=ctx["headers"],
                json={
                    "answers": {"q1": "vata", "q2": "pitta", "q3": "kapha"},
                    "health_concern": "madhu_niyantran",
                    "age_group": "26-40",
                },
                timeout=30,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert "prakriti" in data and "dosha_scores" in data
        finally:
            _db.presales_leads.delete_many({"user_id": ctx["user"]["id"]})
            _db.quiz_results.delete_many({"user_id": ctx["user"]["id"]})
            _db.users.delete_many({"id": ctx["user"]["id"]})

    def test_presales_list_admin_ok(self, base_url):
        admin = _admin_login(base_url)
        r = requests.get(f"{base_url}/api/admin/presales/leads",
                         headers=admin["headers"], timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and isinstance(d["items"], list)
