// Doctor's Appointments queue — full-page view of upcoming + today's consults.
import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function DoctorAppointments() {
  const router = useRouter();
  const [appts, setAppts] = useState<any[]>([]);
  const [refresh, setRefresh] = useState(false);

  const load = useCallback(async () => {
    try { const a = await api.doctorMyAppointments(); setAppts(a || []); }
    catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = new Date().toDateString();
  const upcoming = appts.filter((a) => new Date(a.slot) >= new Date(new Date().setHours(0, 0, 0, 0)));
  const past = appts.filter((a) => new Date(a.slot) < new Date(new Date().setHours(0, 0, 0, 0)));

  const renderRow = (a: any) => {
    const d = new Date(a.slot);
    const dateStr = d.toDateString() === today ? "Today" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const timeStr = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    const paid = a.payment_status === "paid";
    return (
      <TouchableOpacity
        key={a.id}
        style={styles.card}
        onPress={() => router.push({ pathname: "/doctor/prescription/[apptId]", params: { apptId: a.id } })}
        testID={`appt-${a.id}`}
      >
        <View style={styles.dateBlock}>
          <Text style={styles.dateTop}>{dateStr}</Text>
          <Text style={styles.dateBot}>{timeStr}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.patient}>{a.patient_name || "Patient"}</Text>
          <Text style={styles.meta}>{a.mode === "video" ? "🎥 Video" : "💬 Chat"} · {a.status}</Text>
          {paid ? <Text style={styles.paidTag}>Paid ₹{Math.round((a.fee_paise || 0) / 100)}</Text> : <Text style={styles.pendingTag}>Payment pending</Text>}
        </View>
        <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
      >
        <View style={styles.head}>
          <Text style={styles.eyebrow}>Clinic Queue</Text>
          <Text style={styles.title}>Appointments</Text>
        </View>

        <Text style={styles.section}>Upcoming ({upcoming.length})</Text>
        {upcoming.length === 0 && <Text style={styles.empty}>No upcoming appointments.</Text>}
        {upcoming.map(renderRow)}

        {past.length > 0 && (
          <>
            <Text style={styles.section}>Past</Text>
            {past.slice(0, 20).map(renderRow)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.textPrimary, marginTop: 4 },
  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm, fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  empty: { paddingHorizontal: SPACING.lg, color: COLORS.textMuted, fontStyle: "italic", fontSize: 13 },
  card: { marginHorizontal: SPACING.lg, marginBottom: 8, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  dateBlock: { width: 64, alignItems: "center", backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.sm, padding: 6 },
  dateTop: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.brand },
  dateBot: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  patient: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 15 },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  paidTag: { color: COLORS.success, fontSize: 11, marginTop: 4, fontWeight: "700" },
  pendingTag: { color: COLORS.warning, fontSize: 11, marginTop: 4, fontWeight: "700" },
});
