// Doctor's Patients list — searchable list of unique patients from appointments.
import { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function DoctorPatients() {
  const router = useRouter();
  const [patients, setPatients] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [refresh, setRefresh] = useState(false);

  const load = useCallback(async () => {
    try { const p = await api.doctorMyPatients(); setPatients(p || []); }
    catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return patients;
    return patients.filter((p) => (p.patient_name || "").toLowerCase().includes(s) || (p.patient_id || "").toLowerCase().includes(s));
  }, [patients, q]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Patient Records</Text>
        <Text style={styles.title}>My Patients</Text>
      </View>
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search patients by name…"
          placeholderTextColor={COLORS.textMuted}
          testID="dp-search"
        />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
      >
        <Text style={styles.count}>{filtered.length} of {patients.length}</Text>
        {filtered.length === 0 && <Text style={styles.empty}>No patients found.</Text>}
        {filtered.map((p) => (
          <TouchableOpacity
            key={p.patient_id}
            style={styles.card}
            onPress={() => router.push({ pathname: "/doctor/patient/[id]", params: { id: p.patient_id } })}
            testID={`patient-${p.patient_id}`}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(p.patient_name || "?").slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{p.patient_name || "Patient"}</Text>
              <Text style={styles.meta}>
                {p.total_visits || 0} visit{(p.total_visits || 0) !== 1 ? "s" : ""}
                {p.last_visit ? ` · Last: ${String(p.last_visit).slice(0, 10)}` : ""}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.textPrimary, marginTop: 4 },
  searchWrap: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: SPACING.md },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: COLORS.textPrimary },
  count: { paddingHorizontal: SPACING.lg, color: COLORS.textMuted, fontSize: 11, marginBottom: SPACING.sm, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  empty: { paddingHorizontal: SPACING.lg, color: COLORS.textMuted, fontStyle: "italic", fontSize: 13 },
  card: { marginHorizontal: SPACING.lg, marginBottom: 8, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.brand },
  name: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 15 },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
});
