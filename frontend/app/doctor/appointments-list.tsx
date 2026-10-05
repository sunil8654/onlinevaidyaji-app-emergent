// Doctor's Appointments queue — upcoming + past consults, paged.
//
// Dates come from the real `appointment_date` / `appointment_time` columns and
// the past/upcoming split is resolved in SQL by the server. This screen used to
// build its own dates from the JSON-blob `slot` field and split the list on the
// device; when `slot` was absent the dates were Invalid and *both* filters
// dropped every row, so the whole queue rendered empty.
import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api, type Appointment } from "@/src/api";
import { useFocusRefresh } from "@/src/hooks/useFocusRefresh";
import {
  appointmentDate,
  formatApptDay,
  formatApptStatus,
  formatApptTime,
  formatApptType,
  rupeesFromPaise,
} from "@/src/utils/appointments";

type Tab = "upcoming" | "past";

const PAGE_SIZE = 20;

export default function DoctorAppointments() {
  const router = useRouter();
  // This screen has two entry points: the Appointments *tab* (no back button
  // wanted) and a push from Profile > My Appointments. The root Stack sets
  // `headerShown: false`, so without an explicit back button the pushed copy
  // would leave a doctor with no visible way out. `standalone` is the explicit
  // signal - deriving it from `canGoBack()` would wrongly show a back arrow on
  // the tab, since there is usually still signup/login history behind it.
  const { standalone } = useLocalSearchParams<{ standalone?: string }>();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [items, setItems] = useState<Appointment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(
    async (nextPage: number, mode: Tab) => {
      if (nextPage === 1) setLoading(true);
      else setLoadingMore(true);
      try {
        setErr("");
        const res = await api.doctorMyAppointments({
          scope: mode,
          page: nextPage,
          limit: PAGE_SIZE,
        });
        setItems((prev) => (nextPage === 1 ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
        setPage(nextPage);
      } catch (e: any) {
        setErr(e?.message || "Could not load appointments");
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefresh(false);
      }
    },
    []
  );

  // Reloads on mount, on tab focus and when the app returns to the foreground,
  // so a booking made elsewhere shows up without a manual pull.
  const reload = useFocusRefresh(useCallback(() => load(1, tab), [load, tab]));

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setItems([]);
    setTotal(0);
    void load(1, next);
  };

  const onRefresh = async () => {
    setRefresh(true);
    await load(1, tab);
  };

  const hasMore = items.length < total;

  const renderRow = (a: Appointment) => {
    const d = appointmentDate(a);
    const day = formatApptDay(a);
    const time = formatApptTime(a);
    const cancelled = (a.status || "").toLowerCase() === "cancelled";
    return (
      <TouchableOpacity
        style={[styles.card, cancelled && styles.cardCancelled]}
        onPress={() =>
          router.push({ pathname: "/doctor/prescription/[apptId]", params: { apptId: a.id } })
        }
        testID={`appt-${a.id}`}
        disabled={!d}
      >
        <View style={styles.dateBlock}>
          <Text style={styles.dateTop} numberOfLines={1}>
            {day}
          </Text>
          <Text style={styles.dateBot}>{time || "--"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.patient} numberOfLines={1}>
            {a.patient_name || "Patient"}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatApptType(a)} · {formatApptStatus(a)}
          </Text>
          {a.paid ? (
            <Text style={styles.paidTag}>Paid {rupeesFromPaise(a.amount_paise)}</Text>
          ) : (
            <Text style={styles.pendingTag}>Payment pending</Text>
          )}
        </View>
        <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        {standalone ? (
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            testID="appt-back"
            accessibilityLabel="Back to profile"
          >
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Clinic Queue</Text>
          <Text style={styles.title}>Appointments</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(["upcoming", "past"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => switchTab(t)}
            testID={`appt-tab-${t}`}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "upcoming" ? "Upcoming" : "Past"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={COLORS.brand} />
        }
        onScroll={({ nativeEvent }) => {
          // Fetch the next page before the user hits the bottom.
          if (
            hasMore &&
            !loadingMore &&
            nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >
              nativeEvent.contentSize.height - 400
          ) {
            void load(page + 1, tab);
          }
        }}
        scrollEventThrottle={400}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.brand} />
          </View>
        ) : (
          <>
            <Text style={styles.count}>
              {total} {tab === "upcoming" ? "upcoming" : "past"} appointment
              {total === 1 ? "" : "s"}
            </Text>

            {err ? (
              <View style={styles.errorBox}>
                <Feather name="wifi-off" size={18} color={COLORS.error} />
                <Text style={styles.errorText}>{err}</Text>
                <TouchableOpacity onPress={reload} testID="appt-retry">
                  <Text style={styles.retry}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {!err && items.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="calendar" size={22} color={COLORS.brand} />
                <Text style={styles.emptyTitle}>
                  {tab === "upcoming" ? "No upcoming appointments" : "No past consultations yet"}
                </Text>
                <Text style={styles.emptyBody}>
                  {tab === "upcoming"
                    ? "New bookings will appear here as patients schedule them."
                    : "Completed and cancelled consultations are kept here."}
                </Text>
              </View>
            ) : (
              items.map(renderRow)
            )}

            {loadingMore ? (
              <View style={styles.center}>
                <ActivityIndicator color={COLORS.brand} />
              </View>
            ) : null}

            {!loadingMore && hasMore ? (
              <TouchableOpacity
                style={styles.loadMore}
                onPress={() => load(page + 1, tab)}
                testID="appt-load-more"
              >
                <Text style={styles.loadMoreText}>Load older appointments</Text>
              </TouchableOpacity>
            ) : null}

            {!loadingMore && !hasMore && items.length > 0 ? (
              <Text style={styles.endOfList}>End of list · {total} total</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.textPrimary, marginTop: 4 },
  tabs: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm },
  tab: { paddingVertical: 8, paddingHorizontal: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tabText: { fontSize: 13, fontWeight: "700", color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.surface },
  count: { paddingHorizontal: SPACING.lg, color: COLORS.textMuted, fontSize: 11, marginBottom: SPACING.sm, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  center: { paddingVertical: SPACING.lg, alignItems: "center" },
  card: { marginHorizontal: SPACING.lg, marginBottom: 8, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  cardCancelled: { opacity: 0.6 },
  dateBlock: { width: 72, alignItems: "center", backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.sm, padding: 6 },
  dateTop: { fontFamily: FONTS.heading, fontSize: 13, color: COLORS.brand },
  dateBot: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  patient: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 15 },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  paidTag: { color: COLORS.success, fontSize: 11, marginTop: 4, fontWeight: "700" },
  pendingTag: { color: COLORS.warning, fontSize: 11, marginTop: 4, fontWeight: "700" },
  emptyBox: { marginHorizontal: SPACING.lg, alignItems: "center", padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary, marginTop: 8, textAlign: "center" },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  errorBox: { marginHorizontal: SPACING.lg, flexDirection: "row", alignItems: "center", gap: 8, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.error },
  errorText: { flex: 1, color: COLORS.error, fontSize: 13 },
  retry: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  loadMore: { marginHorizontal: SPACING.lg, marginTop: SPACING.sm, paddingVertical: SPACING.md, alignItems: "center", borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  loadMoreText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  endOfList: { paddingVertical: SPACING.lg, textAlign: "center", color: COLORS.textMuted, fontSize: 11 },
});
