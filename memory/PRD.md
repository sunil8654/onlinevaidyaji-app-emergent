# Online Vaidhyaji — PRD (MVP)

## Vision
India's first AI-powered AYUSH (Ayurveda, Homoeopathy, Yoga, Unani, Siddha) daily wellness + consultation platform. Tagline: *Swasth Raho Hamesha — Ab AI ke saath.*

## MVP Features (Shipped)
1. **Onboarding + Role selection** (Patient / Doctor)
2. **JWT Auth** — Register, Login, /auth/me (OTP mocked for MVP)
3. **Patient health profile** — age, gender, dosha (Vata/Pitta/Kapha), conditions
4. **Home dashboard** — greeting, daily AYUSH tip (deterministic tip-of-day), bento grid CTAs, upcoming appointment, community challenges strip
5. **AI AYUSH Chatbot (AI Vaidhyaji)** — Claude Sonnet 4.5 via Emergent LLM Key, session-based history persisted in Mongo, suggestion chips
6. **Doctors** — listing with specialty filter (All/Ayurveda/Homoeopathy/Yoga/Unani/Siddha), doctor detail page with bio, rating, fee, slot picker
7. **Appointments** — booking against a doctor + slot; list "My appointments"
8. **Wellness feed** — filterable content (tips/remedies/yoga) with hero imagery
9. **Medicine reminders** — CRUD with time chips and notes
10. **Community challenges** — join + streak tracking, badges
11. **Profile** — dosha card, stats (streaks/badges), menu, sign-out
12. **Analytics events endpoint** — /api/analytics for visitor tracking

## Stack
- Backend: FastAPI + Motor (Mongo) + JWT + bcrypt + emergentintegrations (Anthropic Claude Sonnet 4.5)
- Frontend: Expo Router (React Native), custom bento UI, Feather icons
- Design: "Organic & Earthy" — Deep Forest Green #0F4C36 + Terracotta #D9663D + Warm Sand #F7F5F0

## Post-MVP Ideas (Not in scope now)
- Real OTP (Twilio) + doctor document verification workflow
- Real teleconsultation video (Agora/Twilio Video)
- Prescriptions & lab reports vault
- Payments (Stripe/Razorpay) for consultation fee
- Streaming chatbot responses (SSE)
