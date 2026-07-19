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

  track: (event: string, props?: any) => request("/analytics", "POST", { event, props }),
};
