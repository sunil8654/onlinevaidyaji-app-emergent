// Doctor edit-profile screen — update avatar photo, bio, fee, languages after onboarding.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform, Image, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING, SPECIALTIES } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

const LANGS = ["Hindi", "English", "Tamil", "Marathi", "Bengali", "Gujarati", "Urdu", "Kannada", "Telugu", "Malayalam"];

export default function EditDoctorProfile() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    specialty: "Ayurveda",
    qualification: "",
    experience_years: "",
    consultation_fee: "499",
    bio: "",
    clinic_name: "",
    clinic_address: "",
    languages: ["Hindi", "English"] as string[],
    avatar_url: "" as string,        // existing avatar from DB (data URI or http)
    avatar_new: "" as string,        // freshly picked (data URI) — takes priority
  });

  useEffect(() => {
    (async () => {
      try {
        const d = await api.doctorMe();
        if (d) {
          setForm((f) => ({
            ...f,
            specialty: d.specialty || f.specialty,
            qualification: d.qualification || "",
            experience_years: String(d.experience_years || ""),
            consultation_fee: String(d.consultation_fee || "499"),
            bio: d.bio || "",
            clinic_name: d.clinic_name || "",
            clinic_address: d.clinic_address || "",
            languages: d.languages?.length ? d.languages : f.languages,
            avatar_url: d.avatar_url || "",
          }));
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const toggleLang = (l: string) =>
    setForm((f) => ({ ...f, languages: f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l] }));

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Grant photo access from Settings to change your profile picture.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      const dataUri = asset.uri?.startsWith("data:") ? asset.uri : `data:image/jpeg;base64,${asset.base64}`;
      setForm((f) => ({ ...f, avatar_new: dataUri }));
    } catch (e: any) {
      Alert.alert("Could not pick photo", e?.message || "Try again");
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.updateDoctorProfile({
        specialty: form.specialty,
        qualification: form.qualification,
        experience_years: parseInt(form.experience_years || "0", 10),
        consultation_fee: parseInt(form.consultation_fee || "499", 10),
        bio: form.bio,
        clinic_name: form.clinic_name,
        clinic_address: form.clinic_address,
        languages: form.languages,
        avatar_base64: form.avatar_new || undefined,
      });
      Alert.alert("Saved", "Your profile is updated.");
      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || "Try again");
    }
    setBusy(false);
  };

  const currentPhoto = form.avatar_new || form.avatar_url;

  if (loading) return <SafeAreaView style={styles.root}><View style={styles.centerLoader}><Text style={{ color: COLORS.textSecondary }}>Loading…</Text></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="edit-profile-back">
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.eyebrow}>Clinic profile</Text>
            <Text style={styles.title}>Edit profile</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 40 }}>
          <Text style={styles.label}>Profile photo</Text>
          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoCircle} onPress={pickPhoto} testID="edit-photo">
              {currentPhoto ? <Image source={{ uri: currentPhoto }} style={styles.photoImg} /> : <Feather name="camera" size={26} color={COLORS.textMuted} />}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} testID="edit-photo-btn">
                <Feather name={currentPhoto ? "refresh-cw" : "upload"} size={14} color={COLORS.brand} />
                <Text style={styles.photoBtnText}>{currentPhoto ? "Change photo" : "Choose photo"}</Text>
              </TouchableOpacity>
              <Text style={styles.photoHint}>Square, well-lit headshot recommended.</Text>
            </View>
          </View>

          <Text style={styles.label}>Specialty</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {SPECIALTIES.filter((s) => s !== "All").map((s) => (
              <TouchableOpacity key={s} onPress={() => setForm({ ...form, specialty: s })} style={[styles.chip, form.specialty === s && styles.chipActive]}>
                <Text style={[styles.chipText, form.specialty === s && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Qualification</Text>
          <TextInput style={styles.input} value={form.qualification} onChangeText={(v) => setForm({ ...form, qualification: v })} placeholder="BAMS, MD (Ayurveda)" placeholderTextColor={COLORS.textMuted} testID="edit-qual" />

          <Text style={styles.label}>Years of experience</Text>
          <TextInput style={styles.input} value={form.experience_years} onChangeText={(v) => setForm({ ...form, experience_years: v })} keyboardType="numeric" placeholderTextColor={COLORS.textMuted} testID="edit-exp" />

          <Text style={styles.label}>Consultation fee (₹)</Text>
          <TextInput style={styles.input} value={form.consultation_fee} onChangeText={(v) => setForm({ ...form, consultation_fee: v })} keyboardType="numeric" placeholderTextColor={COLORS.textMuted} testID="edit-fee" />

          <Text style={styles.label}>Languages</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {LANGS.map((l) => (
              <TouchableOpacity key={l} onPress={() => toggleLang(l)} style={[styles.chip, form.languages.includes(l) && styles.chipActive]}>
                <Text style={[styles.chipText, form.languages.includes(l) && styles.chipTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Clinic name</Text>
          <TextInput style={styles.input} value={form.clinic_name} onChangeText={(v) => setForm({ ...form, clinic_name: v })} placeholderTextColor={COLORS.textMuted} testID="edit-clinic" />

          <Text style={styles.label}>Clinic address</Text>
          <TextInput style={styles.input} value={form.clinic_address} onChangeText={(v) => setForm({ ...form, clinic_address: v })} placeholderTextColor={COLORS.textMuted} testID="edit-address" />

          <Text style={styles.label}>Bio (visible to patients)</Text>
          <TextInput style={[styles.input, { minHeight: 100 }]} value={form.bio} onChangeText={(v) => setForm({ ...form, bio: v })} multiline placeholderTextColor={COLORS.textMuted} testID="edit-bio" />

          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="edit-save">
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save changes"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  centerLoader: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: 2 },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 8, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 15 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  photoRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: 4 },
  photoCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImg: { width: "100%", height: "100%" },
  photoBtn: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.brand, backgroundColor: COLORS.surface },
  photoBtnText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  photoHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  saveBtn: { marginTop: SPACING.lg, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, alignItems: "center" },
  saveText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
});
