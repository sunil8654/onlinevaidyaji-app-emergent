import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api, type Appointment, type AppointmentPage } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";
import { RazorpayCheckout } from "@/src/components/RazorpayCheckout";
import { useAuth } from "@/src/auth";
import { openPrescriptionPdf } from "@/src/utils/prescriptionPdf";
import { formatINR } from "@/src/utils/currency";
import { appointmentDate } from "@/src/utils/appointments";
import { ListState } from "@/src/components/ComingSoon";

const PAGE_SIZE = 20;

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: "Awaiting confirmation", bg: "#FFF4E5", fg: "#B26A00" },
  confirmed: { label: "Confirmed", bg: "#E8F5E9", fg: COLORS.success },
  completed: { label: "Completed", bg: COLORS.surfaceAlt, fg: COLORS.textSecondary },
  cancelled: { label: "Cancelled", bg: "#FCE8E6", fg: COLORS.error },
};

/** `appointment_date` + `appointment_time` are the authoritative real columns. */
const when = appointmentDate;

/**
 * Optional-chained on purpose: `amount={feeOf(payTarget)}` is evaluated on every
 * render, including the first one where `payTarget` is still `null`. Reading
 * `a.amount` off that threw a TypeError during render, so opening this screen
 * killed the app before a single frame was painted.
 */
const feeOf = (a: Appointment | null | undefined) =>
  Number((a as any)?.amount ?? (a as any)?.doctor_fee ?? 0) || 0;

const rxOf = (a: Appointment) =>
  (a as any).prescription as
    | { diagnosis?: string; medicines?: string; notes?: string; author_name?: string; written_at?: string }
    | undefined;

/**
 * `request()` in `src/api.ts` ends with `return data as T` - the envelope is
 * asserted, never checked. If a reply ever arrives without an array `items`
 * (an older build, a caching proxy, the bare-array form of this endpoint), then
 * `for (const a of items)` in the upcoming/past memo throws "items is not
 * iterable" during render and takes the screen down. Coerce once, here.
 */
function normalizePage(res: any, page: number): AppointmentPage {
  const items: Appointment[] = Array.isArray(res?.items) ? res.items : [];
  const total = Number(res?.total);
  return {
    items,
    total: Number.isFinite(total) && total >= 0 ? total : items.length,
    page: Number(res?.page) || page,
    limit: Number(res?.limit) || PAGE_SIZE,
    has_more: !!res?.has_more,
  };
}

/**
 * Appointment history — every record, newest first, paged from the server.
 *
 * Two things were wrong before:
 *  - it called the legacy `/appointments` array endpoint, which the server caps
 *    at 200 rows, so a long history silently lost its tail;
 *  - it rendered `new Date(item.slot)` from a JSON blob while the real
 *    `appointment_date`/`appointment_time` columns went unused, and the
 *    "Add prescription" sheet let a patient type a prescription into their own
 *    medical record (the API has rejected that with 403 since SEC-003, so the
 *    button only ever produced an error).
 */
export default function Appointments() {
  const router = useRouter();
  const { user } = useAuth();

  const [items, setItems] = useState<Appointment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<Appointment | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    const res = await api.listAppointmentsPaged({ page: p, limit: PAGE_SIZE, scope: "all" });
    return normalizePage(res, p);
  }, []);

  /**
   * "Now" is state rather than a `Date.now()` call during render: reading the
   * clock mid-render is impure, and a memoised upcoming/past split would stay
   * stale for as long as the app sat open across an appointment's start time.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetchPage(1);
        setItems(res.items);
        setTotal(res.total);
        setPage(1);
        setHasMore(res.has_more);
        setNow(Date.now());
      } catch (e: any) {
        setItems([]);
        setError(e?.message || "Could not load your appointments.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchPage]
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await fetchPage(next);
      setItems((prev) => [...prev, ...res.items]);
      setPage(next);
      setHasMore(res.has_more);
    } catch {
      // Leave `hasMore` alone so the patient can retry by scrolling again.
    } finally {
      setLoadingMore(false);
    }
  };

  const refresh = useCallback(() => load("refresh"), [load]);

  /** Newest-first from the server; upcoming reads best-first when reversed. */
  const { upcoming, past } = useMemo(() => {
    const up: { a: Appointment; d: Date }[] = [];
    const pastList: { a: Appointment; d: Date }[] = [];
    for (const a of items) {
      const d = when(a);
      if (!d) continue;
      (d.getTime() >= now ? up : pastList).push({ a, d });
    }
    up.sort((x, y) => x.d.getTime() - y.d.getTime());
    pastList.sort((x, y) => y.d.getTime() - x.d.getTime());
    return { upcoming: up, past: pastList };
  }, [items, now]);

  const sections = useMemo(() => {
    const out: { key: string; title: string; data: { a: Appointment; d: Date }[] }[] = [];
    if (upcoming.length) out.push({ key: "up", title: "Upcoming", data: upcoming });
    if (past.length) out.push({ key: "past", title: "Past", data: past });
    return out;
  }, [upcoming, past]);

  const renderCard = ({ a, d }: { a: Appointment; d: Date }) => {
    const status = (a.status || "pending").toLowerCase();
    const st = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
    const fee = feeOf(a);
    const paid = !!(a as any).paid;
    const rx = rxOf(a);
    const isPast = d.getTime() < now;
    const canJoin =
      !isPast && status !== "cancelled" && (a.type || "online") === "online";

    return (
      <View style={styles.card} testID={`appt-${a.id}`}>
        <View style={styles.rowTop}>
          <View style={styles.dateBox}>
            <Text style={styles.dateNum}>{d.getDate()}</Text>
            <Text style={styles.dateMo}>
              {d.toLocaleString("en-IN", { month: "short" })}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.docName} numberOfLines={1}>
              {a.doctor_name || "Doctor"}
            </Text>
            {a.doctor_specialty ? (
              <Text style={styles.docSpec}>{a.doctor_specialty}</Text>
            ) : null}
            <Text style={styles.docTime}>
              {d.toLocaleString("en-IN", {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
              {a.type ? ` · ${a.type === "offline" ? "In person" : "Online"}` : ""}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
            <Text style={[styles.statusText, { color: st.fg }]}>{st.label}</Text>
          </View>
        </View>

        {a.reason ? (
          <Text style={styles.reason} numberOfLines={2}>
            {a.reason}
          </Text>
        ) : null}

        <View style={styles.actionRow}>
          {canJoin ? (
            <TouchableOpacity
              style={styles.joinBtn}
              onPress={() =>
                router.push({
                  pathname: "/video-call",
                  params: {
                    doctor_name: a.doctor_name || "VaidyaJi",
                    doctor_specialty: a.doctor_specialty || "",
                    appt_id: a.id,
                  },
                })
              }
              testID={`appt-join-${a.id}`}
            >
              <Feather name="video" size={14} color={COLORS.surface} />
              <Text style={styles.joinText}>Join call</Text>
            </TouchableOpacity>
          ) : null}

          {/* Only offer payment when the appointment carries a real fee. With no
              fee on file the server refuses to create an order, so a made-up
              amount here would only fail at checkout. */}
          {!paid && fee > 0 && status !== "cancelled" ? (
            <TouchableOpacity
              style={styles.payBtn}
              onPress={() => setPayTarget(a)}
              testID={`appt-pay-${a.id}`}
            >
              <Feather name="credit-card" size={14} color={COLORS.surface} />
              <Text style={styles.joinText}>Pay {formatINR(fee)}</Text>
            </TouchableOpacity>
          ) : null}
          {paid ? (
            <View style={styles.paidPill}>
              <Feather name="check" size={11} color={COLORS.success} />
              <Text style={styles.paidText}>PAID</Text>
            </View>
          ) : null}

          {rx ? (
            <TouchableOpacity
              style={styles.rxBtn}
              onPress={() =>
                Alert.alert(
                  rx.diagnosis || "Prescription",
                  [rx.author_name ? `Dr. ${rx.author_name}` : null, rx.medicines, rx.notes]
                    .filter(Boolean)
                    .join("\n\n")
                )
              }
              testID={`appt-rx-${a.id}`}
            >
              <Feather name="file-text" size={14} color={COLORS.surface} />
              <Text style={styles.joinText}>Rx</Text>
            </TouchableOpacity>
          ) : null}
          {rx ? (
            <TouchableOpacity
              style={styles.pdfBtn}
              onPress={() => openPrescriptionPdf(a.id)}
              testID={`appt-rx-pdf-${a.id}`}
              accessibilityLabel="Download prescription as PDF"
            >
              <Feather name="download" size={14} color={COLORS.surface} />
              <Text style={styles.joinText}>PDF</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  const emptyState = loading ? (
    <View style={{ paddingVertical: SPACING.xl }}>
      <ActivityIndicator color={COLORS.brand} />
    </View>
  ) : error ? (
    <ListState
      icon="wifi-off"
      tone="error"
      title="Could not load appointments"
      body={error}
      actionLabel="Try again"
      onAction={() => load("initial")}
      testID="appts-error"
    />
  ) : (
    <ListState
      icon="calendar"
      title="No appointments yet"
      body="Book a consultation and it will show up here with your doctor, time and status."
      actionLabel="Find a doctor"
      onAction={() => router.push("/(tabs)/consult")}
      testID="appts-empty"
    />
  );

  const footer = (
    <View style={{ paddingTop: SPACING.md }}>
      {loadingMore ? (
        <ActivityIndicator color={COLORS.brand} />
      ) : hasMore ? (
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={loadMore}
          testID="appts-more"
        >
          <Text style={styles.moreText}>
            Load more ({items.length} of {total})
          </Text>
        </TouchableOpacity>
      ) : items.length > 0 ? (
        <Text style={styles.endText}>
          {`That is all ${total} record${total === 1 ? "" : "s"}.`}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity
          onPress={() => router.back()}
          testID="appts-back"
          style={{ width: 40 }}
        >
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>My appointments</Text>
          {total > 0 ? (
            <Text style={styles.count}>
              {total} record{total === 1 ? "" : "s"}
              {hasMore ? ` · showing ${items.length}` : ""}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={refresh}
          style={styles.refreshBtn}
          testID="appts-refresh"
          accessibilityLabel="Refresh appointments"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={COLORS.brand} />
          ) : (
            <Feather name="refresh-cw" size={18} color={COLORS.brand} />
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={sections}
        keyExtractor={(s) => s.key}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.brand} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={emptyState}
        renderItem={({ item: section }) => (
          <View>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.data.map((row, i) => (
              <View key={row.a.id}>
                {i > 0 ? <View style={{ height: SPACING.md }} /> : null}
                {renderCard(row)}
              </View>
            ))}
          </View>
        )}
        ListFooterComponent={footer}
      />

      <RazorpayCheckout
        visible={!!payTarget}
        onClose={() => setPayTarget(null)}
        onSuccess={() => {
          Alert.alert("Payment successful", "Your consultation is confirmed.");
          setPayTarget(null);
          refresh();
        }}
        onFailure={(reason) => {
          if (reason && reason !== "payment_failed" && reason !== "verification_failed") {
            Alert.alert("Payment issue", reason);
          }
        }}
        amount={feeOf(payTarget)}
        purpose="appointment"
        reference_id={payTarget?.id}
        description={`Consultation with ${payTarget?.doctor_name || "Vaidya"}`}
        title="Online VaidyaJi"
        prefill={{
          name: user?.name || "",
          email: user?.email || "",
          contact: user?.phone || "",
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  count: { color: COLORS.textMuted, fontSize: 11, marginTop: 1 },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.accent,
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: SPACING.md },
  dateBox: {
    width: 52,
    alignItems: "center",
    paddingVertical: 8,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md,
  },
  dateNum: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.brand },
  dateMo: {
    color: COLORS.brand,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  docName: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary },
  docSpec: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  docTime: { color: COLORS.textSecondary, marginTop: 4, fontSize: 12 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    maxWidth: 110,
  },
  statusText: { fontSize: 10, fontWeight: "700" },
  reason: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: SPACING.sm,
    fontStyle: "italic",
  },
  actionRow: { flexDirection: "row", gap: 8, marginTop: SPACING.md, flexWrap: "wrap" },
  joinBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.brand,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
  },
  payBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E07B00",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
  },
  paidPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: "#E8F5E9",
    alignSelf: "flex-start",
  },
  paidText: { color: COLORS.success, fontWeight: "700", fontSize: 10, letterSpacing: 1 },
  rxBtn: {
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.accent,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
  },
  pdfBtn: {
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.brand,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
  },
  joinText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  moreBtn: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  moreText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  endText: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: "center",
    paddingVertical: SPACING.md,
  },
});
