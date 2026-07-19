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
- **Backend:** FastAPI + Motor (MongoDB) + JWT + bcrypt + emergentintegrations (Claude Sonnet 4.5) + httpx (push relay) — **80/80 tests passing**
- **Frontend:** Expo Router (React Native), expo-notifications, expo-localization, custom bento UI, Feather icons
- **i18n:** en + hi dictionary in `/app/frontend/src/i18n.tsx`
- **Design:** Deep Forest Green #0F4C36 + Terracotta #D9663D + Warm Sand + ॐ motif + serif headings

## Deploy notes for the user
1. Click **Publish** (top-right) → deploy backend + frontend
2. To enable push: attach `google-services.json` from Firebase console (Project settings → Android app matching `com.emergent.vaidhyaji`) to `/app/frontend/google-services.json`. Deployment pipeline swaps `EMERGENT_PUSH_KEY` placeholder for the real key.
3. Generate iOS + Android builds from the Publish panel to install on real devices via Expo Go / test flight
