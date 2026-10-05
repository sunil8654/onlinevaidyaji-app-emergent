# Doctor Feature Parity — Website vs App

Audit of the shared `onlinevaidyaji` MySQL database, the website backend, the app
backend (`backend/server.py`), and the app screens (`frontend/app/`).

**Rule enforced throughout:** the app talks only to the app backend, and both
backends read and write the *same* MySQL rows. Every field below is a real column
in the shared schema, not an app-only copy.

---

## 1. Shared schema (verified against the live database)

All tables the website's doctor section uses already exist in the shared DB. Row
counts are 0 for the consultation/chat/verification tables, so there is no legacy
data to migrate or reconcile.

| Table | Columns | Used by website | Used by app today |
|---|---|---|---|
| `doctors` | `id, user_id, slug, specialization_id, system, gender, qualification, experience, consultation_fee, about, bio, languages, city, is_available_online, is_available_offline, rating, review_count, is_approved, is_restricted, restriction_reason` | profile | profile (now full parity) |
| `users` | `name, email, phone, image` | profile | profile (now full parity) |
| `appointments` | `status ENUM(pending,confirmed,completed,cancelled)`, `type ENUM(online,offline)`, `appointment_date`, `appointment_time`, `symptoms` | full lifecycle | create/list only |
| `appointment_slots` | `doctor_id, day_of_week, date, start_time, end_time, is_available` | full weekly CRUD | **read-only** |
| `consultation_rooms` | `appointment_id, room_id, doctor_id, patient_id, type, status` | auto-created on confirm | **unused** |
| `messages` | `room_id, sender_id, sender_role, message_type, content, file_url, file_name, file_size, is_read, read_at` | chat | **unused for patients** (community DMs only) |
| `video_sessions` | `appointment_id, room_id, doctor_id, patient_id, status, started_at, ended_at, duration_seconds` | start/end/history | **unused** |
| `doctor_verifications` | `doctor_id, document_type, document_path, status, notes, verified_at` | upload + admin review | **unused (fake filenames)** |
| `notifications` | `user_id, title, message, type, related_id, related_type, is_read` | list/read/read-all | community-scoped only |
| `doctor_status` | `doctor_id, status ENUM(online,offline,busy), last_seen` | socket-driven | **read-only** |

No table aliasing conflicts: consultation rooms use the `consult_` room-id prefix,
while community DMs use UUID thread ids in the same `messages` table.

---

## 2. Gap analysis

### Already at parity (completed earlier)
- Doctor profile read/write across `users` + `doctors`, slug regeneration, phone
  uniqueness, website-compatible system taxonomy.
- Public doctor profile and bookable slots (30-min, date-specific overrides
  recurring, booked slots excluded).
- Booking with mode validation, real `symptoms`/`appointment_date`/`appointment_time`.
- Consultation fee pricing with no invented amounts.

### Gaps — backend

| # | Feature | Website | App today | Fix |
|---|---|---|---|---|
| 1 | Appointment lifecycle | `PUT /api/appointments/:id` with `status ∈ {confirmed,completed,cancelled}`; room created on confirm | No status endpoint at all; status frozen at `confirmed` on create | Add `PUT /api/appointments/{id}/status` with ownership checks, room creation on confirm, cancellation notifications |
| 2 | Booking default status | Creates `pending` | Creates `confirmed` | Keep `confirmed` (paid-in-advance flow) but make transitions explicit and shared |
| 3 | Consultation rooms | `GET /api/consultations/rooms`, auto-creates for confirmed appointments | Absent | Add rooms list + lazy creation, doctor- and patient-scoped |
| 4 | Patient chat | `GET /api/consultations/:roomId/messages`, socket `chat:*` | Absent (community DMs are doctor↔doctor only) | Add REST messages list/send/mark-read on the real `messages` table |
| 5 | Video sessions | `POST /api/consultations/video/start`, `/end`, `GET /video/history/:appointmentId` → `video_sessions` | App uses Daily.co and stores no session record | Record start/end/history in `video_sessions` so the website sees it |
| 6 | Doctor documents | `POST/GET /api/doctors/documents`, admin status + `notes` | Absent; onboarding sends fake filenames `degree_certificate.pdf` | Add real upload/list on `doctor_verifications`, expose status + rejection notes + re-upload |
| 7 | Notifications | `GET /api/notifications`, `PUT /:id/read`, `PUT /read-all` on the shared table | Only `/community/doctor/notifications` (gated, community verified) | Add general notifications feed + per-item read, ungated, for doctors and patients |
| 8 | Weekly slot CRUD | `GET/POST/PUT/DELETE /api/slots` on `appointment_slots`, `is_available` toggle | `doctors.weekly_schedule` JSON blob; `appointment_slots` never written | Add slot CRUD on the real table, with overlap prevention and copy/apply-to-all |
| 9 | Presence status | socket sets `doctor_status` = online/busy/offline | Heartbeat writes `doctors.last_seen_at`; `doctor_status` never written | Add `PUT /api/doctor/status` writing the real `doctor_status` row |
| 10 | Doctor dashboard | Stats: today, active consultations, total, completed, approval banner | Stats computed client-side; no active-consultation or approval aggregate | Add `GET /api/doctor/dashboard` |

### Gaps — app screens

| Feature | Screen today | Gap |
|---|---|---|
| Appointment actions | `app/doctor/appointments-list.tsx` read-only | No confirm/cancel/complete; no API existed |
| Consultations | none | No list, no patient chat |
| Documents | `app/doctor/onboarding.tsx` toggles a flag and sends fake filenames | No real upload, status, or rejection reason UI |
| Notifications | `app/doctor/community/notifications.tsx` (community only) | No general inbox, no per-item read |
| Availability | `app/doctor/availability.tsx` writes the JSON blob | Not the shared slot table; no overlap prevention |
| Presence | heartbeat in `app/doctor/home.tsx:47-53` | Doctor shows offline while on any other screen |
| Routing | login sends doctors to `/doctor/home` (`app/auth/login.tsx:39,69,91`) | Standalone stack with no tab bar; appointments/patients screens unreachable from there |

---

## 3. Data rules compliance

- **No overwrite with empty/null.** Every update is a partial `$set`; absent
  fields are never sent, and blank text is normalised to `None` rather than `""`.
- **IDs stay consistent.** All reads and writes go through the shared
  `doctors.id` / `users.id`; no surrogate profile is created.
- **No data loss on the way out.** Slot and availability writes target
  `appointment_slots` rows; the legacy `weekly_schedule` blob is preserved, not
  deleted, until it is genuinely superseded.
- **Admin-owned fields stay read-only**: `is_approved`, `is_restricted`,
  `restriction_reason`, `rating`, `review_count`.
