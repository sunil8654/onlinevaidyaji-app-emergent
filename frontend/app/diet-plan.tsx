import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

const GOALS = ["Weight loss", "Boost immunity", "Better sleep", "Reduce acidity", "Increase energy", "PCOS support", "Diabetes-friendly"];
const DOSHAS = ["Vata", "Pitta", "Kapha"];

export default function DietPlan() {
  const router = useRouter();
  const [goal, setGoal] = useState("Boost immunity");
  const [dosha, setDosha] = useState("");
  const [customGoal, setCustomGoal] = useState("");
  const [vegetarian, setVeg] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [past, setPast] = useState<any[]>([]);

  useEffect(() => { (async () => { try { setPast(await api.myDietPlans()); } catch {} })(); }, []);

  const generate = async () => {
    setBusy(true);
    setPlan(null);
    try {
      const g = customGoal.trim() || goal;
      const res = await api.generateDietPlan({ goal: g, dosha: dosha || undefined, vegetarian });
      setPlan(res);
      setPast((p) => [res, ...p]);
    } catch {}
    setBusy(false);
  };

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

          <Text style={styles.label}>Your dosha (optional)</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {DOSHAS.map((d) => (
              <TouchableOpacity key={d} onPress={() => setDosha(dosha === d ? "" : d)} style={[styles.chip, dosha === d && styles.chipActive]} testID={`dp-dosha-${d}`}>
                <Text style={[styles.chipText, dosha === d && styles.chipTextActive]}>{d}</Text>
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

          <TouchableOpacity style={[styles.cta, busy && { opacity: 0.6 }]} onPress={generate} disabled={busy} testID="dp-generate">
            <Feather name="cpu" size={16} color={COLORS.surface} />
            <Text style={styles.ctaText}>{busy ? "Generating your plan…" : "Generate my plan"}</Text>
          </TouchableOpacity>
        </View>

        {busy && (
          <View style={styles.thinking}>
            <ActivityIndicator color={COLORS.brand} />
            <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>Consulting our AI Vaidya…</Text>
          </View>
        )}

        {plan && (
          <View style={styles.planCard} testID="dp-result">
            <View style={styles.planHead}>
              <Feather name="sunrise" size={18} color={COLORS.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.planKicker}>Personalised plan</Text>
                <Text style={styles.planTitle}>{plan.goal}</Text>
              </View>
            </View>
            <Text style={styles.planBody}>{plan.plan}</Text>
          </View>
        )}

        {past.length > 0 && (
          <>
            <Text style={styles.section}>Past plans</Text>
            {past.slice(0, 5).map((p) => (
              <TouchableOpacity key={p.id} style={styles.pastCard} onPress={() => setPlan(p)} testID={`dp-past-${p.id}`}>
                <Feather name="file-text" size={16} color={COLORS.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pastGoal}>{p.goal}</Text>
                  <Text style={styles.pastDate}>{new Date(p.created_at).toLocaleDateString()}</Text>
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
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill, marginTop: SPACING.md },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  thinking: { alignItems: "center", padding: SPACING.lg },
  planCard: { marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.brand },
  planHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  planKicker: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, fontWeight: "700", textTransform: "uppercase" },
  planTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: 2 },
  planBody: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 22, marginTop: SPACING.md },
  section: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: SPACING.md },
  pastCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  pastGoal: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary },
  pastDate: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
});
