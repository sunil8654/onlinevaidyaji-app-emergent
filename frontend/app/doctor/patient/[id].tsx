// Doctor's view of one patient's full history — visits, prescriptions, dosha profile.
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

const rupees = (paise: number) =>
  `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default function DoctorPatientHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.doctorPatientHistory>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setErr("");
      const d = await api.doctorPatientHistory(id);
      setData(d);
    } catch (e: any) {
      setErr(e?.message || "Failed to load patient history");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="pat-back">
          <Feather name="chevron-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Patient record</Text>
          <Text style={styles.title} numberOfLines={1}>{data?.patient?.name || "…"}</Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      ) : err ? (
        <View style={styles.emptyBox}>
          <Feather name="alert-triangle" size={22} color={COLORS.warning} />
          <Text style={styles.emptyTitle}>{err}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
        >
          {/* Profile card */}
          <View style={styles.profile}>
            <View style={styles.avatarBig}>
              <Text style={styles.avatarBigText}>{data?.patient?.name?.[0]?.toUpperCase() || "P"}</Text>
            </View>
            <Text style={styles.patientName}>{data?.patient?.name}</Text>
            <View style={styles.chipsRow}>
              {data?.patient?.age ? <Chip icon="user" label={`${data.patient.age} yrs`} /> : null}
              {data?.patient?.gender ? <Chip icon="user" label={data.patient.gender} /> : null}
              {data?.patient?.dosha ? <Chip icon="feather" label={data.patient.dosha} /> : null}
            </View>
            {data?.patient?.email ? (
              <Text style={styles.contactLine}><Feather name="mail" size={11} color={COLORS.textSecondary} />  {data.patient.email}</Text>
            ) : null}
            {data?.patient?.phone ? (
              <Text style={styles.contactLine}><Feather name="phone" size={11} color={COLORS.textSecondary} />  {data.patient.phone}</Text>
            ) : null}
          </View>

          {/* Stats row */}
          <View style={styles.stats}>
            <Stat label="Visits" value={String(data?.stats?.total_visits || 0)} />
            <Stat label="Rx given" value={String(data?.stats?.total_prescriptions || 0)} />
            <Stat label="Paid" value={rupees(data?.stats?.total_paid_paise || 0)} />
          </View>

          {/* Conditions / lifestyle */}
          {(data?.patient?.conditions?.length || data?.patient?.lifestyle) ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Constitution & health</Text>
              {data?.patient?.conditions?.length ? (
                <View style={styles.chipsRow}>
                  {data.patient.conditions.map((c, i) => (
                    <View key={i} style={styles.condChip}><Text style={styles.condText}>{c}</Text></View>
                  ))}
                </View>
              ) : null}
              {data?.patient?.lifestyle ? (
                <Text style={styles.body}>{data.patient.lifestyle}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Visits */}
          <Text style={styles.sectionTitle}>All visits</Text>
          {(data?.appointments || []).map((a: any) => (
            <View key={a.id} style={styles.visitCard} testID={`pat-visit-${a.id}`}>
              <View style={styles.visitHead}>
                <View style={styles.visitDate}>
                  <Text style={styles.visitDay}>{new Date(a.slot).getDate()}</Text>
                  <Text style={styles.visitMonth}>{new Date(a.slot).toLocaleString([], { month: "short" })}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.visitTime}>
                    {new Date(a.slot).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                  </Text>
                  <Text style={styles.visitReason} numberOfLines={2}>
                    {a.reason || "No reason noted"}
                  </Text>
                  <View style={styles.tagRow}>
                    {a.paid ? <View style={styles.tag}><Text style={styles.tagText}>PAID</Text></View> : null}
                    {a.prescription ? <View style={[styles.tag, { backgroundColor: COLORS.accent }]}><Text style={styles.tagText}>Rx</Text></View> : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.rxBtn}
                  onPress={() => router.push({ pathname: "/doctor/prescription/[apptId]", params: { apptId: a.id } })}
                  testID={`pat-open-rx-${a.id}`}
                >
                  <Feather name={a.prescription ? "edit-2" : "file-plus"} size={13} color={COLORS.surface} />
                  <Text style={styles.rxBtnText}>{a.prescription ? "Edit Rx" : "Write Rx"}</Text>
                </TouchableOpacity>
              </View>

              {a.prescription ? (
                <View style={styles.rxBox}>
                  <Text style={styles.rxLbl}>Diagnosis</Text>
                  <Text style={styles.rxVal}>{a.prescription.diagnosis}</Text>
                  {a.prescription.medicines ? (
                    <>
                      <Text style={styles.rxLbl}>Medicines</Text>
                      <Text style={styles.rxVal}>{a.prescription.medicines}</Text>
                    </>
                  ) : null}
                  {a.prescription.notes ? (
                    <>
                      <Text style={styles.rxLbl}>Notes</Text>
                      <Text style={styles.rxVal}>{a.prescription.notes}</Text>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Chip({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.chip}>
      <Feather name={icon} size={11} color={COLORS.brand} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 3, fontSize: 10, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, letterSpacing: -0.5 },
  profile: { alignItems: "center", padding: SPACING.lg, marginHorizontal: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border },
  avatarBig: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center", marginBottom: SPACING.sm },
  avatarBigText: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 28 },
  patientName: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary },
  chipsRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  chipText: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
  contactLine: { color: COLORS.textSecondary, fontSize: 12, marginTop: 6 },
  stats: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  stat: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, alignItems: "center" },
  statVal: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.brand },
  statLbl: { color: COLORS.textSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 2, fontWeight: "700", marginTop: 4 },
  card: { marginHorizontal: SPACING.lg, marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary, marginBottom: 8 },
  condChip: { backgroundColor: COLORS.accentSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  condText: { color: COLORS.accent, fontSize: 11, fontWeight: "700" },
  body: { color: COLORS.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 20 },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  visitCard: { marginHorizontal: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md, overflow: "hidden" },
  visitHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md },
  visitDate: { width: 52, alignItems: "center", padding: 6, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md },
  visitDay: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.brand },
  visitMonth: { color: COLORS.brand, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  visitTime: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary },
  visitReason: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  tagRow: { flexDirection: "row", gap: 4, marginTop: 6 },
  tag: { backgroundColor: COLORS.success, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.pill },
  tagText: { color: COLORS.surface, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  rxBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 8, borderRadius: RADIUS.pill },
  rxBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 11 },
  rxBox: { padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderTopWidth: 1, borderColor: COLORS.border },
  rxLbl: { color: COLORS.textSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: "700", marginTop: 6 },
  rxVal: { color: COLORS.textPrimary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  emptyBox: { margin: SPACING.lg, alignItems: "center", padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary, marginTop: 8, textAlign: "center" },
});
