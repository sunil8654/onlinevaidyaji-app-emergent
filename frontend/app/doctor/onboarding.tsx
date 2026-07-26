import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform, Image, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING, SPECIALTIES } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Feather } from "@expo/vector-icons";

const LANGS = ["Hindi", "English", "Tamil", "Marathi", "Bengali", "Gujarati", "Urdu", "Kannada", "Telugu", "Malayalam"];

export default function DoctorOnboarding() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    specialty: "Ayurveda",
    qualification: "",
    registration_number: "",
    experience_years: "",
    consultation_fee: "499",
    bio: "",
    clinic_name: "",
    clinic_address: "",
    languages: ["Hindi", "English"] as string[],
    documentsAttached: false,
    avatar_base64: "" as string,  // profile photo (base64 or data URI)
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api.doctorMe();
        if (d?.onboarded_at) router.replace("/(tabs)/home");
      } catch {}
    })();
  }, [router]);

  const toggleLang = (l: string) =>
    setForm((f) => ({ ...f, languages: f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l] }));

  const pickPhoto = async () => {
    try {
      // Ask for photo library permission (contextual — right after user taps)
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to set a profile picture. You can grant it from Settings.",
          [{ text: "OK" }]
        );
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
      const dataUri = asset.uri?.startsWith("data:")
        ? asset.uri
        : `data:image/jpeg;base64,${asset.base64}`;
      setForm((f) => ({ ...f, avatar_base64: dataUri }));
    } catch (e: any) {
      Alert.alert("Could not attach photo", e?.message || "Try again");
    }
  };

  const next = () => setStep((s) => Math.min(s + 1, 3));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.doctorOnboard({
        specialty: form.specialty,
        qualification: form.qualification,
        registration_number: form.registration_number,
        experience_years: parseInt(form.experience_years || "0", 10),
        consultation_fee: parseInt(form.consultation_fee || "499", 10),
        bio: form.bio,
        clinic_name: form.clinic_name,
        clinic_address: form.clinic_address,
        languages: form.languages,
        avatar_base64: form.avatar_base64 || undefined,
        documents: form.documentsAttached ? ["degree_certificate.pdf", "reg_certificate.pdf"] : [],
      });
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message || "Could not save");
    }
    setBusy(false);
  };

  const canNext = () => {
    if (step === 0) return !!form.specialty && !!form.qualification;
    if (step === 1) return !!form.registration_number && form.documentsAttached;
    if (step === 2) return form.languages.length > 0 && !!form.experience_years;
    return true;
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} testID="do-back" style={{ width: 40 }}>
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Vaidya onboarding · Step {step + 1} / 4</Text>
            <Text style={styles.title}>Welcome, {user?.name}</Text>
          </View>
        </View>

        <View style={styles.progress}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.dot, step >= i && styles.dotActive]} />
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <View>
              <Text style={styles.sectionTitle}>Your practice</Text>
              <Text style={styles.sectionSub}>Tell us your AYUSH specialty and qualification.</Text>
              <Text style={styles.label}>Specialty</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {SPECIALTIES.filter((s) => s !== "All").map((s) => (
                  <TouchableOpacity key={s} onPress={() => setForm({ ...form, specialty: s })} style={[styles.chip, form.specialty === s && styles.chipActive]} testID={`do-spec-${s}`}>
                    <Text style={[styles.chipText, form.specialty === s && styles.chipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.label}>Qualification</Text>
              <TextInput style={styles.input} value={form.qualification} onChangeText={(v) => setForm({ ...form, qualification: v })} placeholder="e.g. BAMS, MD (Ayurveda)" placeholderTextColor={COLORS.textMuted} testID="do-qual" />
            </View>
          )}

          {step === 1 && (
            <View>
              <Text style={styles.sectionTitle}>Verification</Text>
              <Text style={styles.sectionSub}>Your AYUSH council registration + degree — for patient trust.</Text>
              <Text style={styles.label}>AYUSH Registration No.</Text>
              <TextInput
                style={styles.input}
                value={form.registration_number}
                onChangeText={(v) => setForm({ ...form, registration_number: v })}
                autoCapitalize="characters"
                placeholder="e.g. AYUSH/BAMS/2016/12345"
                placeholderTextColor={COLORS.textMuted}
                testID="do-reg"
              />
              <TouchableOpacity
                style={[styles.uploader, form.documentsAttached && styles.uploaderDone]}
                onPress={() => setForm({ ...form, documentsAttached: !form.documentsAttached })}
                testID="do-upload"
              >
                <Feather name={form.documentsAttached ? "check-circle" : "upload"} size={24} color={form.documentsAttached ? COLORS.success : COLORS.brand} />
                <Text style={styles.uploaderTitle}>{form.documentsAttached ? "Documents attached" : "Attach degree + reg certificate"}</Text>
                <Text style={styles.uploaderSub}>{form.documentsAttached ? "2 files ready (demo)" : "PDF / JPG — max 5 MB each"}</Text>
              </TouchableOpacity>
              <View style={styles.info}>
                <Feather name="info" size={12} color={COLORS.brand} />
                <Text style={styles.infoText}>Our admin verifies your documents within 24 hours. You&apos;ll get a notification once approved.</Text>
              </View>
            </View>
          )}

          {step === 2 && (
            <View>
              <Text style={styles.sectionTitle}>Practice details</Text>
              <Text style={styles.label}>Years of experience</Text>
              <TextInput style={styles.input} value={form.experience_years} onChangeText={(v) => setForm({ ...form, experience_years: v })} keyboardType="numeric" placeholder="8" placeholderTextColor={COLORS.textMuted} testID="do-exp" />
              <Text style={styles.label}>Consultation fee (₹)</Text>
              <TextInput style={styles.input} value={form.consultation_fee} onChangeText={(v) => setForm({ ...form, consultation_fee: v })} keyboardType="numeric" placeholderTextColor={COLORS.textMuted} testID="do-fee" />
              <Text style={styles.label}>Languages you consult in</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {LANGS.map((l) => (
                  <TouchableOpacity key={l} onPress={() => toggleLang(l)} style={[styles.chip, form.languages.includes(l) && styles.chipActive]} testID={`do-lang-${l}`}>
                    <Text style={[styles.chipText, form.languages.includes(l) && styles.chipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {step === 3 && (
            <View>
              <Text style={styles.sectionTitle}>Clinic & bio</Text>

              <Text style={styles.label}>Profile photo</Text>
              <View style={styles.photoRow}>
                <TouchableOpacity style={styles.photoCircle} onPress={pickPhoto} testID="do-photo">
                  {form.avatar_base64 ? (
                    <Image source={{ uri: form.avatar_base64 }} style={styles.photoImg} />
                  ) : (
                    <Feather name="camera" size={26} color={COLORS.textMuted} />
                  )}
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} testID="do-photo-btn">
                    <Feather name={form.avatar_base64 ? "refresh-cw" : "upload"} size={14} color={COLORS.brand} />
                    <Text style={styles.photoBtnText}>{form.avatar_base64 ? "Change photo" : "Choose photo"}</Text>
                  </TouchableOpacity>
                  {form.avatar_base64 ? (
                    <TouchableOpacity style={styles.photoRemove} onPress={() => setForm({ ...form, avatar_base64: "" })}>
                      <Text style={styles.photoRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.photoHint}>A clear headshot builds patient trust.</Text>
                  )}
                </View>
              </View>

              <Text style={styles.label}>Clinic name (optional)</Text>
              <TextInput style={styles.input} value={form.clinic_name} onChangeText={(v) => setForm({ ...form, clinic_name: v })} placeholder="Ayurveda Sanjeevani Clinic" placeholderTextColor={COLORS.textMuted} testID="do-clinic" />
              <Text style={styles.label}>Clinic address (optional)</Text>
              <TextInput style={styles.input} value={form.clinic_address} onChangeText={(v) => setForm({ ...form, clinic_address: v })} placeholder="Sector 22, Chandigarh" placeholderTextColor={COLORS.textMuted} testID="do-address" />
              <Text style={styles.label}>Bio (visible to patients)</Text>
              <TextInput style={[styles.input, { minHeight: 100 }]} value={form.bio} onChangeText={(v) => setForm({ ...form, bio: v })} multiline placeholder="Specialised in dosha-based lifestyle correction and Panchakarma…" placeholderTextColor={COLORS.textMuted} testID="do-bio" />
            </View>
          )}

          {err ? <Text style={styles.err}>{err}</Text> : null}

          <View style={styles.navRow}>
            {step > 0 && (
              <TouchableOpacity style={styles.navBtn} onPress={back} testID="do-prev">
                <Feather name="arrow-left" size={16} color={COLORS.brand} />
                <Text style={styles.navBtnText}>Back</Text>
              </TouchableOpacity>
            )}
            {step < 3 ? (
              <TouchableOpacity style={[styles.nextBtn, !canNext() && { opacity: 0.5 }]} onPress={next} disabled={!canNext()} testID="do-next">
                <Text style={styles.nextText}>Continue</Text>
                <Feather name="arrow-right" size={16} color={COLORS.surface} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.nextBtn, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy} testID="do-submit">
                <Text style={styles.nextText}>{busy ? "Submitting…" : "Submit for verification"}</Text>
                <Feather name="check" size={16} color={COLORS.surface} />
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", gap: SPACING.md, alignItems: "flex-start" },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, marginTop: 2 },
  progress: { flexDirection: "row", gap: 6, marginHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm },
  dot: { flex: 1, height: 4, backgroundColor: COLORS.border, borderRadius: 2 },
  dotActive: { backgroundColor: COLORS.brand },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: SPACING.md, letterSpacing: -0.5 },
  sectionSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 8, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textPrimary, fontSize: 15 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  uploader: { alignItems: "center", padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.brand, borderStyle: "dashed", marginTop: SPACING.md },
  uploaderDone: { backgroundColor: "#E8F5E9", borderColor: COLORS.success, borderStyle: "solid" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: 4 },
  photoCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImg: { width: "100%", height: "100%" },
  photoBtn: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.brand, backgroundColor: COLORS.surface },
  photoBtnText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  photoHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  photoRemove: { marginTop: 6, alignSelf: "flex-start" },
  photoRemoveText: { color: COLORS.error, fontSize: 12, fontWeight: "600" },
  uploaderTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary, marginTop: 10 },
  uploaderSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  info: { flexDirection: "row", gap: 6, marginTop: SPACING.md, padding: 10, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, alignItems: "flex-start" },
  infoText: { color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 16 },
  err: { color: COLORS.error, marginTop: 12 },
  navRow: { flexDirection: "row", gap: 8, marginTop: SPACING.lg },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.pill },
  navBtnText: { color: COLORS.brand, fontWeight: "700" },
  nextBtn: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill },
  nextText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
});
