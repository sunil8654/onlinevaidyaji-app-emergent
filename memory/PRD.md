# Online Vaidhyaji — PRD (MVP + Admin panel + Bilingual + Support AI)

## Vision
India's first AI-powered AYUSH (Ayurveda, Homoeopathy, Yoga, Unani, Siddha) daily wellness + consultation platform. Tagline: *Swasth Raho Hamesha — Ab AI ke saath.*

## MVP Features (Shipped)
### Patient side
- Splash + onboarding with bilingual copy + language toggle
- Role selection (Patient / Vaidya)
- JWT auth (register, login) — mocked OTP screen after register
- Patient health profile (age, gender, **dosha**: Vata / Pitta / Kapha, conditions)
- Home with **ॐ** namaste greeting, daily AYUSH tip, bento CTAs, upcoming consultation, community-challenges strip, **floating support-chat bubble**
- **AI Vaidhyaji chatbot** (Claude Sonnet 4.5) — session-persisted symptom checker
- Doctor discovery (only verified doctors) with specialty filter, doctor detail + slot picker
- Mock-payment sheet before booking → mock video-call screen (mic/cam/end)
- **Health Records vault** — prescriptions (from consultations) + lab reports (add/delete)
- Medicine reminders CRUD
- Community challenges (streaks + badges)
- Bilingual **English / हिन्दी** (auto-detect device locale + manual toggle in profile)

### Doctor side
- Self sign-up with AYUSH registration number; profile enters admin approval queue as `verified=false`
- Doctors are hidden from patient discovery until admin approves

### Admin panel (new)
- Seeded admin: `admin@vaidhyaji.com` / `Admin@123`
- On login, admin auto-routes to `/admin/dashboard`
- **Dashboard:** stats (patients, verified/pending doctors, appointments, today's consultations, leads) + recent activity feed
- **Doctors:** filter all/pending/verified · **Approve / Reject / Remove / Add** (manual add)
- **Patients:** list with appointment counts · tap to see full consultation history
- **Activity log:** every important event with actor + timestamp + metadata

### Support / lead-gen (new)
- **Support AI chat** (`/support-chat`) — public, no login needed
- Separate Claude prompt: answers app FAQs and gently collects name + phone/email for follow-up
- Leads auto-saved to `/api/admin/leads`; visible in admin panel
- Floating headphones bubble on Home + menu entry in profile

## Backend endpoints (grouped)
- **Auth:** /auth/register · /auth/login · /auth/me
- **Patient:** /patient/profile GET/PUT
- **Doctors (public):** /doctors, /doctors/{id}
- **Appointments:** /appointments CRUD + /appointments/{id}/pay + /appointments/{id}/prescription
- **Reminders:** /reminders CRUD
- **Feed:** /feed, /daily-tip
- **Challenges:** /challenges, /challenges/join
- **Prescriptions:** /prescriptions
- **Reports:** /reports CRUD
- **Chat (AYUSH):** /chat/message, /chat/history/{sid}
- **Support / lead-gen:** /support/chat, /support/lead
- **Admin:** /admin/stats · /admin/doctors (list/create/approve/reject/delete/edit) · /admin/patients (+ /appointments) · /admin/activity · /admin/leads
- **Analytics:** /analytics

## Stack
- Backend: FastAPI + Motor + JWT + bcrypt + emergentintegrations (Claude Sonnet 4.5) — 58/58 tests passing
- Frontend: Expo Router (React Native), custom bento UI, Feather icons, expo-localization
- i18n: en + hi dictionary in `/app/frontend/src/i18n.tsx`
- Design: Deep Forest Green #0F4C36 + Terracotta #D9663D + Warm Sand + ॐ motif

## Post-MVP Ideas
- Real OTP (Twilio), real payments (Razorpay/Stripe), real video (Agora/Twilio Video)
- Full doctor calendar / availability engine
- Push notifications (Emergent-managed)
- Rate-limiting anonymous support chat
- Route-level admin dashboard on the web
