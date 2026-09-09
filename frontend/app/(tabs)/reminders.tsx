import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";
import { useAuth } from "@/src/auth";
import DoctorEarnings from "@/app/doctor/earnings";

const TIME_PRESETS = ["07:00", "08:00", "13:00", "20:00", "22:00"];

export default function Reminders() {
  const { user } = useAuth();
  // Role-aware: doctors see their Earnings dashboard in this slot.
  if (user?.role === "doctor") return <DoctorEarnings />;
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [times, setTimes] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.listReminders();
      setItems(r);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleTime = (t: string) => setTimes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const reset = () => {
    setName(""); setDosage(""); setTimes([]); setNotes(""); setErr("");
  };

  const save = async () => {
    setErr("");
    if (!name.trim() || !dosage.trim() || times.length === 0) {
      setErr("Fill name, dosage & at least one time");
      return;
    }
    setBusy(true);
    try {
      await api.createReminder({ medicine_name: name, dosage, times, notes });
      reset();
      setOpen(false);
      await load();
    } catch (e: any) {
      setErr(e.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    await api.deleteReminder(id).catch(() => {});
    load();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <View>
          <Text style={styles.eyebrow}>Ritual</Text>
          <Text style={styles.title}>Medicine reminders</Text>
        </View>
        <TouchableOpacity style={styles.add} onPress={() => setOpen(true)} testID="reminders-add">
          <Feather name="plus" size={20} color={COLORS.surface} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: 120 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Feather name="clock" size={28} color={COLORS.brand} />
            <Text style={styles.emptyTitle}>No reminders yet</Text>
            <Text style={styles.emptyBody}>Add your daily herbs, tonics or medicines to never miss a dose.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card} testID={`reminder-${item.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.medName}>{item.medicine_name}</Text>
              <Text style={styles.dose}>{item.dosage}</Text>
              <View style={styles.times}>
                {item.times.map((t: string) => (
                  <View key={t} style={styles.timePill}>
                    <Feather name="clock" size={10} color={COLORS.brand} />
                    <Text style={styles.timePillText}>{t}</Text>
                  </View>
                ))}
              </View>
              {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => del(item.id)} style={styles.trash} testID={`reminder-delete-${item.id}`}>
              <Feather name="trash-2" size={18} color={COLORS.error} />
            </TouchableOpacity>
          </View>
        )}
      />

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>New reminder</Text>

              <Text style={styles.label}>Medicine / herb</Text>
              <TextInput style={styles.input} placeholder="e.g. Ashwagandha" placeholderTextColor={COLORS.textMuted} value={name} onChangeText={setName} testID="reminder-name" />

              <Text style={styles.label}>Dosage</Text>
              <TextInput style={styles.input} placeholder="e.g. 1 tablet after food" placeholderTextColor={COLORS.textMuted} value={dosage} onChangeText={setDosage} testID="reminder-dosage" />

              <Text style={styles.label}>Times</Text>
              <View style={styles.chipsRow}>
                {TIME_PRESETS.map((t) => (
                  <TouchableOpacity key={t} onPress={() => toggleTime(t)} style={[styles.timeChip, times.includes(t) && styles.timeChipActive]} testID={`reminder-time-${t}`}>
                    <Text style={[styles.timeChipText, times.includes(t) && { color: COLORS.surface }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput style={[styles.input, { minHeight: 80 }]} placeholder="Take with warm water" placeholderTextColor={COLORS.textMuted} value={notes} onChangeText={setNotes} multiline testID="reminder-notes" />

              {err ? <Text style={styles.err}>{err}</Text> : null}

              <View style={{ flexDirection: "row", gap: 8, marginTop: SPACING.md, marginBottom: SPACING.md }}>
                <TouchableOpacity style={styles.cancel} onPress={() => { setOpen(false); reset(); }} testID="reminder-cancel">
                  <Text style={{ color: COLORS.textPrimary, fontWeight: "700" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.save, busy && { opacity: 0.6 }]} onPress={save} disabled={busy} testID="reminder-save">
                  <Text style={{ color: COLORS.surface, fontWeight: "700" }}>{busy ? "Saving…" : "Save"}</Text>
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
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, marginTop: 4, letterSpacing: -1 },
  add: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  medName: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  dose: { color: COLORS.textSecondary, marginTop: 2, fontSize: 13 },
  times: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  timePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill },
  timePillText: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
  notes: { color: COLORS.textMuted, fontSize: 12, marginTop: 6, fontStyle: "italic" },
  trash: { padding: 8 },
  emptyBox: { alignItems: "center", padding: SPACING.xl, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.xl },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: 8 },
  emptyBody: { color: COLORS.textSecondary, textAlign: "center", marginTop: 4, fontSize: 13, lineHeight: 20 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 15 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeChip: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  timeChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  timeChipText: { color: COLORS.textPrimary, fontWeight: "600", fontSize: 13 },
  err: { color: COLORS.error, marginTop: SPACING.sm, fontSize: 13 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  save: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
});
