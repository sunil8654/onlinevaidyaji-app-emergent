import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING, SPECIALTIES } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

export default function Consult() {
  const router = useRouter();
  const [specialty, setSpecialty] = useState<string>("All");
  const [doctors, setDoctors] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (s: string) => {
    try {
      const d = await api.listDoctors(s);
      setDoctors(d);
    } catch {}
  }, []);

  useEffect(() => { load(specialty); }, [specialty, load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={styles.eyebrow}>Consultation</Text>
            <Text style={styles.title}>Find your Vaidya</Text>
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/appointments")} testID="consult-my-appointments">
            <Feather name="calendar" size={18} color={COLORS.brand} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsWrap} contentContainerStyle={styles.chipsRow}>
        {SPECIALTIES.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setSpecialty(s)}
            style={[styles.chip, specialty === s && styles.chipActive]}
            testID={`consult-chip-${s.toLowerCase()}`}
          >
            <Text style={[styles.chipText, specialty === s && styles.chipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={doctors}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(specialty); setRefreshing(false); }} tintColor={COLORS.brand} />}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListEmptyComponent={<Text style={styles.empty}>No doctors in this specialty.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: "/doctor/[id]", params: { id: item.id } })}
            activeOpacity={0.9}
            testID={`doctor-card-${item.id}`}
          >
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.docName}>{item.name}</Text>
              <Text style={styles.docQual}>{item.qualification}</Text>
              <View style={styles.tagRow}>
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{item.specialty}</Text>
                </View>
                <View style={styles.tagLight}>
                  <Feather name="star" size={11} color={COLORS.accent} />
                  <Text style={styles.tagLightText}>{item.rating || 4.6}</Text>
                </View>
                <Text style={styles.exp}>{item.experience_years} yrs</Text>
              </View>
              <Text style={styles.fee}>₹{item.consultation_fee}</Text>
            </View>
            <View style={styles.arrow}>
              <Feather name="chevron-right" size={18} color={COLORS.surface} />
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, marginTop: 4, letterSpacing: -1 },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center",
  },
  chipsWrap: { maxHeight: 56, marginTop: SPACING.md },
  chipsRow: { paddingHorizontal: SPACING.lg, gap: 8, alignItems: "center", height: 56 },
  chip: { flexShrink: 0, height: 36, paddingHorizontal: 16, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  card: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.lg, padding: SPACING.md,
  },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.surfaceAlt },
  docName: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, lineHeight: 22 },
  docQual: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  tag: { backgroundColor: COLORS.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  tagText: { color: COLORS.surface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  tagLight: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: COLORS.accentSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  tagLightText: { color: COLORS.accent, fontSize: 10, fontWeight: "700" },
  exp: { color: COLORS.textMuted, fontSize: 11 },
  fee: { color: COLORS.brand, marginTop: 6, fontWeight: "700", fontSize: 13 },
  arrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.xl },
});
