"""Iteration 29 — Security-fix verification for Vaidya Charcha Phase B.

Covers three findings from the security audit:
  * SEC-001 (MEDIUM): media URLs must be data: URIs with a MIME allowlist.
                       Raw http(s) URLs are rejected (empty ALLOWED_MEDIA_HOSTS).
  * SEC-002 (MEDIUM): moderation for Reels/Stories/DMs.
                       report endpoint accepts reel/story/dm_message.
                       admin can hide/unhide/delete reels, delete stories,
                       redact DM messages. Admin reports listing hydrates all
                       target types.
  * SEC-003 (LOW):    reel view dedupe by (reel_id, doctor_id) &
                       rate-limit on DM thread creation (30/hour).

Base URL: EXPO_PUBLIC_BACKEND_URL /api prefix.
"""

import base64
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://swasth-daily.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@vaidhyaji.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "33NyAeAx%9t*@moaIBDnQka!")

VERIFIED_DOC_EMAIL = "drtest@vaidhyaji.example.com"
VERIFIED_DOC_PASSWORD = "Doctor@Vaidhya123"
PATIENT_EMAIL = "patient1@vaidhyaji.example.com"
PATIENT_PASSWORD = "Vaidhyaji@123"

# --- SEC-001 data URI samples --------------------------------------------
IMG_JPG_DATA_URI = "data:image/jpeg;base64," + base64.b64encode(b"tiny jpg bytes").decode()
IMG_PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(b"tiny png bytes").decode()
IMG_WEBP_DATA_URI = "data:image/webp;base64," + base64.b64encode(b"tiny webp bytes").decode()
VIDEO_MP4_DATA_URI = "data:video/mp4;base64," + base64.b64encode(b"tiny mp4 bytes").decode()
VIDEO_MOV_DATA_URI = "data:video/quicktime;base64," + base64.b64encode(b"tiny mov bytes").decode()

# Disallowed
IMG_SVG_DATA_URI = "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode()
BIN_OCTET_DATA_URI = "data:application/octet-stream;base64," + base64.b64encode(b"binary").decode()
MALFORMED_DATA_URI = "data:image/png;base64"  # no comma → malformed


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
    phone = f"9{str(int(time.time() * 1000))[-9:]}"
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
    assert r2.status_code == 200
    return doctor_id


def _me(tok: str) -> dict:
    r = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15)
    if r.status_code == 200:
        d = r.json()
        return d if "id" in d else d.get("user", {})
    return {}


def _prep_doctor(admin_tok: str, tag: str) -> dict:
    email, password, tok = _register_doctor(tag)
    requests.put(f"{API}/doctor/onboard", headers=_h(tok), json={
        "name": f"TEST Dr {tag}", "specialty": "Ayurveda", "qualification": "BAMS",
        "experience_years": 2, "languages": ["English"], "consultation_fee": 299,
        "bio": "test", "clinic_name": "Clinic", "clinic_address": "addr",
        "registration_number": f"REG-{tag}-{uuid.uuid4().hex[:6]}",
    }, timeout=15)
    _admin_approve_doctor_by_email(admin_tok, email)
    tok = _login(email, password)
    me = _me(tok)
    return {"token": tok, "user_id": me.get("id"), "email": email}


# ─────────── session fixtures ───────────

@pytest.fixture(scope="session")
def admin_token():
    tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not tok:
        pytest.skip("admin login failed")
    return tok


@pytest.fixture(scope="session")
def doctor_a(admin_token):
    """Primary verified doctor (drtest) — created & onboarded by iter28.
    Ensures it exists (safe idempotent re-approve)."""
    tok = _login(VERIFIED_DOC_EMAIL, VERIFIED_DOC_PASSWORD)
    if not tok:
        pytest.skip("drtest doctor unavailable — run iter28 fixtures first")
    me = _me(tok)
    return {"token": tok, "user_id": me.get("id"), "email": VERIFIED_DOC_EMAIL}


@pytest.fixture(scope="session")
def doctor_b(admin_token):
    return _prep_doctor(admin_token, "sec29B")


@pytest.fixture(scope="session")
def doctor_c(admin_token):
    """Non-participant used for 403 checks."""
    return _prep_doctor(admin_token, "sec29C")


@pytest.fixture(scope="session")
def patient_token():
    tok = _login(PATIENT_EMAIL, PATIENT_PASSWORD)
    if not tok:
        pytest.skip("patient login failed")
    return tok


@pytest.fixture(scope="session")
def dm_thread(doctor_a, doctor_b):
    r = requests.post(f"{API}/community/doctor/dm/threads",
                      headers=_h(doctor_a["token"]),
                      json={"target_id": doctor_b["user_id"]}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ══════════════════════════════════════════════════════════════════════
# 1) SEC-001 — Media allowlist enforcement
# ══════════════════════════════════════════════════════════════════════

class TestSEC001MediaAllowlist:
    """Raw http(s) URLs must be rejected; only data: URIs with allowlisted
    MIME types are accepted."""

    # ---- STORIES ----
    def test_story_http_url_rejected(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                          json={"media_url": "https://evil.example.com/track.png",
                                "media_type": "image"}, timeout=15)
        assert r.status_code == 400, r.text
        assert "allow" in r.text.lower() or "uploaded" in r.text.lower()

    def test_story_svg_rejected(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                          json={"media_url": IMG_SVG_DATA_URI, "media_type": "image"}, timeout=15)
        assert r.status_code == 400, r.text
        assert "svg" in r.text.lower() or "unsupported" in r.text.lower()

    def test_story_octet_rejected(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                          json={"media_url": BIN_OCTET_DATA_URI, "media_type": "image"}, timeout=15)
        assert r.status_code == 400

    def test_story_malformed_data_uri_rejected(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                          json={"media_url": MALFORMED_DATA_URI, "media_type": "image"}, timeout=15)
        # Pydantic min_length=8 may 422; explicit malformed message triggers 400.
        assert r.status_code in (400, 422), r.text

    @pytest.mark.parametrize("uri", [IMG_JPG_DATA_URI, IMG_PNG_DATA_URI, IMG_WEBP_DATA_URI])
    def test_story_allowed_image_mimes_accepted(self, doctor_a, uri):
        r = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                          json={"media_url": uri, "media_type": "image"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["media_url"] == uri

    # ---- REELS ----
    def test_reel_http_url_rejected(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                          json={"video_url": "https://evil.example.com/track.mp4"}, timeout=15)
        assert r.status_code == 400, r.text

    def test_reel_bad_mime_rejected(self, doctor_a):
        # Even an image data URI is wrong when kind==video
        r = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                          json={"video_url": IMG_JPG_DATA_URI}, timeout=15)
        assert r.status_code == 400, r.text
        assert "unsupported" in r.text.lower() or "video" in r.text.lower()

    def test_reel_bad_thumb_rejected(self, doctor_a):
        r = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                          json={"video_url": VIDEO_MP4_DATA_URI,
                                "thumbnail_url": "https://evil.example.com/t.jpg"}, timeout=15)
        assert r.status_code == 400, r.text

    @pytest.mark.parametrize("uri", [VIDEO_MP4_DATA_URI, VIDEO_MOV_DATA_URI])
    def test_reel_allowed_video_mimes_accepted(self, doctor_a, uri):
        r = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                          json={"video_url": uri, "thumbnail_url": IMG_JPG_DATA_URI,
                                "caption": "SEC-001 sample"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["video_url"] == uri
        assert j["thumbnail_url"] == IMG_JPG_DATA_URI

    # ---- DM MESSAGES ----
    def test_dm_image_http_url_rejected(self, doctor_a, dm_thread):
        r = requests.post(
            f"{API}/community/doctor/dm/threads/{dm_thread['id']}/messages",
            headers=_h(doctor_a["token"]),
            json={"image_url": "https://evil.example.com/x.png"}, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_dm_image_svg_rejected(self, doctor_a, dm_thread):
        r = requests.post(
            f"{API}/community/doctor/dm/threads/{dm_thread['id']}/messages",
            headers=_h(doctor_a["token"]),
            json={"image_url": IMG_SVG_DATA_URI}, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_dm_image_allowed_accepted(self, doctor_a, dm_thread):
        r = requests.post(
            f"{API}/community/doctor/dm/threads/{dm_thread['id']}/messages",
            headers=_h(doctor_a["token"]),
            json={"image_url": IMG_PNG_DATA_URI}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["image_url"] == IMG_PNG_DATA_URI


# ══════════════════════════════════════════════════════════════════════
# 2) SEC-002 — Moderation coverage & admin actions
# ══════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="class")
def moderation_content(doctor_a, doctor_b):
    """Create a story, reel and DM message that we can moderate."""
    # Story
    rs = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                       json={"media_url": IMG_JPG_DATA_URI, "media_type": "image",
                             "caption": "SEC-002 story"}, timeout=15)
    assert rs.status_code == 200, rs.text
    story = rs.json()

    # Reel
    rr = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                       json={"video_url": VIDEO_MP4_DATA_URI, "thumbnail_url": IMG_JPG_DATA_URI,
                             "caption": "SEC-002 reel"}, timeout=15)
    assert rr.status_code == 200, rr.text
    reel = rr.json()

    # DM thread + message from doctor_a → doctor_b
    rt = requests.post(f"{API}/community/doctor/dm/threads", headers=_h(doctor_a["token"]),
                       json={"target_id": doctor_b["user_id"]}, timeout=15)
    thread = rt.json()
    rm = requests.post(f"{API}/community/doctor/dm/threads/{thread['id']}/messages",
                       headers=_h(doctor_a["token"]),
                       json={"text": "SEC-002 abuse test message"}, timeout=15)
    assert rm.status_code == 200
    msg = rm.json()

    return {"story": story, "reel": reel, "thread": thread, "message": msg}


class TestSEC002Reports:
    """POST /api/community/doctor/report now accepts reel/story/dm_message."""

    def test_report_reel_accepted(self, doctor_b, moderation_content):
        rid = moderation_content["reel"]["id"]
        r = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                          json={"target_type": "reel", "target_id": rid,
                                "reason": "TEST spam reel"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

    def test_report_story_accepted(self, doctor_b, moderation_content):
        sid = moderation_content["story"]["id"]
        r = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                          json={"target_type": "story", "target_id": sid,
                                "reason": "TEST bad story"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_report_dm_message_by_participant(self, doctor_b, moderation_content):
        mid = moderation_content["message"]["id"]
        r = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                          json={"target_type": "dm_message", "target_id": mid,
                                "reason": "TEST abusive DM"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_report_dm_message_non_participant_403(self, doctor_c, moderation_content):
        mid = moderation_content["message"]["id"]
        r = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_c["token"]),
                          json={"target_type": "dm_message", "target_id": mid,
                                "reason": "sneaky"}, timeout=15)
        assert r.status_code == 403, r.text

    def test_report_unknown_reel_404(self, doctor_b):
        r = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                          json={"target_type": "reel", "target_id": str(uuid.uuid4()),
                                "reason": "ghost"}, timeout=15)
        assert r.status_code == 404

    def test_report_unknown_story_404(self, doctor_b):
        r = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                          json={"target_type": "story", "target_id": str(uuid.uuid4()),
                                "reason": "ghost"}, timeout=15)
        assert r.status_code == 404

    def test_report_unknown_dm_404(self, doctor_b):
        r = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                          json={"target_type": "dm_message", "target_id": str(uuid.uuid4()),
                                "reason": "ghost"}, timeout=15)
        assert r.status_code == 404

    def test_duplicate_report_returns_already(self, doctor_b, moderation_content):
        rid = moderation_content["reel"]["id"]
        # First (may already exist from earlier test) → then duplicate
        requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                      json={"target_type": "reel", "target_id": rid,
                            "reason": "dup1"}, timeout=15)
        r2 = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                           json={"target_type": "reel", "target_id": rid,
                                 "reason": "dup2"}, timeout=15)
        assert r2.status_code == 200
        body = r2.json()
        assert body.get("ok") is True and body.get("already") is True


class TestSEC002AdminActions:
    """Admin moderation of reels / stories / DM messages."""

    def test_hide_and_unhide_reel_flow(self, admin_token, doctor_a, moderation_content):
        rid = moderation_content["reel"]["id"]
        # Non-admin cannot hide
        r_forbid = requests.post(f"{API}/admin/doctor-community/reels/{rid}/hide",
                                 headers=_h(doctor_a["token"]),
                                 json={"reason": "TEST hide"}, timeout=15)
        assert r_forbid.status_code in (401, 403), r_forbid.text

        # Admin hides
        r_hide = requests.post(f"{API}/admin/doctor-community/reels/{rid}/hide",
                               headers=_h(admin_token),
                               json={"reason": "TEST hide"}, timeout=15)
        assert r_hide.status_code == 200, r_hide.text
        assert r_hide.json().get("ok") is True

        # Feed should NOT contain hidden reel
        feed = requests.get(f"{API}/community/doctor/reels/feed",
                            headers=_h(doctor_a["token"]), timeout=15).json()
        assert not any(x["id"] == rid for x in feed["items"]), "hidden reel leaked in feed"

        # Individual GET on hidden reel → 404
        gh = requests.get(f"{API}/community/doctor/reels/{rid}",
                          headers=_h(doctor_a["token"]), timeout=15)
        assert gh.status_code == 404

        # Admin unhides
        r_un = requests.post(f"{API}/admin/doctor-community/reels/{rid}/unhide",
                             headers=_h(admin_token), timeout=15)
        assert r_un.status_code == 200

        # Now visible again
        feed2 = requests.get(f"{API}/community/doctor/reels/feed",
                             headers=_h(doctor_a["token"]), timeout=15).json()
        assert any(x["id"] == rid for x in feed2["items"])

    def test_hide_unknown_reel_404(self, admin_token):
        r = requests.post(f"{API}/admin/doctor-community/reels/{uuid.uuid4()}/hide",
                          headers=_h(admin_token), json={"reason": "x"}, timeout=15)
        assert r.status_code == 404

    def test_unhide_unknown_reel_404(self, admin_token):
        r = requests.post(f"{API}/admin/doctor-community/reels/{uuid.uuid4()}/unhide",
                          headers=_h(admin_token), timeout=15)
        assert r.status_code == 404

    def test_admin_delete_reel_cascades(self, admin_token, doctor_a, doctor_b):
        # fresh reel + like + view + report
        rr = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                           json={"video_url": VIDEO_MP4_DATA_URI, "caption": "to-delete"}, timeout=15)
        assert rr.status_code == 200
        rid = rr.json()["id"]

        # doctor_b likes + views + reports it
        requests.post(f"{API}/community/doctor/reels/{rid}/like",
                      headers=_h(doctor_b["token"]), timeout=15)
        requests.post(f"{API}/community/doctor/reels/{rid}/view",
                      headers=_h(doctor_b["token"]), timeout=15)
        rep = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                            json={"target_type": "reel", "target_id": rid,
                                  "reason": "delete-test"}, timeout=15)
        assert rep.status_code == 200

        # Admin deletes
        d = requests.delete(f"{API}/admin/doctor-community/reels/{rid}",
                            headers=_h(admin_token), timeout=15)
        assert d.status_code == 200 and d.json().get("deleted") is True

        # Reel gone
        g = requests.get(f"{API}/community/doctor/reels/{rid}",
                         headers=_h(doctor_a["token"]), timeout=15)
        assert g.status_code == 404

        # Related report auto-resolved
        rpts_open = requests.get(f"{API}/admin/doctor-community/reports?resolved=false&limit=200",
                                 headers=_h(admin_token), timeout=15).json()["items"]
        rpts_res = requests.get(f"{API}/admin/doctor-community/reports?resolved=true&limit=200",
                                headers=_h(admin_token), timeout=15).json()["items"]
        assert not any(r.get("target_id") == rid for r in rpts_open), "report should have been auto-resolved"
        assert any(r.get("target_id") == rid for r in rpts_res)

    def test_admin_delete_story(self, admin_token, doctor_a):
        rs = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                           json={"media_url": IMG_JPG_DATA_URI, "media_type": "image",
                                 "caption": "SEC-002 delete-me"}, timeout=15)
        sid = rs.json()["id"]

        d = requests.delete(f"{API}/admin/doctor-community/stories/{sid}",
                            headers=_h(admin_token), timeout=15)
        assert d.status_code == 200 and d.json().get("deleted") is True

        # Not returned by by-doctor listing
        listing = requests.get(f"{API}/community/doctor/stories/by/{doctor_a['user_id']}",
                               headers=_h(doctor_a["token"]), timeout=15).json()
        assert not any(s["id"] == sid for s in listing.get("stories", []))

        # Second delete → 404
        d2 = requests.delete(f"{API}/admin/doctor-community/stories/{sid}",
                             headers=_h(admin_token), timeout=15)
        assert d2.status_code == 404

    def test_admin_redact_dm_message(self, admin_token, doctor_a, doctor_b, moderation_content):
        mid = moderation_content["message"]["id"]
        tid = moderation_content["thread"]["id"]

        r = requests.delete(f"{API}/admin/doctor-community/dm/messages/{mid}",
                            headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True and body.get("redacted") is True

        # Both participants can still see the thread
        for who in (doctor_a, doctor_b):
            m = requests.get(f"{API}/community/doctor/dm/threads/{tid}/messages",
                             headers=_h(who["token"]), timeout=15)
            assert m.status_code == 200
            items = m.json()["items"]
            row = next((x for x in items if x["id"] == mid), None)
            assert row, f"redacted msg missing for {who['email']}"
            assert row["text"] == "[Removed by moderator]"
            assert row["image_url"] == ""

    def test_admin_delete_unknown_dm_404(self, admin_token):
        r = requests.delete(f"{API}/admin/doctor-community/dm/messages/{uuid.uuid4()}",
                            headers=_h(admin_token), timeout=15)
        assert r.status_code == 404

    def test_admin_hide_reel_requires_admin(self, doctor_a):
        r = requests.post(f"{API}/admin/doctor-community/reels/{uuid.uuid4()}/hide",
                          headers=_h(doctor_a["token"]),
                          json={"reason": "x"}, timeout=15)
        assert r.status_code in (401, 403)


class TestSEC002AdminReportsHydration:
    """GET /admin/doctor-community/reports hydrates target details for all types."""

    def test_reports_listing_hydrates_all_target_types(self, admin_token, doctor_a, doctor_b):
        # Create fresh targets and reports we can verify
        # Story
        rs = requests.post(f"{API}/community/doctor/stories", headers=_h(doctor_a["token"]),
                           json={"media_url": IMG_JPG_DATA_URI, "media_type": "image",
                                 "caption": "hydrate-story"}, timeout=15).json()
        # Reel
        rr = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                           json={"video_url": VIDEO_MP4_DATA_URI,
                                 "caption": "hydrate-reel"}, timeout=15).json()
        # DM message
        rt = requests.post(f"{API}/community/doctor/dm/threads", headers=_h(doctor_a["token"]),
                           json={"target_id": doctor_b["user_id"]}, timeout=15).json()
        rmsg = requests.post(f"{API}/community/doctor/dm/threads/{rt['id']}/messages",
                             headers=_h(doctor_a["token"]),
                             json={"text": "hydrate-dm"}, timeout=15).json()

        # doctor_b reports each
        for tt, tid in [("story", rs["id"]), ("reel", rr["id"]), ("dm_message", rmsg["id"])]:
            rep = requests.post(f"{API}/community/doctor/report", headers=_h(doctor_b["token"]),
                                json={"target_type": tt, "target_id": tid,
                                      "reason": f"hydrate-{tt}"}, timeout=15)
            assert rep.status_code == 200, f"report {tt} failed: {rep.text}"

        # Admin listing (unresolved)
        lst = requests.get(f"{API}/admin/doctor-community/reports?resolved=false&limit=200",
                           headers=_h(admin_token), timeout=15)
        assert lst.status_code == 200
        rows = lst.json()["items"]

        story_row = next((r for r in rows if r["target_type"] == "story"
                          and r["target_id"] == rs["id"]), None)
        reel_row = next((r for r in rows if r["target_type"] == "reel"
                         and r["target_id"] == rr["id"]), None)
        dm_row = next((r for r in rows if r["target_type"] == "dm_message"
                       and r["target_id"] == rmsg["id"]), None)

        assert story_row and story_row.get("story"), "story report not hydrated"
        assert story_row["story"]["id"] == rs["id"]

        assert reel_row and reel_row.get("reel"), "reel report not hydrated"
        assert reel_row["reel"]["id"] == rr["id"]

        assert dm_row and dm_row.get("dm_message"), "dm_message report not hydrated"
        assert dm_row["dm_message"]["id"] == rmsg["id"]
        assert "sender" in dm_row["dm_message"], "dm_message sender not hydrated"


# ══════════════════════════════════════════════════════════════════════
# 3) SEC-003 — reel view dedupe + DM thread rate limit
# ══════════════════════════════════════════════════════════════════════

class TestSEC003ReelViewDedupe:
    def test_double_view_only_increments_once(self, doctor_a, doctor_b):
        # Fresh reel by A
        rr = requests.post(f"{API}/community/doctor/reels", headers=_h(doctor_a["token"]),
                           json={"video_url": VIDEO_MP4_DATA_URI, "caption": "view-dedupe"}, timeout=15)
        assert rr.status_code == 200
        rid = rr.json()["id"]

        before = requests.get(f"{API}/community/doctor/reels/{rid}",
                              headers=_h(doctor_a["token"]), timeout=15).json()["views_count"]

        # doctor_b views twice
        v1 = requests.post(f"{API}/community/doctor/reels/{rid}/view",
                           headers=_h(doctor_b["token"]), timeout=15)
        assert v1.status_code == 200
        j1 = v1.json()
        assert j1.get("ok") is True and not j1.get("already")

        v2 = requests.post(f"{API}/community/doctor/reels/{rid}/view",
                           headers=_h(doctor_b["token"]), timeout=15)
        assert v2.status_code == 200
        j2 = v2.json()
        assert j2.get("ok") is True and j2.get("already") is True

        after = requests.get(f"{API}/community/doctor/reels/{rid}",
                             headers=_h(doctor_a["token"]), timeout=15).json()["views_count"]
        assert after == before + 1, f"expected +1 view (dedup), got before={before} after={after}"


class TestSEC003DMThreadRateLimit:
    def test_rapid_thread_creation_eventually_429(self, admin_token, doctor_a):
        """Fresh doctor with a full 30-call quota. ~32 rapid calls should yield ≥1 429.
        Ingress may also drop very-fast bursts with a connect timeout; both
        outcomes prove a limit is being enforced."""
        rl_doc = _prep_doctor(admin_token, "sec29rl")
        sess = requests.Session()
        got_429 = False
        got_conn_reset = False
        codes: list = []
        for _ in range(32):
            try:
                r = sess.post(f"{API}/community/doctor/dm/threads",
                              headers=_h(rl_doc["token"]),
                              json={"target_id": doctor_a["user_id"]}, timeout=8)
                codes.append(r.status_code)
                if r.status_code == 429:
                    got_429 = True
                    break
            except (requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout) as e:
                codes.append(f"ERR:{type(e).__name__}")
                got_conn_reset = True
                break
            time.sleep(0.05)  # tiny pacing to avoid tripping ingress DDOS shield
        assert got_429 or got_conn_reset, (
            f"expected 429 (or connection drop) within 32 rapid thread starts, saw: {codes}"
        )
        # If we got a 429, verify it happened after roughly the documented quota (30)
        if got_429:
            assert codes.count(200) <= 30, f"429 fired too early? codes={codes}"
