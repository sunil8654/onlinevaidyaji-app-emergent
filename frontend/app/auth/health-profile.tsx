import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import Feather from "@react-native-vector-icons/feather";
import { api } from "@/src/api";

const DOSHAS = [
  { key: "Vata", desc: "Air & space — quick, creative, dry" },
  { key: "Pitta", desc: "Fire & water — sharp, intense, warm" },
  { key: "Kapha", desc: "Earth & water — stable, calm, cool" },
];
const GENDERS = ["Male", "Female", "Other"];

export default function HealthProfile() {
  const router = useRouter();
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<string>("");
  const [dosha, setDosha] = useState<string>("");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.savePatientProfile({
        age: age ? parseInt(age, 10) : null,
        gender,
        dosha,
        conditions: conditions.split(",").map((s) => s.trim()).filter(Boolean),
      });
      router.replace("/(tabs)/home");
    } catch {
      router.replace("/(tabs)/home"); // still enter app
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>Step 1 · Health profile</Text>
        <Text style={styles.title}>Personalise your{"\n"}VaidyaJi</Text>
        <Text style={styles.sub}>Helps us tailor tips, remedies & doctor matches. You can skip anytime.</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Age</Text>
          <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="numeric" placeholder="28" placeholderTextColor={COLORS.textMuted} testID="profile-age" />

          <Text style={styles.label}>Gender</Text>
          <View style={styles.row}>
            {GENDERS.map((g) => (
              <TouchableOpacity
                key={g}
                style={[styles.chip, gender === g && styles.chipActive]}
                onPress={() => setGender(g)}
                testID={`profile-gender-${g.toLowerCase()}`}
              >
                <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Your dominant Dosha</Text>
          {DOSHAS.map((d) => (
            <TouchableOpacity
              key={d.key}
              style={[styles.doshaCard, dosha === d.key && styles.doshaActive]}
              onPress={() => setDosha(d.key)}
              testID={`profile-dosha-${d.key.toLowerCase()}`}
            >
              <View style={styles.doshaTop}>
                <Text style={[styles.doshaTitle, dosha === d.key && { color: COLORS.brand }]}>{d.key}</Text>
                {dosha === d.key && <Feather name="check-circle" size={20} color={COLORS.brand} />}
              </View>
              <Text style={styles.doshaDesc}>{d.desc}</Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.label}>Any known conditions? (comma separated)</Text>
          <TextInput style={styles.input} value={conditions} onChangeText={setConditions} placeholder="e.g. Acidity, Insomnia" placeholderTextColor={COLORS.textMuted} testID="profile-conditions" />
        </View>

        <TouchableOpacity style={[styles.cta, busy && { opacity: 0.6 }]} onPress={save} disabled={busy} testID="profile-save">
          <Text style={styles.ctaText}>{busy ? "Saving…" : "Save & continue"}</Text>
          <Feather name="arrow-right" size={18} color={COLORS.surface} />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace("/(tabs)/home")} style={{ alignSelf: "center", marginTop: SPACING.md }} testID="profile-skip">
          <Text style={{ color: COLORS.textSecondary }}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.lg, paddingBottom: SPACING.xxl },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 38, color: COLORS.textPrimary, marginTop: 6, lineHeight: 42, letterSpacing: -1 },
  sub: { color: COLORS.textSecondary, marginTop: 8, fontSize: 14, lineHeight: 20 },
  section: { marginTop: SPACING.lg },
  label: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 8, fontWeight: "700" },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  doshaCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: 10,
  },
  doshaActive: { borderColor: COLORS.brand, backgroundColor: COLORS.surfaceAlt },
  doshaTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  doshaTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary },
  doshaDesc: { color: COLORS.textSecondary, marginTop: 4, fontSize: 13 },
  cta: {
    marginTop: SPACING.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brand,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    gap: 8,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
});
