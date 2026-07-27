// Admin — Patient detail + editable profile.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const FIELDS: { key: string; label: string; multi?: boolean; kb?: any }[] = [
  { key: "name", label: "Full name" },
  { key: "email", label: "Email", kb: "email-address" },
  { key: "phone", label: "Phone", kb: "phone-pad" },
  { key: "dob", label: "Date of birth (YYYY-MM-DD)" },
  { key: "gender", label: "Gender" },
  { key: "blood_group", label: "Blood group" },
  { key: "city", label: "City" },
  { key: "address", label: "Address", multi: true },
  { key: "notes", label: "Admin notes (private)", multi: true },
];

export default function AdminPatientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [dirty, setDirty] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try { setData(await api.adminGetPatient(id)); }
    catch (e: any) { Alert.alert("Error", e?.message || "Not found"); router.back(); }
    finally { setLoading(false); }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  function set(k: string, v: string) { setDirty((d: any) => ({ ...d, [k]: v })); }

  async function save() {
    if (!Object.keys(dirty).length) { Alert.alert("Nothing changed"); return; }
    setSaving(true);
    try {
      const updated = await api.adminUpdatePatient(id!, dirty);
      setData(updated); setDirty({});
      Alert.alert("Saved");
    } catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
    finally { setSaving(false); }
  }

  async function del() {
    Alert.alert("Delete patient?",
      "This is a SOFT delete — the account and their records are hidden but preserved. You can restore later from the DB if needed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try { await api.adminDeletePatient(id!); router.replace("/admin/patients"); }
            catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
          },
        },
      ]);
  }

  if (loading || !data) return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.brand} /></View>;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="pd-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Admin · Patient</Text>
          <Text style={styles.title}>{data.name || data.email}</Text>
        </View>
        <TouchableOpacity onPress={del} testID="pd-delete" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="trash-2" size={18} color={COLORS.error} />
        </TouchableOpacity>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.statsRow}>
            <Stat label="Appointments" value={data.appointments_count || 0} />
            <Stat label="Prescriptions" value={data.prescriptions_count || 0} />
            <Stat label="Family" value={data.family_members_count || 0} />
          </View>

          {FIELDS.map((f) => (
            <View key={f.key} style={{ marginBottom: SPACING.md }}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                value={dirty[f.key] !== undefined ? dirty[f.key] : (data[f.key] || "")}
                onChangeText={(v) => set(f.key, v)}
                style={[styles.input, f.multi && { minHeight: 80, textAlignVertical: "top" }]}
                multiline={f.multi}
                keyboardType={f.kb}
                autoCapitalize={f.kb === "email-address" ? "none" : "sentences"}
                placeholderTextColor={COLORS.textMuted}
                testID={`pd-${f.key}`}
              />
            </View>
          ))}

          <Text style={styles.meta}>Created: {new Date(data.created_at).toLocaleString()}</Text>
          {data.deleted && <Text style={styles.deleted}>⚠️ This account is soft-deleted</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} disabled={saving || !Object.keys(dirty).length} onPress={save} testID="pd-save">
            {saving ? <ActivityIndicator color={COLORS.surface} /> : (
              <>
                <Feather name="check" size={16} color={COLORS.surface} />
                <Text style={styles.saveText}>Save changes {Object.keys(dirty).length ? `(${Object.keys(dirty).length})` : ""}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  head: { flexDirection: "row", alignItems: "center", padding: SPACING.md, paddingHorizontal: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: SPACING.md, marginBottom: SPACING.lg },
  stat: { flex: 1, alignItems: "center", padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  statVal: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.brand },
  statLbl: { color: COLORS.textMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700", marginTop: 2 },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 14 },
  meta: { color: COLORS.textMuted, fontSize: 11, marginTop: SPACING.md },
  deleted: { color: COLORS.error, marginTop: SPACING.sm, fontWeight: "700" },
  footer: { padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  saveBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill },
  saveText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
});
