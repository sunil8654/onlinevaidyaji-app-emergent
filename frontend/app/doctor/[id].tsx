import { useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

function generateSlots() {
  const slots: { label: string; iso: string; day: string }[] = [];
  const now = new Date();
  for (let d = 0; d < 3; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    for (const h of [10, 12, 15, 17, 19]) {
      const dt = new Date(day);
      dt.setHours(h, 0, 0, 0);
      if (dt.getTime() < Date.now() + 30 * 60 * 1000) continue;
      slots.push({
        iso: dt.toISOString(),
        label: dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        day: d === 0 ? "Today" : d === 1 ? "Tomorrow" : dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
      });
    }
  }
  return slots;
}

export default function DoctorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<any>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const slots = useMemo(() => generateSlots(), []);
  const grouped = useMemo(() => {
    const m: Record<string, typeof slots> = {};
    for (const s of slots) (m[s.day] = m[s.day] || []).push(s);
    return m;
  }, [slots]);

  useEffect(() => {
    (async () => {
      try { setDoc(await api.getDoctor(id as string)); } catch {}
    })();
  }, [id]);

  const book = async () => {
    if (!slot) return;
    setBusy(true); setErr("");
    try {
      await api.bookAppointment({ doctor_id: id as string, slot });
      setOk(true);
      setTimeout(() => router.replace("/appointments"), 900);
    } catch (e: any) {
      setErr(e.message || "Could not book. Sign in first?");
    } finally {
      setBusy(false);
    }
  };

  if (!doc) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.hero}>
          <Image source={{ uri: doc.avatar_url }} style={StyleSheet.absoluteFillObject as any} />
          <View style={styles.heroOverlay} />
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="doctor-back">
            <Feather name="arrow-left" size={20} color={COLORS.surface} />
          </TouchableOpacity>
          <View style={styles.heroContent}>
            <View style={styles.specialtyPill}>
              <Text style={styles.specialtyText}>{doc.specialty}</Text>
            </View>
            <Text style={styles.docName}>{doc.name}</Text>
            <Text style={styles.docSub}>{doc.qualification} · {doc.experience_years} yrs experience</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaChip}>
                <Feather name="star" size={12} color={COLORS.accent} />
                <Text style={styles.metaText}>{doc.rating || 4.6}  ({doc.reviews || 100}+)</Text>
              </View>
              <View style={styles.metaChip}>
                <Feather name="globe" size={12} color={COLORS.brand} />
                <Text style={styles.metaText}>{(doc.languages || []).slice(0, 2).join(", ")}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.about}>{doc.bio}</Text>

          <Text style={styles.sectionTitle}>Consultation fee</Text>
          <Text style={styles.fee}>₹{doc.consultation_fee}</Text>

          <Text style={styles.sectionTitle}>Pick a slot</Text>
          {Object.keys(grouped).map((day) => (
            <View key={day} style={{ marginBottom: SPACING.md }}>
              <Text style={styles.day}>{day}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: SPACING.md }}>
                {grouped[day].map((s) => (
                  <TouchableOpacity
                    key={s.iso}
                    onPress={() => setSlot(s.iso)}
                    style={[styles.slot, slot === s.iso && styles.slotActive]}
                    testID={`slot-${s.iso}`}
                  >
                    <Text style={[styles.slotText, slot === s.iso && { color: COLORS.surface }]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ))}

          {err ? <Text style={styles.err}>{err}</Text> : null}
          {ok ? <Text style={styles.okMsg}>Appointment confirmed!</Text> : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>Total</Text>
          <Text style={styles.footerAmt}>₹{doc.consultation_fee}</Text>
        </View>
        <TouchableOpacity
          style={[styles.bookBtn, (!slot || busy) && { opacity: 0.5 }]}
          disabled={!slot || busy}
          onPress={book}
          testID="doctor-book"
        >
          <Text style={styles.bookText}>{busy ? "Booking…" : "Confirm booking"}</Text>
          <Feather name="arrow-right" size={18} color={COLORS.surface} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  hero: { height: 320, overflow: "hidden" },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,76,54,0.55)" },
  backBtn: { position: "absolute", top: SPACING.md, left: SPACING.md, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", zIndex: 2 },
  heroContent: { position: "absolute", bottom: SPACING.lg, left: SPACING.lg, right: SPACING.lg },
  specialtyPill: { alignSelf: "flex-start", backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.pill },
  specialtyText: { color: COLORS.surface, fontWeight: "700", fontSize: 11, letterSpacing: 2 },
  docName: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 34, lineHeight: 38, marginTop: 10, letterSpacing: -1 },
  docSub: { color: COLORS.accentSoft, marginTop: 6, fontSize: 13 },
  metaRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(247,245,240,0.9)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  metaText: { color: COLORS.textPrimary, fontSize: 11, fontWeight: "700" },
  body: { padding: SPACING.lg },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: 8 },
  about: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },
  fee: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.brand },
  day: { color: COLORS.textSecondary, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginBottom: 6 },
  slot: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  slotActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  slotText: { color: COLORS.textPrimary, fontWeight: "600", fontSize: 13 },
  err: { color: COLORS.error, marginTop: 8 },
  okMsg: { color: COLORS.success, marginTop: 8, fontWeight: "700" },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    padding: SPACING.md, paddingBottom: SPACING.lg,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  footerLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" },
  footerAmt: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary },
  bookBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.brand, paddingHorizontal: 22, paddingVertical: 14, borderRadius: RADIUS.pill },
  bookText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
});
