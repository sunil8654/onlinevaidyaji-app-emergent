// Women's Health hub — Cycle tracker, Pregnancy mode, PCOS/gynae history, AYUSH wellness tips.
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, RefreshControl, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

type Tab = "cycle" | "pregnancy" | "health";

const SYMPTOMS = ["cramps", "bloating", "headache", "fatigue", "acne", "back pain", "cravings", "tender breasts"];
const MOODS: ("happy" | "calm" | "anxious" | "sad" | "irritable")[] = ["happy", "calm", "anxious", "sad", "irritable"];
const MOOD_EMOJI: Record<string, string> = { happy: "😄", calm: "😌", anxious: "😟", sad: "😢", irritable: "😤" };

export default function WomensHealth() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("cycle");
  const [cycles, setCycles] = useState<any>(null);
  const [preg, setPreg] = useState<any>(null);
  const [gynae, setGynae] = useState<any>({});
  const [tips, setTips] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [logModal, setLogModal] = useState(false);
  const [pregModal, setPregModal] = useState(false);

  const phase = preg?.is_active ? "pregnancy" : gynae?.pcos ? "pcos" : "follicular";

  const load = useCallback(async () => {
    try {
      const [c, p, g] = await Promise.all([
        api.listCycles(12).catch(() => ({ cycles: [], next_period_predicted: null, fertile_window: null })),
        api.getPregnancy().catch(() => ({ is_active: false })),
        api.getGynae().catch(() => ({})),
      ]);
      setCycles(c);
      setPreg(p);
      setGynae(g);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.wellnessTips(phase).then((r) => setTips(r.tips)).catch(() => {}); }, [phase]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="wh-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>Women&apos;s Health</Text>
          <Text style={styles.title}>Your rhythm 🌸</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(["cycle", "pregnancy", "health"] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)} testID={`wh-tab-${t}`}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "cycle" ? "Cycle" : t === "pregnancy" ? "Pregnancy" : "Health"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />} contentContainerStyle={styles.scroll}>
        {tab === "cycle" && (
          <View>
            <View style={styles.heroCard}>
              <Text style={styles.heroKicker}>Next period predicted</Text>
              <Text style={styles.heroDate}>{cycles?.next_period_predicted || "Log a cycle to see"}</Text>
              {cycles?.fertile_window && (
                <Text style={styles.heroSub}>Fertile: {cycles.fertile_window.start} — {cycles.fertile_window.end}</Text>
              )}
              <TouchableOpacity style={styles.heroCta} onPress={() => setLogModal(true)} testID="wh-log-period">
                <Feather name="plus" size={16} color={COLORS.surface} />
                <Text style={styles.heroCtaText}>Log period</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.section}>Last 12 cycles</Text>
            {(!cycles?.cycles || cycles.cycles.length === 0) ? (
              <Text style={styles.empty}>No cycles logged yet.</Text>
            ) : cycles.cycles.map((c: any) => (
              <View key={c.id} style={styles.cycleCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cycleDate}>{c.start_date}</Text>
                  <Text style={styles.cycleMeta}>
                    {c.cycle_length}d · {c.flow}
                    {c.mood ? ` · ${MOOD_EMOJI[c.mood] || ""}` : ""}
                  </Text>
                  {c.symptoms?.length > 0 && <Text style={styles.cycleTags}>{c.symptoms.join(" · ")}</Text>}
                </View>
                <TouchableOpacity onPress={async () => { try { await api.deletePeriod(c.id); await load(); } catch (e: any) { Alert.alert("Delete failed", e.message); } }}>
                  <Feather name="x" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            ))}

            {tips.length > 0 && (
              <View style={styles.tipsCard}>
                <Text style={styles.tipsTitle}>🌿 AYUSH tips for you</Text>
                {tips.map((t, i) => (
                  <Text key={i} style={styles.tipItem}>• {t}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        {tab === "pregnancy" && (
          <View>
            {preg?.is_active ? (
              <View>
                <View style={styles.pregHero}>
                  <Text style={styles.pregKicker}>You are</Text>
                  <Text style={styles.pregWeeks}>{preg.weeks} weeks pregnant</Text>
                  <Text style={styles.pregDue}>Due: {preg.due_date || "—"}</Text>
                  {preg.current_milestone && (
                    <View style={styles.milestoneBox}>
                      <Text style={styles.milestoneTitle}>Week {preg.current_milestone.week}</Text>
                      <Text style={styles.milestoneText}>{preg.current_milestone.message}</Text>
                    </View>
                  )}
                  <TouchableOpacity style={styles.pregToggle} onPress={() => setPregModal(true)} testID="wh-preg-manage">
                    <Text style={styles.pregToggleText}>Manage pregnancy mode</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.section}>Milestones</Text>
                {(preg.milestones || []).map((m: any) => (
                  <View key={m.week} style={[styles.mileRow, m.reached && styles.mileReached]}>
                    <Feather name={m.reached ? "check-circle" : "circle"} size={18} color={m.reached ? COLORS.success : COLORS.textMuted} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.mileWeek}>Week {m.week}</Text>
                      <Text style={styles.mileMsg}>{m.message}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.pregEmpty}>
                <Text style={styles.pregEmojiBig}>🤰</Text>
                <Text style={styles.pregEmptyTitle}>Pregnancy mode</Text>
                <Text style={styles.pregEmptyBody}>Track weeks, due date, and week-by-week AYUSH-aligned milestones for a healthy pregnancy.</Text>
                <TouchableOpacity style={styles.heroCta} onPress={() => setPregModal(true)} testID="wh-preg-start">
                  <Feather name="heart" size={16} color={COLORS.surface} />
                  <Text style={styles.heroCtaText}>Start tracking</Text>
                </TouchableOpacity>
              </View>
            )}

            {tips.length > 0 && preg?.is_active && (
              <View style={styles.tipsCard}>
                <Text style={styles.tipsTitle}>🌿 Prenatal tips</Text>
                {tips.map((t, i) => <Text key={i} style={styles.tipItem}>• {t}</Text>)}
              </View>
            )}
          </View>
        )}

        {tab === "health" && (
          <GynaeForm gynae={gynae} onSaved={load} />
        )}
      </ScrollView>

      {logModal && <LogPeriodModal onClose={() => setLogModal(false)} onSaved={async () => { setLogModal(false); await load(); }} />}
      {pregModal && (
        <PregnancyModal current={preg} onClose={() => setPregModal(false)} onSaved={async () => { setPregModal(false); await load(); }} />
      )}
    </SafeAreaView>
  );
}

// ---------------- Log Period Modal ----------------
function LogPeriodModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [cycleLength, setCycleLength] = useState("28");
  const [flow, setFlow] = useState<"light" | "normal" | "heavy">("normal");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [mood, setMood] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (s: string) => setSymptoms((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { Alert.alert("Date must be YYYY-MM-DD"); return; }
    setBusy(true);
    try {
      await api.logPeriod({
        start_date: startDate,
        cycle_length: parseInt(cycleLength, 10) || 28,
        flow, symptoms, mood: mood || undefined,
      });
      onSaved();
    } catch (e: any) { Alert.alert("Save failed", e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <ScrollView contentContainerStyle={styles.modalSheet} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Log period</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={COLORS.textPrimary} /></TouchableOpacity>
          </View>
          <MiniLabel>Start date</MiniLabel>
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="2026-07-15" placeholderTextColor={COLORS.textMuted} testID="period-start" />
          <MiniLabel>Cycle length (days)</MiniLabel>
          <TextInput style={styles.input} keyboardType="numeric" value={cycleLength} onChangeText={setCycleLength} testID="period-length" />
          <MiniLabel>Flow</MiniLabel>
          <View style={styles.chipsRow}>
            {(["light", "normal", "heavy"] as const).map((f) => (
              <TouchableOpacity key={f} style={[styles.chip, flow === f && styles.chipActive]} onPress={() => setFlow(f)}>
                <Text style={[styles.chipText, flow === f && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <MiniLabel>Symptoms</MiniLabel>
          <View style={styles.chipsRow}>
            {SYMPTOMS.map((s) => (
              <TouchableOpacity key={s} style={[styles.chip, symptoms.includes(s) && styles.chipActive]} onPress={() => toggle(s)}>
                <Text style={[styles.chipText, symptoms.includes(s) && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <MiniLabel>Mood</MiniLabel>
          <View style={styles.chipsRow}>
            {MOODS.map((m) => (
              <TouchableOpacity key={m} style={[styles.chip, mood === m && styles.chipActive]} onPress={() => setMood(m)}>
                <Text style={[styles.chipText, mood === m && styles.chipTextActive]}>{MOOD_EMOJI[m]} {m}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="period-save">
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save cycle"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------- Pregnancy Modal ----------------
function PregnancyModal({ current, onClose, onSaved }: { current: any; onClose: () => void; onSaved: () => void }) {
  const [active, setActive] = useState(current?.is_active || false);
  const [lmp, setLmp] = useState(current?.lmp_date || new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (active && !/^\d{4}-\d{2}-\d{2}$/.test(lmp)) { Alert.alert("LMP date must be YYYY-MM-DD"); return; }
    setBusy(true);
    try { await api.setPregnancy({ is_active: active, lmp_date: active ? lmp : undefined }); onSaved(); }
    catch (e: any) { Alert.alert("Save failed", e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Pregnancy mode</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={COLORS.textPrimary} /></TouchableOpacity>
          </View>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pregLabel}>I am currently pregnant</Text>
              <Text style={styles.pregHint}>Turn on to see week-by-week milestones and prenatal AYUSH tips.</Text>
            </View>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: COLORS.brand, false: COLORS.border }} thumbColor={COLORS.surface} />
          </View>
          {active && (
            <>
              <MiniLabel>Last menstrual period (LMP)</MiniLabel>
              <TextInput style={styles.input} value={lmp} onChangeText={setLmp} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.textMuted} testID="preg-lmp" />
              <Text style={styles.pregHint}>Due date is auto-calculated (LMP + 280 days).</Text>
            </>
          )}
          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="preg-save">
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------- Gynae Form ----------------
function GynaeForm({ gynae, onSaved }: { gynae: any; onSaved: () => void }) {
  const [pcos, setPcos] = useState(!!gynae?.pcos);
  const [pcod, setPcod] = useState(!!gynae?.pcod);
  const [conditions, setConditions] = useState((gynae?.conditions || []).join(", "));
  const [surgeries, setSurgeries] = useState((gynae?.surgeries || []).join(", "));
  const [medications, setMedications] = useState((gynae?.medications || []).join(", "));
  const [notes, setNotes] = useState(gynae?.notes || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.upsertGynae({
        pcos, pcod,
        conditions: conditions.split(",").map((s) => s.trim()).filter(Boolean),
        surgeries: surgeries.split(",").map((s) => s.trim()).filter(Boolean),
        medications: medications.split(",").map((s) => s.trim()).filter(Boolean),
        notes: notes || undefined,
      });
      Alert.alert("Saved", "Your gynae history is updated.");
      onSaved();
    } catch (e: any) { Alert.alert("Save failed", e.message); }
    finally { setBusy(false); }
  };

  return (
    <View>
      <View style={styles.rowBetween}>
        <Text style={styles.pregLabel}>PCOS</Text>
        <Switch value={pcos} onValueChange={setPcos} trackColor={{ true: COLORS.brand, false: COLORS.border }} thumbColor={COLORS.surface} />
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.pregLabel}>PCOD</Text>
        <Switch value={pcod} onValueChange={setPcod} trackColor={{ true: COLORS.brand, false: COLORS.border }} thumbColor={COLORS.surface} />
      </View>

      <MiniLabel>Other conditions (comma-separated)</MiniLabel>
      <TextInput style={styles.input} value={conditions} onChangeText={setConditions} placeholder="Endometriosis, Fibroids" placeholderTextColor={COLORS.textMuted} testID="gynae-cond" />

      <MiniLabel>Surgeries</MiniLabel>
      <TextInput style={styles.input} value={surgeries} onChangeText={setSurgeries} placeholder="D&C 2022, C-section 2020" placeholderTextColor={COLORS.textMuted} />

      <MiniLabel>Current medications</MiniLabel>
      <TextInput style={styles.input} value={medications} onChangeText={setMedications} placeholder="Metformin, Iron supplements" placeholderTextColor={COLORS.textMuted} />

      <MiniLabel>Notes</MiniLabel>
      <TextInput style={[styles.input, { minHeight: 80 }]} multiline value={notes} onChangeText={setNotes} placeholder="Anything else your doctor should know" placeholderTextColor={COLORS.textMuted} />

      <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="gynae-save">
        <Text style={styles.saveText}>{busy ? "Saving…" : "Save gynae history"}</Text>
      </TouchableOpacity>

      <Text style={styles.privacy}>🔒 Private to you. Shared with a doctor only if you attach it during a consult.</Text>
    </View>
  );
}

function MiniLabel({ children }: { children: string }) { return <Text style={styles.miniLabel}>{children}</Text>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  tabs: { flexDirection: "row", marginHorizontal: SPACING.lg, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.pill, padding: 4, marginBottom: SPACING.sm },
  tab: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.pill, alignItems: "center" },
  tabActive: { backgroundColor: COLORS.brand },
  tabText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: COLORS.surface, fontWeight: "700" },
  heroCard: { backgroundColor: "#F3D9CD", padding: SPACING.lg, borderRadius: RADIUS.lg, marginBottom: SPACING.md },
  heroKicker: { color: COLORS.accent, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, fontWeight: "700" },
  heroDate: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.textPrimary, marginTop: 4 },
  heroSub: { color: COLORS.textSecondary, marginTop: 6, fontSize: 13 },
  heroCta: { marginTop: SPACING.md, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.brand, paddingHorizontal: 16, paddingVertical: 12, borderRadius: RADIUS.pill, alignSelf: "flex-start" },
  heroCtaText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  section: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: SPACING.sm },
  empty: { color: COLORS.textMuted, fontStyle: "italic", fontSize: 13, marginBottom: SPACING.md },
  cycleCard: { flexDirection: "row", padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8, alignItems: "center" },
  cycleDate: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 15 },
  cycleMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  cycleTags: { color: COLORS.accent, fontSize: 11, marginTop: 4 },
  tipsCard: { marginTop: SPACING.md, backgroundColor: COLORS.surfaceAlt, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  tipsTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary, marginBottom: 8 },
  tipItem: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 4 },
  pregHero: { backgroundColor: COLORS.brand, padding: SPACING.lg, borderRadius: RADIUS.lg, alignItems: "center" },
  pregKicker: { color: COLORS.accentSoft, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, fontWeight: "700" },
  pregWeeks: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.surface, marginTop: 6, textAlign: "center" },
  pregDue: { color: COLORS.accentSoft, marginTop: 6, fontSize: 14 },
  milestoneBox: { marginTop: SPACING.md, backgroundColor: COLORS.brandDark, padding: SPACING.md, borderRadius: RADIUS.md, width: "100%" },
  milestoneTitle: { color: COLORS.accentSoft, fontSize: 12, fontWeight: "700" },
  milestoneText: { color: COLORS.surface, marginTop: 4, fontSize: 13, lineHeight: 20 },
  pregToggle: { marginTop: SPACING.md, paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.accentSoft },
  pregToggleText: { color: COLORS.accentSoft, fontSize: 13, fontWeight: "600" },
  pregEmpty: { alignItems: "center", marginTop: SPACING.lg, paddingHorizontal: SPACING.md },
  pregEmojiBig: { fontSize: 60 },
  pregEmptyTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: 8 },
  pregEmptyBody: { color: COLORS.textSecondary, textAlign: "center", marginTop: 8, fontSize: 14, lineHeight: 20 },
  mileRow: { flexDirection: "row", padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 6, alignItems: "center" },
  mileReached: { backgroundColor: COLORS.surfaceAlt },
  mileWeek: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  mileMsg: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rowBetween: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  pregLabel: { color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" },
  pregHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  privacy: { marginTop: SPACING.lg, color: COLORS.textMuted, fontSize: 12, textAlign: "center", fontStyle: "italic" },
  // Modal
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.lg, paddingBottom: SPACING.xl },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.md },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  miniLabel: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.sm, marginBottom: 6, fontWeight: "700" },
  input: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 14, fontSize: 15, color: COLORS.textPrimary },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textSecondary, fontSize: 13 },
  chipTextActive: { color: COLORS.surface, fontWeight: "700" },
  saveBtn: { marginTop: SPACING.lg, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, alignItems: "center" },
  saveText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
});
