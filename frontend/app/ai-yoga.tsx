// AI Yoga library — categorised curated video sessions.
// Doesn't lock content behind a subscription anymore; the subscription still
// exists as an optional upsell for weekly yogacharya check-ins.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

export default function AiYoga() {
  const router = useRouter();
  const [lib, setLib] = useState<Awaited<ReturnType<typeof api.yogaLibrary>> | null>(null);
  const [mine, setMine] = useState<Awaited<ReturnType<typeof api.yogaMine>> | null>(null);
  const [cat, setCat] = useState("All");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setErr("");
      const [l, m] = await Promise.all([
        api.yogaLibrary({ category: cat === "All" ? undefined : cat }),
        api.yogaMine().catch(() => null),
      ]);
      setLib(l);
      setMine(m);
    } catch (e: any) {
      setErr(e?.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [cat]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <TouchableOpacity onPress={() => router.back()} testID="yg-back" style={styles.back}>
            <Feather name="arrow-left" size={20} color={COLORS.surface} />
          </TouchableOpacity>
          <Text style={styles.eyebrow}>AI YOGA · CURATED</Text>
          <Text style={styles.title}>Your daily{"\n"}yoga library</Text>
          <Text style={styles.sub}>Guided classes for every mood — pose-by-pose timings, dosha suggestions, and a personal streak.</Text>

          {/* Stats */}
          {mine ? (
            <View style={styles.statsRow}>
              <StatPill icon="zap" value={String(mine.streak_days)} label="day streak" />
              <StatPill icon="clock" value={String(mine.total_minutes)} label="minutes" />
              <StatPill icon="check-circle" value={String(mine.total_sessions)} label="sessions" />
            </View>
          ) : null}
        </View>

        {/* Loading / error */}
        {loading ? (
          <View style={{ alignItems: "center", padding: SPACING.xl }}><ActivityIndicator color={COLORS.brand} /></View>
        ) : err ? (
          <Text style={styles.err}>{err}</Text>
        ) : lib ? (
          <>
            {/* Dosha recommended */}
            {lib.dosha && lib.recommended.length > 0 && (
              <>
                <View style={styles.sectionHead}>
                  <View>
                    <Text style={styles.sectionEyebrow}>For your Prakriti · {lib.dosha}</Text>
                    <Text style={styles.sectionTitle}>Recommended for you</Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {lib.recommended.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.recCard}
                      onPress={() => router.push({ pathname: "/yoga/[id]", params: { id: s.id } })}
                      testID={`yg-rec-${s.id}`}
                    >
                      <Image source={{ uri: s.thumbnail }} style={styles.recThumb} />
                      <View style={styles.recBadge}><Text style={styles.recBadgeText}>{s.duration_min} min</Text></View>
                      <View style={styles.recTextWrap}>
                        <Text style={styles.recTitle} numberOfLines={2}>{s.title}</Text>
                        <Text style={styles.recSub}>{s.category} · {s.level}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Category chips */}
            <View style={styles.sectionHead}>
              <View>
                <Text style={styles.sectionEyebrow}>All sessions</Text>
                <Text style={styles.sectionTitle}>Browse by category</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: SPACING.lg, marginBottom: 8 }}>
              {lib.categories.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, cat === c && styles.chipActive]}
                  onPress={() => setCat(c)}
                  testID={`yg-cat-${c}`}
                >
                  <Text style={[styles.chipText, cat === c && styles.chipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* All items */}
            <View style={{ gap: SPACING.md, paddingHorizontal: SPACING.lg }}>
              {lib.items.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.itemCard}
                  onPress={() => router.push({ pathname: "/yoga/[id]", params: { id: s.id } })}
                  testID={`yg-item-${s.id}`}
                >
                  <Image source={{ uri: s.thumbnail }} style={styles.itemThumb} />
                  <View style={{ flex: 1, padding: SPACING.md }}>
                    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                      <MiniTag text={s.category} />
                      <MiniTag text={s.level} tone="alt" />
                      {s.dosha_target.slice(0, 2).map((d) => <MiniTag key={d} text={d} tone="brand" />)}
                    </View>
                    <Text style={styles.itemTitle} numberOfLines={2}>{s.title}</Text>
                    <Text style={styles.itemMeta}>{s.instructor} · {s.duration_min} min</Text>
                  </View>
                  <View style={styles.playBtn}>
                    <Feather name="play" size={16} color={COLORS.surface} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Subscription upsell */}
            <View style={styles.priceCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.priceKicker}>WEEKLY YOGACHARYA · ₹500/mo</Text>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                  <Text style={styles.priceBig}>₹500</Text>
                  <Text style={styles.pricePer}>/ month</Text>
                </View>
                <Text style={styles.priceNote}>Video library is free · pay only for weekly 1:1 check-in with a real teacher.</Text>
              </View>
              <TouchableOpacity
                style={styles.subBtn}
                onPress={() => router.push("/plan-checkout?type=ai-yoga&price=500")}
                testID="yg-subscribe"
              >
                <Text style={styles.subText}>Try 3 days free</Text>
                <Feather name="arrow-right" size={14} color={COLORS.surface} />
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatPill({ icon, value, label }: { icon: any; value: string; label: string }) {
  return (
    <View style={styles.statPill}>
      <Feather name={icon} size={12} color={COLORS.accent} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MiniTag({ text, tone = "default" }: { text: string; tone?: "default" | "alt" | "brand" }) {
  const bg = tone === "brand" ? COLORS.brand : tone === "alt" ? COLORS.accentSoft : COLORS.surfaceAlt;
  const fg = tone === "brand" ? COLORS.surface : tone === "alt" ? COLORS.accent : COLORS.textSecondary;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill }}>
      <Text style={{ color: fg, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  hero: { backgroundColor: COLORS.brand, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg, paddingTop: SPACING.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center", marginBottom: SPACING.md },
  eyebrow: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 36, marginTop: 6, letterSpacing: -1, lineHeight: 40 },
  sub: { color: "#FFFDF3", marginTop: 8, fontSize: 13, lineHeight: 18 },
  statsRow: { flexDirection: "row", gap: 8, marginTop: SPACING.md },
  statPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.2)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  statValue: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 14 },
  statLabel: { color: COLORS.accentSoft, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: "700" },
  err: { color: COLORS.error, padding: SPACING.md, textAlign: "center" },

  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.md },
  sectionEyebrow: { color: COLORS.accent, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, marginTop: 2, letterSpacing: -0.5 },

  hScroll: { paddingHorizontal: SPACING.lg, gap: 12, paddingBottom: 4 },
  recCard: { width: 200, borderRadius: RADIUS.lg, overflow: "hidden", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  recThumb: { width: "100%", height: 120, backgroundColor: COLORS.surfaceAlt },
  recBadge: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  recBadgeText: { color: COLORS.surface, fontSize: 10, fontWeight: "700" },
  recTextWrap: { padding: SPACING.sm },
  recTitle: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.textPrimary, lineHeight: 18 },
  recSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },

  chip: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },

  itemCard: { flexDirection: "row", overflow: "hidden", backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  itemThumb: { width: 100, height: "100%", minHeight: 110, backgroundColor: COLORS.surfaceAlt },
  itemTitle: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary, lineHeight: 19 },
  itemMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  playBtn: { alignSelf: "center", marginRight: SPACING.md, width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },

  priceCard: { margin: SPACING.lg, backgroundColor: COLORS.brand, borderRadius: RADIUS.lg, padding: SPACING.md, flexDirection: "row", alignItems: "center", gap: 12 },
  priceKicker: { color: COLORS.accentSoft, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  priceBig: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.surface, letterSpacing: -1 },
  pricePer: { color: COLORS.accentSoft, fontSize: 12 },
  priceNote: { color: "#FFFDF3", fontSize: 11, marginTop: 4, lineHeight: 15 },
  subBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill },
  subText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
});
