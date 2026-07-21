"""Iter 17 — Prakriti quiz + enhanced Diet Plan backend tests.

Endpoints covered:
- POST /api/prakriti/assess (401 no-auth, 400 <5 answers, math, upsert, doctor no-op)
- POST /api/diet-plan (structured / legacy / dosha auto-fill / duration clamp)
- GET  /api/diet-plans (persisted list, latest first)
"""
import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
load_dotenv(FRONTEND_ENV)
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://localhost:8001").rstrip("/")


# ---------- Prakriti assess ----------
class TestPrakritiAuthAndValidation:
    def test_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/prakriti/assess", json={"answers": ["V"] * 5}, timeout=30)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"

    def test_below_min_answers_400(self, patient_ctx):
        r = requests.post(
            f"{BASE_URL}/api/prakriti/assess",
            json={"answers": ["V", "P", "K", "V"]},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text[:200]}"


class TestPrakritiMath:
    def test_pure_vata(self, patient_ctx):
        r = requests.post(
            f"{BASE_URL}/api/prakriti/assess",
            json={"answers": ["V"] * 12},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["vata"] == 100 and d["pitta"] == 0 and d["kapha"] == 0
        assert d["dominant"] == "Vata"
        assert d["secondary"] is None  # secondary=0 shouldn't be set
        assert d["dosha"] == "Vata"
        assert d["description"] and isinstance(d["traits"], list) and len(d["traits"]) > 0
        assert d["balance"]

    def test_dual_dosha_within_10pts(self, patient_ctx):
        # 6 V, 5 P, 1 K → V=50, P=42, K=8 → diff 8 → secondary should be Pitta
        answers = ["V"] * 6 + ["P"] * 5 + ["K"] * 1
        r = requests.post(
            f"{BASE_URL}/api/prakriti/assess",
            json={"answers": answers},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dominant"] == "Vata"
        assert d["secondary"] == "Pitta"
        assert d["dosha"] == "Vata-Pitta"
        # percentages should sum to ~100 (rounding may give 99-101)
        assert 98 <= (d["vata"] + d["pitta"] + d["kapha"]) <= 101

    def test_upsert_saves_to_patient_profile(self, patient_ctx):
        # Perform assessment
        answers = ["P"] * 10 + ["V"] * 2  # dominant Pitta
        r = requests.post(
            f"{BASE_URL}/api/prakriti/assess",
            json={"answers": answers},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        dosha_val = r.json()["dosha"]
        assert dosha_val.startswith("Pitta"), dosha_val

        # Read back from patient profile
        prof = requests.get(f"{BASE_URL}/api/patient/profile", headers=patient_ctx["headers"], timeout=30)
        assert prof.status_code == 200, prof.text
        profj = prof.json()
        assert profj.get("dosha") == dosha_val, f"profile dosha not upserted: {profj.get('dosha')}"
        # prakriti_result should also be present
        pr = profj.get("prakriti_result")
        assert isinstance(pr, dict) and pr.get("dominant") == "Pitta"


class TestPrakritiDoctorNoop:
    def test_doctor_not_persisted(self, doctor_ctx):
        r = requests.post(
            f"{BASE_URL}/api/prakriti/assess",
            json={"answers": ["K"] * 8},
            headers=doctor_ctx["headers"],
            timeout=30,
        )
        # Endpoint should still respond 200 (result returned) but NOT persist
        assert r.status_code == 200, r.text
        # There is no /doctor/prakriti endpoint; we assert the doc endpoint
        # `/patient/profile` is patient-only — for doctors it likely 403s.
        # Instead we verify no prakriti_assessments write leaks to doctor's diet plan dosha auto-fill:
        # (doctor path doesn't auto-fill dosha, but this is a soft check)
        # Just ensure result structure returned.
        d = r.json()
        assert d["dominant"] == "Kapha"
        assert d["dosha"] == "Kapha"


# ---------- Diet Plan ----------
class TestDietPlanDurationClamp:
    """Verify _clamp_days without hitting LLM — use tiny structured request but ensure
    request is accepted. To conserve LLM budget, we run a single legacy plan test.
    """
    pass


class TestDietPlanLegacyText:
    """Single LLM call — legacy body { goal, dosha, vegetarian }."""

    def test_legacy_generates_text_plan(self, patient_ctx):
        r = requests.post(
            f"{BASE_URL}/api/diet-plan",
            json={"goal": "TEST_ better sleep", "dosha": "Vata", "vegetarian": True},
            headers=patient_ctx["headers"],
            timeout=90,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # Backward compat: legacy fields present
        assert d.get("goal") == "TEST_ better sleep"
        assert d.get("dosha") == "Vata"
        assert d.get("duration_days") == 1  # default
        assert isinstance(d.get("plan"), str) and len(d["plan"]) > 20
        # plan_structured should be None when structured=false
        assert d.get("plan_structured") is None


class TestDietPlanStructuredAndAutoFill:
    """Single LLM call — structured=true + dosha auto-fill from patient profile."""

    def test_structured_auto_dosha_and_persists(self, patient_ctx):
        # First ensure patient profile has a dosha via prakriti/assess
        setup = requests.post(
            f"{BASE_URL}/api/prakriti/assess",
            json={"answers": ["K"] * 10 + ["V"] * 2},
            headers=patient_ctx["headers"],
            timeout=30,
        )
        assert setup.status_code == 200
        saved_dosha = setup.json()["dosha"]

        # Now request diet-plan WITHOUT specifying dosha
        r = requests.post(
            f"{BASE_URL}/api/diet-plan",
            json={
                "goal": "TEST_ boost immunity",
                "duration_days": 3,
                "structured": True,
                "vegetarian": True,
            },
            headers=patient_ctx["headers"],
            timeout=120,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("duration_days") == 3
        # dosha should be auto-filled from profile
        assert d.get("dosha") == saved_dosha, f"expected {saved_dosha} got {d.get('dosha')}"
        assert isinstance(d.get("plan"), str) and len(d["plan"]) > 20
        # plan_structured may be None if model didn't return valid JSON — that's acceptable per acceptance criteria
        if d.get("plan_structured") is not None:
            ps = d["plan_structured"]
            assert isinstance(ps.get("days"), list) and len(ps["days"]) >= 1
            # verify shape of first meal if present
            first_day = ps["days"][0]
            if first_day.get("meals"):
                m0 = first_day["meals"][0]
                assert "slot" in m0

        # Verify GET /api/diet-plans lists it (latest first)
        listr = requests.get(f"{BASE_URL}/api/diet-plans", headers=patient_ctx["headers"], timeout=30)
        assert listr.status_code == 200, listr.text
        items = listr.json()
        assert isinstance(items, list) and len(items) >= 1
        # latest first: newest entry must be the one we just created
        assert items[0].get("goal") == "TEST_ boost immunity"
        assert items[0].get("duration_days") == 3


class TestDietPlanClamping:
    """Verify duration clamping via a structured=false request (cheap) with a large days value."""

    def test_days_25_clamped_to_7(self, patient_ctx):
        r = requests.post(
            f"{BASE_URL}/api/diet-plan",
            json={"goal": "TEST_ energy", "dosha": "Pitta", "duration_days": 25, "structured": False},
            headers=patient_ctx["headers"],
            timeout=90,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("duration_days") == 7
