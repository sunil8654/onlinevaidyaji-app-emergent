import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api, type Doctor, type DoctorSlot } from "@/src/api";
import { RazorpayCheckout } from "@/src/components/RazorpayCheckout";
import { useAuth } from "@/src/auth";
import { formatINR } from "@/src/utils/currency";
import Feather from "@react-native-vector-icons/feather";

/** How many upcoming days the strip offers to look at. */
const DAY_WINDOW = 14;
/** Words to trim in the symptom box. */
const SYMPTOM_LIMIT = 500;

type DayOption = {
  key: string;       // "YYYY-MM-DD", the value the API expects
  dow: string;       // "Tue"
  dnum: string;      // "30"
  full: string;      // "Tomorrow" or "Thursday, 1 Oct"
};

type Mode = { key: "online" | "offline"; label: string; hint: string };

function upcomingDays(count: number): DayOption[] {
  const out: DayOption[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({
      key,
      dow: d.toLocaleDateString([], { weekday: "short" }),
      dnum: String(d.getDate()),
      full: i === 0 ? "Today" : i === 1 ? "Tomorrow"
        : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }),
    });
  }
  return out;
}

/** The fee as a number, or null when the doctor has no chargeable fee on file.
 *  Used to decide whether a payment step applies at all. */
function feeNum(fee: number | null | undefined): number | null {
  if (fee === null || fee === undefined || Number.isNaN(Number(fee))) return null;
  const n = Number(fee);
  return n > 0 ? n : null;
}

/** Formats a fee for display, or null when the doctor has no fee on file. */
function feeText(fee: number | null | undefined): string | null {
  if (fee === null || fee === undefined || Number.isNaN(Number(fee))) return null;
  const n = Number(fee);
  return n > 0 ? formatINR(n) : "Free";
}

export default function DoctorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [doc, setDoc] = useState<Doctor | null>(null);
  const [loadErr, setLoadErr] = useState("");

  const [days] = useState<DayOption[]>(() => upcomingDays(DAY_WINDOW));
  const [date, setDate] = useState<string>(days[0]?.key ?? "");
  const [slots, setSlots] = useState<DoctorSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsErr, setSlotsErr] = useState("");

  const [mode, setMode] = useState<"online" | "offline" | null>(null);
  const [symptoms, setSymptoms] = useState("");
  const [slot, setSlot] = useState<DoctorSlot | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // The appointment just created, awaiting payment. Null means "no payment
  // step" (either not booked yet, or the doctor has no fee on file).
  const [payFor, setPayFor] = useState<{ id: string; amount: number } | null>(null);

  // ---- profile ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getDoctor(String(id));
        if (!cancelled) { setDoc(d); setLoadErr(""); }
      } catch (e: any) {
        if (!cancelled) setLoadErr(e?.message || "Could not load this doctor.");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Consultation modes come from the doctor's real availability flags.
  const modes = useMemo<Mode[]>(() => {
    if (!doc) return [];
    const m: Mode[] = [];
    if (doc.is_available_online) m.push({ key: "online", label: "Online", hint: "Video consultation" });
    if (doc.is_available_offline) m.push({ key: "offline", label: "In-clinic", hint: "Visit the clinic" });
    return m;
  }, [doc]);

  // Derived rather than stored: the first real mode is the default, and a stale
  // selection (e.g. the doctor is offline-only) falls back automatically.
  const activeMode: "online" | "offline" | null =
    mode && modes.some((m) => m.key === mode) ? mode : modes[0]?.key ?? null;

  // ---- slots --------------------------------------------------------------
  useEffect(() => {
    if (!id || !date) return;
    let cancelled = false;
    (async () => {
      setSlotsLoading(true);
      setSlotsErr("");
      setSlot(null);
      try {
        const r = await api.getDoctorSlots(String(id), date);
        if (!cancelled) setSlots(r.slots ?? []);
      } catch (e: any) {
        if (!cancelled) { setSlots([]); setSlotsErr(e?.message || "Could not load availability."); }
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, date]);

  const freeSlots = useMemo(() => slots.filter((s) => !s.is_booked), [slots]);
  const feeNumValue = feeNum(doc?.consultation_fee);
  const fee = feeText(doc?.consultation_fee);
  const dayLabel = days.find((d) => d.key === date)?.full ?? date;
  const modeLabel = modes.find((m) => m.key === activeMode)?.label ?? "";
  const canBook = !!slot && !!activeMode && !busy;

  const book = useCallback(async () => {
    if (!slot || !activeMode) return;
    setBusy(true);
    setErr("");
    try {
      // The API wants "YYYY-MM-DD HH:MM"; the slot carries "HH:MM:SS".
      const created = await api.bookAppointment({
        doctor_id: String(id),
        slot: `${date} ${slot.time.slice(0, 5)}`,
        type: activeMode,
        symptoms: symptoms.trim() || undefined,
      });
      setReviewOpen(false);
      // Booking is done either way. When the doctor has a real fee on file,
      // the slot is only secured once it is paid, so take payment now. The
      // server re-reads the fee from the appointment and ignores ours, so a
      // tampered client amount cannot change what is charged.
      if (feeNumValue && created?.id) {
        setPayFor({ id: String(created.id), amount: feeNumValue });
      } else {
        setOk(true);
        setTimeout(() => router.replace("/appointments"), 1200);
      }
    } catch (e: any) {
      setErr(e?.message || "Could not book. Please sign in and try again.");
      setReviewOpen(false);
      // The slot may have just been taken by someone else; refresh the list.
      if (/no longer available/i.test(e?.message || "")) {
        try { setSlots((await api.getDoctorSlots(String(id), date)).slots ?? []); } catch {}
        setSlot(null);
      }
    } finally {
      setBusy(false);
    }
  }, [slot, activeMode, id, date, symptoms, feeNumValue, router]);

  // ---- states -------------------------------------------------------------
  if (loadErr) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.centerBox}>
          <Feather name="alert-circle" size={34} color={COLORS.error} />
          <Text style={styles.centerText}>{loadErr}</Text>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
            <Text style={styles.ghostBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!doc) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  const rating = typeof doc.rating === "number" && doc.rating > 0 ? doc.rating : null;
  const reviewCount = typeof doc.review_count === "number" ? doc.review_count : null;
  const languages = doc.languages ?? [];
  const specs = doc.specializations ?? [];
  const exp = doc.experience_years ?? doc.experience ?? null;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 150 }} keyboardShouldPersistTaps="handled">
        {/* ---------------- hero ---------------- */}
        <View style={styles.hero}>
          {doc.avatar_url || doc.image ? (
            <Image source={{ uri: doc.avatar_url || doc.image }} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.heroFallback]} />
          )}
          <View style={styles.heroOverlay} />
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="doctor-back">
            <Feather name="arrow-left" size={20} color={COLORS.surface} />
          </TouchableOpacity>

          <View style={styles.heroContent}>
            {doc.specialty ? (
              <View style={styles.specialtyPill}>
                <Text style={styles.specialtyText}>{doc.specialty.toUpperCase()}</Text>
              </View>
            ) : null}
            <Text style={styles.docName} testID="doctor-name">{doc.name}</Text>
            {doc.qualification ? <Text style={styles.docSub}>{doc.qualification}</Text> : null}

            <View style={styles.metaRow}>
              {rating !== null ? (
                <View style={styles.metaChip}>
                  <Feather name="star" size={12} color={COLORS.accent} />
                  <Text style={styles.metaText}>
                    {rating.toFixed(1)}{reviewCount !== null ? ` (${reviewCount})` : ""}
                  </Text>
                </View>
              ) : null}
              {languages.length ? (
                <View style={styles.metaChip}>
                  <Feather name="globe" size={12} color={COLORS.brand} />
                  <Text style={styles.metaText}>{languages.slice(0, 2).join(", ")}</Text>
                </View>
              ) : null}
              {doc.city ? (
                <View style={styles.metaChip}>
                  <Feather name="map-pin" size={12} color={COLORS.brand} />
                  <Text style={styles.metaText}>{doc.city}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* ---------------- details ---------------- */}
          <View style={styles.card}>
            <DetailRow icon="award" label="Qualifications" value={doc.qualification} />
            <DetailRow icon="briefcase" label="Experience" value={exp !== null && exp > 0 ? `${exp} years` : null} />
            <DetailRow icon="map-pin" label="City" value={doc.city} last={!doc.city} />
          </View>

          {doc.about ? (
            <>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.prose}>{doc.about}</Text>
            </>
          ) : null}

          {doc.bio ? (
            <>
              <Text style={styles.sectionTitle}>Biography &amp; expertise</Text>
              <Text style={styles.prose}>{doc.bio}</Text>
            </>
          ) : null}

          {specs.length ? (
            <>
              <Text style={styles.sectionTitle}>Specializations</Text>
              <View style={styles.tagWrap}>
                {specs.map((s) => (
                  <View key={s.id} style={styles.tag}>
                    <Text style={styles.tagText}>{s.name}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {languages.length ? (
            <>
              <Text style={styles.sectionTitle}>Languages</Text>
              <View style={styles.tagWrap}>
                {languages.map((l) => (
                  <View key={l} style={styles.tag}>
                    <Text style={styles.tagText}>{l}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Consultation</Text>
          <View style={styles.card}>
            <DetailRow icon="rupee" label="Fee" value={fee ?? "Not specified"} last />
          </View>

          {modes.length ? (
            <>
              <Text style={styles.sectionTitle}>How would you like to consult?</Text>
              <View style={styles.modeRow}>
                {modes.map((m) => (
                  <TouchableOpacity
                    key={m.key}
                    testID={`mode-${m.key}`}
                    onPress={() => setMode(m.key)}
                    style={[styles.modeCard, activeMode === m.key && styles.modeCardActive]}
                  >
                    <Feather
                      name={m.key === "online" ? "video" : "map-pin"}
                      size={18}
                      color={activeMode === m.key ? COLORS.surface : COLORS.brand}
                    />
                    <Text style={[styles.modeLabel, activeMode === m.key && { color: COLORS.surface }]}>
                      {m.label}
                    </Text>
                    <Text style={[styles.modeHint, activeMode === m.key && { color: "rgba(255,255,255,0.85)" }]}>
                      {m.hint}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}

          {/* ---------------- date + time ---------------- */}
          <Text style={styles.sectionTitle}>Choose a date</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: SPACING.lg }}
          >
            {days.map((d) => (
              <TouchableOpacity
                key={d.key}
                testID={`day-${d.key}`}
                onPress={() => setDate(d.key)}
                style={[styles.dayCard, date === d.key && styles.dayCardActive]}
              >
                <Text style={[styles.dayDow, date === d.key && { color: COLORS.surface }]}>{d.dow}</Text>
                <Text style={[styles.dayNum, date === d.key && { color: COLORS.surface }]}>{d.dnum}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.sectionTitle}>Pick a time · {dayLabel}</Text>
          {slotsLoading ? (
            <ActivityIndicator color={COLORS.brand} style={{ marginVertical: SPACING.md }} />
          ) : slotsErr ? (
            <Text style={styles.empty}>{slotsErr}</Text>
          ) : freeSlots.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="calendar" size={20} color={COLORS.textMuted} />
              <Text style={styles.empty}>
                {slots.length
                  ? "Every slot on this day is already booked. Try another date."
                  : "This doctor has not published availability for this day."}
              </Text>
            </View>
          ) : (
            <View style={styles.slotWrap}>
              {freeSlots.map((s) => (
                <TouchableOpacity
                  key={s.time}
                  testID={`slot-${s.time}`}
                  onPress={() => setSlot(s)}
                  style={[styles.slot, slot?.time === s.time && styles.slotActive]}
                >
                  <Text style={[styles.slotText, slot?.time === s.time && { color: COLORS.surface }]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionTitle}>Describe your symptoms</Text>
          <TextInput
            testID="doctor-symptoms"
            style={styles.input}
            value={symptoms}
            onChangeText={(t) => setSymptoms(t.slice(0, SYMPTOM_LIMIT))}
            placeholder="Optional - helps the doctor prepare for your visit"
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{symptoms.length}/{SYMPTOM_LIMIT}</Text>

          {err ? <Text style={styles.err}>{err}</Text> : null}
          {ok ? <Text style={styles.okMsg}>Appointment confirmed!</Text> : null}
        </View>
      </ScrollView>

      {/* ---------------- footer ---------------- */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>Total</Text>
          <Text style={styles.footerAmt}>{fee ?? "On request"}</Text>
        </View>
        <TouchableOpacity
          style={[styles.bookBtn, (!canBook || ok) && { opacity: 0.5 }]}
          disabled={!canBook || ok}
          onPress={() => setReviewOpen(true)}
          testID="doctor-book"
        >
          <Text style={styles.bookText}>
            {!activeMode ? "Unavailable" : !slot ? "Select a time" : "Review & confirm"}
          </Text>
          <Feather name="arrow-right" size={18} color={COLORS.surface} />
        </TouchableOpacity>
      </View>

      {/* ---------------- review sheet ---------------- */}
      <Modal visible={reviewOpen} animationType="slide" transparent onRequestClose={() => setReviewOpen(false)}>
        <KeyboardAvoidingView
          style={styles.payWrap}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.paySheet}>
            <View style={styles.grabber} />
            <Text style={styles.payTitle}>Confirm booking</Text>

            <View style={[styles.payRow, { marginTop: SPACING.md }]}>
              <Text style={styles.payLabel}>Doctor</Text>
              <Text style={styles.payVal} numberOfLines={1}>{doc.name}</Text>
            </View>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Date</Text>
              <Text style={styles.payVal}>{dayLabel}</Text>
            </View>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Time</Text>
              <Text style={styles.payVal}>{slot?.label}</Text>
            </View>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Mode</Text>
              <Text style={styles.payVal}>{modeLabel}</Text>
            </View>
            {symptoms.trim() ? (
              <View style={styles.payRow}>
                <Text style={styles.payLabel}>Symptoms</Text>
                <Text style={[styles.payVal, styles.payValWrap]}>{symptoms.trim()}</Text>
              </View>
            ) : null}

            <View style={[styles.payRow, styles.payTotal]}>
              <Text style={[styles.payLabel, { fontWeight: "700", color: COLORS.textPrimary }]}>Total</Text>
              <Text style={styles.payTotalVal}>{fee ?? "On request"}</Text>
            </View>

            {err ? <Text style={styles.err}>{err}</Text> : null}

            <View style={styles.payActions}>
              <TouchableOpacity style={styles.payCancel} onPress={() => setReviewOpen(false)} testID="pay-cancel">
                <Text style={{ color: COLORS.textPrimary, fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.payGo, busy && { opacity: 0.6 }]}
                onPress={book}
                disabled={busy}
                testID="pay-confirm"
              >
                <Text style={{ color: COLORS.surface, fontWeight: "700" }}>
                  {busy ? "Booking…" : fee ? "Confirm & pay" : "Confirm"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <RazorpayCheckout
        visible={!!payFor}
        onClose={() => {
          // Dismissing checkout must not hide the fact that the appointment
          // exists and is unpaid - it is still payable from My appointments.
          setPayFor(null);
          setOk(true);
          setTimeout(() => router.replace("/appointments"), 900);
        }}
        onSuccess={() => {
          setPayFor(null);
          setOk(true);
          setTimeout(() => router.replace("/appointments"), 1200);
        }}
        onFailure={(reason) => {
          setPayFor(null);
          if (reason && reason !== "payment_failed" && reason !== "verification_failed") {
            Alert.alert("Payment issue", reason);
          }
        }}
        amount={payFor?.amount ?? 0}
        purpose="appointment"
        reference_id={payFor?.id}
        description={`Consultation with ${doc?.name || "Vaidya"}`}
        title="Online VaidyaJi"
        prefill={{
          name: (user as any)?.name || "",
          email: (user as any)?.email || "",
          contact: (user as any)?.phone || "",
        }}
      />
    </SafeAreaView>
  );
}

function DetailRow({
  icon, label, value, last,
}: { icon: string; label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]}>
      <View style={styles.detailLabelWrap}>
        <Feather name={icon as any} size={15} color={COLORS.brand} />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={[styles.detailValue, !value && { color: COLORS.textMuted, fontStyle: "italic" }]}>
        {value && String(value).trim() ? value : "Not provided"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.md, padding: SPACING.lg },
  centerText: { color: COLORS.textPrimary, fontSize: 15, textAlign: "center" },
  ghostBtn: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  ghostBtnText: { color: COLORS.textPrimary, fontWeight: "700" },

  hero: { height: 320, overflow: "hidden", backgroundColor: COLORS.brandDark },
  heroFallback: { backgroundColor: COLORS.brandDark },
  heroOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(15,76,54,0.58)" },
  backBtn: { position: "absolute", top: SPACING.md, left: SPACING.md, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", zIndex: 2 },
  heroContent: { position: "absolute", bottom: SPACING.lg, left: SPACING.lg, right: SPACING.lg },
  specialtyPill: { alignSelf: "flex-start", backgroundColor: COLORS.brand, paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.pill },
  specialtyText: { color: COLORS.surface, fontWeight: "700", fontSize: 11, letterSpacing: 2 },
  docName: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 34, lineHeight: 38, marginTop: 10, letterSpacing: -1 },
  docSub: { color: COLORS.surface, marginTop: 6, fontSize: 13, opacity: 0.92 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.94)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  metaText: { color: COLORS.textPrimary, fontSize: 11, fontWeight: "700" },

  body: { padding: SPACING.lg },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: 8 },
  prose: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },

  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: SPACING.md },
  detailLabelWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "600" },
  detailValue: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "right" },

  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  tagText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "600" },

  modeRow: { flexDirection: "row", gap: SPACING.sm },
  modeCard: { flex: 1, alignItems: "center", gap: 3, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  modeCardActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  modeLabel: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 14 },
  modeHint: { color: COLORS.textMuted, fontSize: 11 },

  dayCard: { width: 58, alignItems: "center", gap: 2, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  dayCardActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  dayDow: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  dayNum: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "700" },

  slotWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  slotActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  slotText: { color: COLORS.textPrimary, fontWeight: "600", fontSize: 13 },

  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, minHeight: 96, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  counter: { color: COLORS.textMuted, fontSize: 11, textAlign: "right", marginTop: 4 },

  emptyBox: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  empty: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, flex: 1 },

  err: { color: COLORS.error, marginTop: SPACING.md, fontSize: 13 },
  okMsg: { color: COLORS.success, marginTop: SPACING.md, fontWeight: "700" },

  footer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: SPACING.md, paddingBottom: SPACING.lg, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" },
  footerAmt: { fontFamily: FONTS.money, fontSize: 24, color: COLORS.textPrimary },
  bookBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.brand, paddingHorizontal: 22, paddingVertical: 14, borderRadius: RADIUS.pill },
  bookText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },

  payWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  paySheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  payTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, letterSpacing: -0.5 },
  payRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.md, marginTop: 10 },
  payLabel: { color: COLORS.textSecondary, fontSize: 14 },
  payVal: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  payValWrap: { fontWeight: "400", fontSize: 13 },
  payTotal: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12, marginTop: SPACING.md },
  payTotalVal: { fontFamily: FONTS.money, fontSize: 22, color: COLORS.brand },
  payActions: { flexDirection: "row", gap: 8, marginTop: SPACING.lg },
  payCancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  payGo: { flex: 1.4, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
});
