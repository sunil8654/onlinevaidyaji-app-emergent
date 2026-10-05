// Doctor's Patients list — unique patients, paged, grouped server-side in SQL.
//
// This screen read `p.total_visits` while the endpoint returned `visits`, so
// every patient showed "0 visits" regardless of how many times they had
// actually been seen.
import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api, type DoctorPatientRow } from "@/src/api";
import { useFocusRefresh } from "@/src/hooks/useFocusRefresh";

const PAGE_SIZE = 20;

/** "2026-09-25 10:30:00" is not ISO, so parse the two parts explicitly. */
function formatLastVisit(raw: string | null): string {
  if (!raw) return "No visits recorded";
  const [date, time] = raw.split(" ");
  const d = new Date(`${date}T${(time || "00:00:00").slice(0, 8)}`);
  if (Number.isNaN(d.getTime())) return date;
  return `Last visit ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
}

export default function DoctorPatients() {
  const router = useRouter();
  const [patients, setPatients] = useState<DoctorPatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async (nextPage: number) => {
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      setErr("");
      const res = await api.doctorMyPatients({ page: nextPage, limit: PAGE_SIZE });
      setPatients((prev) => (nextPage === 1 ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
      setPage(nextPage);
    } catch (e: any) {
      setErr(e?.message || "Could not load patients");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefresh(false);
    }
  }, []);

  const reload = useFocusRefresh(useCallback(() => load(1), [load]));

  const onRefresh = async () => {
    setRefresh(true);
    await load(1);
  };

  const hasMore = patients.length < total;
  // Filtering happens on the loaded page only; the search box narrows what is
  // already fetched rather than pretending to query the whole history.
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? patients.filter(
        (p) =>
          p.patient_name.toLowerCase().includes(needle) ||
          p.patient_id.toLowerCase().includes(needle)
      )
    : patients;

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
          placeholder="Search loaded patients…"
          placeholderTextColor={COLORS.textMuted}
          testID="dp-search"
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={COLORS.brand} />
        }
        onScroll={({ nativeEvent }) => {
          if (
            hasMore &&
            !loadingMore &&
            nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >
              nativeEvent.contentSize.height - 400
          ) {
            void load(page + 1);
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
              {needle ? `${filtered.length} matching` : `${patients.length} of ${total}`} patient
              {total === 1 ? "" : "s"}
            </Text>

            {err ? (
              <View style={styles.errorBox}>
                <Feather name="wifi-off" size={18} color={COLORS.error} />
                <Text style={styles.errorText}>{err}</Text>
                <TouchableOpacity onPress={reload} testID="dp-retry">
                  <Text style={styles.retry}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {!err && filtered.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="users" size={22} color={COLORS.brand} />
                <Text style={styles.emptyTitle}>
                  {needle ? "No match on this page" : "No patients yet"}
                </Text>
                <Text style={styles.emptyBody}>
                  {needle
                    ? "Clear the search to see the rest of your list."
                    : "Patients appear here after their first consultation with you."}
                </Text>
              </View>
            ) : (
              filtered.map((p) => (
                <TouchableOpacity
                  key={p.patient_id}
                  style={styles.card}
                  onPress={() =>
                    router.push({ pathname: "/doctor/patient/[id]", params: { id: p.patient_id } })
                  }
                  testID={`patient-${p.patient_id}`}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(p.patient_name || "?").slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {p.patient_name || "Patient"}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {p.total_visits} visit{p.total_visits === 1 ? "" : "s"} ·{" "}
                      {formatLastVisit(p.last_visit)}
                    </Text>
                  </View>
                  {p.has_rx ? (
                    <View style={styles.rxTag}>
                      <Feather name="file-text" size={10} color={COLORS.brand} />
                      <Text style={styles.rxTagText}>Rx</Text>
                    </View>
                  ) : null}
                  <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))
            )}

            {loadingMore ? (
              <View style={styles.center}>
                <ActivityIndicator color={COLORS.brand} />
              </View>
            ) : null}

            {!loadingMore && hasMore ? (
              <TouchableOpacity style={styles.loadMore} onPress={() => load(page + 1)} testID="dp-load-more">
                <Text style={styles.loadMoreText}>Load more patients</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
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
  center: { paddingVertical: SPACING.lg, alignItems: "center" },
  card: { marginHorizontal: SPACING.lg, marginBottom: 8, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.brand },
  name: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 15 },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rxTag: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill },
  rxTagText: { color: COLORS.brand, fontSize: 10, fontWeight: "700" },
  emptyBox: { marginHorizontal: SPACING.lg, alignItems: "center", padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary, marginTop: 8, textAlign: "center" },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  errorBox: { marginHorizontal: SPACING.lg, flexDirection: "row", alignItems: "center", gap: 8, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.error },
  errorText: { flex: 1, color: COLORS.error, fontSize: 13 },
  retry: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  loadMore: { marginHorizontal: SPACING.lg, marginTop: SPACING.sm, paddingVertical: SPACING.md, alignItems: "center", borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  loadMoreText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
});
