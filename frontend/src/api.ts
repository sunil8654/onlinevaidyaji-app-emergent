// Thin API client for Online Vaidhyaji backend.
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "vaidhyaji.token";

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function request<T = any>(
  path: string,
  method: Method = "GET",
  body?: any,
  auth: boolean = true
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
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

  // Admin — password reset moderation
  adminListPasswordResets: (status: "pending" | "approved" | "rejected" = "pending") =>
    request<{ items: any[] }>(`/admin/password-resets?status=${status}`),
  adminApprovePasswordReset: (reset_id: string, temp_password?: string) =>
    request<{ reset_id: string; email: string; name: string; temp_password: string; message: string }>(
      `/admin/password-resets/${reset_id}/approve`, "POST", { temp_password: temp_password || null }),
  adminRejectPasswordReset: (reset_id: string) =>
    request<{ ok: boolean }>(`/admin/password-resets/${reset_id}/reject`, "POST"),

  getPatientProfile: () => request("/patient/profile"),
  savePatientProfile: (body: any) => request("/patient/profile", "PUT", body),

  listDoctors: (specialty?: string) =>
    request(`/doctors${specialty && specialty !== "All" ? `?specialty=${specialty}` : ""}`, "GET", undefined, false),
  getDoctor: (id: string) => request(`/doctors/${id}`, "GET", undefined, false),

  bookAppointment: (body: { doctor_id: string; slot: string; reason?: string }) =>
    request("/appointments", "POST", body),
  listAppointments: () => request("/appointments"),

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

  // Medicines shop
  listMedicines: (category?: string) => request(`/medicines${category && category !== "all" ? `?category=${category}` : ""}`, "GET", undefined, false),
  getMedicine: (id: string) => request(`/medicines/${id}`, "GET", undefined, false),
  orderMedicines: (items: { medicine_id: string; qty: number }[], address?: string) =>
    request("/medicines/order", "POST", { items, address }),
  myMedicineOrders: () => request("/medicines/orders/mine"),

  // Lab tests
  listLabTests: () => request("/lab-tests", "GET", undefined, false),
  getLabTest: (id: string) => request(`/lab-tests/${id}`, "GET", undefined, false),
  bookLabTest: (body: { lab_test_id: string; slot: string; address?: string }) =>
    request("/lab-tests/book", "POST", body),
  myLabBookings: () => request("/lab-tests/bookings/mine"),

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

  // Doctor workspace
  doctorMe: () => request("/doctor/me"),
  doctorOnboard: (body: any) => request("/doctor/onboard", "PUT", body),
  updateDoctorProfile: (body: {
    specialty?: string; qualification?: string; experience_years?: number;
    languages?: string[]; consultation_fee?: number; bio?: string;
    clinic_name?: string; clinic_address?: string; avatar_base64?: string;
  }) => request<any>("/doctor/profile", "PUT", body),
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
  doctorMyAppointments: () => request("/doctor/my-appointments"),
  doctorMyPatients: () => request("/doctor/my-patients"),
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
  submitQuiz: (id: string, answers: number[]) => request<{
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

  docComReport: (target_type: "post" | "comment", target_id: string, reason: string) =>
    request<{ ok: boolean; already: boolean }>("/community/doctor/report", "POST", { target_type, target_id, reason }),

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
};
