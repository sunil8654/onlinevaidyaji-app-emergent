import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Feather } from "@expo/vector-icons";

const GOALS = ["Weight loss", "Boost immunity", "Better sleep", "Reduce acidity", "Increase energy", "PCOS support", "Diabetes-friendly"];
const DOSHAS = ["Vata", "Pitta", "Kapha"];
const DURATIONS: { key: 1 | 3 | 7; label: string; hint: string }[] = [
  { key: 1, label: "1 day", hint: "Quick trial" },
  { key: 3, label: "3 days", hint: "Balanced" },
  { key: 7, label: "7 days", hint: "Full week" },
];

const SLOT_ICONS: Record<string, any> = {
  "Early morning": "sunrise",
  "Breakfast": "coffee",
  "Mid-morning": "sun",
  "Lunch": "grid",
  "Evening": "cloud",
  "Dinner": "moon",
  "Bedtime": "star",
};

export default function DietPlan() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dosha?: string }>();
  const { user } = useAuth();
  const [goal, setGoal] = useState("Boost immunity");
  const [dosha, setDosha] = useState("");
  const [customGoal, setCustomGoal] = useState("");
  const [vegetarian, setVeg] = useState(true);
  const [duration, setDuration] = useState<1 | 3 | 7>(3);
  const [structured, setStructured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [past, setPast] = useState<any[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [err, setErr] = useState("");

  // Load user's saved dosha + past plans
  const boot = useCallback(async () => {
    try {
      if (user?.role === "patient") {
        const prof = await api.getPatientProfile().catch(() => ({} as any));
        const savedDosha = (prof as any)?.dosha || "";
        // If quiz result was passed in via nav param, prefer that
        setDosha(params.dosha || savedDosha || "");
      }
    } catch {}
    try { setPast(await api.myDietPlans()); } catch {}
  }, [user?.role, params.dosha]);

  useEffect(() => { boot(); }, [boot]);

  const generate = async () => {
    setBusy(true); setPlan(null); setErr(""); setDayIdx(0);
    try {
      const g = customGoal.trim() || goal;
      const res: any = await api.generateDietPlan({
        goal: g,
        dosha: dosha || undefined,
        vegetarian,
        duration_days: duration,
        structured,
      });
      setPlan(res);
      setPast((p) => [res, ...p]);
    } catch (e: any) {
      setErr(e?.message || "Could not generate plan");
    } finally {
      setBusy(false);
    }
  };

  const doshaMissing = user?.role === "patient" && !dosha;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="dp-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>AI Powered · Free</Text>
          <Text style={styles.title}>AYUSH diet plan</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
        {/* Prakriti banner */}
        {doshaMissing ? (
          <TouchableOpacity
            style={styles.prakritiBanner}
            onPress={() => router.push("/prakriti-quiz")}
            testID="dp-take-quiz"
            activeOpacity={0.9}
          >
            <View style={styles.prakritiIcon}>
              <Feather name="feather" size={18} color={COLORS.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.prakritiKicker}>NEW · 2 MIN</Text>
              <Text style={styles.prakritiTitle}>Find your Prakriti</Text>
              <Text style={styles.prakritiBody}>A short quiz reveals your dosha and unlocks truly personalised plans.</Text>
            </View>
            <Feather name="arrow-right" size={16} color={COLORS.brand} />
          </TouchableOpacity>
        ) : dosha ? (
          <View style={styles.doshaChipRow}>
            <View style={styles.doshaBadge}>
              <Feather name="feather" size={12} color={COLORS.surface} />
              <Text style={styles.doshaBadgeText}>Prakriti: {dosha}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/prakriti-quiz")} testID="dp-retake-quiz">
              <Text style={styles.retake}>Retake quiz</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Your goal</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: SPACING.md }}>
            {GOALS.map((g) => (
              <TouchableOpacity key={g} onPress={() => { setGoal(g); setCustomGoal(""); }} style={[styles.chip, goal === g && !customGoal && styles.chipActive]} testID={`dp-goal-${g}`}>
                <Text style={[styles.chipText, goal === g && !customGoal && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Or type your own</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Reduce migraines"
            placeholderTextColor={COLORS.textMuted}
            value={customGoal}
            onChangeText={setCustomGoal}
            testID="dp-custom"
          />

          <Text style={styles.label}>Your dosha</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {DOSHAS.map((d) => (
              <TouchableOpacity key={d} onPress={() => setDosha(dosha.startsWith(d) ? "" : d)} style={[styles.chip, dosha.startsWith(d) && styles.chipActive]} testID={`dp-dosha-${d}`}>
                <Text style={[styles.chipText, dosha.startsWith(d) && styles.chipTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Duration</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {DURATIONS.map((d) => (
              <TouchableOpacity
                key={d.key}
                onPress={() => setDuration(d.key)}
                style={[styles.durationCard, duration === d.key && styles.durationCardActive]}
                testID={`dp-dur-${d.key}`}
              >
                <Text style={[styles.durationLabel, duration === d.key && styles.durationLabelActive]}>{d.label}</Text>
                <Text style={[styles.durationHint, duration === d.key && { color: COLORS.accentSoft }]}>{d.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Diet</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <TouchableOpacity onPress={() => setVeg(true)} style={[styles.chip, vegetarian && styles.chipActive]} testID="dp-veg">
              <Text style={[styles.chipText, vegetarian && styles.chipTextActive]}>Vegetarian</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setVeg(false)} style={[styles.chip, !vegetarian && styles.chipActive]} testID="dp-nonveg">
              <Text style={[styles.chipText, !vegetarian && styles.chipTextActive]}>Non-veg</Text>
            </TouchableOpacity>
          </View>

          {/* Style toggle */}
          <TouchableOpacity onPress={() => setStructured((s) => !s)} style={styles.toggleRow} testID="dp-toggle-structured">
            <Feather name={structured ? "check-square" : "square"} size={16} color={COLORS.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Structured meal-wise plan</Text>
              <Text style={styles.toggleSub}>Recommended · day-wise meals with Ayurvedic reasoning</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.cta, busy && { opacity: 0.6 }]} onPress={generate} disabled={busy} testID="dp-generate">
            <Feather name="cpu" size={16} color={COLORS.surface} />
            <Text style={styles.ctaText}>{busy ? "Generating your plan…" : `Generate ${duration}-day plan`}</Text>
          </TouchableOpacity>
        </View>

        {busy && (
          <View style={styles.thinking}>
            <ActivityIndicator color={COLORS.brand} />
            <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>Consulting our AI Vaidya…</Text>
          </View>
        )}

        {err ? <Text style={styles.errText}>{err}</Text> : null}

        {plan && <PlanView plan={plan} dayIdx={dayIdx} setDayIdx={setDayIdx} onUpgrade={() => router.push("/plan-checkout?type=weekly-diet&price=200")} />}

        {past.length > 0 && (
          <>
            <Text style={styles.section}>Past plans</Text>
            {past.slice(0, 5).map((p) => (
              <TouchableOpacity key={p.id} style={styles.pastCard} onPress={() => { setPlan(p); setDayIdx(0); }} testID={`dp-past-${p.id}`}>
                <Feather name="file-text" size={16} color={COLORS.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pastGoal}>{p.goal}</Text>
                  <Text style={styles.pastDate}>
                    {new Date(p.created_at).toLocaleDateString()}
                    {p.duration_days ? ` · ${p.duration_days} day${p.duration_days > 1 ? "s" : ""}` : ""}
                    {p.dosha ? ` · ${p.dosha}` : ""}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanView({ plan, dayIdx, setDayIdx, onUpgrade }: { plan: any; dayIdx: number; setDayIdx: (n: number) => void; onUpgrade: () => void }) {
  const structured = plan.plan_structured;
  if (structured && Array.isArray(structured.days) && structured.days.length > 0) {
    const day = structured.days[Math.min(dayIdx, structured.days.length - 1)];
    return (
      <View style={styles.planCard} testID="dp-result">
        <View style={styles.planHead}>
          <Feather name="sunrise" size={18} color={COLORS.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.planKicker}>Personalised plan · {plan.duration_days || structured.days.length} day{(plan.duration_days || structured.days.length) > 1 ? "s" : ""}</Text>
            <Text style={styles.planTitle}>{plan.goal}</Text>
          </View>
        </View>
        {structured.summary ? <Text style={styles.summary}>{structured.summary}</Text> : null}

        {structured.principles?.length ? (
          <View style={styles.principlesBox}>
            {structured.principles.map((p: string, i: number) => (
              <View key={i} style={styles.principleLine}>
                <View style={styles.principleDot} />
                <Text style={styles.principleText}>{p}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Day tabs */}
        {structured.days.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: SPACING.md }}>
            {structured.days.map((d: any, i: number) => (
              <TouchableOpacity
                key={i}
                onPress={() => setDayIdx(i)}
                style={[styles.dayTab, dayIdx === i && styles.dayTabActive]}
                testID={`dp-day-${i}`}
              >
                <Text style={[styles.dayTabText, dayIdx === i && styles.dayTabTextActive]}>{d.name || `Day ${d.day || i + 1}`}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Meals for the selected day */}
        <View style={{ marginTop: SPACING.sm, gap: SPACING.sm }}>
          {(day?.meals || []).map((m: any, i: number) => (
            <View key={i} style={styles.mealCard} testID={`dp-meal-${dayIdx}-${i}`}>
              <View style={styles.mealIcon}>
                <Feather name={SLOT_ICONS[m.slot] || "circle"} size={14} color={COLORS.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.mealSlot}>{m.slot}</Text>
                {m.title ? <Text style={styles.mealTitle}>{m.title}</Text> : null}
                {Array.isArray(m.items) && m.items.length > 0 && (
                  <View style={{ marginTop: 4 }}>
                    {m.items.map((it: string, j: number) => (
                      <Text key={j} style={styles.mealItem}>• {it}</Text>
                    ))}
                  </View>
                )}
                {m.reasoning ? <Text style={styles.mealReasoning}>{m.reasoning}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        {/* Favour / Avoid */}
        {(structured.favour?.length || structured.avoid?.length) && (
          <View style={styles.favAvoid}>
            {structured.favour?.length ? (
              <View style={styles.favBox}>
                <Text style={styles.favTitle}>✓ Favour</Text>
                {structured.favour.map((f: string, i: number) => (<Text key={i} style={styles.favItem}>{f}</Text>))}
              </View>
            ) : null}
            {structured.avoid?.length ? (
              <View style={styles.avoidBox}>
                <Text style={styles.avoidTitle}>✕ Avoid</Text>
                {structured.avoid.map((f: string, i: number) => (<Text key={i} style={styles.avoidItem}>{f}</Text>))}
              </View>
            ) : null}
          </View>
        )}

        {/* Upgrade CTA */}
        <View style={styles.upgradeCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.upKicker}>UPGRADE · ₹200 only</Text>
            <Text style={styles.upTitle}>Dietitian-curated 7-day plan</Text>
            <Text style={styles.upBody}>Human-verified menus + WhatsApp support from a certified Ayurvedic dietitian.</Text>
          </View>
          <TouchableOpacity style={styles.upBtn} onPress={onUpgrade} testID="dp-upgrade">
            <Text style={styles.upBtnText}>Buy ₹200</Text>
            <Feather name="arrow-right" size={14} color={COLORS.surface} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Legacy plain-text fallback
  return (
    <View style={styles.planCard} testID="dp-result">
      <View style={styles.planHead}>
        <Feather name="sunrise" size={18} color={COLORS.brand} />
        <View style={{ flex: 1 }}>
          <Text style={styles.planKicker}>Personalised plan</Text>
          <Text style={styles.planTitle}>{plan.goal}</Text>
        </View>
      </View>
      <Text style={styles.planBody}>{plan.plan}</Text>
      <View style={styles.upgradeCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.upKicker}>UPGRADE · ₹200 only</Text>
          <Text style={styles.upTitle}>Get a 7-day Weekly Plan</Text>
          <Text style={styles.upBody}>Certified Online VaidyaJi dietician · daily menus tailored to your dosha, symptoms & taste · WhatsApp support.</Text>
        </View>
        <TouchableOpacity style={styles.upBtn} onPress={onUpgrade} testID="dp-upgrade">
          <Text style={styles.upBtnText}>Buy ₹200</Text>
          <Feather name="arrow-right" size={14} color={COLORS.surface} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.sm },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
  label: { color: COLORS.textSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 2, fontWeight: "700", marginTop: SPACING.md, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  input: { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 14 },
  durationCard: { flex: 1, alignItems: "center", padding: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceAlt },
  durationCardActive: { borderColor: COLORS.brand, backgroundColor: COLORS.brand },
  durationLabel: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  durationLabelActive: { color: COLORS.surface },
  durationHint: { color: COLORS.textSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 2 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, ...Platform.select({ web: { cursor: "pointer" }, default: {} }) },
  toggleTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "700" },
  toggleSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill, marginTop: SPACING.md },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  thinking: { alignItems: "center", padding: SPACING.lg },
  errText: { color: COLORS.error, textAlign: "center", padding: SPACING.md },

  // Prakriti banner
  prakritiBanner: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.accentSoft, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.accent, marginBottom: SPACING.md },
  prakritiIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  prakritiKicker: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  prakritiTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: 2 },
  prakritiBody: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  doshaChipRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.md },
  doshaBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  doshaBadgeText: { color: COLORS.surface, fontSize: 12, fontWeight: "700" },
  retake: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },

  // Plan card
  planCard: { marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.brand },
  planHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  planKicker: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, fontWeight: "700", textTransform: "uppercase" },
  planTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: 2 },
  summary: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 20, marginTop: SPACING.sm, fontStyle: "italic" },
  planBody: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 22, marginTop: SPACING.md },

  principlesBox: { marginTop: SPACING.md, padding: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md },
  principleLine: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  principleDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: COLORS.brand },
  principleText: { color: COLORS.textPrimary, fontSize: 12, flex: 1 },

  dayTab: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  dayTabActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  dayTabText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700" },
  dayTabTextActive: { color: COLORS.surface },

  mealCard: { flexDirection: "row", gap: 10, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  mealIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  mealSlot: { color: COLORS.accent, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  mealTitle: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary, marginTop: 2 },
  mealItem: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 20 },
  mealReasoning: { color: COLORS.textSecondary, fontSize: 11, marginTop: 6, fontStyle: "italic", lineHeight: 16 },

  favAvoid: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  favBox: { flex: 1, padding: SPACING.sm, backgroundColor: "#E8F5E9", borderRadius: RADIUS.md },
  avoidBox: { flex: 1, padding: SPACING.sm, backgroundColor: "#FBE9E7", borderRadius: RADIUS.md },
  favTitle: { color: COLORS.success, fontSize: 11, fontWeight: "700", marginBottom: 4, letterSpacing: 1 },
  avoidTitle: { color: COLORS.error, fontSize: 11, fontWeight: "700", marginBottom: 4, letterSpacing: 1 },
  favItem: { color: COLORS.textPrimary, fontSize: 12, paddingVertical: 1 },
  avoidItem: { color: COLORS.textPrimary, fontSize: 12, paddingVertical: 1 },

  upgradeCard: { marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.brand, borderRadius: RADIUS.md, flexDirection: "row", gap: 12, alignItems: "center" },
  upKicker: { color: COLORS.accentSoft, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  upTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.surface, marginTop: 4, lineHeight: 22, letterSpacing: -0.3 },
  upBody: { color: "#FFFDF3", fontSize: 11, marginTop: 6, lineHeight: 16 },
  upBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill },
  upBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },

  section: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: SPACING.md },
  pastCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  pastGoal: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary },
  pastDate: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
});
