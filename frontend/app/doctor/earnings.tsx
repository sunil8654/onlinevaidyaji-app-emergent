// Doctor earnings dashboard.
// Aggregates paid appointments from the backend and shows summary + 30-day trend.
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

const rupees = (paise: number) =>
  `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default function DoctorEarnings() {
  const router = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.doctorEarnings>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setErr("");
      const d = await api.doctorEarnings();
      setData(d);
    } catch (e: any) {
      setErr(e?.message || "Failed to load earnings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const maxDaily = useMemo(() => {
    if (!data?.daily?.length) return 1;
    return Math.max(1, ...data.daily.map((d) => d.amount_paise));
  }, [data]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="earn-back">
          <Feather name="chevron-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Vaidya workspace</Text>
          <Text style={styles.title}>Earnings</Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
        >
          {err ? <Text style={styles.err}>{err}</Text> : null}

          {/* Big total */}
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>Total earnings</Text>
            <Text style={styles.heroValue} testID="earn-total">{rupees(data?.total_paise || 0)}</Text>
            <Text style={styles.heroSub}>
              from {data?.consultations || 0} paid consultation{(data?.consultations || 0) === 1 ? "" : "s"}
            </Text>
          </View>

          {/* Period grid */}
          <View style={styles.grid}>
            <PeriodCard label="Today" value={rupees(data?.today_paise || 0)} icon="sun" tid="earn-today" />
            <PeriodCard label="This week" value={rupees(data?.week_paise || 0)} icon="trending-up" tid="earn-week" />
            <PeriodCard label="This month" value={rupees(data?.month_paise || 0)} icon="calendar" tid="earn-month" />
          </View>

          {/* 30-day trend */}
          <Text style={styles.sectionTitle}>Last 30 days</Text>
          <View style={styles.chartCard}>
            <View style={styles.chartRow}>
              {data?.daily?.map((d) => {
                const h = Math.max(3, Math.round((d.amount_paise / maxDaily) * 100));
                const isToday = d.date === new Date().toISOString().slice(0, 10);
                return (
                  <View key={d.date} style={styles.barWrap}>
                    <View style={[styles.bar, { height: h, backgroundColor: d.amount_paise ? (isToday ? COLORS.accent : COLORS.brand) : COLORS.border }]} />
                  </View>
                );
              })}
            </View>
            <View style={styles.chartLegend}>
              <Text style={styles.legendText}>30d ago</Text>
              <Text style={styles.legendText}>Today</Text>
            </View>
          </View>

          {/* Recent transactions */}
          <Text style={styles.sectionTitle}>Recent payouts</Text>
          {!data?.recent?.length ? (
            <View style={styles.emptyBox}>
              <Feather name="inbox" size={22} color={COLORS.brand} />
              <Text style={styles.emptyTitle}>No paid consultations yet</Text>
              <Text style={styles.emptyBody}>
                Once patients complete payment for a booking, it&apos;ll show up here.
              </Text>
            </View>
          ) : (
            data.recent.map((r, i) => (
              <View key={`${r.razorpay_payment_id || i}`} style={styles.txnCard} testID={`earn-txn-${i}`}>
                <View style={styles.txnAvatar}>
                  <Text style={styles.txnAvatarText}>{r.patient_name?.[0]?.toUpperCase() || "P"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txnName}>{r.patient_name}</Text>
                  <Text style={styles.txnMeta}>
                    {r.verified_at ? new Date(r.verified_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"}
                  </Text>
                  {r.razorpay_payment_id ? (
                    <Text style={styles.txnRef}>{r.razorpay_payment_id}</Text>
                  ) : null}
                </View>
                <Text style={styles.txnAmount}>+{rupees(r.amount_paise)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PeriodCard({ label, value, icon, tid }: { label: string; value: string; icon: any; tid: string }) {
  return (
    <View style={styles.periodCard} testID={tid}>
      <View style={styles.periodIcon}>
        <Feather name={icon} size={14} color={COLORS.brand} />
      </View>
      <Text style={styles.periodValue}>{value}</Text>
      <Text style={styles.periodLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 3, fontSize: 10, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.textPrimary, letterSpacing: -0.5 },
  err: { color: COLORS.error, textAlign: "center", padding: SPACING.md },
  hero: { marginHorizontal: SPACING.lg, padding: SPACING.lg, backgroundColor: COLORS.brand, borderRadius: RADIUS.xl },
  heroEyebrow: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 2, fontSize: 11, fontWeight: "700" },
  heroValue: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 44, marginTop: 8, letterSpacing: -1 },
  heroSub: { color: COLORS.accentSoft, marginTop: 4, fontSize: 13 },
  grid: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  periodCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, alignItems: "flex-start" },
  periodIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  periodValue: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  periodLabel: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: "700", marginTop: 2 },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  chartCard: { marginHorizontal: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
  chartRow: { flexDirection: "row", alignItems: "flex-end", height: 110, gap: 2 },
  barWrap: { flex: 1, alignItems: "center" },
  bar: { width: "100%", borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 3 },
  chartLegend: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  legendText: { color: COLORS.textMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  emptyBox: { marginHorizontal: SPACING.lg, alignItems: "center", padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: 8 },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  txnCard: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginHorizontal: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  txnAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  txnAvatarText: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 18 },
  txnName: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  txnMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  txnRef: { color: COLORS.textMuted, fontSize: 10, marginTop: 2, fontFamily: FONTS.mono },
  txnAmount: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.success },
});
