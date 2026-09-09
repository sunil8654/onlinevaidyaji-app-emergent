// Doctor workspace — shown as "home" for doctors from the tabs group.
import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ImageBackground } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import Feather from "@react-native-vector-icons/feather";

export default function DoctorHome() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [doc, setDoc] = useState<any>(null);
  const [appts, setAppts] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [earnings, setEarnings] = useState<{ month_paise: number; total_paise: number } | null>(null);
  const [refresh, setRefresh] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, a, p, e] = await Promise.all([
        api.doctorMe(),
        api.doctorMyAppointments().catch(() => []),
        api.doctorMyPatients().catch(() => []),
        api.doctorEarnings().catch(() => null as any),
      ]);
      setDoc(d);
      setAppts(a);
      setPatients(p);
      setEarnings(e);
      // if not onboarded yet, redirect
      if (!d?.onboarded_at) router.replace("/doctor/onboarding");
    } catch {}
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // Heartbeat so patients see a live green dot on this doctor's card.
  // Fires immediately when the screen mounts, then every 60s while it's alive.
  useEffect(() => {
    let cancelled = false;
    const beat = () => { api.doctorHeartbeat().catch(() => {}); };
    beat();
    const t = setInterval(() => { if (!cancelled) beat(); }, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const upcoming = appts.filter((a) => new Date(a.slot) > new Date()).slice(0, 5);
  const today = appts.filter((a) => new Date(a.slot).toDateString() === new Date().toDateString()).length;
  const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
      >
        {/* Hero */}
        <ImageBackground source={{ uri: "https://images.pexels.com/photos/5738735/pexels-photo-5738735.jpeg" }} style={styles.hero}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroTopRow}>
              <Text style={styles.eyebrow}>Vaidya workspace</Text>
              <TouchableOpacity
                onPress={async () => { await logout(); router.replace("/signup"); }}
                style={styles.logoutBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                testID="doctor-logout"
              >
                <Feather name="log-out" size={13} color={COLORS.surface} />
                <Text style={styles.logoutText}>Logout</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hi}>Namaste, {user?.name?.split(" ")[0]}</Text>
            <Text style={styles.role}>{doc?.specialty} · {doc?.qualification}</Text>
            <View style={[styles.status, { backgroundColor: doc?.verified ? COLORS.success : COLORS.warning }]}>
              <Feather name={doc?.verified ? "check-circle" : "clock"} size={11} color={COLORS.surface} />
              <Text style={styles.statusText}>{doc?.verified ? "VERIFIED · LIVE" : "AWAITING APPROVAL"}</Text>
            </View>
          </View>
        </ImageBackground>

        {/* Availability toggle */}
        <TouchableOpacity
          style={styles.availCard}
          onPress={() => router.push("/doctor/availability")}
          testID="dh-availability"
        >
          <View style={[styles.availDot, { backgroundColor: doc?.is_available === false ? COLORS.error : COLORS.success }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.availTitle}>
              {doc?.is_available === false ? "You’re Offline" : "You’re Live"}
            </Text>
            <Text style={styles.availSub}>
              {doc?.is_available === false
                ? "Tap to go online and open your calendar"
                : `Mode: ${doc?.consultation_mode === "online" ? "Video only" : doc?.consultation_mode === "offline" ? "Clinic only" : "Video + Clinic"} · Manage slots`}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>

        {/* Stats row */}
        <View style={styles.stats}>
          <Stat label="Today" value={today} />
          <Stat label="Upcoming" value={upcoming.length} />
          <Stat label="Patients" value={patients.length} />
        </View>

        {/* Doctor Community entry — Vaidya Charcha */}
        <TouchableOpacity
          style={styles.charcha}
          onPress={() => router.push("/doctor/community")}
          testID="dh-community"
          activeOpacity={0.9}
        >
          <View style={styles.charchaIcon}>
            <Feather name="users" size={20} color={COLORS.surface} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.charchaTitle}>Vaidya Charcha</Text>
            <Text style={styles.charchaSub}>Connect with fellow AYUSH doctors — share cases & insights</Text>
          </View>
          <Feather name="arrow-right" size={18} color={COLORS.surface} />
        </TouchableOpacity>

        {/* Earnings + quick actions */}
        <View style={styles.quickRow}>
          <TouchableOpacity
            style={styles.earnCard}
            onPress={() => router.push("/doctor/earnings")}
            testID="dh-open-earnings"
          >
            <View style={styles.earnHead}>
              <Feather name="trending-up" size={14} color={COLORS.accent} />
              <Text style={styles.earnLabel}>This month</Text>
            </View>
            <Text style={styles.earnValue}>{rupees(earnings?.month_paise || 0)}</Text>
            <Text style={styles.earnSub}>Total: {rupees(earnings?.total_paise || 0)}</Text>
            <View style={styles.earnArrow}>
              <Feather name="arrow-up-right" size={12} color={COLORS.brand} />
              <Text style={styles.earnArrowText}>Earnings</Text>
            </View>
          </TouchableOpacity>

          <View style={{ flex: 1, gap: SPACING.sm }}>
            <TouchableOpacity style={styles.actionTile} onPress={() => router.push("/doctor/earnings")} testID="dh-earn-tile">
              <Feather name="bar-chart-2" size={16} color={COLORS.brand} />
              <Text style={styles.actionText}>Earnings</Text>
              <Feather name="chevron-right" size={14} color={COLORS.textMuted} style={{ marginLeft: "auto" }} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionTile} onPress={() => { /* stays on page — patients section below */ }} testID="dh-pat-tile">
              <Feather name="users" size={16} color={COLORS.brand} />
              <Text style={styles.actionText}>Patients ({patients.length})</Text>
              <Feather name="chevron-down" size={14} color={COLORS.textMuted} style={{ marginLeft: "auto" }} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Upcoming appointments */}
        <Text style={styles.sectionTitle}>Upcoming consultations</Text>
        {upcoming.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="calendar" size={22} color={COLORS.brand} />
            <Text style={styles.emptyTitle}>No upcoming consultations</Text>
            <Text style={styles.emptyBody}>Once patients book you, they&apos;ll appear here.</Text>
          </View>
        ) : upcoming.map((a) => (
          <View key={a.id} style={styles.apptCard} testID={`dh-appt-${a.id}`}>
            <View style={styles.apptDate}>
              <Text style={styles.apptDay}>{new Date(a.slot).getDate()}</Text>
              <Text style={styles.apptMonth}>{new Date(a.slot).toLocaleString([], { month: "short" })}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.apptName}>{a.patient_name}</Text>
              <Text style={styles.apptMeta}>{new Date(a.slot).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
              <View style={styles.apptTags}>
                {a.paid ? <View style={styles.tag}><Text style={styles.tagText}>PAID</Text></View> : null}
                {a.prescription ? <View style={[styles.tag, { backgroundColor: COLORS.accent }]}><Text style={styles.tagText}>Rx</Text></View> : null}
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <TouchableOpacity
                style={styles.joinBtn}
                onPress={() => router.push({ pathname: "/video-call", params: { doctor_name: user?.name, doctor_specialty: doc?.specialty, appt_id: a.id } })}
                testID={`dh-join-${a.id}`}
              >
                <Feather name="video" size={12} color={COLORS.surface} />
                <Text style={styles.joinText}>Join</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rxBtn, a.prescription && { backgroundColor: COLORS.success }]}
                onPress={() => router.push({ pathname: "/doctor/prescription/[apptId]", params: { apptId: a.id } })}
                testID={`dh-rx-${a.id}`}
              >
                <Feather name="file-text" size={12} color={COLORS.surface} />
                <Text style={styles.joinText}>{a.prescription ? "Rx ✓" : "Write Rx"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* My patients */}
        <Text style={styles.sectionTitle}>My patients</Text>
        {patients.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="users" size={22} color={COLORS.brand} />
            <Text style={styles.emptyTitle}>No patients yet</Text>
          </View>
        ) : patients.slice(0, 10).map((p) => (
          <TouchableOpacity
            key={p.patient_id}
            style={styles.patCard}
            onPress={() => router.push({ pathname: "/doctor/patient/[id]", params: { id: p.patient_id } })}
            testID={`dh-pat-${p.patient_id}`}
          >
            <View style={styles.patAvatar}>
              <Text style={styles.patAvatarText}>{p.patient_name?.[0]?.toUpperCase() || "?"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.patName}>{p.patient_name}</Text>
              <Text style={styles.patMeta}>{p.visits} visit{p.visits > 1 ? "s" : ""} · last {new Date(p.last_visit).toLocaleDateString()}</Text>
            </View>
            {p.has_rx && (
              <View style={styles.tagLite}>
                <Feather name="file-text" size={10} color={COLORS.brand} />
                <Text style={styles.tagLiteText}>Rx</Text>
              </View>
            )}
            <Feather name="chevron-right" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: any) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  hero: { height: 200 },
  heroOverlay: { flex: 1, backgroundColor: "rgba(15,76,54,0.75)", padding: SPACING.lg, justifyContent: "flex-end" },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  logoutText: { color: COLORS.surface, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  eyebrow: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  hi: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 30, marginTop: 4, letterSpacing: -0.5 },
  role: { color: COLORS.accentSoft, marginTop: 2, fontSize: 13 },
  status: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, marginTop: 8 },
  statusText: { color: COLORS.surface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  stats: { flexDirection: "row", gap: SPACING.md, paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  charcha: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    padding: SPACING.md, backgroundColor: COLORS.brand, borderRadius: RADIUS.lg,
  },
  charchaIcon: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.accent,
    alignItems: "center", justifyContent: "center",
  },
  charchaTitle: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 18 },
  charchaSub: { color: COLORS.accentSoft, fontSize: 11, marginTop: 2 },
  availCard: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    marginHorizontal: SPACING.lg, marginTop: -30,
    padding: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  availDot: { width: 10, height: 10, borderRadius: 5 },
  availTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  availSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  stat: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, alignItems: "center" },
  statVal: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.brand },
  statLbl: { color: COLORS.textSecondary, textTransform: "uppercase", fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 4 },
  quickRow: { flexDirection: "row", gap: SPACING.md, paddingHorizontal: SPACING.lg, marginTop: -8 },
  earnCard: { flex: 1.1, backgroundColor: COLORS.brand, borderRadius: RADIUS.lg, padding: SPACING.md },
  earnHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  earnLabel: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 2, fontSize: 10, fontWeight: "700" },
  earnValue: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 26, marginTop: 6 },
  earnSub: { color: COLORS.accentSoft, fontSize: 11, marginTop: 2 },
  earnArrow: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.surface, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, marginTop: 8 },
  earnArrowText: { color: COLORS.brand, fontWeight: "700", fontSize: 11, letterSpacing: 1 },
  actionTile: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, flex: 1 },
  actionText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 13 },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.md },
  emptyBox: { marginHorizontal: SPACING.lg, alignItems: "center", padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: 8 },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  apptCard: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginHorizontal: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  apptDate: { width: 52, alignItems: "center", padding: 6, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md },
  apptDay: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.brand },
  apptMonth: { color: COLORS.brand, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  apptName: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary },
  apptMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  apptTags: { flexDirection: "row", gap: 4, marginTop: 6 },
  tag: { backgroundColor: COLORS.success, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.pill },
  tagText: { color: COLORS.surface, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  joinBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  rxBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  joinText: { color: COLORS.surface, fontWeight: "700", fontSize: 11 },
  patCard: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginHorizontal: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  patAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  patAvatarText: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 18 },
  patName: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  patMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  tagLite: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill },
  tagLiteText: { color: COLORS.brand, fontSize: 10, fontWeight: "700" },
});
