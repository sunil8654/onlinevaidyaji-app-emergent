// Thin API client for Online VaidyaJi backend.
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "vaidyaji.token";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Public doctor as rendered by the Book Consultation cards and the
 *  Doctor Full Profile screen. Every field is a real column on `doctors` or a
 *  real join; `null`/absent means "not recorded", never a placeholder. */
export type Doctor = {
  id: string;
  name: string;
  slug?: string | null;
  specialty?: string;
  specialization?: { id: number | null; name: string } | null;
  specializations?: { id: number; name: string; icon?: string | null }[];
  qualification?: string | null;
  experience?: number | null;
  experience_years?: number | null;
  languages?: string[];
  consultation_fee?: number | null;
  about?: string | null;
  bio?: string | null;
  gender?: string | null;
  avatar_url?: string;
  image?: string;
  rating?: number | null;
  reviews?: number | null;
  review_count?: number | null;
  verified?: boolean;
  is_available?: boolean;
  is_available_online?: boolean;
  is_available_offline?: boolean;
  consultation_mode?: string;
  system?: string;
  city?: string | null;
  is_online?: boolean;
  status?: string;
};

export type ConsultationMode = "online" | "offline" | "both" | "none";

/** Taxonomy for the profile editor, mirroring the website's public endpoints. */
export type SpecializationOption = { id: number; name: string; icon?: string | null };
export type CityOption = { id: number; name: string; state?: string | null };

export type ProfileTaxonomy = {
  specializations: SpecializationOption[];
  systems: string[];
};

/**
 * The signed-in doctor's own record, as returned by GET /doctor/me.
 *
 * These are the website's real MySQL columns (`users.*` + `doctors.*`), so the
 * edit screen renders exactly what the public profile page shows and every save
 * round-trips through the shared database.
 */
export type DoctorOwnProfile = {
  id: string;
  user_id: string;
  slug: string | null;
  // users table
  name: string;
  email: string;
  phone: string;
  image: string | null;
  avatar_url: string | null;
  // doctors table
  specialization_id: number | null;
  specialty: string | null;
  specializations: { id: number; name: string; icon?: string | null }[];
  system: string | null;
  gender: string | null;
  qualification: string | null;
  experience: number;
  experience_years: number;
  consultation_fee: number | null;
  about: string | null;
  bio: string | null;
  /** Comma-separated, as stored in `doctors.languages`. */
  languages: string | null;
  city: string | null;
  is_available_online: boolean;
  is_available_offline: boolean;
  consultation_mode: ConsultationMode;
  // admin-owned, read-only here
  is_approved: boolean;
  verified: boolean;
  is_restricted: boolean;
  restriction_reason: string | null;
  rating: number;
  review_count: number;
  status: string;
  last_seen: string | null;
  // app-only extras with no website column
  clinic_name: string | null;
  clinic_address: string | null;
  registration_number: string | null;
  onboarded_at: string | null;
  documents_uploaded: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** Fields the doctor may change. Admin-owned columns are deliberately absent. */
export type DoctorProfilePayload = {
  name?: string;
  phone?: string;
  image?: string;
  avatar_base64?: string;
  about?: string;
  bio?: string;
  qualification?: string;
  experience?: number;
  consultation_fee?: number;
  /** Accepts a list or a comma-separated string. */
  languages?: string[] | string;
  city?: string;
  gender?: "male" | "female";
  system?: string;
  specialization_id?: number;
  specializations?: number[];
  is_available_online?: boolean;
  is_available_offline?: boolean;
  clinic_name?: string;
  clinic_address?: string;
  registration_number?: string;
};

/** One bookable slot, mirroring the website's `generateTimeSlots` output. */
export type DoctorSlot = {
  /** "HH:MM:SS" - matches `appointments.appointment_time`. */
  time: string;
  /** "9:00 AM" - website's 12-hour format, no leading zero. */
  label: string;
  /** Local ISO datetime for the chosen day. */
  iso: string;
  is_booked: boolean;
};

export type DoctorSlotDay = {
  doctor_id: string;
  date: string;
  slots: DoctorSlot[];
  total: number;
  available: number;
};

/** Paginated envelope returned by GET /doctors. */
export type DoctorPage = {
  items: Doctor[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
};

/**
 * The signed-in patient's own record: the `users` row plus their
 * `patient_profiles` health row. Every field here is a real column - there is
 * deliberately no DOB/city/state because `patient_profiles` has no such
 * columns, and inventing them would mean the screen silently discards saves.
 */
export type PatientProfile = {
  id: string;
  user_id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Raw `users.image`, either a relative /uploads path or an absolute URL. */
  image?: string | null;
  /** `image` resolved to something an <Image> can load. */
  photo_url?: string | null;
  role?: string;
  is_verified?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  address?: string | null;
  age?: number | null;
  gender?: string | null;
  dosha?: string | null;
  conditions?: string[] | null;
  lifestyle?: string | null;
};

export type PatientProfilePayload = {
  age?: number | null;
  gender?: string | null;
  dosha?: string | null;
  conditions?: string | null;
  lifestyle?: string | null;
  address?: string | null;
};

/** Identity fields, changed through PATCH /patient/account. */
export type PatientAccount = {
  id: string;
  name: string;
  email: string;
  phone: string;
  image: string | null;
  avatar_url?: string | null;
  address?: string | null;
};

/** One appointment row as rendered by the Appointments tab. */
export type Appointment = {
  id: string;
  doctor_id?: string;
  doctor_name?: string;
  doctor_specialty?: string;
  doctor_image?: string | null;
  /** `appointments.patient_id` is an INT column, so this arrives as a number. */
  patient_id?: string | number;
  /** Live `users.name`, preferred over the booking-time snapshot. */
  patient_name?: string;
  appointment_date: string;
  appointment_time: string;
  type?: string;
  status?: string;
  reason?: string | null;
  fee?: number | null;
  payment_status?: string | null;
  /** Real payment state, resolved server-side from the `payments` table. */
  paid?: boolean;
  amount_paise?: number;
  has_prescription?: boolean;
  prescription?: string | null;
};

/** Envelope returned by GET /appointments when `page` is supplied. */
export type AppointmentPage = {
  items: Appointment[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
};

/** One unique patient in GET /doctor/my-patients. */
export type DoctorPatientRow = {
  patient_id: string;
  patient_name: string;
  total_visits: number;
  /** "YYYY-MM-DD HH:MM:SS" derived from the indexed date/time columns. */
  last_visit: string | null;
  has_rx: boolean;
};

/** Envelope returned by GET /doctor/my-patients. */
export type DoctorPatientPage = {
  items: DoctorPatientRow[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
};

/** Real AYUSH pharmacy catalogue row (`pharmacy_products` + `product_reviews`). */
export type Medicine = {
  id: string;
  name: string;
  brand?: string | null;
  unit?: string | null;
  price?: number | null;
  mrp?: number | null;
  image_url?: string | null;
  avg_rating?: number | null;
  total_ratings?: number | null;
  stock_quantity?: number | null;
  description?: string | null;
};

/** Real diagnostic catalogue row (`lab_tests`). */
export type LabTest = {
  id: string;
  name: string;
  category?: string | null;
  price?: number | null;
  description?: string | null;
  turnaround?: string | null;
  fasting?: boolean | null;
  preparation?: string | null;
};

/** A request that never settles leaves a spinner up forever. */
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * In-flight GET deduplication.
 *
 * Several screens fetch the same endpoint from more than one effect (a first
 * load plus a refresh, a tab plus a header badge), and React does not cancel
 * the superseded request. Keying by method+path+token lets the later caller
 * await the promise already in the air instead of opening a second socket.
 */
const inFlight = new Map<string, Promise<unknown>>();

async function request<T = any>(
  path: string,
  method: Method = "GET",
  body?: any,
  auth: boolean = true,
  opts: { timeoutMs?: number; dedupe?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let token = "";
  if (auth) {
    token = (await storage.secureGet<string>(TOKEN_KEY, "")) || "";
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const dedupe = opts.dedupe ?? method === "GET";
  // Keyed by the actual token, not a bare "auth" flag: if a logout/login swap
  // happens while a request is still in the air, the new patient must not be
  // handed the previous patient's response for the same path. A bare flag
  // collapsed every authenticated user into one key. The token is only ever a
  // transient in-memory key (entries are deleted in `finally`), never logged.
  const authKey = token ? token : "anon";
  const key = dedupe ? `${method} ${path} ${authKey}` : "";
  const existing = key ? inFlight.get(key) : undefined;
  if (existing) return existing as Promise<T>;

  const run = (async () => {
    // React Native's fetch has no timeout of its own; without this a dropped
    // connection on a hospital wifi leaves the UI spinning indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    try {
      const res = await fetch(`${BASE}/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const raw = await res.text();
      let data: any = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          // A proxy or an HTML error page can reach us instead of JSON.
          throw new Error(
            `Unexpected response from server (HTTP ${res.status}). Please try again.`
          );
        }
      }
      if (!res.ok) {
        const msg = data?.detail || data?.message || `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return data as T;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error("The request timed out. Please check your connection.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (key) inFlight.delete(key);
    }
  })();

  if (key) inFlight.set(key, run);
  return run;
}

export const api = {
  register: (payload: {
    name: string;
    email: string;
    password: string;
    role: "patient" | "doctor";
    phone?: string;
    registration_number?: string;
  }) => request("/auth/register", "POST", payload, false),
  login: (payload: { email: string; password: string }) =>
    request<{ token: string; user: any; must_change_password?: boolean }>("/auth/login", "POST", payload, false),
  me: () => request("/auth/me"),

  requestPasswordReset: (email: string) =>
    request<{ message: string }>("/auth/request-password-reset", "POST", { email }, false),
  changePassword: (new_password: string, confirm_password: string) =>
    request<{ ok: boolean; message: string }>("/auth/change-password", "POST", { new_password, confirm_password }),

  // ── Onboarding funnel (Phase 1a) ─────────────────────────────
  onboardingConfig: () => request<{
    callback_sla_minutes: number;
    whatsapp_number: string;
    whatsapp_url: string;
    tagline: string;
    brand: string;
    kit_catalog: Record<string, { en: string; hi: string }>;
  }>("/onboarding/config", "GET", undefined, false),

  sendPhoneOtp: (phone: string) =>
    request<{
      ok: boolean;
      message: string;
      provider?: string;
      /** How the OTP was actually delivered. Absent only on hard failure. */
      channel?: "whatsapp" | "sms" | "mock";
      /** Present only in non-production mock mode; the code is always random. */
      dev_hint?: string;
      warning?: string;
    }>("/auth/phone/send-otp", "POST", { phone }, false),
  verifyPhoneOtp: (payload: { phone: string; otp: string; name?: string; email?: string; role?: "patient" | "doctor" }) =>
    request<{ token: string; user: any; is_new: boolean }>("/auth/phone/verify-otp", "POST", payload, false),
  appleAuth: (identity_token: string, full_name?: string | null, email?: string | null) =>
    request<{ token: string; user: any; is_new: boolean }>(
      "/auth/apple",
      "POST",
      { identity_token, full_name, email },
      false,
    ),
  googleAuth: (id_token: string) =>
    request<{ token: string; user: any; is_new: boolean }>(
      "/auth/google",
      "POST",
      { id_token },
      false,
    ),

  updateMe: (body: {
    preferred_language?: "en" | "hi";
    call_preference?: "video" | "phone";
    name?: string;
    email?: string;
    phone?: string;
  }) => request<{ ok: boolean; user?: any }>("/users/me", "PATCH", body),

  submitQuiz: (body: {
    answers: Record<string, "A" | "B" | "C">;
    health_concern: string;
    age_group: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  }) => request<{
    id: string;
    prakriti: string;
    dosha_scores: { vata: number; pitta: number; kapha: number };
    description: { line1: string; line2: string; line3: string };
    recommended_kit: { id: string; name: string };
    language: "en" | "hi";
    free_consult_available: boolean;
    callback_sla_minutes: number;
  }>("/quiz/submit", "POST", {
    // Hard-fallback: ensure answers is always a serializable object so JSON.stringify
    // never drops it (undefined state on some devices caused a 422 in the field before).
    answers: body.answers && typeof body.answers === "object" ? body.answers : {},
    health_concern: body.health_concern,
    age_group: body.age_group,
    utm_source: body.utm_source,
    utm_medium: body.utm_medium,
    utm_campaign: body.utm_campaign,
  }),

  myQuizResult: () => request<any>("/quiz/mine"),

  // ── Health Documents (Phase 1b) ──────────────────────────────
  listMyDocuments: () => request<{ items: any[]; total: number }>("/documents/mine"),
  deleteDocument: (doc_id: string) => request<{ deleted: boolean }>(`/documents/${doc_id}`, "DELETE"),
  documentDownloadUrl: (doc_id: string, token: string) =>
    `${BASE}/api/files/${doc_id}?token=${encodeURIComponent(token)}`,
  uploadDocument: async (file: { uri: string; name: string; mimeType: string }, doc_type: string, user_note?: string) => {
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    const form = new FormData();
    if (typeof window !== "undefined" && !(process as any)?.env?.EXPO_OS) {
      // web
      const blob = await (await fetch(file.uri)).blob();
      form.append("file", blob, file.name);
    } else {
      // native
      form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as any);
    }
    form.append("doc_type", doc_type);
    if (user_note) form.append("user_note", user_note);
    const res = await fetch(`${BASE}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },  // NO Content-Type
      body: form as any,
    });
    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok) throw new Error((data && (data.detail || data.message)) || `HTTP ${res.status}`);
    return data;
  },

  // ── Admin Pre-Sales Queue (Phase 1b) ─────────────────────────
  adminPresalesLeads: (status?: string) =>
    request<{ items: any[]; stats: any }>(`/admin/presales/leads${status ? `?status=${status}` : ""}`),
  adminUpdateLeadStatus: (lead_id: string, body: { status: string; agent_name?: string; note?: string }) =>
    request<{ ok: boolean }>(`/admin/presales/leads/${lead_id}/status`, "PATCH", body),
  adminPresalesCsvUrl: () => `${BASE}/api/admin/presales/leads.csv`,
  adminPendingDocuments: (status?: string) =>
    request<{ items: any[] }>(`/admin/documents/pending${status ? `?status=${status}` : ""}`),
  adminReviewDocument: (doc_id: string, body: { decision: "approve" | "reupload"; assigned_doctor_id?: string; review_note?: string }) =>
    request<{ ok: boolean; status: string }>(`/admin/documents/${doc_id}/review`, "PATCH", body),

  // Admin — password reset moderation
  adminListPasswordResets: (status: "pending" | "approved" | "rejected" = "pending") =>
    request<{ items: any[] }>(`/admin/password-resets?status=${status}`),
  adminApprovePasswordReset: (reset_id: string, temp_password?: string) =>
    request<{ reset_id: string; email: string; name: string; temp_password: string; message: string }>(
      `/admin/password-resets/${reset_id}/approve`, "POST", { temp_password: temp_password || null }),
  adminRejectPasswordReset: (reset_id: string) =>
    request<{ ok: boolean }>(`/admin/password-resets/${reset_id}/reject`, "POST"),

  getPatientProfile: () => request<PatientProfile>("/patient/profile"),
  savePatientProfile: (body: PatientProfilePayload) =>
    request<PatientProfile>("/patient/profile", "PUT", body),
  /** Account-level fields. `email` is only editable while still unset. */
  updatePatientAccount: (body: {
    name?: string; phone?: string; email?: string; address?: string;
    image_base64?: string; remove_photo?: boolean;
  }) => request<PatientAccount>("/patient/account", "PATCH", body),

  // Book Consultation directory. The backend filters by medical system / city
  // in SQL and only returns approved, non-restricted doctors, so the app never
  // downloads the whole table. `system` accepts the legacy `specialty` value so
  // older builds keep filtering correctly.
  listDoctors: (params?: {
    system?: string;
    specialty?: string;
    city?: string;
    q?: string;
    page?: number;
    page_size?: number;
  }) => {
    const p = new URLSearchParams();
    const system = params?.system ?? params?.specialty;
    if (system && system !== "All") p.set("system", system);
    if (params?.city && params.city !== "All Cities") p.set("city", params.city);
    if (params?.q) p.set("q", params.q);
    if (params?.page) p.set("page", String(params.page));
    if (params?.page_size) p.set("page_size", String(params.page_size));
    const qs = p.toString();
    return request<DoctorPage>(`/doctors${qs ? `?${qs}` : ""}`, "GET", undefined, false);
  },

  // Distinct systems + cities for the filter chips, so the UI never hardcodes a
  // list that drifts from the database.
  listDoctorFilters: () =>
    request<{ systems: string[]; cities: string[] }>("/doctors/filters", "GET", undefined, false),
  getDoctor: (id: string) => request<Doctor>(`/doctors/${id}`, "GET", undefined, false),
  /** Real bookable slots for one day, straight from `appointment_slots`. */
  getDoctorSlots: (id: string, date: string) =>
    request<DoctorSlotDay>(
      `/doctors/${encodeURIComponent(id)}/slots?date=${encodeURIComponent(date)}`,
      "GET", undefined, false,
    ),
  doctorHeartbeat: () =>
    request<{ ok: boolean; last_seen_at: string; window_seconds: number }>(
      "/doctors/heartbeat", "POST",
    ),

  bookAppointment: (body: {
    doctor_id: string;
    /** "YYYY-MM-DD HH:MM" - a slot the doctor actually published. */
    slot: string;
    type?: "online" | "offline";
    symptoms?: string;
    reason?: string;
  }) => request("/appointments", "POST", body),
  /**
   * Paginated appointment history.
   *
   * The bare `/appointments` call returns a plain array (kept for older builds)
   * but it is capped server-side, so a patient with a long history silently
   * lost the tail of their own records. Sending `page` switches the endpoint to
   * the `{items, total, page, limit, has_more}` envelope; `scope` is resolved in
   * SQL by the server, not by downloading everything and filtering on device.
   */
  listAppointmentsPaged: (params: {
    page?: number;
    limit?: number;
    /** "all" = past + future. Omit to keep the legacy mixed ordering. */
    scope?: "all" | "upcoming" | "past";
    status?: string;
  } = {}) => {
    const p = new URLSearchParams();
    p.set("page", String(params.page ?? 1));
    p.set("limit", String(params.limit ?? 20));
    if (params.scope) p.set("scope", params.scope);
    if (params.status) p.set("status", params.status);
    return request<AppointmentPage>(`/appointments?${p.toString()}`);
  },

  createReminder: (body: any) => request("/reminders", "POST", body),
  listReminders: () => request("/reminders"),
  deleteReminder: (id: string) => request(`/reminders/${id}`, "DELETE"),

  feed: () => request("/feed", "GET", undefined, false),
  dailyTip: () => request("/daily-tip", "GET", undefined, false),

  listChallenges: () => request("/challenges"),
  joinChallenge: (challenge_id: string) => request("/challenges/join", "POST", { challenge_id }),

  chat: (session_id: string, message: string) =>
    request("/chat/message", "POST", { session_id, message }),
  chatHistory: (session_id: string) => request(`/chat/history/${session_id}`),

  // DEPRECATED: use createPaymentOrder + verifyPayment instead. Kept for
  // backward-compat with old clients; server now returns 410.
  payAppointment: (id: string) => request(`/appointments/${id}/pay`, "POST"),
  addPrescription: (id: string, body: {
    diagnosis: string;
    medicines?: string;
    notes?: string;
    medicines_structured?: {
      name: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions?: string;
    }[];
    symptoms?: string;
    advice?: string;
    follow_up?: string;
  }) =>
    request(`/appointments/${id}/prescription`, "POST", body),
  listPrescriptions: () => request("/prescriptions"),

  addReport: (body: { title: string; kind?: string; date?: string; notes?: string; image_base64?: string }) =>
    request("/reports", "POST", body),
  listReports: () => request("/reports"),
  deleteReport: (id: string) => request(`/reports/${id}`, "DELETE"),

  // Admin
  adminStats: () => request("/admin/stats"),
  adminDoctors: (verify_status?: "pending" | "verified") =>
    request(`/admin/doctors${verify_status ? `?verify_status=${verify_status}` : ""}`),
  adminApproveDoctor: (id: string) => request(`/admin/doctors/${id}/approve`, "POST"),
  adminRejectDoctor: (id: string) => request(`/admin/doctors/${id}/reject`, "POST"),
  adminDeleteDoctor: (id: string) => request(`/admin/doctors/${id}`, "DELETE"),
  adminAddDoctor: (body: any) => request("/admin/doctors", "POST", body),
  adminPatients: () => request("/admin/patients"),
  adminPatientAppointments: (id: string) => request(`/admin/patients/${id}/appointments`),
  adminActivity: (limit = 100) => request(`/admin/activity?limit=${limit}`),
  adminLeads: () => request("/admin/leads"),

  // Support / lead-gen
  supportChat: (session_id: string, message: string) =>
    request("/support/chat", "POST", { session_id, message }, false),
  createLead: (body: { name: string; contact: string; goal?: string }) =>
    request("/support/lead", "POST", body, false),

  // AYUSH pharmacy. The catalogue is real website inventory, so browsing is
  // honest; ordering is deliberately NOT exposed here. `orderMedicines` used to
  // write an app document straight into the website's `orders` table with a
  // placeholder order_id and status='pending' - no payment, no dispatch - so the
  // bag is browse-only until a real fulfilment partner is wired up.
  listMedicines: (category?: string) => request<Medicine[]>(`/medicines${category && category !== "all" ? `?category=${category}` : ""}`, "GET", undefined, false),
  getMedicine: (id: string) => request<Medicine>(`/medicines/${id}`, "GET", undefined, false),

  // Lab tests. Same rule as the pharmacy: the catalogue is real, booking is not.
  listLabTests: (category?: string) =>
    request<LabTest[]>(`/lab-tests${category && category !== "all" ? `?category=${category}` : ""}`, "GET", undefined, false),
  getLabTest: (id: string) => request<LabTest>(`/lab-tests/${id}`, "GET", undefined, false),

  // Blogs
  listBlogs: () => request("/blogs", "GET", undefined, false),
  getBlog: (id: string) => request(`/blogs/${id}`, "GET", undefined, false),

  // Diet plan
  generateDietPlan: (body: { goal: string; dosha?: string; conditions?: string[]; vegetarian?: boolean; duration_days?: number; structured?: boolean }) =>
    request("/diet-plan", "POST", body),
  myDietPlans: () => request("/diet-plans"),
  prakritiAssess: (body: { answers: ("V" | "P" | "K")[]; age?: number; gender?: string }) =>
    request<{
      vata: number; pitta: number; kapha: number;
      dominant: string; secondary: string | null; dosha: string;
      description: string; traits: string[]; balance: string;
      assessed_at: string;
    }>("/prakriti/assess", "POST", body),

  // Yoga library
  yogaLibrary: (params?: { category?: string; dosha?: string; level?: string }) => {
    const q = new URLSearchParams();
    if (params?.category && params.category !== "All") q.set("category", params.category);
    if (params?.dosha) q.set("dosha", params.dosha);
    if (params?.level) q.set("level", params.level);
    const qs = q.toString();
    return request<{
      items: {
        id: string; title: string; category: string; level: string;
        duration_min: number; dosha_target: string[]; language: string;
        premium: boolean; thumbnail: string; instructor: string;
      }[];
      categories: string[];
      levels: string[];
      recommended: { id: string; title: string; category: string; level: string; duration_min: number; dosha_target: string[]; language: string; premium: boolean; thumbnail: string; instructor: string; }[];
      dosha: string | null;
      total: number;
    }>(`/yoga/library${qs ? "?" + qs : ""}`);
  },
  yogaSession: (id: string) => request<{
    id: string; title: string; category: string; level: string; duration_min: number;
    dosha_target: string[]; language: string; premium: boolean;
    video_url: string; youtube_id: string; thumbnail: string; instructor: string;
    benefits: string[];
    poses: { name: string; duration_sec: number; cue: string }[];
  }>(`/yoga/sessions/${id}`),
  yogaLog: (body: { session_id: string; completed_seconds: number; total_seconds: number; completed_poses: number }) =>
    request("/yoga/log", "POST", body),
  yogaMine: () => request<{
    sessions: any[];
    streak_days: number;
    total_minutes: number;
    total_sessions: number;
  }>("/yoga/mine"),

  listSpecializations: () => request<ProfileTaxonomy>("/specializations"),
  listCities: () => request<{ cities: CityOption[] }>("/cities"),

// Doctor workspace
  doctorMe: () => request<DoctorOwnProfile>("/doctor/me"),
  doctorOnboard: (body: any) => request("/doctor/onboard", "PUT", body),
  updateDoctorProfile: (body: DoctorProfilePayload) =>
    request<DoctorOwnProfile>("/doctor/profile", "PUT", body),
  doctorGetAvailability: () => request<{
    is_available: boolean;
    consultation_mode: "online" | "offline" | "both";
    weekly_schedule: Record<string, string[]>;
    slot_duration_min: number;
    notes: string;
  }>("/doctor/availability"),
  doctorSetAvailability: (body: {
    is_available?: boolean;
    consultation_mode?: "online" | "offline" | "both";
    weekly_schedule?: Record<string, string[]>;
    slot_duration_min?: number;
    notes?: string;
  }) => request<any>("/doctor/availability", "PUT", body),
  doctorMyAppointments: (params: {
    page?: number;
    limit?: number;
    scope?: "all" | "upcoming" | "past" | "today";
    status?: string;
    /** "asc" = soonest first (upcoming lists). Defaults per `scope` server-side. */
    order?: "asc" | "desc";
  } = {}) => {
    const p = new URLSearchParams();
    p.set("page", String(params.page ?? 1));
    p.set("limit", String(params.limit ?? 20));
    if (params.scope) p.set("scope", params.scope);
    if (params.status) p.set("status", params.status);
    if (params.order) p.set("order", params.order);
    return request<AppointmentPage>(`/doctor/my-appointments?${p.toString()}`);
  },
  doctorMyPatients: (params: { page?: number; limit?: number } = {}) => {
    const p = new URLSearchParams();
    p.set("page", String(params.page ?? 1));
    p.set("limit", String(params.limit ?? 20));
    return request<DoctorPatientPage>(`/doctor/my-patients?${p.toString()}`);
  },
  doctorEarnings: () => request<{
    total_paise: number;
    month_paise: number;
    week_paise: number;
    today_paise: number;
    consultations: number;
    daily: { date: string; amount_paise: number }[];
    recent: {
      razorpay_payment_id: string | null;
      amount_paise: number;
      verified_at: string | null;
      patient_name: string;
      appointment_id: string;
      appointment_slot: string | null;
    }[];
  }>("/doctor/earnings"),
  doctorPatientHistory: (patient_id: string) => request<{
    patient: {
      id: string; name: string; email?: string; phone?: string;
      age?: number; gender?: string; dosha?: string;
      conditions?: string[]; lifestyle?: string;
    };
    stats: {
      total_visits: number;
      total_prescriptions: number;
      total_paid_paise: number;
      first_visit: string | null;
      last_visit: string | null;
    };
    appointments: any[];
  }>(`/doctor/patients/${patient_id}/history`),

  // Push
  registerPush: (body: { user_id: string; platform: string; device_token: string }) =>
    request("/register-push", "POST", body, false),

  // Video (Daily.co)
  createVideoSession: (body: { appointment_id?: string; doctor_id?: string; duration_minutes?: number }) =>
    request<{ room_url: string; room_name: string; token: string; embed_url: string; is_owner: boolean; exp: number; user_name: string }>("/video/session", "POST", body),

  // Payments (Razorpay)
  createPaymentOrder: (body: { amount: number; currency?: string; purpose: string; reference_id?: string; description?: string }) =>
    request<{ order_id: string; amount: number; currency: string; receipt: string; key_id: string; purpose: string; reference_id: string | null }>("/payments/create-order", "POST", body),
  verifyPayment: (body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string; purpose?: string; reference_id?: string }) =>
    request<{ success: boolean; razorpay_payment_id: string; purpose: string; reference_id: string | null }>("/payments/verify", "POST", body),
  myPayments: () => request("/payments/mine"),

  // Admin broadcast
  adminBroadcast: (body: { title: string; message: string; audience: string }) =>
    request("/admin/broadcast", "POST", body),

  // Wellness Dashboard v2
  wellnessLog: (body: {
    type: "bmi" | "weight" | "sleep" | "steps" | "bp" | "sugar" | "mood" | "water";
    value?: number;
    systolic?: number;
    diastolic?: number;
    fasting?: number;
    post_meal?: number;
    height_cm?: number;
    weight_kg?: number;
    note?: string;
    date?: string;
    member_id?: string;
  }) => request("/wellness/log", "POST", body),
  wellnessHistory: (type?: string, days = 30, member_id?: string) => {
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    q.set("days", String(days));
    if (member_id) q.set("member_id", member_id);
    return request<{ items: any[]; days: number }>(`/wellness/history?${q.toString()}`);
  },
  wellnessDashboard: (member_id?: string) =>
    request<{ latest: Record<string, any | null>; weekly: Record<string, any[]>; health_score: number }>(
      `/wellness/dashboard${member_id ? `?member_id=${member_id}` : ""}`
    ),
  wellnessDelete: (log_id: string) => request(`/wellness/log/${log_id}`, "DELETE"),

  // Family Health
  addFamilyMember: (body: {
    name: string; relation: string; gender?: string; dob?: string;
    blood_group?: string; conditions?: string[]; allergies?: string[]; avatar_url?: string;
  }) => request("/family/members", "POST", body),
  listFamilyMembers: () => request<{ items: any[] }>("/family/members"),
  getFamilyMember: (id: string) => request<any>(`/family/members/${id}`),
  updateFamilyMember: (id: string, body: any) => request(`/family/members/${id}`, "PUT", body),
  deleteFamilyMember: (id: string) => request(`/family/members/${id}`, "DELETE"),
  addGrowthEntry: (id: string, body: {
    date?: string; height_cm?: number; weight_kg?: number; head_circ_cm?: number; note?: string;
  }) => request(`/family/members/${id}/growth`, "POST", body),
  addVaccination: (id: string, body: {
    vaccine: string; scheduled_date?: string; given_date?: string; dose?: string; notes?: string;
  }) => request(`/family/members/${id}/vaccination`, "POST", body),
  deleteVaccination: (id: string, entry_id: string) =>
    request(`/family/members/${id}/vaccination/${entry_id}`, "DELETE"),
  deleteGrowth: (id: string, entry_id: string) =>
    request(`/family/members/${id}/growth/${entry_id}`, "DELETE"),
  getMilestones: (id: string) => request<{ age_months: number | null; groups: any[] }>(`/family/members/${id}/milestones`),
  toggleMilestone: (id: string, text: string, done: boolean) =>
    request(`/family/members/${id}/milestones/toggle`, "POST", { text, done }),

  // Women's Health
  logPeriod: (body: {
    start_date: string; end_date?: string; cycle_length?: number;
    flow?: "light" | "normal" | "heavy"; symptoms?: string[];
    mood?: "happy" | "calm" | "anxious" | "sad" | "irritable"; notes?: string;
  }) => request("/women/period-log", "POST", body),
  listCycles: (limit = 12) =>
    request<{ cycles: any[]; next_period_predicted: string | null; fertile_window: any }>(`/women/cycles?limit=${limit}`),
  deletePeriod: (log_id: string) => request(`/women/period-log/${log_id}`, "DELETE"),
  setPregnancy: (body: { is_active: boolean; lmp_date?: string; notes?: string }) =>
    request("/women/pregnancy", "PUT", body),
  getPregnancy: () => request<any>("/women/pregnancy"),
  upsertGynae: (body: {
    pcos?: boolean; pcod?: boolean; conditions?: string[];
    surgeries?: string[]; medications?: string[]; notes?: string;
  }) => request("/women/gynae-profile", "PUT", body),
  getGynae: () => request<any>("/women/gynae-profile"),
  wellnessTips: (phase: string) => request<{ phase: string; tips: string[] }>(`/women/wellness-tips?phase=${phase}`),

  // Community
  createPost: (body: { content: string; hashtags?: string[]; image_base64?: string; is_question?: boolean }) =>
    request("/community/posts", "POST", body),
  listPosts: (params?: { hashtag?: string; is_question?: boolean; limit?: number; before?: string }) => {
    const q = new URLSearchParams();
    if (params?.hashtag) q.set("hashtag", params.hashtag);
    if (params?.is_question !== undefined) q.set("is_question", String(params.is_question));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.before) q.set("before", params.before);
    return request<{ items: any[] }>(`/community/posts?${q.toString()}`);
  },
  getPost: (id: string) => request<any>(`/community/posts/${id}`),
  togglePostLike: (id: string) => request<{ liked: boolean }>(`/community/posts/${id}/like`, "POST"),
  addComment: (id: string, text: string) => request(`/community/posts/${id}/comments`, "POST", { text }),
  listComments: (id: string) => request<{ items: any[] }>(`/community/posts/${id}/comments`),
  deletePost: (id: string) => request(`/community/posts/${id}`, "DELETE"),
  listHashtags: () => request<{ items: { tag: string; count: number }[] }>("/community/hashtags"),

  // Engagement
  engagementMe: () => request<{
    points: number; streak_current: number; streak_max: number;
    streak_last_date: string | null;
    level: { level: number; title: string; next_at: number | null; next_title: string | null; progress_pct: number };
    badges: { key: string; title: string; desc: string; icon: string; points: number; earned: boolean; earned_at: string | null }[];
    badges_earned: number; badges_total: number;
    history: { reason: string; points: number; meta?: any; at: string }[];
  }>("/engagement/me"),
  engagementCheckin: () => request<{
    already_checked_in: boolean; streak_current: number; streak_max: number;
    points_awarded: number; new_badges?: string[];
  }>("/engagement/checkin", "POST"),

  // Quizzes
  listQuizzes: () => request<{
    id: string; title: string; category: string; description: string;
    image_url: string; duration_min: number; points: number;
    questions_count: number; best_score: number; attempted: boolean;
  }[]>("/quizzes"),
  getQuiz: (id: string) => request<{
    id: string; title: string; category: string; description: string;
    image_url: string; duration_min: number; points: number;
    questions: { q: string; options: string[] }[];
  }>(`/quizzes/${id}`),
  submitQuizAttempt: (id: string, answers: number[]) => request<{
    score: number; total: number; pct: number; points_awarded: number;
    details: { q: string; picked: number; correct: number; ok: boolean; explain: string }[];
    new_badges?: string[];
    already_attempted?: boolean;
  }>(`/quizzes/${id}/submit`, "POST", { answers }),

  track: (event: string, props?: any) => request("/analytics", "POST", { event, props }),

  // ── Doctor Community (verified doctors only) ────────────────────
  docComAccess: () => request<{ has_access: boolean; reason?: string }>("/community/doctor/access"),
  docComFeed: (before?: string) => request<any[]>(`/community/doctor/feed${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  docComExplore: (specialty?: string) => request<any[]>(`/community/doctor/explore${specialty && specialty !== "All" ? `?specialty=${encodeURIComponent(specialty)}` : ""}`),
  docComSearch: (q: string) => request<{ doctors: any[]; hashtags: any[]; posts: any[] }>(`/community/doctor/search?q=${encodeURIComponent(q)}`),
  docComSuggest: () => request<any[]>("/community/doctor/suggest"),
  docComByHashtag: (tag: string) => request<any[]>(`/community/doctor/hashtag/${encodeURIComponent(tag)}`),

  docComCreatePost: (body: {
    images?: string[]; caption?: string; hashtags?: string[];
    specialty_tag?: string; clinical_flag?: boolean;
  }) => request<any>("/community/doctor/posts", "POST", body),
  docComGetPost: (post_id: string) => request<any>(`/community/doctor/posts/${post_id}`),
  docComDeletePost: (post_id: string) => request<{ deleted: boolean }>(`/community/doctor/posts/${post_id}`, "DELETE"),
  docComLike: (post_id: string) => request<{ liked: boolean }>(`/community/doctor/posts/${post_id}/like`, "POST"),
  docComUnlike: (post_id: string) => request<{ liked: boolean }>(`/community/doctor/posts/${post_id}/like`, "DELETE"),
  docComSave: (post_id: string) => request<{ saved: boolean }>(`/community/doctor/posts/${post_id}/save`, "POST"),
  docComUnsave: (post_id: string) => request<{ saved: boolean }>(`/community/doctor/posts/${post_id}/save`, "DELETE"),
  docComListComments: (post_id: string) => request<any[]>(`/community/doctor/posts/${post_id}/comments`),
  docComAddComment: (post_id: string, text: string) => request<any>(`/community/doctor/posts/${post_id}/comments`, "POST", { text }),
  docComDeleteComment: (comment_id: string) => request<{ deleted: boolean }>(`/community/doctor/comments/${comment_id}`, "DELETE"),

  docComProfile: (doctor_id: string) => request<any>(`/community/doctor/profile/${doctor_id}`),
  docComProfilePosts: (doctor_id: string) => request<any[]>(`/community/doctor/profile/${doctor_id}/posts`),
  docComFollow: (target_id: string) => request<{ ok: boolean; already: boolean }>(`/community/doctor/follow/${target_id}`, "POST"),
  docComUnfollow: (target_id: string) => request<{ ok: boolean }>(`/community/doctor/follow/${target_id}`, "DELETE"),
  docComMyFollowers: () => request<any[]>("/community/doctor/me/followers"),
  docComMyFollowing: () => request<any[]>("/community/doctor/me/following"),
  docComMySaved: () => request<any[]>("/community/doctor/me/saved"),

  docComNotifications: () => request<{ items: any[]; unread: number }>("/community/doctor/notifications"),
  docComReadNotifications: () => request<{ ok: boolean }>("/community/doctor/notifications/read", "POST"),

  docComReport: (target_type: "post" | "comment" | "reel" | "story" | "dm_message", target_id: string, reason: string) =>
    request<{ ok: boolean; already: boolean }>("/community/doctor/report", "POST", { target_type, target_id, reason }),

  // Admin moderation for Phase B media
  adminHideReel: (reel_id: string, reason?: string) =>
    request<{ ok: boolean }>(`/admin/doctor-community/reels/${reel_id}/hide`, "POST", { reason: reason || "Removed by admin" }),
  adminUnhideReel: (reel_id: string) =>
    request<{ ok: boolean }>(`/admin/doctor-community/reels/${reel_id}/unhide`, "POST"),
  adminDeleteReel: (reel_id: string) =>
    request<{ deleted: boolean }>(`/admin/doctor-community/reels/${reel_id}`, "DELETE"),
  adminDeleteStory: (story_id: string) =>
    request<{ deleted: boolean }>(`/admin/doctor-community/stories/${story_id}`, "DELETE"),
  adminRedactDM: (message_id: string) =>
    request<{ ok: boolean; redacted: boolean }>(`/admin/doctor-community/dm/messages/${message_id}`, "DELETE"),

  // ── Vaidya Charcha Phase B — Stories / DMs / Reels ─────────────
  // Stories (24h)
  docComStoriesFeed: () => request<{ items: any[] }>("/community/doctor/stories/feed"),
  docComStoriesBy: (doctor_id: string) => request<{ author: any; stories: any[]; is_me: boolean }>(`/community/doctor/stories/by/${doctor_id}`),
  docComCreateStory: (body: { media_url: string; media_type?: "image" | "video"; caption?: string }) =>
    request<any>("/community/doctor/stories", "POST", body),
  docComViewStory: (story_id: string) => request<{ ok: boolean }>(`/community/doctor/stories/${story_id}/view`, "POST"),
  docComDeleteStory: (story_id: string) => request<{ deleted: boolean }>(`/community/doctor/stories/${story_id}`, "DELETE"),

  // DMs (1:1)
  docComDMThreads: () => request<{ items: any[]; unread_total: number }>("/community/doctor/dm/threads"),
  docComDMStart: (target_id: string) => request<any>("/community/doctor/dm/threads", "POST", { target_id }),
  docComDMMessages: (thread_id: string, before?: string) =>
    request<{ items: any[] }>(`/community/doctor/dm/threads/${thread_id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  docComDMSend: (thread_id: string, body: { text?: string; image_url?: string }) =>
    request<any>(`/community/doctor/dm/threads/${thread_id}/messages`, "POST", body),
  docComDMRead: (thread_id: string) => request<{ ok: boolean }>(`/community/doctor/dm/threads/${thread_id}/read`, "POST"),

  // Reels
  docComReelsFeed: (before?: string) =>
    request<{ items: any[] }>(`/community/doctor/reels/feed${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  docComReelsBy: (doctor_id: string) => request<{ items: any[] }>(`/community/doctor/reels/by/${doctor_id}`),
  docComGetReel: (reel_id: string) => request<any>(`/community/doctor/reels/${reel_id}`),
  docComCreateReel: (body: { video_url: string; thumbnail_url?: string; caption?: string; hashtags?: string[]; duration_sec?: number }) =>
    request<any>("/community/doctor/reels", "POST", body),
  docComReelLike: (reel_id: string) => request<{ liked: boolean }>(`/community/doctor/reels/${reel_id}/like`, "POST"),
  docComReelView: (reel_id: string) => request<{ ok: boolean }>(`/community/doctor/reels/${reel_id}/view`, "POST"),
  docComDeleteReel: (reel_id: string) => request<{ deleted: boolean }>(`/community/doctor/reels/${reel_id}`, "DELETE"),

  // Admin moderation
  adminDocComPin: (post_id: string) => request(`/admin/doctor-community/pin/${post_id}`, "POST"),
  adminDocComUnpin: (post_id: string) => request(`/admin/doctor-community/unpin/${post_id}`, "POST"),
  adminDocComHide: (post_id: string, reason: string) => request(`/admin/doctor-community/hide/${post_id}`, "POST", { reason }),
  adminDocComUnhide: (post_id: string) => request(`/admin/doctor-community/unhide/${post_id}`, "POST"),
  adminDocComBan: (doctor_id: string, reason: string) => request(`/admin/doctor-community/ban/${doctor_id}`, "POST", { reason }),
  adminDocComUnban: (doctor_id: string) => request(`/admin/doctor-community/unban/${doctor_id}`, "POST"),
  adminDocComReports: (resolved: boolean = false) => request<{ items: any[] }>(`/admin/doctor-community/reports?resolved=${resolved}`),
  adminDocComResolveReport: (id: string) => request(`/admin/doctor-community/reports/${id}/resolve`, "POST"),
  adminDocComBroadcast: (message: string) => request<any>("/admin/doctor-community/broadcast", "POST", { message }),

  // Admin — Staff / team management
  adminListStaff: () => request<any[]>("/admin/staff"),
  adminCreateStaff: (name: string, email: string, password: string) =>
    request<any>("/admin/staff", "POST", { name, email, password }),
  adminDeleteStaff: (user_id: string) => request<{ ok: boolean }>(`/admin/staff/${user_id}`, "DELETE"),
  adminResetStaffPassword: (user_id: string, new_password: string) =>
    request<{ ok: boolean; temp_password: string; message: string }>(`/admin/staff/${user_id}/reset-password`, "POST", { new_password }),

  // Admin — Patient CRUD
  adminGetPatient: (id: string) => request<any>(`/admin/patients/${id}`),
  adminUpdatePatient: (id: string, body: any) => request<any>(`/admin/patients/${id}`, "PUT", body),
  adminDeletePatient: (id: string) => request<{ ok: boolean }>(`/admin/patients/${id}`, "DELETE"),
  adminRestorePatient: (id: string) => request<{ ok: boolean }>(`/admin/patients/${id}/restore`, "POST"),

  // Admin — Doctor detail + full update
  adminGetDoctor: (id: string) => request<any>(`/admin/doctors/${id}`),
  adminUpdateDoctorFull: (id: string, body: any) => request<any>(`/admin/doctors/${id}/full`, "PUT", body),
};
