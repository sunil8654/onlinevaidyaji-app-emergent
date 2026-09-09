import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";

type Tab = "prescriptions" | "reports";

export default function Records() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("prescriptions");
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("lab");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([api.listPrescriptions().catch(() => []), api.listReports().catch(() => [])]);
      setPrescriptions(p || []);
      setReports(r || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveReport = async () => {
    setErr("");
    if (!title.trim()) { setErr("Title required"); return; }
    setBusy(true);
    try {
      await api.addReport({ title, kind, notes });
      setTitle(""); setNotes(""); setKind("lab");
      setOpen(false);
      await load();
    } catch (e: any) {
      setErr(e.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const delReport = async (id: string) => {
    await api.deleteReport(id).catch(() => {});
    load();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="records-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Vault</Text>
          <Text style={styles.title}>Health records</Text>
        </View>
        {tab === "reports" && (
          <TouchableOpacity style={styles.add} onPress={() => setOpen(true)} testID="records-add">
            <Feather name="plus" size={20} color={COLORS.surface} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === "prescriptions" && styles.tabActive]} onPress={() => setTab("prescriptions")} testID="records-tab-prescriptions">
          <Text style={[styles.tabText, tab === "prescriptions" && styles.tabTextActive]}>Prescriptions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === "reports" && styles.tabActive]} onPress={() => setTab("reports")} testID="records-tab-reports">
          <Text style={[styles.tabText, tab === "reports" && styles.tabTextActive]}>Lab reports</Text>
        </TouchableOpacity>
      </View>

      {tab === "prescriptions" ? (
        <FlatList
          data={prescriptions}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Feather name="file-text" size={26} color={COLORS.brand} />
              <Text style={styles.emptyTitle}>No prescriptions yet</Text>
              <Text style={styles.emptyBody}>After a consultation, your doctor&apos;s prescription will appear here.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.presCard} testID={`pres-${item.id}`}>
              <View style={styles.presHead}>
                <View>
                  <Text style={styles.presDoc}>{item.doctor_name}</Text>
                  <Text style={styles.presSpec}>{item.doctor_specialty} · {new Date(item.slot).toLocaleDateString()}</Text>
                </View>
                <View style={styles.rxBadge}>
                  <Text style={styles.rxText}>Rx</Text>
                </View>
              </View>
              <Text style={styles.presLabel}>Diagnosis</Text>
              <Text style={styles.presBody}>{item.prescription?.diagnosis}</Text>
              <Text style={styles.presLabel}>Medicines</Text>
              <Text style={styles.presBody}>{item.prescription?.medicines}</Text>
              {item.prescription?.notes ? (
                <>
                  <Text style={styles.presLabel}>Notes</Text>
                  <Text style={styles.presBody}>{item.prescription.notes}</Text>
                </>
              ) : null}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Feather name="folder" size={26} color={COLORS.brand} />
              <Text style={styles.emptyTitle}>No reports uploaded</Text>
              <Text style={styles.emptyBody}>Add lab results, scans, or health notes to keep them handy.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.reportCard} testID={`report-${item.id}`}>
              <View style={styles.reportIcon}>
                <Feather name={item.kind === "scan" ? "image" : item.kind === "note" ? "edit-3" : "activity"} size={18} color={COLORS.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{item.title}</Text>
                <Text style={styles.reportMeta}>{(item.kind || "lab").toUpperCase()} · {new Date(item.date || item.created_at).toLocaleDateString()}</Text>
                {item.notes ? <Text style={styles.reportNotes}>{item.notes}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => delReport(item.id)} style={{ padding: 6 }} testID={`report-delete-${item.id}`}>
                <Feather name="trash-2" size={16} color={COLORS.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>New health record</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput style={styles.input} placeholder="e.g. Blood test — CBC" placeholderTextColor={COLORS.textMuted} value={title} onChangeText={setTitle} testID="report-title" />

              <Text style={styles.label}>Kind</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[
                  { k: "lab", label: "Lab" },
                  { k: "scan", label: "Scan" },
                  { k: "note", label: "Note" },
                ].map((o) => (
                  <TouchableOpacity key={o.k} onPress={() => setKind(o.k)} style={[styles.kindChip, kind === o.k && styles.kindChipActive]} testID={`report-kind-${o.k}`}>
                    <Text style={[styles.kindText, kind === o.k && { color: COLORS.surface }]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Notes</Text>
              <TextInput style={[styles.input, { minHeight: 90 }]} placeholder="Findings, values, doctor mentions…" placeholderTextColor={COLORS.textMuted} value={notes} onChangeText={setNotes} multiline testID="report-notes" />

              {err ? <Text style={{ color: COLORS.error, marginTop: 8 }}>{err}</Text> : null}

              <View style={{ flexDirection: "row", gap: 8, marginTop: SPACING.md, marginBottom: SPACING.md }}>
                <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)} testID="report-cancel">
                  <Text style={{ color: COLORS.textPrimary, fontWeight: "700" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.save, busy && { opacity: 0.6 }]} onPress={saveReport} disabled={busy} testID="report-save">
                  <Text style={{ color: COLORS.surface, fontWeight: "700" }}>{busy ? "Saving…" : "Save record"}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: 2 },
  add: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.md },
  tab: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: "center" },
  tabActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tabText: { color: COLORS.textPrimary, fontWeight: "600" },
  tabTextActive: { color: COLORS.surface },
  emptyBox: { alignItems: "center", padding: SPACING.xl, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: 8 },
  emptyBody: { color: COLORS.textSecondary, textAlign: "center", marginTop: 4, fontSize: 13, lineHeight: 20 },
  presCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  presHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  presDoc: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  presSpec: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rxBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  rxText: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 16 },
  presLabel: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginTop: 10 },
  presBody: { color: COLORS.textPrimary, fontSize: 14, marginTop: 4, lineHeight: 20 },
  reportCard: { flexDirection: "row", alignItems: "center", gap: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  reportIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  reportTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  reportMeta: { color: COLORS.accent, fontSize: 10, marginTop: 2, letterSpacing: 2, fontWeight: "700" },
  reportNotes: { color: COLORS.textSecondary, marginTop: 4, fontSize: 13 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 15 },
  kindChip: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  kindChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  kindText: { color: COLORS.textPrimary, fontWeight: "600", fontSize: 13 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  save: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
});
