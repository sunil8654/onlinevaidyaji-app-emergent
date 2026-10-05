import type { Appointment } from "@/src/api";

/**
 * `appointments.appointment_date` + `appointment_time` are the real indexed
 * MySQL columns. The `slot` string that older code read is a JSON-blob field
 * with no index and, for website-created rows, an empty placeholder - parsing
 * it produced `Invalid Date` and made every appointment look like it was in the
 * past (or the future). Always build the date from the two real columns.
 */
export function appointmentDate(a: {
  appointment_date?: string | null;
  appointment_time?: string | null;
}): Date | null {
  const date = (a.appointment_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = (a.appointment_time || "").slice(0, 8);
  const d = new Date(`${date}T${/^\d{2}:\d{2}/.test(time) ? time : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isUpcoming(a: Appointment, now = Date.now()): boolean {
  const d = appointmentDate(a);
  return !!d && d.getTime() >= now;
}

export function isPast(a: Appointment, now = Date.now()): boolean {
  const d = appointmentDate(a);
  return !!d && d.getTime() < now;
}

/** Midnight today, so "is this on today's list" is a calendar-day question. */
export function startOfToday(now: Date | number = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isToday(a: Appointment, now: Date | number = Date.now()): boolean {
  const d = appointmentDate(a);
  if (!d) return false;
  const today = startOfToday(now);
  const day = startOfToday(d.getTime());
  return day === today;
}

/** "Today" / "Tomorrow" / "12 Sep", built from the real date column. */
export function formatApptDay(a: Appointment, now: Date | number = Date.now()): string {
  const d = appointmentDate(a);
  if (!d) return "Date unavailable";
  const today = startOfToday(now);
  const day = startOfToday(d.getTime());
  if (day === today) return "Today";
  if (day === today + 86_400_000) return "Tomorrow";
  if (day === today - 86_400_000) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** "10:30 AM", built from the real time column. */
export function formatApptTime(a: Appointment): string {
  const d = appointmentDate(a);
  if (!d) return "";
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export const APPT_STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Real enum is online|offline - the old `mode === "video"` check never matched. */
export function formatApptType(a: Appointment): string {
  if (a.type === "online") return "Online consult";
  if (a.type === "offline") return "Clinic visit";
  return "Consultation";
}

export function formatApptStatus(a: Appointment): string {
  const s = (a.status || "").toLowerCase();
  return APPT_STATUS_LABEL[s] || (a.status ? a.status : "Unknown");
}

export function rupeesFromPaise(paise: number | null | undefined): string {
  return `₹${(Math.round(paise || 0) / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
}

/** The soonest future appointment, or null. */
export function nextAppointment(list: Appointment[]): Appointment | null {
  let best: Appointment | null = null;
  let bestT = Infinity;
  for (const a of list) {
    const d = appointmentDate(a);
    if (!d) continue;
    const t = d.getTime();
    if (t >= Date.now() && t < bestT) {
      best = a;
      bestT = t;
    }
  }
  return best;
}
