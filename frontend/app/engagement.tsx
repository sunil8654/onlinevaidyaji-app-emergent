// Engagement Suite — points, streak, badges, level, history.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function EngagementScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.engagementMe();
      setData(d);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load engagement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onCheckin() {
    setCheckingIn(true);
    try {
      const r = await api.engagementCheckin();
      if (r.already_checked_in) {
        Alert.alert("Already checked in", `Streak: ${r.streak_current} 🔥`);
      } else {
        const msg = `+${r.points_awarded} points · streak ${r.streak_current} 🔥` +
          (r.new_badges && r.new_badges.length ? `\n🏅 New badge: ${r.new_badges.join(", ")}` : "");
        Alert.alert("Nice work!", msg);
      }
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Check-in failed");
    } finally {
      setCheckingIn(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  const lvl = data?.level || { level: 1, title: "Seeker", next_at: 100, progress_pct: 0 };
  const todayISO = new Date().toISOString().slice(0, 10);
  const checkedInToday = data?.streak_last_date === todayISO;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="eng-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>My Rewards</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={COLORS.brand}
          />
        }
      >
        {/* Points + Level hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.pointsLabel}>Points</Text>
              <Text style={styles.pointsValue}>{data?.points ?? 0}</Text>
            </View>
            <View style={styles.levelBadge}>
              <Feather name="award" size={13} color={COLORS.accent} />
              <Text style={styles.levelText}>Lvl {lvl.level} · {lvl.title}</Text>
            </View>
          </View>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${lvl.progress_pct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {lvl.next_at
              ? `${lvl.next_at - (data?.points || 0)} pts to ${lvl.next_title}`
              : "Max level reached — Vaidhya Ratna 🕉️"}
          </Text>
        </View>

        {/* Streak + Check-in */}
        <View style={styles.streakRow}>
          <View style={styles.streakCard}>
            <Feather name="zap" size={20} color={COLORS.accent} />
            <Text style={styles.streakValue}>{data?.streak_current ?? 0}</Text>
            <Text style={styles.streakLabel}>Current streak</Text>
          </View>
          <View style={styles.streakCard}>
            <Feather name="trending-up" size={20} color={COLORS.brand} />
            <Text style={styles.streakValue}>{data?.streak_max ?? 0}</Text>
            <Text style={styles.streakLabel}>Best streak</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.checkinBtn, checkedInToday && styles.checkinDone]}
          onPress={onCheckin}
          disabled={checkingIn}
          testID="eng-checkin"
        >
          {checkingIn ? <ActivityIndicator color={COLORS.surface} /> : (
            <>
              <Feather name={checkedInToday ? "check-circle" : "sun"} size={18} color={COLORS.surface} />
              <Text style={styles.checkinText}>
                {checkedInToday ? "Checked in today ✓" : "Daily check-in (+10 pts)"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Quests / quick actions */}
        <Text style={styles.sectionLabel}>Earn more points</Text>
        <View style={styles.questGrid}>
          <QuestTile icon="book-open" title="Take a quiz"  sub="+55 pts on 100%" onPress={() => router.push("/quiz")} testID="eng-quest-quiz" />
          <QuestTile icon="target"     title="Join a challenge" sub="+25 pts" onPress={() => router.push("/challenges")} testID="eng-quest-challenge" />
          <QuestTile icon="activity"   title="Log wellness"  sub="Track a metric" onPress={() => router.push("/wellness")} testID="eng-quest-wellness" />
          <QuestTile icon="message-square" title="Post in community" sub="+10 pts" onPress={() => router.push("/community")} testID="eng-quest-community" />
        </View>

        {/* Badges */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>Badges</Text>
          <Text style={styles.count}>{data?.badges_earned || 0}/{data?.badges_total || 0}</Text>
        </View>
        <View style={styles.badgeGrid}>
          {(data?.badges || []).map((b: any) => (
            <View key={b.key} style={[styles.badge, !b.earned && styles.badgeLocked]}>
              <View style={[styles.badgeIcon, !b.earned && { backgroundColor: COLORS.border }]}>
                <Feather name={b.icon as any} size={20} color={b.earned ? COLORS.surface : COLORS.textMuted} />
              </View>
              <Text style={[styles.badgeTitle, !b.earned && { color: COLORS.textMuted }]} numberOfLines={2}>{b.title}</Text>
              <Text style={styles.badgePoints}>+{b.points} pts</Text>
            </View>
          ))}
        </View>

        {/* History */}
        <Text style={styles.sectionLabel}>Recent activity</Text>
        {(data?.history || []).length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="clock" size={22} color={COLORS.brand} />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyBody}>Start by checking in above.</Text>
          </View>
        ) : (
          <View style={styles.historyList}>
            {data.history.map((h: any, i: number) => (
              <View key={i} style={styles.historyRow}>
                <View style={styles.historyDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyTitle}>{prettyReason(h.reason)}</Text>
                  <Text style={styles.historyTime}>{new Date(h.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
                </View>
                <Text style={styles.historyPts}>+{h.points}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function prettyReason(r: string): string {
  if (r === "daily_checkin") return "Daily check-in";
  if (r === "quiz_submitted") return "Completed a quiz";
  if (r === "challenge_joined") return "Joined a challenge";
  if (r.startsWith("badge:")) return `Earned badge: ${r.slice(6).replace(/_/g, " ")}`;
  return r.replace(/_/g, " ");
}

function QuestTile({ icon, title, sub, onPress, testID }: any) {
  return (
    <TouchableOpacity style={styles.quest} onPress={onPress} testID={testID}>
      <View style={styles.questIcon}>
        <Feather name={icon} size={18} color={COLORS.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.questTitle}>{title}</Text>
        <Text style={styles.questSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary },
  hero: {
    margin: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.brand, borderRadius: RADIUS.lg,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pointsLabel: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 2, fontSize: 11, fontWeight: "700" },
  pointsValue: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 46, marginTop: 2 },
  levelBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: COLORS.surface, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  levelText: { color: COLORS.brand, fontWeight: "700", fontSize: 11 },
  progressBg: {
    height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.2)",
    marginTop: SPACING.md, overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: COLORS.accent, borderRadius: 4 },
  progressLabel: { color: COLORS.accentSoft, fontSize: 12, marginTop: 6 },
  streakRow: { flexDirection: "row", gap: SPACING.md, paddingHorizontal: SPACING.lg },
  streakCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
    alignItems: "center",
  },
  streakValue: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.textPrimary, marginTop: 4 },
  streakLabel: { color: COLORS.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700", marginTop: 4 },
  checkinBtn: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.accent, paddingVertical: 14,
    borderRadius: RADIUS.pill,
  },
  checkinDone: { backgroundColor: COLORS.success },
  checkinText: { color: COLORS.surface, fontWeight: "700", fontSize: 14, letterSpacing: 0.5 },
  sectionLabel: {
    paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.sm,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingRight: SPACING.lg },
  count: { color: COLORS.textMuted, fontSize: 11, marginBottom: SPACING.sm, fontWeight: "700" },
  questGrid: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  quest: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  questIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  questTitle: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  questSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  badgeGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  badge: {
    width: "31%", backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.sm, alignItems: "center",
  },
  badgeLocked: { opacity: 0.55 },
  badgeIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  badgeTitle: { color: COLORS.textPrimary, fontSize: 11, fontWeight: "700", textAlign: "center", minHeight: 30 },
  badgePoints: { color: COLORS.accent, fontSize: 10, fontWeight: "700", marginTop: 2 },
  emptyBox: {
    marginHorizontal: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center",
  },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: 8 },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  historyList: {
    marginHorizontal: SPACING.lg, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.md, gap: SPACING.sm,
  },
  historyRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  historyTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "700" },
  historyTime: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  historyPts: { color: COLORS.brand, fontWeight: "700", fontSize: 14 },
});
