# Online Vaidhyaji — Full-fledged AYUSH Health Tech Platform (PRD)

## Vision
India's first pure AI-powered AYUSH platform that patients open *daily* — not just when sick. Every screen drives either **engagement** (blogs, tips, streaks, diet plans, chatbot) or **revenue** (consultations, medicine shop, lab tests). Tagline: *Swasth Raho Hamesha — Ab AI ke saath.*

## Revenue streams (all live in-app)
1. **Doctor consultations** — book across 5 AYUSH specialties, mock payment sheet, video call
2. **AYUSH medicine shop** — 8 seeded SKUs (Chyawanprash, Ashwagandha, Triphala, Kumkumadi Tailam, Tulsi, Mahanarayan Oil, Brahmi Ghrita, Hingvastak Churna) with add-to-cart, sticky checkout bar, mock order
3. **Lab tests at home** — 5 seeded tests (CBC, HbA1c, Wellness Panel, Thyroid, D+B12) with slot picker and booking
4. **(Post-MVP)** medicine subscriptions, premium doctor plans, personalised herb plans

## Patient engagement (drives daily-open rate)
- **AI Vaidhyaji chatbot** (Claude Sonnet 4.5) — symptom checker
- **AI Diet Plan** — FREE generator: pick goal + dosha + veg/non-veg → Claude returns a full-day AYUSH meal plan; plans persist per user for revisit
- **Daily AYUSH tip** on home + wellness feed
- **AYUSH Journal (blogs)** — articles on Ayurveda, remedies, yoga, nutrition
- **Community challenges** with streaks & badges (Prana Master / Agni Ignitor / Nidra Guardian)
- **Support-chat** floating bubble (lead-gen bot even for logged-out visitors)
- **Push notifications** (Emergent-managed) — daily tip, appointment reminders, order updates
- **Bilingual** English + हिन्दी with auto device-locale detect

## Doctor experience (different from patients)
- Role-based routing: doctors see a **Vaidya workspace** on the home tab, not the patient home
- **First-time onboarding wizard** (4 steps): specialty + qualification → **AYUSH registration number + degree upload** (mocked) → experience + fee + languages → clinic + bio
- Admin verifies documents in the admin panel — verified badge shows on patient profile for trust
- Workspace shows: verified status, today's / upcoming consultations, patient list with visit counts, **Write Rx** modal (diagnosis + medicines + notes) — the prescription flows to patient's Health Records vault
- One-tap **Join video call** for any appointment

## Admin panel
- Single admin seeded: `admin@vaidhyaji.com` / `Admin@123`
- Dashboard stats: patients, verified doctors, pending, appointments, today's consultations, leads
- Doctors: Approve / Reject / Remove / Add-manually with specialty picker
- Patients: history sheet showing all consultations + prescriptions
- Activity log: every event with actor + timestamp (audit trail)
- **Broadcast push** to all patients or all doctors (post-deploy)

## Push notifications (Emergent-managed)
- Backend `/api/register-push` and `send_push()` helper via SuprSend relay
- `EMERGENT_PUSH_KEY=placeholder` in env — replaced automatically at deployment
- Frontend `expo-notifications` wired: module-scope handler, Android channel, tap-through routing (warm + cold-start)
- **Requires Android google-services.json** and a native build (Expo Go doesn't deliver pushes)

## Stack
- **Backend:** FastAPI + Motor (MongoDB) + JWT + bcrypt + emergentintegrations (Claude Sonnet 4.5) + httpx (push relay + Daily.co REST) — **97/97 tests passing** (17 new video tests added)
- **Frontend:** Expo Router (React Native), expo-notifications, expo-localization, react-native-webview (Daily.co video), custom bento UI, Feather icons
- **i18n:** en + hi dictionary in `/app/frontend/src/i18n.tsx`
- **Design:** Deep Forest Green #0F4C36 + Terracotta #D9663D + Warm Sand + ॐ motif + serif headings

## Real integrations (live)
1. **Claude Sonnet 4.5** via Emergent LLM Key — AI Vaidhyaji chatbot + Diet plan generation
2. **Daily.co video consultations** (WebView + Daily Prebuilt) — real HD video/audio, screen-share, in-call chat. Domain: `onlinevaidya.daily.co`. API key in `/app/backend/.env` as `DAILY_API_KEY`.
   - `POST /api/video/session` → creates/fetches room + issues meeting token (owner=doctor, guest=patient)
   - `GET /api/video/embed/{room_name}` → HTML page hosting themed Daily Prebuilt iframe
   - Handles Daily's "room already exists" (HTTP 400) for rejoin idempotency
   - iOS/Android camera + mic permissions declared in `app.json`

## Still mocked / pending
- **Razorpay payments** (`/app/frontend/app/plan-checkout.tsx`) — awaiting user's Razorpay Key ID + Secret
- **OTP verification** — any 4-6 digit code accepted (backend mock)
- **Push notifications on device** — needs `google-services.json` + native build via Publish

## Deploy notes for the user
1. Click **Publish** (top-right) → deploy backend + frontend
2. To enable push: attach `google-services.json` from Firebase console (Project settings → Android app matching `com.emergent.vaidhyaji`) to `/app/frontend/google-services.json`. Deployment pipeline swaps `EMERGENT_PUSH_KEY` placeholder for the real key.
3. Generate iOS + Android builds from the Publish panel to install on real devices via Expo Go / test flight

## Session log (Jun 2026)
- **Iteration 6:** Deployment health-check → fixed CORS_ORIGINS env + N+1 aggregation on `/api/admin/patients`
- **Iteration 7-8:** Daily.co video integration complete — 17/17 real-API tests pass. Fixed room-already-exists 400/409 dual handling.
- **Next up (user requested "continue tomorrow"):**
  - 💳 Razorpay real payment integration (needs credentials from user)
  - 🔔 Firebase `google-services.json` for push after Publish
  - 🎥 End-to-end 2-device video call verification on real phones


## Session log (Jun 2026 · cont.)
- **Iteration 34:** Google Sign-in added to **/auth/login** and the **Doctor** tab of /signup. Extracted Emergent-auth flow into a reusable `useGoogleAuth` hook + `GoogleButton` component (`src/hooks/useGoogleAuth.ts`, `src/components/GoogleButton.tsx`). Returning Google users can now log in from the main Sign-in screen; SEC-002 (session_id URL scrub) is preserved.

## Phase 1c — Welcome Email (Jun 2026)
- **Iteration 35:** Bilingual (EN + Hinglish) transactional welcome email via **Emergent-managed Resend**. New module `/app/backend/emails.py` with:
  - Full guardrail gate (`_assert_safe_email`) enforcing G1–G5.
  - Branded HTML templates for patients (with optional Prakriti + kit) and doctors.
  - `send_welcome_email_bg(user)` fire-and-forget wrapper — signup never blocks or fails on email issues.
  - Idempotent: writes `welcome_email_sent_at` on the user doc to avoid duplicate sends.
- Wired into `/auth/register` (patient + doctor), `/auth/phone/verify-otp` (new users), `/auth/session` (Google new users), and `/quiz/submit` (backfill for phone-only signups that later add email).
- Live send verified against Emergent Resend proxy (`delivered@resend.dev` returns a delivery ID).
- New tests: `tests/test_welcome_email.py` (8/8 pass). Full suite: 88/88 pass.

## Security audit — Iteration 36 (Jun 2026)
Read-only audit of Iterations 34–35 (Google sign-in hook + Welcome Email) returned **no critical/high findings**. Applied three P3 hardening fixes:
- **SEC-001a:** `/api/quiz/submit` now rate-limited per user (30 / hour) via `rate_limit(f"quiz:submit:{user['id']}")`.
- **SEC-001b:** `welcome_email_sent_at` claimed atomically via compare-and-set BEFORE dispatch; rolled back if the send fails so legitimate retries succeed.
- **SEC-002:** Recipient email addresses masked in failure logs (`a***@example.com`) via new `_mask_email` helper.
- **SEC-003:** Doctor tab shows a bilingual hint below the Google button steering new doctors to the Register form so we can capture and verify their AYUSH registration number.
- Hardening: `send_welcome_email_bg` now retains a strong task-set reference + wraps the body in try/except (no more "task exception never retrieved" warnings).
- New regression suite: `tests/test_iter36_security_fixes.py` (7/7 pass). Total: 52/52 pass across the touched surface.

## Iteration 37 — Multi-feature drop + P0 security fix (Jun 2026)
Shipped four features in one iteration plus an audit-driven P0 hardening.
- **Prakriti Report Email**: new bilingual (EN + Hi) post-quiz report with dosha bars, idempotent per user via `prakriti_email_sent_at` compare-and-set. Wired into `/quiz/submit`.
- **Twilio SMS OTP (with graceful mock fallback)**: new module `/app/backend/otp_sender.py`. Direct Twilio REST API via httpx + HTTP Basic auth (no SDK dep). Falls back to a mock provider when Twilio env vars are empty. Phone masked in logs. Random OTP on the Twilio path via `secrets.randbelow`. `.env` has empty `TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM` placeholders — paste real creds to go live instantly.
- **Doctor Availability Badge**: new `POST /api/doctors/heartbeat` (doctor-only, role-gated + per-user rate-limited). Computed `is_online` field surfaced on the public doctor projection with `last_seen_at` stripped. Frontend: `AvailabilityDot` component + auto-heartbeat every 60s from `doctor/home.tsx` + green dot on each doctor card in the patient consult tab.
- **Light modular refactor**: OTP send logic extracted into `otp_sender.py` (mirrors the `emails.py` pattern) — server.py is now more focused; the pattern for future extractions is established.

### P0 fix from post-ship security audit
- Auditor flagged: with `OTP_MOCK_ENABLED=true` and Twilio blank, a live deployment would ship a fixed `123456` OTP echoed in the API response — enabling account takeover.
- Fix: introduced `APP_ENV` env var (default `development`). When `APP_ENV=production`, `OTP_MOCK_ENABLED` is HARD-DISABLED regardless of the env value. Mock branch also requires `not IS_PRODUCTION`.
- Added a loud `warning: "TEST MODE — do not use…"` field to every mock-mode send-otp response.
- Tests: `tests/test_iter37_security_fixes.py` (4/4 pass). Full touched suite: **136/136 pass**.
