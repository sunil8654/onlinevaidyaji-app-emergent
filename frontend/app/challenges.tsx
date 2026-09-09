import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";

export default function Challenges() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => {
    try { setItems(await api.listChallenges()); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const join = async (id: string) => {
    await api.joinChallenge(id).catch(() => {});
    load();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="challenges-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Habit builder</Text>
          <Text style={styles.title}>Community challenges</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        renderItem={({ item }) => (
          <View style={styles.card} testID={`challenge-${item.id}`}>
            <Image source={{ uri: item.image_url }} style={styles.img} />
            <View style={{ flex: 1, padding: SPACING.md }}>
              <Text style={styles.badgePill}>{item.badge}</Text>
              <Text style={styles.chTitle}>{item.title}</Text>
              <Text style={styles.chBody}>{item.description}</Text>
              <View style={styles.row}>
                <View style={styles.chip}>
                  <Feather name="calendar" size={12} color={COLORS.brand} />
                  <Text style={styles.chipText}>{item.duration_days} days</Text>
                </View>
                {item.joined && (
                  <View style={[styles.chip, { backgroundColor: COLORS.accentSoft }]}>
                    <Feather name="zap" size={12} color={COLORS.accent} />
                    <Text style={[styles.chipText, { color: COLORS.accent }]}>Streak: {item.streak}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={[styles.joinBtn, item.joined && { backgroundColor: COLORS.success }]}
                onPress={() => join(item.id)}
                testID={`challenge-join-${item.id}`}
              >
                <Text style={styles.joinText}>{item.joined ? "Check-in today" : "Join challenge"}</Text>
              </TouchableOpacity>
            </View>
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
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: 2 },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  img: { width: "100%", height: 140 },
  badgePill: { alignSelf: "flex-start", backgroundColor: COLORS.brand, color: COLORS.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill, fontSize: 10, letterSpacing: 2, fontWeight: "700", overflow: "hidden" },
  chTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: 8 },
  chBody: { color: COLORS.textSecondary, marginTop: 4, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  chipText: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
  joinBtn: { marginTop: SPACING.md, backgroundColor: COLORS.brand, paddingVertical: 12, borderRadius: RADIUS.pill, alignItems: "center" },
  joinText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
});
