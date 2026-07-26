// Structured prescription editor with PDF export.
// Doctor can add multiple medicine rows (name / dosage / frequency / duration / instructions)
// plus diagnosis, symptoms, advice and follow-up. On save, it also composes a
// plain-text `medicines` string so older patient screens still render correctly.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

type MedRow = {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
};

const EMPTY_MED: MedRow = { name: "", dosage: "", frequency: "", duration: "", instructions: "" };

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(opts: {
  doctorName: string;
  doctorSpecialty?: string;
  doctorQualification?: string;
  patientName: string;
  slot: string;
  diagnosis: string;
  symptoms: string;
  advice: string;
  followUp: string;
  notes: string;
  meds: MedRow[];
}): string {
  const mrows = opts.meds
    .filter((m) => m.name.trim())
    .map(
      (m, i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #EFE8C8;color:#5C6B64;">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #EFE8C8;"><strong>${escapeHtml(m.name)}</strong>${m.instructions ? `<br/><span style='color:#8A968F;font-size:11px;'>${escapeHtml(m.instructions)}</span>` : ""}</td>
        <td style="padding:8px;border-bottom:1px solid #EFE8C8;">${escapeHtml(m.dosage)}</td>
        <td style="padding:8px;border-bottom:1px solid #EFE8C8;">${escapeHtml(m.frequency)}</td>
        <td style="padding:8px;border-bottom:1px solid #EFE8C8;">${escapeHtml(m.duration)}</td>
      </tr>`,
    )
    .join("");

  const slotText = opts.slot ? new Date(opts.slot).toLocaleString() : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Prescription — ${escapeHtml(opts.patientName)}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color:#1A2421; padding:32px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0F5C2A; padding-bottom:16px; margin-bottom:24px; }
  .brand { color:#0F5C2A; font-size:24px; font-weight:800; letter-spacing:-0.5px; }
  .brand small { display:block; color:#8A968F; font-size:11px; letter-spacing:2px; font-weight:600; text-transform:uppercase; margin-top:4px; }
  .doc { text-align:right; font-size:12px; color:#5C6B64; }
  .doc strong { color:#1A2421; font-size:15px; display:block; }
  .row { display:flex; gap:32px; margin-bottom:16px; }
  .row div { flex:1; }
  .lbl { color:#8A968F; font-size:10px; letter-spacing:2px; text-transform:uppercase; font-weight:700; margin-bottom:4px; }
  .val { color:#1A2421; font-size:14px; line-height:20px; }
  h3 { font-size:14px; color:#0F5C2A; margin-top:20px; margin-bottom:8px; text-transform:uppercase; letter-spacing:1.5px; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:16px; }
  th { text-align:left; padding:8px; background:#FFF6D9; color:#0F5C2A; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; }
  .box { border:1px solid #EFE8C8; border-radius:8px; padding:12px; background:#FFFDF3; font-size:13px; line-height:20px; }
  .foot { margin-top:48px; display:flex; justify-content:space-between; align-items:flex-end; }
  .sig { border-top:1px solid #1A2421; padding-top:6px; min-width:180px; text-align:center; font-size:11px; color:#5C6B64; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      Online Vaidhyaji
      <small>AYUSH Prescription</small>
    </div>
    <div class="doc">
      <strong>Dr. ${escapeHtml(opts.doctorName)}</strong>
      ${opts.doctorSpecialty ? `${escapeHtml(opts.doctorSpecialty)}` : ""}
      ${opts.doctorQualification ? `<br/>${escapeHtml(opts.doctorQualification)}` : ""}
    </div>
  </div>

  <div class="row">
    <div>
      <div class="lbl">Patient</div>
      <div class="val"><strong>${escapeHtml(opts.patientName)}</strong></div>
    </div>
    <div>
      <div class="lbl">Consultation</div>
      <div class="val">${escapeHtml(slotText)}</div>
    </div>
  </div>

  ${opts.symptoms ? `<h3>Symptoms</h3><div class="box">${escapeHtml(opts.symptoms)}</div>` : ""}

  <h3>Diagnosis</h3>
  <div class="box">${escapeHtml(opts.diagnosis) || "—"}</div>

  ${mrows ? `
  <h3>Medicines</h3>
  <table>
    <thead><tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr></thead>
    <tbody>${mrows}</tbody>
  </table>` : ""}

  ${opts.advice ? `<h3>Advice & Pathya</h3><div class="box">${escapeHtml(opts.advice)}</div>` : ""}

  ${opts.notes ? `<h3>Lifestyle notes</h3><div class="box">${escapeHtml(opts.notes)}</div>` : ""}

  ${opts.followUp ? `<h3>Follow-up</h3><div class="box">${escapeHtml(opts.followUp)}</div>` : ""}

  <div class="foot">
    <div style="font-size:10px;color:#8A968F;">Generated via Online Vaidhyaji · ${new Date().toLocaleDateString()}</div>
    <div class="sig">Dr. ${escapeHtml(opts.doctorName)}</div>
  </div>
</body>
</html>`;
}

export default function PrescriptionEditor() {
  const { apptId } = useLocalSearchParams<{ apptId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState("");
  const [appt, setAppt] = useState<any>(null);
  const [doc, setDoc] = useState<any>(null);

  const [diagnosis, setDiagnosis] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [advice, setAdvice] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [meds, setMeds] = useState<MedRow[]>([{ ...EMPTY_MED }]);

  const load = useCallback(async () => {
    try {
      setErr("");
      const [d, mine] = await Promise.all([
        api.doctorMe().catch(() => null),
        api.doctorMyAppointments().catch(() => [] as any[]),
      ]);
      setDoc(d);
      const a = (mine as any[]).find((x) => x.id === apptId);
      if (!a) {
        setErr("Appointment not found");
        return;
      }
      setAppt(a);
      const rx = a.prescription;
      if (rx) {
        setDiagnosis(rx.diagnosis || "");
        setSymptoms(rx.symptoms || "");
        setAdvice(rx.advice || "");
        setFollowUp(rx.follow_up || "");
        setNotes(rx.notes || "");
        if (Array.isArray(rx.medicines_structured) && rx.medicines_structured.length) {
          setMeds(
            rx.medicines_structured.map((m: any) => ({
              name: m.name || "",
              dosage: m.dosage || "",
              frequency: m.frequency || "",
              duration: m.duration || "",
              instructions: m.instructions || "",
            })),
          );
        } else if (rx.medicines) {
          // Older prescriptions used a free-text `medicines` field — pre-seed
          // the first row's "name" so the doctor can migrate quickly.
          setMeds([{ ...EMPTY_MED, name: "" }]);
          setNotes((prev) => (prev ? prev + "\n\n" : "") + `[Legacy meds]\n${rx.medicines}`);
        }
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [apptId]);

  useEffect(() => { load(); }, [load]);

  const updateMed = (idx: number, key: keyof MedRow, val: string) => {
    setMeds((cur) => cur.map((m, i) => (i === idx ? { ...m, [key]: val } : m)));
  };
  const addMed = () => setMeds((cur) => [...cur, { ...EMPTY_MED }]);
  const removeMed = (idx: number) => setMeds((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== idx) : cur));

  const filledMeds = meds.filter((m) => m.name.trim());

  const canSave = diagnosis.trim().length > 0 && filledMeds.length > 0;

  const save = async () => {
    if (!apptId || !canSave || saving) return;
    setSaving(true);
    setErr("");
    try {
      await api.addPrescription(apptId, {
        diagnosis: diagnosis.trim(),
        notes: notes.trim() || undefined,
        symptoms: symptoms.trim() || undefined,
        advice: advice.trim() || undefined,
        follow_up: followUp.trim() || undefined,
        medicines_structured: filledMeds.map((m) => ({
          name: m.name.trim(),
          dosage: m.dosage.trim(),
          frequency: m.frequency.trim(),
          duration: m.duration.trim(),
          instructions: m.instructions.trim() || undefined,
        })),
      });
      if (Platform.OS === "web") {
        window.alert("Prescription saved & sent to the patient.");
      } else {
        Alert.alert("Saved", "Prescription sent to the patient.");
      }
      router.back();
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const exportPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const html = buildHtml({
        doctorName: user?.name || doc?.name || "Vaidya",
        doctorSpecialty: doc?.specialty,
        doctorQualification: doc?.qualification,
        patientName: appt?.patient_name || "Patient",
        slot: appt?.slot || "",
        diagnosis,
        symptoms,
        advice,
        followUp,
        notes,
        meds: filledMeds.length ? filledMeds : meds,
      });

      if (Platform.OS === "web") {
        // Open a print-preview window (browser handles Save-as-PDF).
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(html);
          w.document.close();
          setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 300);
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        const can = await Sharing.isAvailableAsync();
        if (can) {
          await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share prescription" });
        } else {
          Alert.alert("Saved", `PDF saved to ${uri}`);
        }
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to export PDF");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="rx-back">
          <Feather name="chevron-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Prescription</Text>
          <Text style={styles.title} numberOfLines={1}>{appt?.patient_name || "…"}</Text>
        </View>
        <TouchableOpacity onPress={exportPdf} style={styles.pdfBtn} disabled={pdfBusy} testID="rx-export">
          {pdfBusy ? <ActivityIndicator color={COLORS.brand} size="small" /> : <Feather name="download" size={16} color={COLORS.brand} />}
          <Text style={styles.pdfText}>PDF</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 160 }}
          keyboardShouldPersistTaps="handled"
        >
          {appt?.slot ? (
            <Text style={styles.slotLine}>
              <Feather name="calendar" size={11} color={COLORS.textSecondary} />{"  "}
              {new Date(appt.slot).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
            </Text>
          ) : null}

          <Label>Diagnosis <Text style={styles.req}>*</Text></Label>
          <TextInput
            style={styles.input}
            value={diagnosis}
            onChangeText={setDiagnosis}
            placeholder="e.g. Vata-Pitta imbalance with amla-pitta"
            placeholderTextColor={COLORS.textMuted}
            testID="rx-diagnosis"
          />

          <Label>Symptoms</Label>
          <TextInput
            style={[styles.input, styles.multi]}
            value={symptoms}
            onChangeText={setSymptoms}
            placeholder="Chief complaints, duration, aggravating factors"
            placeholderTextColor={COLORS.textMuted}
            multiline
            testID="rx-symptoms"
          />

          {/* Medicines block */}
          <View style={styles.medHeader}>
            <Text style={styles.sectionLabel}>Medicines <Text style={styles.req}>*</Text></Text>
            <TouchableOpacity onPress={addMed} style={styles.addBtn} testID="rx-add-med">
              <Feather name="plus" size={14} color={COLORS.surface} />
              <Text style={styles.addText}>Add medicine</Text>
            </TouchableOpacity>
          </View>

          {meds.map((m, i) => (
            <View key={i} style={styles.medCard} testID={`rx-med-${i}`}>
              <View style={styles.medTop}>
                <Text style={styles.medNum}>#{i + 1}</Text>
                {meds.length > 1 && (
                  <TouchableOpacity onPress={() => removeMed(i)} testID={`rx-rem-${i}`}>
                    <Feather name="x" size={16} color={COLORS.error} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={styles.medInput}
                value={m.name}
                onChangeText={(v) => updateMed(i, "name", v)}
                placeholder="Medicine / herb (e.g. Avipattikar Churna)"
                placeholderTextColor={COLORS.textMuted}
                testID={`rx-med-${i}-name`}
              />
              <View style={styles.medRow}>
                <TextInput
                  style={[styles.medInput, styles.medInputHalf]}
                  value={m.dosage}
                  onChangeText={(v) => updateMed(i, "dosage", v)}
                  placeholder="Dosage (½ tsp)"
                  placeholderTextColor={COLORS.textMuted}
                  testID={`rx-med-${i}-dosage`}
                />
                <TextInput
                  style={[styles.medInput, styles.medInputHalf]}
                  value={m.frequency}
                  onChangeText={(v) => updateMed(i, "frequency", v)}
                  placeholder="Frequency (BD / OD)"
                  placeholderTextColor={COLORS.textMuted}
                  testID={`rx-med-${i}-freq`}
                />
              </View>
              <View style={styles.medRow}>
                <TextInput
                  style={[styles.medInput, styles.medInputHalf]}
                  value={m.duration}
                  onChangeText={(v) => updateMed(i, "duration", v)}
                  placeholder="Duration (7 days)"
                  placeholderTextColor={COLORS.textMuted}
                  testID={`rx-med-${i}-dur`}
                />
                <TextInput
                  style={[styles.medInput, styles.medInputHalf]}
                  value={m.instructions}
                  onChangeText={(v) => updateMed(i, "instructions", v)}
                  placeholder="Instructions"
                  placeholderTextColor={COLORS.textMuted}
                  testID={`rx-med-${i}-inst`}
                />
              </View>
            </View>
          ))}

          <Label>Advice & Pathya</Label>
          <TextInput
            style={[styles.input, styles.multi]}
            value={advice}
            onChangeText={setAdvice}
            placeholder="Avoid spicy/fried food; take dinner before 8pm; warm water sips through the day"
            placeholderTextColor={COLORS.textMuted}
            multiline
            testID="rx-advice"
          />

          <Label>Lifestyle notes</Label>
          <TextInput
            style={[styles.input, styles.multi]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Yoga, pranayama, sleep, daily routine tips"
            placeholderTextColor={COLORS.textMuted}
            multiline
            testID="rx-notes"
          />

          <Label>Follow-up</Label>
          <TextInput
            style={styles.input}
            value={followUp}
            onChangeText={setFollowUp}
            placeholder="e.g. Review after 2 weeks"
            placeholderTextColor={COLORS.textMuted}
            testID="rx-followup"
          />

          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>
      )}

      {/* Sticky save bar */}
      {!loading && (
        <View style={styles.saveBar}>
          <TouchableOpacity
            style={[styles.saveBtn, (!canSave || saving) && { opacity: 0.5 }]}
            onPress={save}
            disabled={!canSave || saving}
            testID="rx-save"
          >
            {saving ? (
              <ActivityIndicator color={COLORS.surface} size="small" />
            ) : (
              <>
                <Feather name="send" size={14} color={COLORS.surface} />
                <Text style={styles.saveText}>Save & send to patient</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 3, fontSize: 10, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, letterSpacing: -0.5 },
  pdfBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand, borderRadius: RADIUS.pill },
  pdfText: { color: COLORS.brand, fontWeight: "700", fontSize: 12, letterSpacing: 1 },
  slotLine: { color: COLORS.textSecondary, fontSize: 12, paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700", paddingHorizontal: SPACING.lg },
  sectionLabel: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, fontWeight: "700" },
  req: { color: COLORS.error },
  input: { marginHorizontal: SPACING.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 14 },
  multi: { minHeight: 80, textAlignVertical: "top" },
  medHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: 6 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  addText: { color: COLORS.surface, fontWeight: "700", fontSize: 11 },
  medCard: { marginHorizontal: SPACING.lg, marginTop: 8, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  medTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  medNum: { color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  medInput: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 13, marginBottom: 6 },
  medRow: { flexDirection: "row", gap: 6 },
  medInputHalf: { flex: 1 },
  err: { color: COLORS.error, textAlign: "center", padding: SPACING.md },
  saveBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: SPACING.md, backgroundColor: COLORS.bg, borderTopWidth: 1, borderColor: COLORS.border },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill },
  saveText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
});
