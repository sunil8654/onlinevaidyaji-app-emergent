# Web -> App porting reference

How to propagate a change made in the **website** into the **Expo mobile app**.
Written after auditing `OnlineVaidhyaJi.com/` (web) against `backend/` (app),
27 Sep 2026.

---

## 1. The one thing to understand

The two products share **only a MySQL database**. There is no shared code.

| | Web | App |
|---|---|---|
| Frontend | Next.js 14.2.3 (App Router, Tailwind) | Expo 57 / React Native, expo-router |
| Backend | Node + Express 4.19, raw SQL (`mysql2`) | Python FastAPI, `asyncmy` |
| DB access | hand-written SQL in `routes/*.js` | Mongo-style API over MySQL (`msdb.py`) |
| Port | 5000 | 8001 (local) |
| Env prefix | `NEXT_PUBLIC_*` | `EXPO_PUBLIC_*` |

Consequence: **a schema change on the web is a contract change for the app.** The
app never calls the web API, so nothing tells it a column appeared. The only
place that knowledge lives is `msdb.py`.

---

## 2. Current state: zero drift

Run the audit after any web schema change:

```
cd OnlineVaidhyaJi.com/backend
python audit_tables.py
```

Current result:

```
LIVE DB tables: 77
WEB dump tables: 77   (with seed data: 8)
APP msdb: 7 collection aliases, 7 column-mapped tables
```

- No app-only tables, no web-only tables. Schemas agree exactly.
- 70 tables are web-owned; the app reads them but only writes through the
  `data` JSON column.

---

## 3. The 7 mirrored collections (the real contract)

`msdb.py:70-78` — app collection name -> real table:

| App collection | Real table | Direction |
|---|---|---|
| `activity` | `audit_logs` | app writes |
| `support_messages` | `contact_messages` | app writes |
| `medicines` | `pharmacy_products` | **two-way** |
| `medicine_orders` | `orders` | **two-way** |
| `health_documents` | `prescription_uploads` | app writes |
| `doc_com_dm_messages` | `messages` | **two-way** |
| `doc_com_notifications` | `notifications` | **two-way** |

**If you change any of these 7 tables on the web, you must touch `msdb.py`.**
The other 70 tables are safe to change — the app will keep working through
`data` JSON.

### Field renames — the checklist

`msdb.py:93-111`. When the web renames a column, update the map, or app writes
silently stop reaching that column:

```python
"activity":                {"kind": "action", "actor_id": "user_id", "actor_name": "details"},
"support_messages":        {"session_id": "subject", "text": "message"},
"health_documents":        {"storage_path": "file_path"},
"doc_com_dm_messages":     {"thread_id": "room_id", "text": "content"},
"doc_com_notifications":   {"doctor_id": "user_id", "snippet": "message", "read": "is_read"},
"medicines":               {"price": ["sale_price", "mrp"]},
"doctors": {
    "experience_years": "experience",
    "reviews":          "review_count",
    "verified":         "is_approved",
    "languages":        [("languages", _join_langs)],
    "consultation_mode": [("is_available_online", ...), ("is_available_offline", ...)],
}
```

`doctors` is the highest-risk one — the app and web disagree on six field names
for the same row.

### Reads: `POST_READ_SYNTH`

`msdb.py:116-158`. Web-written rows have no `data` JSON, so the app synthesises
app-style fields from real columns. Two post-processors exist:

- `_synth_medicine` — derives `price` from `sale_price`/`mrp`
- `_synth_doctor` — derives `verified`, `experience_years`, `reviews`,
  `consultation_mode`, and defaults for `specialty`, `qualification`,
  `consultation_fee`, `bio`, `rating`, `avatar_url`

**A new required column on `doctors` or `pharmacy_products` needs a `setdefault`
added here** or app reads will `KeyError`.

---

## 4. API surfaces

- **Web backend**: 110 routes across 11 files (`backend/routes/*.js`)
  - `pharmacy.js` 47, `admin.js` 19, `auth.js` 9, `doctors.js` 6,
    `consultations.js` 5, `slots.js` 5, `contact.js` 5, `public.js` 4,
    `notifications.js` 4, `appointments.js` 3, `payments.js` 3
- **App backend**: 202 routes, 174 distinct paths (`backend/server.py`)

These are **independent implementations of overlapping features**. They are not
1:1 and must not be assumed to be — e.g. web has `POST /api/auth/login`
(email+password) while the app has `POST /api/auth/phone/verify-otp` (OTP).
Neither calls the other.

---

## 5. Web-only features with no app equivalent

If you build these on the web, decide whether the app needs them:

- Admin panel — 23 Next routes, 44 `/api/admin/*` endpoints
- Razorpay **Route** payouts (`razorpay_contact_id`, `razorpay_fund_account_id`,
  `transfer_logs` table) — marketplace onboarding, no app equivalent
- Blog via WordPress GraphQL (`NEXT_PUBLIC_WORDPRESS_API_URL`)
- SEO surface: `sitemap.ts`, `generateMetadata`, canonicals, robots
- Video consult: web uses **PeerJS/WebRTC**; app uses `expo-video`
- Realtime: web Socket.IO; app has no socket layer

---

## 6. Porting checklist

When a web change lands:

1. Run `audit_tables.py`. Any table moving between APP-ONLY and WEB-ONLY is a
   red flag.
2. If one of the **7 mirrored** tables changed, update `COLUMN_MAPS` and
   `POST_READ_SYNTH` in `msdb.py`.
3. If a **column** on `doctors`/`pharmacy_products` was added, add a `setdefault`
   to the matching `_synth_*`.
4. If an **enum** changed, check both sides. Known divergences:
   `users.role`, appointment status, prescription status.
5. Nothing is needed for the other 70 tables.

## 7. Environment names differ — do not cross-paste

| Web | App |
|---|---|
| `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME` | `MYSQL_HOST`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE` |
| `JWT_EXPIRY` | `JWT_EXPIRE_DAYS` |
| `SMTP_PASS` | `SMTP_PASSWORD` |
| `GOOGLE_CLIENT_ID` | `GOOGLE_AUDIENCES` |
| `NEXT_PUBLIC_API_URL` | `EXPO_PUBLIC_BACKEND_URL` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |

Both sides also use **different Google OAuth clients** (web `253550824519-…`,
app `333559780075-…`). Intentional, but do not "fix" it by accident.
