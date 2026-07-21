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
    request("/auth/login", "POST", payload, false),
  me: () => request("/auth/me"),

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

  payAppointment: (id: string) => request(`/appointments/${id}/pay`, "POST"),
  addPrescription: (id: string, body: { diagnosis: string; medicines: string; notes?: string }) =>
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
  generateDietPlan: (body: { goal: string; dosha?: string; conditions?: string[]; vegetarian?: boolean }) =>
    request("/diet-plan", "POST", body),
  myDietPlans: () => request("/diet-plans"),

  // Doctor workspace
  doctorMe: () => request("/doctor/me"),
  doctorOnboard: (body: any) => request("/doctor/onboard", "PUT", body),
  doctorMyAppointments: () => request("/doctor/my-appointments"),
  doctorMyPatients: () => request("/doctor/my-patients"),

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

  track: (event: string, props?: any) => request("/analytics", "POST", { event, props }),
};
