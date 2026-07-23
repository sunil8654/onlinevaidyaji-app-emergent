// Wellness Dashboard v2 — BMI, Weight, Sleep, Steps, BP, Blood Sugar, Mood, Water
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

type MetricKey = "bmi" | "weight" | "sleep" | "steps" | "bp" | "sugar" | "mood" | "water";

const METRICS: {
  key: MetricKey; label: string; icon: any; unit: string; color: string;
  format: (l: any) => string;
}[] = [
  { key: "bmi", label: "BMI", icon: "activity", unit: "kg/m²", color: "#0F4C36",
    format: (l) => l ? `${l.value} · ${l.category ?? ""}` : "Log now" },
  { key: "weight", label: "Weight", icon: "trending-down", unit: "kg", color: "#D9663D",
    format: (l) => l ? `${l.value} kg` : "Log now" },
  { key: "sleep", label: "Sleep", icon: "moon", unit: "hrs", color: "#5C4B7A",
    format: (l) => l ? `${l.value} hrs` : "Log now" },
  { key: "steps", label: "Steps", icon: "activity", unit: "steps", color: "#0F4C36",
    format: (l) => l ? `${Math.round(l.value)}` : "Log now" },
  { key: "bp", label: "BP", icon: "heart", unit: "mmHg", color: "#D32F2F",
    format: (l) => l ? `${l.systolic}/${l.diastolic}` : "Log now" },
  { key: "sugar", label: "Blood Sugar", icon: "droplet", unit: "mg/dL", color: "#B8860B",
    format: (l) => l ? `${l.fasting ?? l.post_meal ?? l.value} mg/dL` : "Log now" },
  { key: "mood", label: "Mood", icon: "smile", unit: "1-5", color: "#D9663D",
    format: (l) => l ? ["😢","🙁","😐","🙂","😄"][Math.min(4, Math.max(0, Math.round((l.value || 3) - 1)))] : "Log now" },
  { key: "water", label: "Water", icon: "droplet", unit: "glasses", color: "#1E88E5",
    format: (l) => l ? `${l.value} glasses` : "Log now" },
];

export default function Wellness() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<MetricKey | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.wellnessDashboard();
      setDashboard(d);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const score = dashboard?.health_score ?? 50;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
      >
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="wellness-back">
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.eyebrow}>Daily Wellness</Text>
            <Text style={styles.title}>Your Health Score</Text>
          </View>
        </View>

        {/* Health Score Card */}
        <View style={styles.scoreCard}>
          <View style={styles.scoreRing}>
            <Text style={styles.scoreNum}>{score}</Text>
            <Text style={styles.scoreDenom}>/ 100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.scoreLabel}>{
              score >= 80 ? "Excellent — keep it up!" :
              score >= 60 ? "Good — small wins add up" :
              score >= 40 ? "Fair — log more to improve" :
              "Start logging today"
            }</Text>
            <Text style={styles.scoreHint}>Log daily metrics to see it climb.</Text>
          </View>
        </View>

        {/* Metrics Grid */}
        <Text style={styles.section}>Trackers</Text>
        <View style={styles.grid}>
          {METRICS.map((m) => {
            const latest = dashboard?.latest?.[m.key];
            return (
              <TouchableOpacity
                key={m.key}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => setModal(m.key)}
                testID={`wellness-${m.key}`}
              >
                <View style={[styles.cardIcon, { backgroundColor: `${m.color}15` }]}>
                  <Feather name={m.icon} size={16} color={m.color} />
                </View>
                <Text style={styles.cardLabel}>{m.label}</Text>
                <Text style={styles.cardValue} numberOfLines={1}>{m.format(latest)}</Text>
                <Text style={styles.cardUnit}>{m.unit}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.tip}>
          🌿 Tip: Tap any tracker to log today&apos;s reading. Your Ayurvedic doctor can see trends when you consult.
        </Text>
      </ScrollView>

      {modal && (
        <LogModal
          metric={modal}
          latest={dashboard?.latest?.[modal]}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await load(); }}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------- Log modal ----------------
function LogModal({
  metric, latest, onClose, onSaved,
}: { metric: MetricKey; latest: any; onClose: () => void; onSaved: () => void }) {
  const [val, setVal] = useState("");
  const [val2, setVal2] = useState("");
  const [val3, setVal3] = useState("");
  const [busy, setBusy] = useState(false);

  const cfg = METRICS.find((m) => m.key === metric)!;

  const save = async () => {
    setBusy(true);
    try {
      if (metric === "bp") {
        const s = parseInt(val, 10); const d = parseInt(val2, 10);
        if (!s || !d) { Alert.alert("Enter both systolic and diastolic"); setBusy(false); return; }
        await api.wellnessLog({ type: "bp", systolic: s, diastolic: d });
      } else if (metric === "bmi") {
        const h = parseFloat(val); const w = parseFloat(val2);
        if (!h || !w) { Alert.alert("Enter both height and weight"); setBusy(false); return; }
        await api.wellnessLog({ type: "bmi", height_cm: h, weight_kg: w });
      } else if (metric === "sugar") {
        const f = val ? parseInt(val, 10) : undefined;
        const p = val2 ? parseInt(val2, 10) : undefined;
        if (!f && !p) { Alert.alert("Enter fasting or post-meal reading"); setBusy(false); return; }
        await api.wellnessLog({ type: "sugar", fasting: f, post_meal: p });
      } else if (metric === "mood") {
        const v = parseInt(val3 || val, 10);
        if (!v || v < 1 || v > 5) { Alert.alert("Choose mood 1-5"); setBusy(false); return; }
        await api.wellnessLog({ type: "mood", value: v });
      } else {
        const v = parseFloat(val);
        if (!v && v !== 0) { Alert.alert("Enter a valid number"); setBusy(false); return; }
        await api.wellnessLog({ type: metric, value: v });
      }
      onSaved();
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Log {cfg.label}</Text>
            <TouchableOpacity onPress={onClose} testID="log-modal-close">
              <Feather name="x" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          {metric === "bp" && (
            <>
              <MiniLabel>Systolic (upper)</MiniLabel>
              <TextInput style={styles.modalInput} keyboardType="numeric" value={val} onChangeText={setVal} placeholder="120" placeholderTextColor={COLORS.textMuted} />
              <MiniLabel>Diastolic (lower)</MiniLabel>
              <TextInput style={styles.modalInput} keyboardType="numeric" value={val2} onChangeText={setVal2} placeholder="80" placeholderTextColor={COLORS.textMuted} />
            </>
          )}

          {metric === "bmi" && (
            <>
              <MiniLabel>Height (cm)</MiniLabel>
              <TextInput style={styles.modalInput} keyboardType="numeric" value={val} onChangeText={setVal} placeholder="170" placeholderTextColor={COLORS.textMuted} />
              <MiniLabel>Weight (kg)</MiniLabel>
              <TextInput style={styles.modalInput} keyboardType="numeric" value={val2} onChangeText={setVal2} placeholder="65" placeholderTextColor={COLORS.textMuted} />
            </>
          )}

          {metric === "sugar" && (
            <>
              <MiniLabel>Fasting (mg/dL) — optional</MiniLabel>
              <TextInput style={styles.modalInput} keyboardType="numeric" value={val} onChangeText={setVal} placeholder="90" placeholderTextColor={COLORS.textMuted} />
              <MiniLabel>Post-meal (mg/dL) — optional</MiniLabel>
              <TextInput style={styles.modalInput} keyboardType="numeric" value={val2} onChangeText={setVal2} placeholder="140" placeholderTextColor={COLORS.textMuted} />
            </>
          )}

          {metric === "mood" && (
            <>
              <MiniLabel>How do you feel today?</MiniLabel>
              <View style={styles.moodRow}>
                {[1,2,3,4,5].map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.moodBtn, val3 === String(n) && styles.moodActive]}
                    onPress={() => setVal3(String(n))}
                  >
                    <Text style={styles.moodEmoji}>{["😢","🙁","😐","🙂","😄"][n-1]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {(metric === "weight" || metric === "sleep" || metric === "steps" || metric === "water") && (
            <>
              <MiniLabel>{
                metric === "weight" ? "Weight (kg)" :
                metric === "sleep" ? "Hours slept" :
                metric === "steps" ? "Steps count" :
                "Glasses today"
              }</MiniLabel>
              <TextInput
                style={styles.modalInput}
                keyboardType="numeric"
                value={val}
                onChangeText={setVal}
                placeholder={metric === "steps" ? "6500" : metric === "sleep" ? "7.5" : metric === "water" ? "8" : "65"}
                placeholderTextColor={COLORS.textMuted}
              />
            </>
          )}

          {latest && (
            <Text style={styles.lastNote}>Last logged: {latest.date} · {cfg.format(latest)}</Text>
          )}

          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="log-modal-save">
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save reading"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MiniLabel({ children }: { children: string }) {
  return <Text style={styles.miniLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingBottom: SPACING.xl },
  head: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  scoreCard: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: COLORS.brand,
    borderRadius: RADIUS.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  scoreRing: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 4, borderColor: COLORS.accentSoft,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row",
    backgroundColor: COLORS.brandDark,
  },
  scoreNum: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.surface, letterSpacing: -1 },
  scoreDenom: { color: COLORS.accentSoft, fontSize: 12, marginLeft: 2 },
  scoreLabel: { color: COLORS.surface, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  scoreHint: { color: COLORS.accentSoft, fontSize: 12 },
  section: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.sm, fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  card: {
    width: "31%",
    padding: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 96,
  },
  cardIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  cardLabel: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  cardValue: { color: COLORS.textPrimary, fontSize: 16, fontWeight: "700", marginTop: 4 },
  cardUnit: { color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  tip: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
    color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, fontStyle: "italic",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  modalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.md,
  },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  miniLabel: {
    color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2,
    marginTop: SPACING.sm, marginBottom: 6, fontWeight: "700",
  },
  modalInput: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  moodRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  moodBtn: {
    flex: 1,
    marginHorizontal: 4,
    height: 60,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  moodActive: { borderColor: COLORS.brand, backgroundColor: COLORS.surfaceAlt, borderWidth: 2 },
  moodEmoji: { fontSize: 28 },
  lastNote: { marginTop: SPACING.md, color: COLORS.textMuted, fontSize: 12 },
  saveBtn: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.brand,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    alignItems: "center",
  },
  saveText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
});
