// Prakriti (Vata / Pitta / Kapha) constitution quiz.
// 12 questions across body, digestion, energy, mind, sleep dimensions.
// Result is saved to the user's patient profile.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

type Dosha = "V" | "P" | "K";

type Question = {
  q: string;
  options: { key: Dosha; label: string }[];
};

const QUESTIONS: Question[] = [
  {
    q: "Body build & frame",
    options: [
      { key: "V", label: "Thin, light frame — hard to gain weight" },
      { key: "P", label: "Medium, muscular build" },
      { key: "K", label: "Solid, heavier build — gain weight easily" },
    ],
  },
  {
    q: "Skin",
    options: [
      { key: "V", label: "Dry, cool, rough — cracks in winter" },
      { key: "P", label: "Warm, sensitive — flushes or breaks out easily" },
      { key: "K", label: "Smooth, oily, thick — cool to touch" },
    ],
  },
  {
    q: "Hair",
    options: [
      { key: "V", label: "Dry, thin, frizzy — often splits" },
      { key: "P", label: "Fine, straight — early greying / balding" },
      { key: "K", label: "Thick, wavy, oily — lustrous" },
    ],
  },
  {
    q: "Appetite & hunger",
    options: [
      { key: "V", label: "Irregular — forget to eat, then very hungry" },
      { key: "P", label: "Strong, sharp — irritable if I skip meals" },
      { key: "K", label: "Low, steady — can easily skip meals" },
    ],
  },
  {
    q: "Digestion",
    options: [
      { key: "V", label: "Variable — gas, bloating, constipation" },
      { key: "P", label: "Fast, strong — acidity or loose stools" },
      { key: "K", label: "Slow, heavy — feel full for long" },
    ],
  },
  {
    q: "Body temperature",
    options: [
      { key: "V", label: "Feel cold often — cold hands & feet" },
      { key: "P", label: "Feel warm — prefer cool weather" },
      { key: "K", label: "Feel cool but tolerate cold well" },
    ],
  },
  {
    q: "Energy through the day",
    options: [
      { key: "V", label: "Bursts of energy then quick fatigue" },
      { key: "P", label: "Focused, intense — burnout if pushed" },
      { key: "K", label: "Steady, enduring — slow to warm up" },
    ],
  },
  {
    q: "Sleep",
    options: [
      { key: "V", label: "Light, interrupted — 5-6 hours" },
      { key: "P", label: "Moderate, sound — 6-8 hours" },
      { key: "K", label: "Deep, long — 8+ hours, hard to wake" },
    ],
  },
  {
    q: "Mind & thinking",
    options: [
      { key: "V", label: "Quick, creative — many ideas at once" },
      { key: "P", label: "Sharp, analytical — decisive" },
      { key: "K", label: "Calm, methodical — slow but steady" },
    ],
  },
  {
    q: "Under stress I…",
    options: [
      { key: "V", label: "Get anxious, worried, restless" },
      { key: "P", label: "Get irritated, angry, critical" },
      { key: "K", label: "Withdraw, feel heavy or sad" },
    ],
  },
  {
    q: "Speech & voice",
    options: [
      { key: "V", label: "Fast, talkative — jump between topics" },
      { key: "P", label: "Precise, articulate — direct" },
      { key: "K", label: "Slow, deep — thoughtful pauses" },
    ],
  },
  {
    q: "Memory",
    options: [
      { key: "V", label: "Learn fast, forget fast" },
      { key: "P", label: "Sharp — remember what interests me" },
      { key: "K", label: "Slow to learn, but never forget" },
    ],
  },
];

const DOSHA_META: Record<string, { color: string; icon: any; oneline: string }> = {
  Vata: { color: "#7C4DFF", icon: "wind", oneline: "Air & Ether — creative, quick, movement" },
  Pitta: { color: "#F57C00", icon: "sun", oneline: "Fire & Water — sharp, focused, transformation" },
  Kapha: { color: "#2E7D32", icon: "cloud-drizzle", oneline: "Earth & Water — steady, calm, grounding" },
};

export default function PrakritiQuiz() {
  const router = useRouter();
  const [step, setStep] = useState(0); // question index; QUESTIONS.length = results
  const [answers, setAnswers] = useState<(Dosha | null)[]>(() => QUESTIONS.map(() => null));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.prakritiAssess>> | null>(null);
  const [err, setErr] = useState("");

  const total = QUESTIONS.length;
  const isDone = step >= total;
  const answered = answers.filter((a) => a).length;
  const progressPct = Math.round((step / total) * 100);

  const pick = (key: Dosha) => {
    setAnswers((cur) => {
      const next = [...cur];
      next[step] = key;
      return next;
    });
    // auto-advance after a short delay so the pick is visible
    setTimeout(() => setStep((s) => s + 1), 200);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const list = answers.filter(Boolean) as Dosha[];
      const res = await api.prakritiAssess({ answers: list });
      setResult(res);
    } catch (e: any) {
      setErr(e?.message || "Assessment failed");
    } finally {
      setBusy(false);
    }
  };

  // When we reach the results step, automatically submit
  useEffect(() => {
    if (isDone && !result && !busy && answered === total) {
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);

  const back = () => {
    if (result) { router.back(); return; }
    if (step === 0) { router.back(); return; }
    setStep((s) => Math.max(0, s - 1));
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={back} style={styles.backBtn} testID="pk-back">
          <Feather name="chevron-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Prakriti · Ayurveda</Text>
          <Text style={styles.title}>Find your dosha</Text>
        </View>
      </View>

      {/* Progress bar (hidden on results) */}
      {!result && !isDone && (
        <View style={styles.progressWrap}>
          <View style={[styles.progressBar, { width: `${progressPct}%` }]} />
          <Text style={styles.progressText}>{step + 1} of {total}</Text>
        </View>
      )}

      {result ? (
        // -------------------- RESULT --------------------
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }}>
          <View style={styles.resultHero}>
            <Text style={styles.resultEyebrow}>Your Prakriti</Text>
            <Text style={styles.resultDosha}>{result.dosha}</Text>
            <Text style={styles.resultDesc}>{result.description}</Text>
          </View>

          {/* Score bars */}
          <View style={styles.scoreCard}>
            {(["Vata", "Pitta", "Kapha"] as const).map((name) => {
              const pct = name === "Vata" ? result.vata : name === "Pitta" ? result.pitta : result.kapha;
              const meta = DOSHA_META[name];
              return (
                <View key={name} style={styles.scoreRow}>
                  <View style={styles.scoreHead}>
                    <Feather name={meta.icon} size={14} color={meta.color} />
                    <Text style={styles.scoreName}>{name}</Text>
                    <Text style={[styles.scorePct, { color: meta.color }]}>{pct}%</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: meta.color }]} />
                  </View>
                  <Text style={styles.scoreOneline}>{meta.oneline}</Text>
                </View>
              );
            })}
          </View>

          {/* Traits */}
          {result.traits?.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Traits of {result.dominant}</Text>
              {result.traits.map((t, i) => (
                <View key={i} style={styles.traitLine}>
                  <View style={styles.dot} />
                  <Text style={styles.traitText}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Balance advice */}
          {result.balance ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>To stay in balance</Text>
              <Text style={styles.body}>{result.balance}</Text>
            </View>
          ) : null}

          {/* Actions */}
          <TouchableOpacity
            style={styles.primaryCta}
            onPress={() => router.replace({ pathname: "/diet-plan", params: { dosha: result.dosha } })}
            testID="pk-continue-diet"
          >
            <Feather name="coffee" size={16} color={COLORS.surface} />
            <Text style={styles.primaryCtaText}>Get my personalised diet plan</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryCta}
            onPress={() => { setResult(null); setAnswers(QUESTIONS.map(() => null)); setStep(0); }}
            testID="pk-retake"
          >
            <Feather name="refresh-cw" size={14} color={COLORS.brand} />
            <Text style={styles.secondaryCtaText}>Retake the quiz</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : isDone ? (
        // -------------------- LOADING / ERROR --------------------
        <View style={styles.center}>
          {err ? (
            <>
              <Feather name="alert-triangle" size={22} color={COLORS.warning} />
              <Text style={styles.errText}>{err}</Text>
              <TouchableOpacity style={styles.secondaryCta} onPress={submit} testID="pk-retry">
                <Text style={styles.secondaryCtaText}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator color={COLORS.brand} />
              <Text style={{ color: COLORS.textSecondary, marginTop: 12 }}>Analysing your Prakriti…</Text>
            </>
          )}
        </View>
      ) : (
        // -------------------- QUESTION --------------------
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
          <Text style={styles.qNum}>Question {step + 1}</Text>
          <Text style={styles.qText}>{QUESTIONS[step].q}</Text>
          <View style={{ marginTop: SPACING.lg, gap: SPACING.sm }}>
            {QUESTIONS[step].options.map((opt) => {
              const isSelected = answers[step] === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  activeOpacity={0.85}
                  onPress={() => pick(opt.key)}
                  style={[styles.optCard, isSelected && styles.optCardActive]}
                  testID={`pk-q${step}-opt-${opt.key}`}
                >
                  <View style={[styles.optRadio, isSelected && styles.optRadioActive]}>
                    {isSelected && <View style={styles.optRadioDot} />}
                  </View>
                  <Text style={[styles.optText, isSelected && styles.optTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {step > 0 && (
            <TouchableOpacity onPress={() => setStep((s) => s - 1)} style={styles.backLink} testID="pk-prev">
              <Feather name="chevron-left" size={14} color={COLORS.brand} />
              <Text style={styles.backLinkText}>Previous question</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 3, fontSize: 10, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, letterSpacing: -0.5 },
  progressWrap: { height: 4, backgroundColor: COLORS.border, marginHorizontal: SPACING.lg, borderRadius: 2, overflow: "hidden", marginBottom: 6 },
  progressBar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: COLORS.brand, borderRadius: 2 },
  progressText: { position: "absolute", right: 0, top: 8, color: COLORS.textMuted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: "700" },

  qNum: { color: COLORS.accent, fontSize: 11, textTransform: "uppercase", letterSpacing: 3, fontWeight: "700" },
  qText: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: 8, lineHeight: 32, letterSpacing: -0.3 },

  optCard: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, ...Platform.select({ web: { cursor: "pointer" }, default: {} }) },
  optCardActive: { borderColor: COLORS.brand, backgroundColor: COLORS.surfaceAlt },
  optRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  optRadioActive: { borderColor: COLORS.brand },
  optRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.brand },
  optText: { flex: 1, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  optTextActive: { color: COLORS.textPrimary, fontWeight: "600" },

  backLink: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: SPACING.lg, paddingVertical: 6 },
  backLinkText: { color: COLORS.brand, fontSize: 13, fontWeight: "700" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  errText: { color: COLORS.textPrimary, fontSize: 14, textAlign: "center", marginVertical: SPACING.md },

  // Results
  resultHero: { padding: SPACING.lg, backgroundColor: COLORS.brand, borderRadius: RADIUS.xl },
  resultEyebrow: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  resultDosha: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 44, marginTop: 8, letterSpacing: -1 },
  resultDesc: { color: COLORS.accentSoft, marginTop: 4, fontSize: 14, lineHeight: 20 },

  scoreCard: { marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.md },
  scoreRow: {},
  scoreHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  scoreName: { flex: 1, fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  scorePct: { fontFamily: FONTS.heading, fontSize: 16, fontWeight: "700" },
  barTrack: { height: 8, backgroundColor: COLORS.surfaceAlt, borderRadius: 4, marginTop: 6, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4 },
  scoreOneline: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },

  card: { marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  traitLine: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: COLORS.accent },
  traitText: { color: COLORS.textPrimary, fontSize: 13, flex: 1 },
  body: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 },

  primaryCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill, marginTop: SPACING.lg },
  primaryCtaText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  secondaryCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: SPACING.md, paddingVertical: 12 },
  secondaryCtaText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
});
