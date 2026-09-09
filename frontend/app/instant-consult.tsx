// Instant video consultation — "find a Vaidya in 30 min"
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";

export default function InstantConsult() {
  const router = useRouter();
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setDoctors(await api.listDoctors()); } catch {}
      setLoading(false);
    })();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="ic-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>Instant · Video</Text>
          <Text style={styles.title}>Consult in 30 min</Text>
        </View>
      </View>

      <View style={styles.hero}>
        <View style={styles.pulse}>
          <Feather name="video" size={22} color={COLORS.surface} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Vaidyas online right now</Text>
          <Text style={styles.heroSub}>Skip the wait — connect with a verified AYUSH doctor in under 30 minutes.</Text>
        </View>
        <View style={styles.count}>
          <Text style={styles.countNum}>{doctors.length}</Text>
          <Text style={styles.countLbl}>ONLINE</Text>
        </View>
      </View>

      <FlatList
        data={doctors}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: 60 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? "Finding Vaidyas…" : "No Vaidyas online right now."}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card} testID={`ic-doc-${item.id}`}>
            <View style={{ position: "relative" }}>
              <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
              <View style={styles.dot} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.docName}>{item.name}</Text>
              <Text style={styles.docMeta}>{item.specialty} · {item.experience_years} yrs</Text>
              <View style={styles.metaRow}>
                <View style={styles.ratePill}>
                  <Feather name="star" size={10} color={COLORS.accent} />
                  <Text style={styles.rateText}>{item.rating || 4.6}</Text>
                </View>
                <Text style={styles.wait}>~5-15 min wait</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => router.push({ pathname: "/video-call", params: { doctor_name: item.name, doctor_specialty: item.specialty, doctor_id: item.id } })}
              testID={`ic-call-${item.id}`}
            >
              <Feather name="video" size={14} color={COLORS.surface} />
              <Text style={styles.callText}>Call ₹{item.consultation_fee}</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  hero: { flexDirection: "row", gap: 12, alignItems: "center", marginHorizontal: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.brand, borderRadius: RADIUS.lg },
  pulse: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" },
  heroTitle: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 18 },
  heroSub: { color: COLORS.accentSoft, fontSize: 12, marginTop: 4, lineHeight: 16 },
  count: { alignItems: "center" },
  countNum: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 26 },
  countLbl: { color: COLORS.accentSoft, fontSize: 9, letterSpacing: 1, fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.surfaceAlt },
  dot: { position: "absolute", right: 2, bottom: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.success, borderWidth: 2, borderColor: COLORS.surface },
  docName: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary },
  docMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: "row", gap: 8, marginTop: 6, alignItems: "center" },
  ratePill: { flexDirection: "row", gap: 3, alignItems: "center", backgroundColor: COLORS.accentSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.pill },
  rateText: { color: COLORS.accent, fontSize: 10, fontWeight: "700" },
  wait: { color: COLORS.success, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill },
  callText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
});
