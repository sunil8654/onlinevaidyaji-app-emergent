// Quiz list — browse AYUSH health quizzes.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function QuizList() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rs = await api.listQuizzes();
      setItems(rs);
    } catch {}
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="quiz-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Test your knowledge</Text>
          <Text style={styles.title}>Health Quizzes</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(q) => q.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
        }
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Feather name="book-open" size={22} color={COLORS.brand} />
            <Text style={styles.emptyTitle}>No quizzes right now</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: "/quiz/[id]", params: { id: item.id } })}
            testID={`quiz-${item.id}`}
          >
            <Image source={{ uri: item.image_url }} style={styles.img} />
            <View style={styles.overlay} />
            <View style={styles.body}>
              <View style={styles.chipsTop}>
                <View style={styles.catChip}>
                  <Text style={styles.catText}>{item.category?.toUpperCase()}</Text>
                </View>
                {item.attempted && (
                  <View style={styles.doneChip}>
                    <Feather name="check" size={11} color={COLORS.surface} />
                    <Text style={styles.doneText}>Best: {Math.round((item.best_score / item.questions_count) * 100)}%</Text>
                  </View>
                )}
              </View>
              <Text style={styles.chTitle}>{item.title}</Text>
              <Text style={styles.chDesc} numberOfLines={2}>{item.description}</Text>
              <View style={styles.metaRow}>
                <View style={styles.meta}>
                  <Feather name="clock" size={11} color={COLORS.brand} />
                  <Text style={styles.metaText}>{item.duration_min} min</Text>
                </View>
                <View style={styles.meta}>
                  <Feather name="help-circle" size={11} color={COLORS.brand} />
                  <Text style={styles.metaText}>{item.questions_count} Qs</Text>
                </View>
                <View style={[styles.meta, { backgroundColor: COLORS.accentSoft }]}>
                  <Feather name="award" size={11} color={COLORS.accent} />
                  <Text style={[styles.metaText, { color: COLORS.accent }]}>+{item.points} pts</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, marginTop: 2 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
  },
  img: { width: "100%", height: 130 },
  overlay: {
    position: "absolute", left: 0, right: 0, top: 0, height: 130,
    backgroundColor: "rgba(15,92,42,0.25)",
  },
  body: { padding: SPACING.md },
  chipsTop: { flexDirection: "row", gap: 6, marginBottom: 6 },
  catChip: {
    backgroundColor: COLORS.brand, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  catText: { color: COLORS.surface, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  doneChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: COLORS.success, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  doneText: { color: COLORS.surface, fontSize: 10, fontWeight: "700" },
  chTitle: { fontFamily: FONTS.heading, fontSize: 19, color: COLORS.textPrimary, marginTop: 4 },
  chDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  metaRow: { flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" },
  meta: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  metaText: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", padding: SPACING.xl },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: 8 },
});
