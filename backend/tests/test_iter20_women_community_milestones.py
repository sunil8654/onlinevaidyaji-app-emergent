"""
Iteration 20 backend tests:
- Women's Health module (cycle tracker, pregnancy, gynae profile, wellness tips)
- Community feed (posts, likes, comments, hashtags, admin/doctor moderation)
- Child developmental milestones (per family member)
- Regression: /api/auth/*, /api/wellness/*, /api/family/*, /api/doctors
"""
import os
import time
import uuid
import pytest
import requests
from datetime import date, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(http, role="patient"):
    email = f"test_iter20_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_{role}_{uuid.uuid4().hex[:4]}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": "9876543210",
    }
    r = http.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return {
        "token": d["token"],
        "user": d["user"],
        "email": email,
        "headers": {"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"},
    }


@pytest.fixture(scope="module")
def user_a(http):
    return _register(http, "patient")


@pytest.fixture(scope="module")
def user_b(http):
    return _register(http, "patient")


@pytest.fixture(scope="module")
def doctor_ctx(http):
    return _register(http, "doctor")


@pytest.fixture(scope="module")
def admin_ctx(http):
    if not ADMIN_PASSWORD:
        pytest.skip("ADMIN_PASSWORD not set in env")
    r = http.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    d = r.json()
    assert d["user"].get("is_admin") is True, "admin user missing is_admin=True"
    return {
        "token": d["token"],
        "user": d["user"],
        "headers": {"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"},
    }


# ==================================================================
# Women's Health
# ==================================================================
class TestWomenPeriodLog:
    def test_create_period_log(self, http, user_a):
        start = "2026-01-05"
        body = {
            "start_date": start,
            "cycle_length": 30,
            "flow": "normal",
            "symptoms": ["cramps", "bloating"],
            "mood": "irritable",
        }
        r = http.post(f"{BASE_URL}/api/women/period-log", json=body, headers=user_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"]
        assert d["start_date"] == start
        assert d["cycle_length"] == 30
        assert "_id" not in d
        user_a["period_id"] = d["id"]

    def test_get_cycles_predicts_next_period(self, http, user_a):
        r = http.get(f"{BASE_URL}/api/women/cycles?limit=12", headers=user_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("cycles"), list) and len(d["cycles"]) >= 1
        # Prediction = latest start_date + cycle_length (30)
        assert d["next_period_predicted"] == "2026-02-04"
        fw = d["fertile_window"]
        # ovulation = start + (length-14) = 2026-01-05 + 16 = 2026-01-21
        # fertile window: ov-3d .. ov+1d
        assert fw["start"] == "2026-01-18"
        assert fw["end"] == "2026-01-22"

    def test_delete_period_log_then_404(self, http, user_a):
        pid = user_a["period_id"]
        r1 = http.delete(f"{BASE_URL}/api/women/period-log/{pid}", headers=user_a["headers"])
        assert r1.status_code == 200
        r2 = http.delete(f"{BASE_URL}/api/women/period-log/{pid}", headers=user_a["headers"])
        assert r2.status_code == 404

    def test_period_log_requires_auth(self, http):
        r = http.post(f"{BASE_URL}/api/women/period-log", json={"start_date": "2026-01-01"})
        assert r.status_code in (401, 403), r.status_code


class TestWomenPregnancy:
    def test_set_pregnancy_and_get(self, http, user_a):
        r = http.put(
            f"{BASE_URL}/api/women/pregnancy",
            json={"is_active": True, "lmp_date": "2026-04-01"},
            headers=user_a["headers"],
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        g = http.get(f"{BASE_URL}/api/women/pregnancy", headers=user_a["headers"])
        assert g.status_code == 200
        d = g.json()
        assert d["is_active"] is True
        # LMP + 280d = 2026-04-01 + 280 = 2027-01-06
        assert d["due_date"] == (date(2026, 4, 1) + timedelta(days=280)).isoformat()
        assert isinstance(d.get("weeks"), int) and d["weeks"] >= 0
        assert isinstance(d.get("milestones"), list) and len(d["milestones"]) == 10

    def test_pregnancy_inactive_returns_flag_only(self, http, user_b):
        r = http.get(f"{BASE_URL}/api/women/pregnancy", headers=user_b["headers"])
        assert r.status_code == 200
        assert r.json() == {"is_active": False}

    def test_pregnancy_user_scoped(self, http, user_a, user_b):
        # user_b did not set pregnancy -> should not see user_a's pregnancy
        r = http.get(f"{BASE_URL}/api/women/pregnancy", headers=user_b["headers"])
        d = r.json()
        assert d.get("is_active") is False
        assert "lmp_date" not in d or d.get("lmp_date") is None


class TestWomenGynae:
    def test_upsert_and_get_gynae(self, http, user_a):
        payload = {
            "pcos": True,
            "pcod": False,
            "conditions": ["endometriosis"],
            "surgeries": ["laparoscopy 2023"],
            "medications": ["metformin"],
            "notes": "TEST_regular follow-up",
        }
        r = http.put(f"{BASE_URL}/api/women/gynae-profile", json=payload, headers=user_a["headers"])
        assert r.status_code == 200
        g = http.get(f"{BASE_URL}/api/women/gynae-profile", headers=user_a["headers"])
        assert g.status_code == 200
        d = g.json()
        assert d["pcos"] is True
        assert d["conditions"] == ["endometriosis"]
        assert d["medications"] == ["metformin"]
        assert d["notes"] == "TEST_regular follow-up"

    def test_gynae_user_scoped(self, http, user_b):
        r = http.get(f"{BASE_URL}/api/women/gynae-profile", headers=user_b["headers"])
        assert r.status_code == 200
        # user_b never posted a gynae profile -> should be empty
        assert r.json() == {}


class TestWomenWellnessTips:
    @pytest.mark.parametrize("phase", ["menstrual", "follicular", "ovulation", "luteal", "pregnancy", "pcos"])
    def test_wellness_tips_each_phase(self, http, user_a, phase):
        r = http.get(f"{BASE_URL}/api/women/wellness-tips?phase={phase}", headers=user_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["phase"] == phase
        assert isinstance(d["tips"], list) and len(d["tips"]) == 3


class TestWomenUserScoping:
    def test_user_a_cycle_not_visible_to_user_b(self, http, user_a, user_b):
        # user_a creates a cycle
        r = http.post(
            f"{BASE_URL}/api/women/period-log",
            json={"start_date": "2026-03-01", "cycle_length": 28},
            headers=user_a["headers"],
        )
        assert r.status_code == 200
        cid = r.json()["id"]

        # user_b listing cycles must NOT contain user_a's log
        b = http.get(f"{BASE_URL}/api/women/cycles", headers=user_b["headers"])
        assert b.status_code == 200
        ids = [c["id"] for c in b.json()["cycles"]]
        assert cid not in ids

        # user_b cannot delete user_a's log -> 404 (user_id scoped)
        d = http.delete(f"{BASE_URL}/api/women/period-log/{cid}", headers=user_b["headers"])
        assert d.status_code == 404

        # cleanup
        http.delete(f"{BASE_URL}/api/women/period-log/{cid}", headers=user_a["headers"])


# ==================================================================
# Community
# ==================================================================
class TestCommunityCreatePost:
    def test_create_post_lowercases_hashtags_and_strips_hash(self, http, user_a):
        body = {
            "content": "TEST_iter20 Ayurveda has helped me a lot",
            "hashtags": ["#Ayurveda", "PCOS", "#Wellness", "yoga"],
            "is_question": False,
        }
        r = http.post(f"{BASE_URL}/api/community/posts", json=body, headers=user_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["hashtags"] == ["ayurveda", "pcos", "wellness", "yoga"]
        assert d["author"]["name"] == user_a["user"]["name"]
        assert d["author"]["role"] == "patient"
        assert d["author"]["verified"] is False
        user_a["ayurveda_post_id"] = d["id"]

    def test_create_question_post(self, http, user_a):
        body = {
            "content": "TEST_iter20 Is triphala safe during pregnancy?",
            "hashtags": ["ayurveda", "pregnancy"],
            "is_question": True,
        }
        r = http.post(f"{BASE_URL}/api/community/posts", json=body, headers=user_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_question"] is True
        user_a["question_post_id"] = d["id"]

    def test_hashtags_capped_to_8(self, http, user_a):
        body = {
            "content": "TEST_iter20 too many tags",
            "hashtags": [f"tag{i}" for i in range(15)],
        }
        r = http.post(f"{BASE_URL}/api/community/posts", json=body, headers=user_a["headers"])
        assert r.status_code == 200
        assert len(r.json()["hashtags"]) == 8

    def test_no_auth_denied(self, http):
        r = http.post(f"{BASE_URL}/api/community/posts", json={"content": "no auth"})
        assert r.status_code in (401, 403)


class TestCommunityRateLimit:
    """Rate limit: 10 posts per hour. 11th call in a burst returns 429."""

    def test_11th_post_returns_429(self, http):
        # Use a fresh user so we don't exhaust user_a's quota mid-suite
        u = _register(http, "patient")
        codes = []
        for i in range(11):
            r = http.post(
                f"{BASE_URL}/api/community/posts",
                json={"content": f"TEST_iter20 burst {i}", "hashtags": ["burst"]},
                headers=u["headers"],
            )
            codes.append(r.status_code)
        # First 10 should succeed, 11th should be 429
        assert codes[:10] == [200] * 10, f"unexpected codes: {codes}"
        assert codes[10] == 429, f"expected 429 on 11th, got {codes[10]} (all: {codes})"


class TestCommunityListFilters:
    def test_list_posts_excludes_image_base64_and_has_liked_by_me(self, http, user_a):
        r = http.get(f"{BASE_URL}/api/community/posts?limit=20", headers=user_a["headers"])
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("items"), list) and len(d["items"]) >= 1
        for it in d["items"]:
            assert "image_base64" not in it
            assert "liked_by_me" in it
            assert isinstance(it["liked_by_me"], bool)

    def test_filter_by_hashtag(self, http, user_a):
        r = http.get(f"{BASE_URL}/api/community/posts?hashtag=ayurveda", headers=user_a["headers"])
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        for it in items:
            assert "ayurveda" in it["hashtags"]

    def test_filter_by_is_question(self, http, user_a):
        r = http.get(f"{BASE_URL}/api/community/posts?is_question=true", headers=user_a["headers"])
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        for it in items:
            assert it["is_question"] is True


class TestCommunitySinglePostAndLikes:
    def test_get_single_post(self, http, user_a):
        pid = user_a["ayurveda_post_id"]
        r = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=user_a["headers"])
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == pid
        assert d["liked_by_me"] is False

    def test_toggle_like_increments_then_decrements(self, http, user_a, user_b):
        pid = user_a["ayurveda_post_id"]
        # user_b likes it
        r = http.post(f"{BASE_URL}/api/community/posts/{pid}/like", headers=user_b["headers"])
        assert r.status_code == 200 and r.json()["liked"] is True
        # verify like_count incremented and liked_by_me true for user_b
        g = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=user_b["headers"])
        assert g.json()["like_count"] == 1
        assert g.json()["liked_by_me"] is True
        # user_a still sees liked_by_me=False
        ga = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=user_a["headers"])
        assert ga.json()["liked_by_me"] is False
        # user_b un-likes
        r2 = http.post(f"{BASE_URL}/api/community/posts/{pid}/like", headers=user_b["headers"])
        assert r2.json()["liked"] is False
        g2 = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=user_b["headers"])
        assert g2.json()["like_count"] == 0
        assert g2.json()["liked_by_me"] is False


class TestCommunityComments:
    def test_add_comment_increments_parent_count(self, http, user_a, user_b):
        pid = user_a["ayurveda_post_id"]
        before = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=user_a["headers"]).json()
        r = http.post(
            f"{BASE_URL}/api/community/posts/{pid}/comments",
            json={"text": "TEST_iter20 nice post"},
            headers=user_b["headers"],
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["text"] == "TEST_iter20 nice post"
        assert d["author"]["id"] == user_b["user"]["id"]
        assert d["author"]["role"] == "patient"
        # second comment from user_a
        r2 = http.post(
            f"{BASE_URL}/api/community/posts/{pid}/comments",
            json={"text": "TEST_iter20 thanks"},
            headers=user_a["headers"],
        )
        assert r2.status_code == 200
        after = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=user_a["headers"]).json()
        assert after["comment_count"] == before["comment_count"] + 2

    def test_list_comments_sorted_asc(self, http, user_a):
        pid = user_a["ayurveda_post_id"]
        r = http.get(f"{BASE_URL}/api/community/posts/{pid}/comments", headers=user_a["headers"])
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 2
        timestamps = [it["created_at"] for it in items]
        assert timestamps == sorted(timestamps), f"comments not sorted asc: {timestamps}"


class TestCommunityDelete:
    def test_other_user_cannot_delete(self, http, user_a, user_b):
        pid = user_a["ayurveda_post_id"]
        r = http.delete(f"{BASE_URL}/api/community/posts/{pid}", headers=user_b["headers"])
        assert r.status_code == 403

    def test_author_can_delete_and_cascades(self, http, user_a):
        pid = user_a["ayurveda_post_id"]
        # confirm comments exist first
        c_before = http.get(f"{BASE_URL}/api/community/posts/{pid}/comments", headers=user_a["headers"])
        assert len(c_before.json()["items"]) >= 2
        r = http.delete(f"{BASE_URL}/api/community/posts/{pid}", headers=user_a["headers"])
        assert r.status_code == 200
        # 404 after delete
        g = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=user_a["headers"])
        assert g.status_code == 404
        # comments returned empty (cascade)
        c_after = http.get(f"{BASE_URL}/api/community/posts/{pid}/comments", headers=user_a["headers"])
        assert c_after.status_code == 200
        assert c_after.json()["items"] == []

    def test_admin_can_delete_any(self, http, user_a, admin_ctx):
        # create a fresh post to delete
        r = http.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter20 admin will delete this", "hashtags": ["admin_test"]},
            headers=user_a["headers"],
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        d = http.delete(f"{BASE_URL}/api/community/posts/{pid}", headers=admin_ctx["headers"])
        assert d.status_code == 200, d.text
        g = http.get(f"{BASE_URL}/api/community/posts/{pid}", headers=admin_ctx["headers"])
        assert g.status_code == 404


class TestCommunityAuthorRoles:
    def test_admin_author_snapshot(self, http, admin_ctx):
        r = http.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter20 admin announcement", "hashtags": ["official"]},
            headers=admin_ctx["headers"],
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["author"]["role"] == "admin"
        assert d["author"]["verified"] is True
        # cleanup
        http.delete(f"{BASE_URL}/api/community/posts/{d['id']}", headers=admin_ctx["headers"])

    def test_doctor_author_snapshot_reflects_verified(self, http, doctor_ctx):
        r = http.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter20 doctor tip", "hashtags": ["doctor"]},
            headers=doctor_ctx["headers"],
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["author"]["role"] == "doctor"
        # Freshly registered doctor is not yet verified in doctors collection
        assert d["author"]["verified"] is False
        # cleanup
        http.delete(f"{BASE_URL}/api/community/posts/{d['id']}", headers=doctor_ctx["headers"])


class TestCommunityHashtags:
    def test_hashtags_aggregate(self, http, user_a):
        # ensure at least one post exists with a known hashtag
        r = http.post(
            f"{BASE_URL}/api/community/posts",
            json={"content": "TEST_iter20 hashtag agg", "hashtags": ["ayurveda", "yoga"]},
            headers=user_a["headers"],
        )
        assert r.status_code == 200
        pid = r.json()["id"]

        h = http.get(f"{BASE_URL}/api/community/hashtags", headers=user_a["headers"])
        assert h.status_code == 200
        items = h.json()["items"]
        assert isinstance(items, list) and len(items) <= 20
        # counts should be ints and tags lowercase strings
        for it in items:
            assert isinstance(it["tag"], str) and it["tag"] == it["tag"].lower()
            assert isinstance(it["count"], int) and it["count"] >= 1
        tags = [it["tag"] for it in items]
        # Our just-created 'ayurveda' should be in the top 20 (there are only a handful of tags in TEST_ data)
        assert "ayurveda" in tags or "yoga" in tags

        # cleanup
        http.delete(f"{BASE_URL}/api/community/posts/{pid}", headers=user_a["headers"])


# ==================================================================
# Child Milestones
# ==================================================================
@pytest.fixture(scope="module")
def child_member(http, user_a):
    """Create a family member with dob (child)."""
    dob = (date.today() - timedelta(days=30 * 10)).isoformat()  # ~10 months old
    r = http.post(
        f"{BASE_URL}/api/family/members",
        json={"name": "TEST_iter20_Kid", "relation": "son", "dob": dob, "gender": "male"},
        headers=user_a["headers"],
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def dobless_member(http, user_a):
    r = http.post(
        f"{BASE_URL}/api/family/members",
        json={"name": "TEST_iter20_Grandpa", "relation": "grandfather", "gender": "male"},
        headers=user_a["headers"],
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestChildMilestones:
    def test_get_milestones_with_dob(self, http, user_a, child_member):
        mid = child_member["id"]
        r = http.get(f"{BASE_URL}/api/family/members/{mid}/milestones", headers=user_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["age_months"], int)
        assert isinstance(d["groups"], list) and len(d["groups"]) >= 1
        # Each item has text + done
        for g in d["groups"]:
            assert "age_months" in g and "items" in g and "applicable" in g
            for it in g["items"]:
                assert "text" in it and "done" in it
                assert isinstance(it["done"], bool)

    def test_get_milestones_without_dob(self, http, user_a, dobless_member):
        mid = dobless_member["id"]
        r = http.get(f"{BASE_URL}/api/family/members/{mid}/milestones", headers=user_a["headers"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["age_months"] is None
        # All groups applicable (no dob -> all shown)
        for g in d["groups"]:
            assert g["applicable"] is True

    def test_toggle_add_and_remove(self, http, user_a, child_member):
        mid = child_member["id"]
        text = "Smiles at people"
        # Mark done
        r1 = http.post(
            f"{BASE_URL}/api/family/members/{mid}/milestones/toggle",
            json={"text": text, "done": True},
            headers=user_a["headers"],
        )
        assert r1.status_code == 200
        # Verify done=true in GET
        g1 = http.get(f"{BASE_URL}/api/family/members/{mid}/milestones", headers=user_a["headers"])
        found = False
        for grp in g1.json()["groups"]:
            for it in grp["items"]:
                if it["text"] == text:
                    found = True
                    assert it["done"] is True
        assert found, f"'{text}' not present in milestone catalogue"

        # Un-mark
        r2 = http.post(
            f"{BASE_URL}/api/family/members/{mid}/milestones/toggle",
            json={"text": text, "done": False},
            headers=user_a["headers"],
        )
        assert r2.status_code == 200
        g2 = http.get(f"{BASE_URL}/api/family/members/{mid}/milestones", headers=user_a["headers"])
        for grp in g2.json()["groups"]:
            for it in grp["items"]:
                if it["text"] == text:
                    assert it["done"] is False

    def test_cross_user_access_denied(self, http, user_b, child_member):
        mid = child_member["id"]
        r = http.get(f"{BASE_URL}/api/family/members/{mid}/milestones", headers=user_b["headers"])
        assert r.status_code == 404
        r2 = http.post(
            f"{BASE_URL}/api/family/members/{mid}/milestones/toggle",
            json={"text": "Smiles at people", "done": True},
            headers=user_b["headers"],
        )
        assert r2.status_code == 404


# ==================================================================
# Regression
# ==================================================================
class TestRegression:
    def test_doctors_public(self, http):
        r = http.get(f"{BASE_URL}/api/doctors", timeout=15)
        assert r.status_code == 200
        # Should be JSON list
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_wellness_log_and_dashboard(self, http, user_a):
        r = http.post(
            f"{BASE_URL}/api/wellness/log",
            json={"type": "weight", "value": 65.5},
            headers=user_a["headers"],
        )
        assert r.status_code == 200
        d = http.get(f"{BASE_URL}/api/wellness/dashboard", headers=user_a["headers"])
        assert d.status_code == 200
        payload = d.json()
        assert "latest" in payload and "health_score" in payload

    def test_family_list(self, http, user_a):
        # Ensure at least one member exists for this user
        create = http.post(
            f"{BASE_URL}/api/family/members",
            json={"name": "TEST_iter20_regr", "relation": "self"},
            headers=user_a["headers"],
        )
        assert create.status_code == 200
        r = http.get(f"{BASE_URL}/api/family/members", headers=user_a["headers"])
        assert r.status_code == 200
        payload = r.json()
        members = payload["items"] if isinstance(payload, dict) else payload
        assert isinstance(members, list) and len(members) >= 1

    def test_auth_login_admin(self, http):
        if not ADMIN_PASSWORD:
            pytest.skip("ADMIN_PASSWORD not set")
        r = http.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        assert r.status_code == 200
        assert r.json()["user"]["is_admin"] is True
