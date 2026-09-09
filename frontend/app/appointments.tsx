import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";
import { RazorpayCheckout } from "@/src/components/RazorpayCheckout";
import { useAuth } from "@/src/auth";
import { openPrescriptionPdf } from "@/src/utils/prescriptionPdf";

export default function Appointments() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [rxOpen, setRxOpen] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState("");
  const [medicines, setMedicines] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [payTarget, setPayTarget] = useState<any | null>(null);

  const load = async () => {
    try { setItems(await api.listAppointments()); } catch {}
  };
  useEffect(() => { load(); }, []);

  const saveRx = async () => {
    if (!rxOpen || !diagnosis.trim() || !medicines.trim()) return;
    setBusy(true);
    try {
      await api.addPrescription(rxOpen, { diagnosis, medicines, notes });
      setRxOpen(null); setDiagnosis(""); setMedicines(""); setNotes("");
      load();
    } catch {}
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="appts-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>My appointments</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListEmptyComponent={<Text style={styles.empty}>No appointments yet.</Text>}
        renderItem={({ item }) => {
          const dt = new Date(item.slot);
          const hasRx = !!item.prescription;
          return (
            <View style={styles.card} testID={`appt-${item.id}`}>
              <View style={styles.rowTop}>
                <View style={styles.dateBox}>
                  <Text style={styles.dateNum}>{dt.getDate()}</Text>
                  <Text style={styles.dateMo}>{dt.toLocaleString([], { month: "short" })}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docName}>{item.doctor_name}</Text>
                  <Text style={styles.docSpec}>{item.doctor_specialty}</Text>
                  <Text style={styles.docTime}>{dt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
                </View>
                {item.paid ? (
                  <View style={styles.paidPill}>
                    <Feather name="check" size={11} color={COLORS.success} />
                    <Text style={styles.paidText}>PAID</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.joinBtn}
                  onPress={() =>
                    router.push({ pathname: "/video-call", params: { doctor_name: item.doctor_name, doctor_specialty: item.doctor_specialty, appt_id: item.id } })
                  }
                  testID={`appt-join-${item.id}`}
                >
                  <Feather name="video" size={14} color={COLORS.surface} />
                  <Text style={styles.joinText}>Join call</Text>
                </TouchableOpacity>
                {!item.paid && (
                  <TouchableOpacity
                    style={[styles.payBtn, authLoading && { opacity: 0.6 }]}
                    disabled={authLoading}
                    onPress={() => {
                      if (!user) return;
                      setPayTarget(item);
                    }}
                    testID={`appt-pay-${item.id}`}
                  >
                    <Feather name="credit-card" size={14} color={COLORS.surface} />
                    <Text style={styles.joinText}>Pay ₹{item.amount || 500}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.rxBtn, hasRx && { backgroundColor: COLORS.success }]}
                  onPress={() => setRxOpen(item.id)}
                  testID={`appt-rx-${item.id}`}
                >
                  <Feather name="file-text" size={14} color={COLORS.surface} />
                  <Text style={styles.joinText}>{hasRx ? "Rx" : "Rx"}</Text>
                </TouchableOpacity>
                {hasRx ? (
                  <TouchableOpacity
                    style={styles.pdfBtn}
                    onPress={() => openPrescriptionPdf(item.id)}
                    testID={`appt-rx-pdf-${item.id}`}
                    accessibilityLabel="Download prescription as PDF"
                  >
                    <Feather name="download" size={14} color={COLORS.surface} />
                    <Text style={styles.joinText}>PDF</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        }}
      />

      <Modal visible={rxOpen !== null} animationType="slide" transparent onRequestClose={() => setRxOpen(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Add prescription</Text>
              <Text style={styles.sheetSub}>Demo entry — normally your doctor writes this.</Text>

              <Text style={styles.label}>Diagnosis</Text>
              <TextInput style={styles.input} value={diagnosis} onChangeText={setDiagnosis} placeholder="e.g. Vata imbalance, mild insomnia" placeholderTextColor={COLORS.textMuted} testID="rx-diagnosis" />

              <Text style={styles.label}>Medicines / herbs</Text>
              <TextInput style={[styles.input, { minHeight: 90 }]} value={medicines} onChangeText={setMedicines} multiline placeholder="1. Ashwagandha 500mg — 1 tab bedtime\n2. Brahmi ghrita — ½ tsp with milk" placeholderTextColor={COLORS.textMuted} testID="rx-medicines" />

              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Sleep by 10 pm, avoid screens" placeholderTextColor={COLORS.textMuted} testID="rx-notes" />

              <View style={{ flexDirection: "row", gap: 8, marginTop: SPACING.md, marginBottom: SPACING.md }}>
                <TouchableOpacity style={styles.cancel} onPress={() => setRxOpen(null)} testID="rx-cancel">
                  <Text style={{ color: COLORS.textPrimary, fontWeight: "700" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.save, busy && { opacity: 0.6 }]} onPress={saveRx} disabled={busy} testID="rx-save">
                  <Text style={{ color: COLORS.surface, fontWeight: "700" }}>{busy ? "Saving…" : "Save Rx"}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <RazorpayCheckout
        visible={!!payTarget}
        onClose={() => setPayTarget(null)}
        onSuccess={() => {
          Alert.alert("Payment successful", "Your consultation is confirmed.");
          setPayTarget(null);
          load();
        }}
        onFailure={(reason) => {
          if (reason && reason !== "payment_failed" && reason !== "verification_failed") {
            Alert.alert("Payment issue", reason);
          }
        }}
        amount={payTarget?.amount || 500}
        purpose="appointment"
        reference_id={payTarget?.id}
        description={`Consultation with ${payTarget?.doctor_name || "Vaidya"}`}
        title="Online VaidyaJi"
        prefill={{ name: user?.name || "", email: user?.email || "", contact: (user as any)?.phone || "" }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
  rowTop: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  dateBox: { width: 56, alignItems: "center", padding: 8, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md },
  dateNum: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.brand },
  dateMo: { color: COLORS.brand, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  docName: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  docSpec: { color: COLORS.accent, fontSize: 11, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginTop: 2 },
  docTime: { color: COLORS.textSecondary, marginTop: 4, fontSize: 12 },
  paidPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "#E8F5E9", borderRadius: RADIUS.pill },
  paidText: { color: COLORS.success, fontWeight: "700", fontSize: 10, letterSpacing: 1 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: SPACING.md },
  joinBtn: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingVertical: 10, borderRadius: RADIUS.pill },
  payBtn: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: "#E07B00", paddingVertical: 10, borderRadius: RADIUS.pill },
  rxBtn: { paddingHorizontal: 14, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: COLORS.accent, paddingVertical: 10, borderRadius: RADIUS.pill },
  pdfBtn: { paddingHorizontal: 14, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingVertical: 10, borderRadius: RADIUS.pill },
  joinText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  sheetSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 15 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  save: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
});
