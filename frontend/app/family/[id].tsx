// Family member detail — vaccinations + growth tracking + basic info
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

type Tab = "overview" | "vaccinations" | "growth" | "milestones";

const RECOMMENDED_VACCINES = [
  { name: "BCG", age: "At birth" },
  { name: "Hepatitis B", age: "0, 6 weeks, 6 mo" },
  { name: "OPV/IPV (Polio)", age: "6, 10, 14 weeks" },
  { name: "Pentavalent (DPT+Hib+HepB)", age: "6, 10, 14 weeks" },
  { name: "Rotavirus", age: "6, 10, 14 weeks" },
  { name: "PCV (Pneumococcal)", age: "6, 14 weeks, 9 mo" },
  { name: "MMR", age: "9, 15 mo" },
  { name: "Typhoid Conjugate", age: "9-12 mo" },
  { name: "DPT Booster", age: "16-24 mo, 5 yrs" },
  { name: "HPV", age: "9-14 yrs (girls & boys)" },
  { name: "Tdap", age: "10-12 yrs" },
];

export default function FamilyMember() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [member, setMember] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [vaccineModal, setVaccineModal] = useState(false);
  const [growthModal, setGrowthModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await api.getFamilyMember(id as string);
      setMember(m);
    } catch (e: any) {
      Alert.alert("Load failed", e.message || "Try again");
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const confirmDelete = () => {
    Alert.alert("Remove member?", "This will delete their records permanently.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try {
            await api.deleteFamilyMember(id as string);
            router.back();
          } catch (e: any) {
            Alert.alert("Delete failed", e.message);
          }
        },
      },
    ]);
  };

  if (!member) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.centerLoader}>
          <Text style={{ color: COLORS.textSecondary }}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="fm-detail-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{member.relation}</Text>
          <Text style={styles.title}>{member.name}</Text>
        </View>
        <TouchableOpacity onPress={confirmDelete} testID="fm-delete">
          <Feather name="trash-2" size={18} color={COLORS.error} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(["overview", "vaccinations", "growth", "milestones"] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "overview" ? "Info" : t === "vaccinations" ? "Vaccines" : t === "growth" ? "Growth" : "Milestones"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
      >
        {tab === "overview" && (
          <View style={styles.section}>
            <InfoRow label="Date of birth" value={member.dob || "—"} />
            <InfoRow label="Gender" value={member.gender || "—"} />
            <InfoRow label="Blood group" value={member.blood_group || "—"} />
            <InfoRow label="Conditions" value={member.conditions?.length ? member.conditions.join(", ") : "None"} />
            <InfoRow label="Allergies" value={member.allergies?.length ? member.allergies.join(", ") : "None"} />
            <Text style={styles.hint}>
              💡 Add vaccination and growth records in the tabs above to build a complete health record.
            </Text>
          </View>
        )}

        {tab === "vaccinations" && (
          <View style={{ padding: SPACING.lg }}>
            <View style={styles.rowBetween}>
              <Text style={styles.subhead}>Recorded ({(member.vaccinations || []).length})</Text>
              <TouchableOpacity style={styles.addBtn} onPress={() => setVaccineModal(true)} testID="add-vaccine">
                <Feather name="plus" size={14} color={COLORS.surface} />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {(member.vaccinations || []).length === 0 && (
              <Text style={styles.emptySection}>No vaccinations logged yet.</Text>
            )}

            {(member.vaccinations || []).map((v: any) => (
              <View key={v.id} style={styles.entryCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryTitle}>{v.vaccine}</Text>
                  <Text style={styles.entryMeta}>
                    {v.given_date ? `Given: ${v.given_date}` : v.scheduled_date ? `Scheduled: ${v.scheduled_date}` : ""}
                    {v.dose ? ` · Dose ${v.dose}` : ""}
                  </Text>
                  {v.notes ? <Text style={styles.entryNote}>{v.notes}</Text> : null}
                </View>
                <TouchableOpacity onPress={async () => {
                  try { await api.deleteVaccination(id as string, v.id); await load(); }
                  catch (e: any) { Alert.alert("Delete failed", e.message); }
                }}>
                  <Feather name="x" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            ))}

            <Text style={[styles.subhead, { marginTop: SPACING.lg }]}>Recommended (India)</Text>
            <Text style={styles.smallHint}>Common childhood + adolescent vaccines. Tap ➕ to log.</Text>
            {RECOMMENDED_VACCINES.map((v) => (
              <View key={v.name} style={styles.recCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryTitle}>{v.name}</Text>
                  <Text style={styles.entryMeta}>{v.age}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === "growth" && (
          <View style={{ padding: SPACING.lg }}>
            <View style={styles.rowBetween}>
              <Text style={styles.subhead}>Growth log ({(member.growth || []).length})</Text>
              <TouchableOpacity style={styles.addBtn} onPress={() => setGrowthModal(true)} testID="add-growth">
                <Feather name="plus" size={14} color={COLORS.surface} />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {(member.growth || []).length === 0 && (
              <Text style={styles.emptySection}>No growth data yet. Add height, weight and optional head circumference.</Text>
            )}

            {(member.growth || []).slice().reverse().map((g: any) => (
              <View key={g.id} style={styles.entryCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryTitle}>{g.date}</Text>
                  <Text style={styles.entryMeta}>
                    {g.height_cm ? `H: ${g.height_cm} cm` : ""}
                    {g.weight_kg ? ` · W: ${g.weight_kg} kg` : ""}
                    {g.head_circ_cm ? ` · HC: ${g.head_circ_cm} cm` : ""}
                    {g.bmi ? ` · BMI ${g.bmi}` : ""}
                  </Text>
                  {g.note ? <Text style={styles.entryNote}>{g.note}</Text> : null}
                </View>
                <TouchableOpacity onPress={async () => {
                  try { await api.deleteGrowth(id as string, g.id); await load(); }
                  catch (e: any) { Alert.alert("Delete failed", e.message); }
                }}>
                  <Feather name="x" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {tab === "milestones" && <MilestonesPanel memberId={id as string} />}
      </ScrollView>

      {vaccineModal && (
        <VaccineModal onClose={() => setVaccineModal(false)} memberId={id as string} onSaved={async () => { setVaccineModal(false); await load(); }} />
      )}
      {growthModal && (
        <GrowthModal onClose={() => setGrowthModal(false)} memberId={id as string} onSaved={async () => { setGrowthModal(false); await load(); }} />
      )}
    </SafeAreaView>
  );
}

// ---------------- Milestones Tab ----------------
function MilestonesPanel({ memberId }: { memberId: string }) {
  const [data, setData] = useState<any>(null);
  const load = useCallback(async () => {
    try { const d = await api.getMilestones(memberId); setData(d); } catch {}
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (text: string, done: boolean) => {
    // Optimistic
    setData((prev: any) => ({
      ...prev,
      groups: prev.groups.map((g: any) => ({
        ...g,
        items: g.items.map((it: any) => it.text === text ? { ...it, done: !done } : it),
      })),
    }));
    try { await api.toggleMilestone(memberId, text, !done); }
    catch { await load(); }
  };

  if (!data) return <Text style={{ padding: SPACING.lg, color: COLORS.textSecondary }}>Loading milestones…</Text>;

  return (
    <View style={{ padding: SPACING.lg }}>
      {data.age_months == null && (
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.md, fontStyle: "italic" }}>
          Add a date of birth to see age-appropriate milestones highlighted.
        </Text>
      )}
      {data.age_months != null && (
        <Text style={{ color: COLORS.textSecondary, marginBottom: SPACING.md, fontSize: 13 }}>
          Current age: {data.age_months < 24 ? `${data.age_months} months` : `${(data.age_months/12).toFixed(1)} years`}
        </Text>
      )}
      {(data.groups || []).map((g: any) => (
        <View key={g.age_months} style={[styles.recCard, !g.applicable && { opacity: 0.5 }]}>
          <Text style={styles.entryTitle}>By {g.age_label}</Text>
          {g.items.map((it: any) => (
            <TouchableOpacity key={it.text} style={styles.mileItem} onPress={() => toggle(it.text, it.done)}>
              <Feather name={it.done ? "check-circle" : "circle"} size={18} color={it.done ? COLORS.success : COLORS.textMuted} />
              <Text style={[styles.mileText, it.done && { textDecorationLine: "line-through", color: COLORS.textMuted }]}>
                {it.text}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}
      <Text style={{ marginTop: SPACING.md, color: COLORS.textSecondary, fontStyle: "italic", fontSize: 12 }}>
        🌿 Milestones vary — consult your pediatrician if you have concerns.
      </Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ---------------- Vaccine Modal ----------------
function VaccineModal({ memberId, onClose, onSaved }: { memberId: string; onClose: () => void; onSaved: () => void }) {
  const [vaccine, setVaccine] = useState("");
  const [givenDate, setGivenDate] = useState("");
  const [dose, setDose] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!vaccine.trim()) { Alert.alert("Enter vaccine name"); return; }
    if (givenDate && !/^\d{4}-\d{2}-\d{2}$/.test(givenDate)) { Alert.alert("Date must be YYYY-MM-DD"); return; }
    setBusy(true);
    try {
      await api.addVaccination(memberId, {
        vaccine: vaccine.trim(),
        given_date: givenDate || undefined,
        dose: dose || undefined,
        notes: notes || undefined,
      });
      onSaved();
    } catch (e: any) {
      Alert.alert("Save failed", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Log vaccine</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={COLORS.textPrimary} /></TouchableOpacity>
          </View>
          <MiniLabel>Vaccine name *</MiniLabel>
          <TextInput style={styles.input} value={vaccine} onChangeText={setVaccine} placeholder="e.g. MMR, DPT Booster" placeholderTextColor={COLORS.textMuted} testID="vaccine-name" />
          <MiniLabel>Given on (YYYY-MM-DD)</MiniLabel>
          <TextInput style={styles.input} value={givenDate} onChangeText={setGivenDate} placeholder="2024-05-14" placeholderTextColor={COLORS.textMuted} testID="vaccine-date" />
          <MiniLabel>Dose (optional)</MiniLabel>
          <TextInput style={styles.input} value={dose} onChangeText={setDose} placeholder="1 / 2 / Booster" placeholderTextColor={COLORS.textMuted} />
          <MiniLabel>Notes</MiniLabel>
          <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="e.g. mild fever after dose" placeholderTextColor={COLORS.textMuted} />
          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="vaccine-save">
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save vaccine"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------- Growth Modal ----------------
function GrowthModal({ memberId, onClose, onSaved }: { memberId: string; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [head, setHead] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!height && !weight) { Alert.alert("Enter at least height or weight"); return; }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert("Date must be YYYY-MM-DD"); return; }
    setBusy(true);
    try {
      await api.addGrowthEntry(memberId, {
        date: date || undefined,
        height_cm: height ? parseFloat(height) : undefined,
        weight_kg: weight ? parseFloat(weight) : undefined,
        head_circ_cm: head ? parseFloat(head) : undefined,
        note: note || undefined,
      });
      onSaved();
    } catch (e: any) {
      Alert.alert("Save failed", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Log growth</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={COLORS.textPrimary} /></TouchableOpacity>
          </View>
          <MiniLabel>Measurement date (YYYY-MM-DD)</MiniLabel>
          <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="today if empty" placeholderTextColor={COLORS.textMuted} />
          <MiniLabel>Height (cm)</MiniLabel>
          <TextInput style={styles.input} keyboardType="numeric" value={height} onChangeText={setHeight} placeholder="110" placeholderTextColor={COLORS.textMuted} testID="growth-height" />
          <MiniLabel>Weight (kg)</MiniLabel>
          <TextInput style={styles.input} keyboardType="numeric" value={weight} onChangeText={setWeight} placeholder="20" placeholderTextColor={COLORS.textMuted} testID="growth-weight" />
          <MiniLabel>Head circumference (cm) — infants</MiniLabel>
          <TextInput style={styles.input} keyboardType="numeric" value={head} onChangeText={setHead} placeholder="47" placeholderTextColor={COLORS.textMuted} />
          <MiniLabel>Note</MiniLabel>
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Well visit, doing great" placeholderTextColor={COLORS.textMuted} />
          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="growth-save">
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save entry"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MiniLabel({ children }: { children: string }) {
  return <Text style={styles.miniLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  centerLoader: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  tabs: {
    flexDirection: "row",
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.pill,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.pill, alignItems: "center" },
  tabActive: { backgroundColor: COLORS.brand },
  tabText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: COLORS.surface, fontWeight: "700" },
  scroll: { paddingBottom: SPACING.xl },
  section: { padding: SPACING.lg },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  infoLabel: { color: COLORS.textSecondary, fontSize: 13 },
  infoValue: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  hint: { marginTop: SPACING.lg, color: COLORS.textSecondary, fontStyle: "italic", fontSize: 13, lineHeight: 20 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.sm },
  subhead: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  smallHint: { color: COLORS.textMuted, fontSize: 12, marginBottom: SPACING.sm },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.brand,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  addBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  emptySection: { color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.md, fontStyle: "italic" },
  entryCard: {
    flexDirection: "row",
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
    alignItems: "center",
    gap: SPACING.sm,
  },
  recCard: {
    padding: SPACING.md,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md,
    marginBottom: 6,
  },
  mileItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  mileText: { flex: 1, color: COLORS.textPrimary, fontSize: 14 },
  entryTitle: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  entryMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  entryNote: { color: COLORS.textMuted, fontSize: 12, marginTop: 4, fontStyle: "italic" },
  modalBackdrop: {
    flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  modalHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.md,
  },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  miniLabel: {
    color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2,
    marginTop: SPACING.sm, marginBottom: 6, fontWeight: "700",
  },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  saveBtn: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.brand,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    alignItems: "center",
  },
  saveText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
});
