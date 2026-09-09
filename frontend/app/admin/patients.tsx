import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import Feather from "@react-native-vector-icons/feather";

export default function AdminPatients() {
  const router = useRouter();
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [appts, setAppts] = useState<any[]>([]);

  useEffect(() => {
    (async () => { try { setItems(await api.adminPatients()); } catch {} })();
  }, []);

  const openHistory = async (u: any) => {
    setSelected(u);
    setAppts([]);
    try { setAppts(await api.adminPatientAppointments(u.id)); } catch {}
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="ap-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>{t("admin_dashboard")}</Text>
          <Text style={styles.title}>{t("patients")}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListEmptyComponent={<Text style={styles.empty}>No patients yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push({ pathname: "/admin/patient/[id]", params: { id: item.id } })} onLongPress={() => openHistory(item)} testID={`ap-${item.id}`}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name?.[0]?.toUpperCase() || "?"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pName}>{item.name}</Text>
              <Text style={styles.pMeta}>{item.email} · {item.phone || "no phone"}</Text>
              <Text style={styles.pAppt}>{item.appointments || 0} {t("appointments")}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      />

      <Modal visible={selected !== null} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>{selected?.name}</Text>
            <Text style={styles.sheetSub}>{selected?.email}</Text>
            <Text style={styles.sectionLabel}>{t("view_consultations")}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {appts.length === 0 ? (
                <Text style={styles.empty}>No consultation history.</Text>
              ) : appts.map((a) => (
                <View key={a.id} style={styles.apptCard} testID={`ap-appt-${a.id}`}>
                  <View>
                    <Text style={styles.apptDoc}>{a.doctor_name}</Text>
                    <Text style={styles.apptSpec}>{a.doctor_specialty} · {new Date(a.slot).toLocaleString()}</Text>
                    {a.prescription ? <Text style={styles.apptRx}>Rx: {a.prescription.diagnosis}</Text> : null}
                  </View>
                  <View style={[styles.badge, { backgroundColor: a.paid ? COLORS.success : COLORS.warning }]}>
                    <Text style={styles.badgeText}>{a.paid ? "PAID" : "UNPAID"}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.close} onPress={() => setSelected(null)} testID="ap-close">
              <Text style={{ color: COLORS.surface, fontWeight: "700" }}>{t("cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 20 },
  pName: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  pMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  pAppt: { color: COLORS.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 4 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  sheetSub: { color: COLORS.textSecondary, marginTop: 2, fontSize: 13 },
  sectionLabel: { color: COLORS.accent, fontSize: 10, textTransform: "uppercase", letterSpacing: 2, fontWeight: "700", marginTop: SPACING.md, marginBottom: 8 },
  apptCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  apptDoc: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  apptSpec: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  apptRx: { color: COLORS.brand, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  badge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: RADIUS.pill },
  badgeText: { color: COLORS.surface, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  close: { marginTop: SPACING.md, paddingVertical: 14, backgroundColor: COLORS.brand, borderRadius: RADIUS.pill, alignItems: "center" },
});
