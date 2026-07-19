// Doctor workspace — shown as "home" for doctors from the tabs group.
import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ImageBackground, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Feather } from "@expo/vector-icons";

export default function DoctorHome() {
  const router = useRouter();
  const { user } = useAuth();
  const [doc, setDoc] = useState<any>(null);
  const [appts, setAppts] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [refresh, setRefresh] = useState(false);
  const [rxOpen, setRxOpen] = useState<any | null>(null);
  const [diag, setDiag] = useState("");
  const [meds, setMeds] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, a, p] = await Promise.all([
        api.doctorMe(),
        api.doctorMyAppointments().catch(() => []),
        api.doctorMyPatients().catch(() => []),
      ]);
      setDoc(d);
      setAppts(a);
      setPatients(p);
      // if not onboarded yet, redirect
      if (!d?.onboarded_at) router.replace("/doctor/onboarding");
    } catch {}
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const submitRx = async () => {
    if (!rxOpen || !diag.trim() || !meds.trim()) return;
    try {
      await api.addPrescription(rxOpen.id, { diagnosis: diag, medicines: meds, notes });
      setRxOpen(null); setDiag(""); setMeds(""); setNotes("");
      load();
    } catch {}
  };

  const upcoming = appts.filter((a) => new Date(a.slot) > new Date()).slice(0, 5);
  const today = appts.filter((a) => new Date(a.slot).toDateString() === new Date().toDateString()).length;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
      >
        {/* Hero */}
        <ImageBackground source={{ uri: "https://images.pexels.com/photos/5738735/pexels-photo-5738735.jpeg" }} style={styles.hero}>
          <View style={styles.heroOverlay}>
            <Text style={styles.eyebrow}>Vaidya workspace</Text>
            <Text style={styles.hi}>Namaste, {user?.name?.split(" ")[0]}</Text>
            <Text style={styles.role}>{doc?.specialty} · {doc?.qualification}</Text>
            <View style={[styles.status, { backgroundColor: doc?.verified ? COLORS.success : COLORS.warning }]}>
              <Feather name={doc?.verified ? "check-circle" : "clock"} size={11} color={COLORS.surface} />
              <Text style={styles.statusText}>{doc?.verified ? "VERIFIED · LIVE" : "AWAITING APPROVAL"}</Text>
            </View>
          </View>
        </ImageBackground>

        {/* Stats row */}
        <View style={styles.stats}>
          <Stat label="Today" value={today} />
          <Stat label="Upcoming" value={upcoming.length} />
          <Stat label="Patients" value={patients.length} />
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
                onPress={() => { setRxOpen(a); setDiag(a.prescription?.diagnosis || ""); setMeds(a.prescription?.medicines || ""); setNotes(a.prescription?.notes || ""); }}
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
          <View key={p.patient_id} style={styles.patCard} testID={`dh-pat-${p.patient_id}`}>
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
          </View>
        ))}
      </ScrollView>

      {/* Rx modal */}
      <Modal visible={rxOpen !== null} animationType="slide" transparent onRequestClose={() => setRxOpen(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Prescription for {rxOpen?.patient_name}</Text>
              <Text style={styles.sheetSub}>{rxOpen?.slot ? new Date(rxOpen.slot).toLocaleString() : ""}</Text>

              <Text style={styles.rxLabel}>Diagnosis</Text>
              <TextInput style={styles.rxInput} value={diag} onChangeText={setDiag} placeholder="e.g. Vata-Pitta imbalance, acid reflux" placeholderTextColor={COLORS.textMuted} testID="dh-rx-diag" />

              <Text style={styles.rxLabel}>Medicines / herbs</Text>
              <TextInput style={[styles.rxInput, { minHeight: 100 }]} value={meds} onChangeText={setMeds} multiline placeholder="1. Avipattikar Churna — ½ tsp with warm water, before meals&#10;2. Yashtimadhu tab — 1 tab BD" placeholderTextColor={COLORS.textMuted} testID="dh-rx-meds" />

              <Text style={styles.rxLabel}>Lifestyle notes</Text>
              <TextInput style={styles.rxInput} value={notes} onChangeText={setNotes} placeholder="Avoid spicy food, dinner by 8pm" placeholderTextColor={COLORS.textMuted} testID="dh-rx-notes" />

              <View style={{ flexDirection: "row", gap: 8, marginTop: SPACING.md, marginBottom: SPACING.md }}>
                <TouchableOpacity style={styles.cancel} onPress={() => setRxOpen(null)} testID="dh-rx-cancel">
                  <Text style={{ color: COLORS.textPrimary, fontWeight: "700" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.save} onPress={submitRx} testID="dh-rx-save">
                  <Text style={{ color: COLORS.surface, fontWeight: "700" }}>Save & send to patient</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  eyebrow: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  hi: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 30, marginTop: 4, letterSpacing: -0.5 },
  role: { color: COLORS.accentSoft, marginTop: 2, fontSize: 13 },
  status: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, marginTop: 8 },
  statusText: { color: COLORS.surface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  stats: { flexDirection: "row", gap: SPACING.md, padding: SPACING.lg, marginTop: -30 },
  stat: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, alignItems: "center" },
  statVal: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.brand },
  statLbl: { color: COLORS.textSecondary, textTransform: "uppercase", fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 4 },
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
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary },
  sheetSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  rxLabel: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700" },
  rxInput: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 14 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  save: { flex: 1.4, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
});
