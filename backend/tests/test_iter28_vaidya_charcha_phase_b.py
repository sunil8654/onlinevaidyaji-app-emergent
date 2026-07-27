"""Iteration 28 — Vaidya Charcha Phase B tests.

Covers:
  • Access gate (patient / unverified doctor blocked with 403 on new endpoints)
  • STORIES  create / feed / by-doctor / view (idempotent) / delete
  • DMs      start (self=400, patient/nonexistent=404), send (empty=400),
             list, messages, read (clears unread), non-participant=403
  • REELS    create (12MB base64 rejected), feed, by-doctor, like toggle,
             view increment, delete
  • ENHANCED PROFILE returns clinic_address, consultation_fee, experience_years,
    languages, bio + posts/followers/following counts
  • Regression: Phase-A endpoints still work (feed / posts / follow)
"""

import base64
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://swasth-daily.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "33NyAeAx%9t*@moaIBDnQka!")

VERIFIED_DOC_EMAIL = "drtest@vaidhyaji.example.com"
VERIFIED_DOC_PASSWORD = "Doctor@Vaidhya123"
PATIENT_EMAIL = "patient1@vaidhyaji.example.com"
PATIENT_PASSWORD = "Vaidhyaji@123"


# ─────────── helpers ───────────

def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _login(email: str, password: str) -> str | None:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    return r.json().get("token") if r.status_code == 200 else None


def _register_doctor(session_tag: str) -> tuple[str, str, str]:
    tag = uuid.uuid4().hex[:8]
    email = f"TEST_{session_tag}_{tag}@vaidhyaji.example.com"
    password = "TestPass@123"
    phone = f"9{str(int(time.time()*1000))[-9:]}"
    r = requests.post(f"{API}/auth/register", json={
        "name": f"TEST Dr {session_tag} {tag}",
        "email": email, "password": password, "role": "doctor",
        "phone": phone, "registration_number": f"REG-{tag}",
    }, timeout=15)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return email, password, r.json()["token"]


def _admin_approve_doctor_by_email(admin_tok: str, email: str) -> str:
    r = requests.get(f"{API}/admin/doctors", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200, f"list doctors failed: {r.text}"
    rows = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    row = next((d for d in rows if d.get("email") == email.lower()), None)
    assert row, f"doctor row not found for {email}"
    doctor_id = row["id"]
    r2 = requests.post(f"{API}/admin/doctors/{doctor_id}/approve", headers=_h(admin_tok), timeout=15)
    assert r2.status_code == 200, f"approve failed: {r2.text}"
    return doctor_id


def _me(tok: str) -> dict:
    r = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15)
    if r.status_code == 200:
        d = r.json()
        return d if "id" in d else d.get("user", {})
    return {}


# ─────────── session fixtures ───────────

@pytest.fixture(scope="session")
def admin_token():
    tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not tok:
        pytest.skip("admin login failed")
    return tok


@pytest.fixture(scope="session")
def patient_token():
    tok = _login(PATIENT_EMAIL, PATIENT_PASSWORD)
    if not tok:
        phone = f"9876500{str(int(time.time()))[-3:]}"
        requests.post(f"{API}/auth/register", json={
            "name": "Patient One", "email": PATIENT_EMAIL, "password": PATIENT_PASSWORD,
            "role": "patient", "phone": phone,
        }, timeout=15)
        tok = _login(PATIENT_EMAIL, PATIENT_PASSWORD)
    if not tok:
        pytest.skip("patient login failed")
    return tok


@pytest.fixture(scope="session")
def patient_user(patient_token):
    return _me(patient_token)


@pytest.fixture(scope="session")
def unverified_doctor_token():
    _, _, tok = _register_doctor("unver28")
    return tok


@pytest.fixture(scope="session")
def doctor_a(admin_token):
    """Primary verified doctor (drtest…). Ensures it exists + is approved,
    and onboarded with clinic_address/bio/languages for profile tests."""
    tok = _login(VERIFIED_DOC_EMAIL, VERIFIED_DOC_PASSWORD)
    if not tok:
        requests.post(f"{API}/auth/register", json={
            "name": "Dr Test", "email": VERIFIED_DOC_EMAIL, "password": VERIFIED_DOC_PASSWORD,
            "role": "doctor", "phone": "9876543299", "registration_number": "REG-drtest",
        }, timeout=15)
        tok = _login(VERIFIED_DOC_EMAIL, VERIFIED_DOC_PASSWORD)
    assert tok
    # Onboard (idempotent — writes bio, clinic_address, fee, exp, languages)
    onboard = {
        "name": "Dr Test",
        "specialty": "Ayurveda",
        "qualification": "BAMS",
        "experience_years": 7,
        "languages": ["English", "Hindi"],
        "consultation_fee": 599,
        "bio": "TEST bio for phase-B profile.",
        "clinic_name": "Test Clinic",
        "clinic_address": "12 Test Lane, Pune",
        "registration_number": "REG-drtest",
    }
    requests.put(f"{API}/doctor/onboard", headers=_h(tok), json=onboard, timeout=15)
    # Approve
    _admin_approve_doctor_by_email(admin_token, VERIFIED_DOC_EMAIL)
    # Re-login to pick up the verified flag in the token payload
    tok = _login(VERIFIED_DOC_EMAIL, VERIFIED_DOC_PASSWORD)
    me = _me(tok)
    return {"token": tok, "user_id": me.get("id"), "email": VERIFIED_DOC_EMAIL}


@pytest.fixture(scope="session")
def doctor_b(admin_token):
    """Second verified doctor (fresh) for DM/follow tests."""
    email, password, tok = _register_doctor("verB28")
    # Onboard so profile endpoint has data
    requests.put(f"{API}/doctor/onboard", headers=_h(tok), json={
        "name": "TEST Dr B",
        "specialty": "Yoga",
        "qualification": "MSc Yoga",
        "experience_years": 3,
        "languages": ["English"],
        "consultation_fee": 399,
        "bio": "TEST B bio",
        "clinic_name": "B Clinic",
        "clinic_address": "45 B Road, Delhi",
        "registration_number": f"REG-B-{uuid.uuid4().hex[:6]}",
    }, timeout=15)
    _admin_approve_doctor_by_email(admin_token, email)
    tok = _login(email, password)
    me = _me(tok)
    return {"token": tok, "user_id": me.get("id"), "email": email, "password": password}


# ══════════════════════════════════════════════════════════════════
# 1) ACCESS GATE
# ══════════════════════════════════════════════════════════════════

class TestGuardPhaseB:
    PROTECTED = [
        ("GET",  "/community/doctor/stories/feed"),
        ("POST", "/community/doctor/stories"),
        ("GET",  "/community/doctor/dm/threads"),
        ("POST", "/community/doctor/reels"),
        ("GET",  "/community/doctor/reels/feed"),
    ]

    @pytest.mark.parametrize("method,path", PROTECTED)
    def test_patient_blocked_403(self, patient_token, method, path):
        r = requests.request(method, f"{API}{path}", headers=_h(patient_token),
                             json={} if method == "POST" else None, timeout=15)
        assert r.status_code == 403, f"{method} {path} → {r.status_code} {r.text[:120]}"

    @pytest.mark.parametrize("method,path", PROTECTED)
    def test_unverified_doctor_blocked_403(self, unverified_doctor_token, method, path):
        r = requests.request(method, f"{API}{path}", headers=_h(unverified_doctor_token),
                             json={} if method == "POST" else None, timeout=15)
        assert r.status_code == 403, f"{method} {path} → {r.status_code}"


# ══════════════════════════════════════════════════════════════════
# 2) STORIES
# ══════════════════════════════════════════════════════════════════

class TestStories:
    def test_create_story_url(self, doctor_a):
        body = {
            "media_url": "https://example.com/story.jpg",
            "media_type": "image",
            "caption": "TEST story A",
        }
        r = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]), json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] and d["doctor_id"] == doctor_a["user_id"]
        assert d["media_url"] == body["media_url"]
        assert d["views_count"] == 0
        assert d["author"]["id"] == doctor_a["user_id"]
        assert d.get("expires_at")

    def test_create_story_base64(self, doctor_a):
        # 8+ chars is enough — value is a data URI
        b64 = "data:image/png;base64," + base64.b64encode(b"hello world png").decode()
        r = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                          json={"media_url": b64, "media_type": "image"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_stories_feed_own_bucket_first(self, doctor_a, doctor_b):
        # doctor_a already has stories; doctor_b creates one too and doctor_a follows B
        rb = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_b["token"]),
                           json={"media_url": "https://example.com/b.jpg"}, timeout=15)
        assert rb.status_code == 200

        # A follows B so B's stories appear in A's feed
        requests.post(f"{API}/community/doctor/follow/{doctor_b['user_id']}",
                      headers=_h(doctor_a["token"]), timeout=15)

        r = requests.get(f"{API}/community/doctor/stories/feed", headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "items" in j and isinstance(j["items"], list)
        assert len(j["items"]) >= 2
        # own bucket first
        assert j["items"][0].get("is_me") is True
        assert j["items"][0]["doctor"]["id"] == doctor_a["user_id"]
        # doctor_b bucket present
        assert any(b["doctor"]["id"] == doctor_b["user_id"] and b.get("is_me") is False
                   for b in j["items"][1:])

    def test_stories_by_doctor(self, doctor_a):
        r = requests.get(f"{API}/community/doctor/stories/by/{doctor_a['user_id']}",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["is_me"] is True
        assert j["author"]["id"] == doctor_a["user_id"]
        assert isinstance(j["stories"], list) and len(j["stories"]) >= 1

    def test_view_story_idempotent(self, doctor_a, doctor_b):
        # doctor_b creates a fresh story; doctor_a views it twice
        rb = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_b["token"]),
                           json={"media_url": "https://example.com/v.jpg"}, timeout=15)
        sid = rb.json()["id"]

        r1 = requests.post(f"{API}/community/doctor/stories/{sid}/view",
                           headers=_h(doctor_a["token"]), timeout=15)
        assert r1.status_code == 200 and r1.json().get("ok") is True
        r2 = requests.post(f"{API}/community/doctor/stories/{sid}/view",
                           headers=_h(doctor_a["token"]), timeout=15)
        assert r2.status_code == 200 and r2.json().get("already") is True

        # views_count on the story should be 1 (idempotent)
        listing = requests.get(f"{API}/community/doctor/stories/by/{doctor_b['user_id']}",
                               headers=_h(doctor_b["token"]), timeout=15).json()
        story = next((s for s in listing["stories"] if s["id"] == sid), None)
        assert story and story["views_count"] == 1

        # self-view is a no-op counter-wise
        rs = requests.post(f"{API}/community/doctor/stories/{sid}/view",
                           headers=_h(doctor_b["token"]), timeout=15)
        assert rs.status_code == 200 and rs.json().get("self") is True

    def test_delete_story_author_only(self, doctor_a, doctor_b):
        rb = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                           json={"media_url": "https://example.com/del.jpg"}, timeout=15)
        sid = rb.json()["id"]
        # non-author cannot delete
        r_forbid = requests.delete(f"{API}/community/doctor/stories/{sid}",
                                   headers=_h(doctor_b["token"]), timeout=15)
        assert r_forbid.status_code == 403
        # author can
        r_ok = requests.delete(f"{API}/community/doctor/stories/{sid}",
                               headers=_h(doctor_a["token"]), timeout=15)
        assert r_ok.status_code == 200 and r_ok.json().get("deleted") is True

    def test_view_missing_story_404(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/stories/{uuid.uuid4()}/view",
                          headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 404


# ══════════════════════════════════════════════════════════════════
# 3) DIRECT MESSAGES
# ══════════════════════════════════════════════════════════════════

@pytest.fixture(scope="session")
def dm_thread(doctor_a, doctor_b):
    r = requests.post(f"{API}/community/doctor/dm/threads",
                      headers=_h(doctor_a["token"]),
                      json={"target_id": doctor_b["user_id"]}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestDMs:
    def test_dm_self_400(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/dm/threads", headers=_h(doctor_a["token"]),
                          json={"target_id": doctor_a["user_id"]}, timeout=15)
        assert r.status_code == 400

    def test_dm_patient_target_404(self, doctor_a, patient_user):
        pid = patient_user.get("id")
        if not pid:
            pytest.skip("patient id unavailable")
        r = requests.post(f"{API}/community/doctor/dm/threads", headers=_h(doctor_a["token"]),
                          json={"target_id": pid}, timeout=15)
        assert r.status_code == 404, r.text

    def test_dm_unknown_target_404(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/dm/threads", headers=_h(doctor_a["token"]),
                          json={"target_id": str(uuid.uuid4())}, timeout=15)
        assert r.status_code == 404

    def test_dm_thread_created_and_reused(self, doctor_a, doctor_b, dm_thread):
        assert dm_thread["id"] and "other" in dm_thread
        # Second call from same doctor should reuse
        r2 = requests.post(f"{API}/community/doctor/dm/threads",
                           headers=_h(doctor_a["token"]),
                           json={"target_id": doctor_b["user_id"]}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["id"] == dm_thread["id"]
        # And from the OTHER side too (canonical thread key)
        r3 = requests.post(f"{API}/community/doctor/dm/threads",
                           headers=_h(doctor_b["token"]),
                           json={"target_id": doctor_a["user_id"]}, timeout=15)
        assert r3.status_code == 200 and r3.json()["id"] == dm_thread["id"]

    def test_send_message_empty_400(self, doctor_a, dm_thread):
        r = requests.post(f"{API}/community/doctor/dm/threads/{dm_thread['id']}/messages",
                          headers=_h(doctor_a["token"]),
                          json={"text": "   ", "image_url": ""}, timeout=15)
        assert r.status_code == 400

    def test_send_text_and_read(self, doctor_a, doctor_b, dm_thread):
        tid = dm_thread["id"]
        # A sends a text
        s = requests.post(f"{API}/community/doctor/dm/threads/{tid}/messages",
                          headers=_h(doctor_a["token"]),
                          json={"text": "Hello Doctor B — TEST"}, timeout=15)
        assert s.status_code == 200, s.text
        msg = s.json()
        assert msg["text"] == "Hello Doctor B — TEST"
        assert msg["sender_id"] == doctor_a["user_id"]

        # B lists threads → sees unread >= 1 for this thread
        lst = requests.get(f"{API}/community/doctor/dm/threads",
                           headers=_h(doctor_b["token"]), timeout=15).json()
        row = next((t for t in lst["items"] if t["id"] == tid), None)
        assert row and row["unread"] >= 1
        assert lst["unread_total"] >= 1

        # B fetches messages → chronological, includes the message
        m = requests.get(f"{API}/community/doctor/dm/threads/{tid}/messages",
                         headers=_h(doctor_b["token"]), timeout=15)
        assert m.status_code == 200
        items = m.json()["items"]
        assert any(x["id"] == msg["id"] for x in items)

        # B marks read → unread clears
        rr = requests.post(f"{API}/community/doctor/dm/threads/{tid}/read",
                           headers=_h(doctor_b["token"]), timeout=15)
        assert rr.status_code == 200
        lst2 = requests.get(f"{API}/community/doctor/dm/threads",
                            headers=_h(doctor_b["token"]), timeout=15).json()
        row2 = next(t for t in lst2["items"] if t["id"] == tid)
        assert row2["unread"] == 0

    def test_send_image_only_ok(self, doctor_a, dm_thread):
        r = requests.post(f"{API}/community/doctor/dm/threads/{dm_thread['id']}/messages",
                          headers=_h(doctor_a["token"]),
                          json={"image_url": "https://example.com/photo.jpg"}, timeout=15)
        assert r.status_code == 200 and r.json()["image_url"].startswith("http")

    def test_non_participant_403(self, doctor_a, doctor_b, dm_thread, admin_token):
        # Create a third verified doctor
        email, password, tok = _register_doctor("verC28")
        # onboard minimally + approve
        requests.put(f"{API}/doctor/onboard", headers=_h(tok), json={
            "name": "TEST Dr C", "specialty": "Ayurveda", "qualification": "BAMS",
            "experience_years": 1, "languages": ["English"], "consultation_fee": 299,
            "bio": "c", "clinic_name": "C", "clinic_address": "C addr",
            "registration_number": f"REG-C-{uuid.uuid4().hex[:6]}",
        }, timeout=15)
        _admin_approve_doctor_by_email(admin_token, email)
        tok = _login(email, password)

        r_msg = requests.get(f"{API}/community/doctor/dm/threads/{dm_thread['id']}/messages",
                             headers=_h(tok), timeout=15)
        assert r_msg.status_code == 403
        r_send = requests.post(f"{API}/community/doctor/dm/threads/{dm_thread['id']}/messages",
                               headers=_h(tok), json={"text": "sneaky"}, timeout=15)
        assert r_send.status_code == 403
        r_read = requests.post(f"{API}/community/doctor/dm/threads/{dm_thread['id']}/read",
                               headers=_h(tok), timeout=15)
        assert r_read.status_code == 403


# ══════════════════════════════════════════════════════════════════
# 4) REELS
# ══════════════════════════════════════════════════════════════════

@pytest.fixture(scope="session")
def sample_reel(doctor_a):
    body = {
        "video_url": "https://example.com/reel.mp4",
        "thumbnail_url": "https://example.com/thumb.jpg",
        "caption": "TEST reel #ayurveda",
        "hashtags": ["#Ayurveda", "wellness"],
        "duration_sec": 15,
    }
    r = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                      json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestReels:
    def test_create_reel_url(self, sample_reel, doctor_a):
        assert sample_reel["id"] and sample_reel["doctor_id"] == doctor_a["user_id"]
        assert sample_reel["author"]["id"] == doctor_a["user_id"]
        assert sample_reel["liked_by_me"] is False
        assert sample_reel["likes_count"] == 0
        # hashtags normalised — lowercase, no '#'
        tags = sample_reel.get("hashtags") or []
        assert "ayurveda" in tags and "wellness" in tags
        assert all("#" not in t for t in tags)

    def test_create_reel_base64_too_large_400(self, doctor_a):
        # 12MB+ base64 payload (~13MB string)
        big = "data:video/mp4;base64," + ("A" * (12_500_000))
        r = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                          json={"video_url": big}, timeout=30)
        # Pydantic max_length may catch it first with 422; either 400 or 422 is acceptable.
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text[:200]}"

    def test_reels_feed(self, sample_reel, doctor_a):
        r = requests.get(f"{API}/community/doctor/reels/feed", headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x["id"] == sample_reel["id"] for x in items)

    def test_reels_by_doctor(self, sample_reel, doctor_a):
        r = requests.get(f"{API}/community/doctor/reels/by/{doctor_a['user_id']}",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x["id"] == sample_reel["id"] for x in items)
        for it in items:
            assert it["doctor_id"] == doctor_a["user_id"]

    def test_reel_like_toggle(self, sample_reel, doctor_b, doctor_a):
        rid = sample_reel["id"]
        h_b = _h(doctor_b["token"])

        r1 = requests.post(f"{API}/community/doctor/reels/{rid}/like", headers=h_b, timeout=15)
        assert r1.status_code == 200 and r1.json()["liked"] is True

        # Reflects on GET
        g = requests.get(f"{API}/community/doctor/reels/{rid}", headers=h_b, timeout=15).json()
        assert g["likes_count"] >= 1 and g["liked_by_me"] is True

        r2 = requests.post(f"{API}/community/doctor/reels/{rid}/like", headers=h_b, timeout=15)
        assert r2.status_code == 200 and r2.json()["liked"] is False

        g2 = requests.get(f"{API}/community/doctor/reels/{rid}", headers=h_b, timeout=15).json()
        assert g2["liked_by_me"] is False

    def test_reel_view_increments(self, sample_reel, doctor_a, doctor_b):
        rid = sample_reel["id"]
        before = requests.get(f"{API}/community/doctor/reels/{rid}",
                              headers=_h(doctor_a["token"]), timeout=15).json()["views_count"]
        r = requests.post(f"{API}/community/doctor/reels/{rid}/view",
                          headers=_h(doctor_b["token"]), timeout=15)
        assert r.status_code == 200
        after = requests.get(f"{API}/community/doctor/reels/{rid}",
                             headers=_h(doctor_a["token"]), timeout=15).json()["views_count"]
        assert after == before + 1

    def test_delete_reel_author_only(self, doctor_a, doctor_b):
        # Create a fresh reel to delete
        r = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                          json={"video_url": "https://example.com/del.mp4", "caption": "x"},
                          timeout=15)
        assert r.status_code == 200
        rid = r.json()["id"]
        # non-author denied
        rf = requests.delete(f"{API}/community/doctor/reels/{rid}",
                             headers=_h(doctor_b["token"]), timeout=15)
        assert rf.status_code == 403
        # author OK
        ro = requests.delete(f"{API}/community/doctor/reels/{rid}",
                             headers=_h(doctor_a["token"]), timeout=15)
        assert ro.status_code == 200 and ro.json()["deleted"] is True
        # gone
        g = requests.get(f"{API}/community/doctor/reels/{rid}", headers=_h(doctor_a["token"]), timeout=15)
        assert g.status_code == 404


# ══════════════════════════════════════════════════════════════════
# 5) ENHANCED PROFILE
# ══════════════════════════════════════════════════════════════════

class TestEnhancedProfile:
    def test_profile_includes_new_fields(self, doctor_a):
        r = requests.get(f"{API}/community/doctor/profile/{doctor_a['user_id']}",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        # New Phase-B fields
        for key in ("clinic_address", "consultation_fee", "experience_years",
                    "languages", "bio"):
            assert key in p, f"missing '{key}' in profile: {list(p.keys())}"
        # Values from onboarding above
        assert p["clinic_address"] == "12 Test Lane, Pune"
        assert p["consultation_fee"] == 599
        assert p["experience_years"] == 7
        assert isinstance(p["languages"], list) and "English" in p["languages"]
        assert p["bio"].startswith("TEST bio")
        # Existing counts still present
        for key in ("posts_count", "followers_count", "following_count",
                    "is_following", "is_me"):
            assert key in p
        assert p["is_me"] is True

    def test_profile_of_other_doctor(self, doctor_a, doctor_b):
        r = requests.get(f"{API}/community/doctor/profile/{doctor_b['user_id']}",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p["is_me"] is False
        assert p["clinic_address"] == "45 B Road, Delhi"
        assert p["consultation_fee"] == 399
        assert p["experience_years"] == 3


# ══════════════════════════════════════════════════════════════════
# 6) REGRESSION — Phase-A endpoints still healthy
# ══════════════════════════════════════════════════════════════════

class TestRegressionPhaseA:
    def test_access_probe(self, doctor_a):
        r = requests.get(f"{API}/community/doctor/access",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200 and r.json().get("has_access") is True

    def test_feed_still_works(self, doctor_a):
        r = requests.get(f"{API}/community/doctor/feed?limit=10",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_post_and_read(self, doctor_a):
        body = {"images": [], "caption": "TEST regression post iter28",
                "hashtags": ["#regression"], "specialty_tag": "Ayurveda"}
        r = requests.post(f"{API}/community/doctor/posts",
                          headers=_h(doctor_a["token"]), json=body, timeout=15)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        g = requests.get(f"{API}/community/doctor/posts/{pid}",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert g.status_code == 200

    def test_follow_still_works(self, doctor_a, doctor_b):
        target = doctor_b["user_id"]
        r = requests.post(f"{API}/community/doctor/follow/{target}",
                          headers=_h(doctor_a["token"]), timeout=15)
        assert r.status_code == 200 and r.json()["ok"] is True
        u = requests.delete(f"{API}/community/doctor/follow/{target}",
                            headers=_h(doctor_a["token"]), timeout=15)
        assert u.status_code == 200

    def test_public_doctors_list(self):
        r = requests.get(f"{API}/doctors", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_auth_login(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
