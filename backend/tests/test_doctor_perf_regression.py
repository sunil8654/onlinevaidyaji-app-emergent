"""Performance regression tests for the doctor directory fixes.

Covers:
- /api/doctors list: cold vs warm (30s in-memory cache) timing
- /api/doctors?system=ayurveda: cold vs warm timing
- Data correctness: 20 items / total 61, name/specialty/rating populated
- /api/doctors/{id} single profile: <3s, 200, full shape
"""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL not set", allow_module_level=True)

COLD_BUDGET_S = 4.0   # remote MySQL ~215ms RTT; cold may be ~1-3s
WARM_BUDGET_S = 0.15  # second identical call must be a ~2ms cache hit
DETAIL_BUDGET_S = 3.0


def _timed_get(session, path):
    t0 = time.monotonic()
    r = session.get(f"{BASE_URL}{path}", timeout=30)
    dt = time.monotonic() - t0
    return r, dt


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestDoctorListTiming:
    """Cold vs warm timing for the public doctor directory (30s cache)."""

    def test_doctors_list_cold_then_cached(self, api_client):
        r1, t1 = _timed_get(api_client, "/api/doctors")
        assert r1.status_code == 200, f"first call status {r1.status_code}"
        r2, t2 = _timed_get(api_client, "/api/doctors")
        assert r2.status_code == 200, f"second call status {r2.status_code}"
        print(f"\n/api/doctors first={t1:.3f}s second={t2:.4f}s")
        assert t1 < COLD_BUDGET_S, f"cold call too slow: {t1:.3f}s"
        assert t2 < WARM_BUDGET_S, f"cached call too slow: {t2:.4f}s (cache miss?)"
        assert r1.json() == r2.json(), "cached response differs from fresh response"

    def test_doctors_ayurveda_cold_then_cached(self, api_client):
        r1, t1 = _timed_get(api_client, "/api/doctors?system=ayurveda")
        assert r1.status_code == 200
        r2, t2 = _timed_get(api_client, "/api/doctors?system=ayurveda")
        assert r2.status_code == 200
        print(f"\n/api/doctors?system=ayurveda first={t1:.3f}s second={t2:.4f}s")
        assert t1 < COLD_BUDGET_S, f"cold call too slow: {t1:.3f}s"
        assert t2 < WARM_BUDGET_S, f"cached call too slow: {t2:.4f}s (cache miss?)"
        assert r1.json() == r2.json()


class TestDoctorListDataCorrectness:
    """Data shape after the serializer refactor (unified batched path)."""

    def test_page_size_and_total(self, api_client):
        r, _ = _timed_get(api_client, "/api/doctors")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 61, f"expected total 61, got {data['total']}"
        assert len(data["items"]) == 20, f"expected 20 items, got {len(data['items'])}"
        assert data["page"] == 1 and data["page_size"] == 20
        assert data["has_more"] is True

    def test_items_have_populated_fields(self, api_client):
        r, _ = _timed_get(api_client, "/api/doctors")
        data = r.json()
        for item in data["items"]:
            did = item.get("id")
            assert item.get("name"), f"doctor {did}: name empty (broken batching?)"
            assert item.get("specialty"), f"doctor {did}: specialty empty"
            assert item.get("rating") is not None, f"doctor {did}: rating is None"
            assert item.get("review_count") is not None, f"doctor {did}: review_count None"
            assert isinstance(item.get("specializations"), list), (
                f"doctor {did}: specializations not an array"
            )
            assert "status" in item or "is_available" in item, (
                f"doctor {did}: missing availability/status"
            )


class TestDoctorDetail:
    """Single doctor profile: <3s and full data shape."""

    @pytest.mark.parametrize("doctor_id", [11, 12])
    def test_single_doctor_fast_and_complete(self, api_client, doctor_id):
        r, dt = _timed_get(api_client, f"/api/doctors/{doctor_id}")
        assert r.status_code == 200, f"doctor {doctor_id} status {r.status_code}"
        print(f"\n/api/doctors/{doctor_id} took {dt:.3f}s")
        assert dt < DETAIL_BUDGET_S, f"doctor {doctor_id} too slow: {dt:.3f}s"
        d = r.json()
        assert d.get("name"), f"doctor {doctor_id}: name empty"
        assert isinstance(d.get("specializations"), list), "specializations not array"
        assert d.get("rating") is not None, "rating None"
        assert d.get("review_count") is not None, "review_count None"
        assert d.get("status") is not None or d.get("is_available") is not None, (
            "availability/status missing"
        )
