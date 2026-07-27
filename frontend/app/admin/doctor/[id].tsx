// Admin — Doctor detail: full profile, verification docs, editable fields, approve/reject.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const FIELDS: { key: string; label: string; kb?: any; multi?: boolean }[] = [
  { key: "name", label: "Full name" },
  { key: "email", label: "Email", kb: "email-address" },
  { key: "phone", label: "Phone", kb: "phone-pad" },
  { key: "specialty", label: "Specialty" },
  { key: "qualification", label: "Qualification / Degree" },
  { key: "registration_number", label: "AYUSH Registration Number" },
  { key: "consultation_fee", label: "Consultation Fee (₹)", kb: "number-pad" },
  { key: "experience_years", label: "Experience (years)", kb: "number-pad" },
  { key: "clinic_name", label: "Clinic name" },
  { key: "clinic_address", label: "Clinic address", multi: true },
  { key: "bio", label: "Bio", multi: true },
  { key: "admin_notes", label: "Admin notes (private)", multi: true },
];

export default function AdminDoctorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [dirty, setDirty] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try { setData(await api.adminGetDoctor(id)); }
    catch (e: any) { Alert.alert("Error", e?.message || "Not found"); router.back(); }
    finally { setLoading(false); }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  function set(k: string, v: any) { setDirty((d: any) => ({ ...d, [k]: v })); }

  async function save() {
    if (!Object.keys(dirty).length) { Alert.alert("Nothing changed"); return; }
    // Convert numeric fields
    const body = { ...dirty };
    for (const k of ["consultation_fee", "experience_years"]) {
      if (k in body) body[k] = parseInt(body[k], 10) || 0;
    }
    setSaving(true);
    try {
      const updated = await api.adminUpdateDoctorFull(id!, body);
      setData({ ...data, ...updated }); setDirty({});
      Alert.alert("Saved");
    } catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
    finally { setSaving(false); }
  }

  async function approve() {
    try {
      const updated = await api.adminUpdateDoctorFull(id!, { verified: true });
      setData({ ...data, ...updated });
      Alert.alert("Approved", "Doctor is now verified.");
    } catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
  }

  async function reject() {
    try {
      const updated = await api.adminUpdateDoctorFull(id!, { verified: false });
      setData({ ...data, ...updated });
      Alert.alert("Marked unverified", "Doctor is now hidden from public listing.");
    } catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
  }

  if (loading || !data) return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.brand} /></View>;

  const docs: string[] = Array.isArray(data.documents) ? data.documents : [];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="dd-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Admin · Doctor</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.title} numberOfLines={1}>{data.name}</Text>
            {data.verified && <Feather name="check-circle" size={14} color={COLORS.brand} />}
          </View>
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
          {/* Verification banner */}
          <View style={[styles.banner, data.verified ? styles.bannerOk : styles.bannerPending]}>
            <Feather name={data.verified ? "shield" : "alert-triangle"} size={16} color={COLORS.surface} />
            <Text style={styles.bannerText}>
              {data.verified ? "Verified — visible to patients" : "Pending verification — review docs & registration below"}
            </Text>
            <View style={styles.verifyRow}>
              <TouchableOpacity style={styles.rejectBtn} onPress={reject} testID="dd-reject">
                <Text style={styles.rejectText}>Unverify</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.approveBtn} onPress={approve} testID="dd-approve">
                <Text style={styles.approveText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <Stat label="Appts" value={data.appointments_count || 0} />
            <Stat label="Rx" value={data.prescriptions_count || 0} />
            <Stat label="Posts" value={data.community_posts_count || 0} />
            <Stat label="Fee" value={`₹${data.consultation_fee || 0}`} />
          </View>

          {/* Avatar */}
          {data.avatar_url && (
            <View style={{ alignItems: "center", marginBottom: SPACING.md }}>
              <Image source={{ uri: data.avatar_url }} style={styles.avatar} />
            </View>
          )}

          {/* Verification documents */}
          <Text style={styles.sectionLabel}>Verification documents ({docs.length})</Text>
          {docs.length === 0 ? (
            <Text style={styles.emptyDocs}>No documents uploaded by the doctor.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.md }}>
              {docs.map((d, i) => (
                <View key={i} style={styles.docTile}>
                  <Image source={{ uri: d }} style={styles.docImg} />
                  <Text style={styles.docLabel}>Doc {i + 1}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Editable fields */}
          {FIELDS.map((f) => (
            <View key={f.key} style={{ marginBottom: SPACING.md }}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                value={dirty[f.key] !== undefined ? String(dirty[f.key]) : String(data[f.key] ?? "")}
                onChangeText={(v) => set(f.key, v)}
                style={[styles.input, f.multi && { minHeight: 80, textAlignVertical: "top" }]}
                multiline={f.multi}
                keyboardType={f.kb}
                autoCapitalize={f.kb === "email-address" ? "none" : "sentences"}
                placeholderTextColor={COLORS.textMuted}
                testID={`dd-${f.key}`}
              />
            </View>
          ))}

          {/* Verified toggle explicit */}
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Verified status</Text>
            <Switch
              value={dirty.verified !== undefined ? dirty.verified : !!data.verified}
              onValueChange={(v) => set("verified", v)}
              trackColor={{ true: COLORS.brand, false: COLORS.border }}
              thumbColor={COLORS.surface}
              testID="dd-verified"
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.saveBtn, (saving || !Object.keys(dirty).length) && { opacity: 0.5 }]} disabled={saving || !Object.keys(dirty).length} onPress={save} testID="dd-save">
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
  banner: { padding: SPACING.md, borderRadius: RADIUS.lg, marginBottom: SPACING.md, gap: 8 },
  bannerOk: { backgroundColor: COLORS.success },
  bannerPending: { backgroundColor: COLORS.warning },
  bannerText: { color: COLORS.surface, fontSize: 13, fontWeight: "700" },
  verifyRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  rejectBtn: { flex: 1, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center" },
  rejectText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  approveBtn: { flex: 1, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, alignItems: "center" },
  approveText: { color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  statsRow: { flexDirection: "row", gap: 6, marginBottom: SPACING.md },
  stat: { flex: 1, alignItems: "center", padding: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  statVal: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.brand },
  statLbl: { color: COLORS.textMuted, fontSize: 9, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700", marginTop: 2 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.surfaceAlt },
  sectionLabel: { textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700", marginBottom: SPACING.sm, marginTop: SPACING.md },
  docTile: { marginRight: SPACING.sm, alignItems: "center" },
  docImg: { width: 140, height: 180, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border },
  docLabel: { color: COLORS.textMuted, fontSize: 10, marginTop: 4, fontWeight: "700" },
  emptyDocs: { color: COLORS.textMuted, fontStyle: "italic", padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 14 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  footer: { padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  saveBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill },
  saveText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
});
