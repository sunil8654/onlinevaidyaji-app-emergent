"""Iter 46: Apple Sign In backend endpoint."""
import os
import sys
import asyncio
import uuid
from unittest.mock import patch, AsyncMock

sys.path.insert(0, "/app/backend")

import requests

BASE = "http://localhost:8001"


class TestAppleEndpoint:
    def test_rejects_invalid_token(self):
        # 32+ chars but still not a valid Apple-signed JWT → 401 (verify fails)
        # or 503 (JWKS fetch unavailable in this sandboxed env). Either way, NOT 200.
        r = requests.post(f"{BASE}/api/auth/apple", json={
            "identity_token": "not-a-real-jwt-but-long-enough-to-pass-schema",
            "full_name": None, "email": None,
        }, timeout=15)
        assert r.status_code in (401, 503), r.text

    def test_requires_min_length_token(self):
        r = requests.post(f"{BASE}/api/auth/apple", json={
            "identity_token": "x",
        }, timeout=15)
        assert r.status_code == 422

    def test_apple_sub_keys_users(self):
        """A real Apple ID token claims payload can't be forged without Apple's
        private key — so the JWT-verify path is the security guarantee. Here we
        just verify the endpoint never returns 500 on clean (but fake) tokens."""
        r = requests.post(f"{BASE}/api/auth/apple", json={
            # Well-formed JWT shape with wrong signature / issuer.
            "identity_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjF1V25vc2Y0eW8ifQ.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwiYXVkIjoiY29tLm9ubGluZXZhaWR5YWppLmFwcCIsInN1YiI6IjAwMTIzNC5hYmNkZWYifQ.invalidsig",
        }, timeout=15)
        assert r.status_code in (401, 503), (
            f"Invalid Apple token must not authenticate: {r.status_code} {r.text[:200]}"
        )

    def test_endpoint_registered(self):
        # OpenAPI should expose the new route.
        r = requests.get(f"{BASE}/openapi.json", timeout=15)
        assert r.status_code == 200
        paths = r.json().get("paths", {})
        assert "/api/auth/apple" in paths, (
            f"/api/auth/apple missing from openapi — routes: {list(paths)[:30]}"
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
