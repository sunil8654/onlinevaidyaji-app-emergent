// Doctor edit-profile screen.
//
// Every field the website's "dashboard/profile" form can write is editable here,
// because both surfaces read and write the same MySQL columns (`users.*` and
// `doctors.*`). Anything the website does not store (clinic details) is kept in a
// clearly separated app-only section, and admin-owned values are shown read-only.
import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, Image, Alert, Switch, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import {
  api, type DoctorProfilePayload,
  type SpecializationOption, type CityOption,
} from "@/src/api";
import Feather from "@react-native-vector-icons/feather";

const LANGS = [
  "Hindi", "English", "Tamil", "Marathi", "Bengali", "Gujarati",
  "Urdu", "Kannada", "Telugu", "Malayalam", "Punjabi", "Odia", "Assamese",
];

const SYSTEM_LABELS: Record<string, string> = {
  ayurveda: "Ayurveda",
  yoga: "Yoga",
  naturopathy: "Naturopathy",
  unani: "Unani",
  siddha: "Siddha",
  homeopathy: "Homeopathy",
  "retreat-hills": "Retreat (Hills)",
  dietician: "Dietician",
  therapist: "Therapist",
};

/** `doctors.languages` is comma-separated text; anything else yields []. */
function parseLanguages(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Form = {
  name: string;
  phone: string;
  qualification: string;
  experience: string;
  consultation_fee: string;
  gender: string;
  system: string;
  specialization_id: string;
  city: string;
  about: string;
  bio: string;
  languages: string[];
  is_available_online: boolean;
  is_available_offline: boolean;
  clinic_name: string;
  clinic_address: string;
  registration_number: string;
  photo_existing: string;
  photo_new: string;
};

const EMPTY: Form = {
  name: "", phone: "", qualification: "", experience: "", consultation_fee: "",
  gender: "", system: "", specialization_id: "", city: "", about: "", bio: "",
  languages: [], is_available_online: true, is_available_offline: true,
  clinic_name: "", clinic_address: "", registration_number: "",
  photo_existing: "", photo_new: "",
};

export default function EditDoctorProfile() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [meta, setMeta] = useState<{
    email: string;
    slug: string | null;
    is_approved: boolean;
    is_restricted: boolean;
    restriction_reason: string | null;
    rating: number;
    review_count: number;
    status: string;
    onboarded: boolean;
  }>({
    email: "", slug: null, is_approved: false, is_restricted: false,
    restriction_reason: null, rating: 0, review_count: 0, status: "offline",
    onboarded: false,
  });
  const [specializations, setSpecializations] = useState<SpecializationOption[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    (async () => {
      try {
        const [me, tax, cityList] = await Promise.all([
          api.doctorMe(),
          api.listSpecializations().catch(() => null),
          api.listCities().catch(() => null),
        ]);
        setForm({
          ...EMPTY,
          name: me.name ?? "",
          phone: me.phone ?? "",
          qualification: me.qualification ?? "",
          experience: me.experience ? String(me.experience) : "",
          // Never default to a fee the doctor did not set: an invented price
          // would be charged to patients.
          consultation_fee:
            me.consultation_fee === null || me.consultation_fee === undefined
              ? "" : String(me.consultation_fee),
          gender: me.gender ?? "",
          system: me.system ?? "",
          specialization_id: me.specialization_id ? String(me.specialization_id) : "",
          city: me.city ?? "",
          about: me.about ?? "",
          bio: me.bio ?? "",
          languages: parseLanguages(me.languages),
          is_available_online: !!me.is_available_online,
          is_available_offline: !!me.is_available_offline,
          clinic_name: me.clinic_name ?? "",
          clinic_address: me.clinic_address ?? "",
          registration_number: me.registration_number ?? "",
          photo_existing: me.image ?? me.avatar_url ?? "",
        });
        setMeta({
          email: me.email ?? "",
          slug: me.slug ?? null,
          is_approved: !!me.is_approved,
          is_restricted: !!me.is_restricted,
          restriction_reason: me.restriction_reason ?? null,
          rating: me.rating ?? 0,
          review_count: me.review_count ?? 0,
          status: me.status ?? "offline",
          onboarded: !!me.onboarded_at,
        });
        setSpecializations(tax?.specializations ?? []);
        setSystems(tax?.systems ?? []);
        setCities(cityList?.cities ?? []);
      } catch (e: any) {
        Alert.alert("Could not load profile", e?.message || "Try again");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleLang = (l: string) =>
    setForm((f) => ({
      ...f,
      languages: f.languages.includes(l)
        ? f.languages.filter((x) => x !== l)
        : [...f.languages, l],
    }));

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission needed",
          "Grant photo access from Settings to change your profile picture.",
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
      set("photo_new", dataUri);
    } catch (e: any) {
      Alert.alert("Could not pick photo", e?.message || "Try again");
    }
  };

  const missing = useMemo(() => {
    const gaps: string[] = [];
    if (!form.name.trim()) gaps.push("full name");
    if (!form.system) gaps.push("type of medicine");
    if (!form.specialization_id) gaps.push("specialization");
    if (!form.city.trim()) gaps.push("city");
    if (form.consultation_fee.trim() && Number.isNaN(Number(form.consultation_fee)))
      gaps.push("a numeric consultation fee");
    return gaps;
  }, [form]);

  const save = async () => {
    if (missing.length) {
      Alert.alert(
        "Some details are missing",
        `Please add: ${missing.join(", ")}.`,
      );
      return;
    }
    const payload: DoctorProfilePayload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      qualification: form.qualification.trim(),
      experience: form.experience.trim() ? parseInt(form.experience, 10) : 0,
      gender: form.gender === "male" || form.gender === "female" ? form.gender : undefined,
      system: form.system,
      specialization_id: form.specialization_id ? parseInt(form.specialization_id, 10) : undefined,
      city: form.city.trim(),
      about: form.about.trim(),
      bio: form.bio.trim(),
      languages: form.languages,
      is_available_online: form.is_available_online,
      is_available_offline: form.is_available_offline,
      clinic_name: form.clinic_name.trim(),
      clinic_address: form.clinic_address.trim(),
      registration_number: form.registration_number.trim(),
    };
    // A blank fee clears it rather than storing a made-up amount.
    if (form.consultation_fee.trim()) payload.consultation_fee = Number(form.consultation_fee);
    if (form.photo_new) payload.image = form.photo_new;

    setBusy(true);
    try {
      await api.updateDoctorProfile(payload);
      Alert.alert("Saved", "Your profile is updated.");
      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || "Try again");
    } finally {
      setBusy(false);
    }
  };

  const currentPhoto = form.photo_new || form.photo_existing;
  const modeCount = (form.is_available_online ? 1 : 0) + (form.is_available_offline ? 1 : 0);

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="edit-profile-back">
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Clinic profile</Text>
            <Text style={styles.title}>Edit profile</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.formBody}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* ---- profile state, read-only ---- */}
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Feather
                name={meta.is_approved ? "check-circle" : "clock"}
                size={15}
                color={meta.is_approved ? "#1F9D55" : COLORS.textMuted}
              />
              <Text style={styles.statusText}>
                {meta.is_approved ? "Approved by the clinic" : "Awaiting approval"}
              </Text>
            </View>
            {meta.is_restricted && (
              <View style={styles.statusRow}>
                <Feather name="alert-triangle" size={15} color="#C0392B" />
                <Text style={[styles.statusText, { color: "#C0392B" }]}>
                  Restricted{meta.restriction_reason ? `: ${meta.restriction_reason}` : ""}
                </Text>
              </View>
            )}
            <Text style={styles.statusMeta}>
              {meta.rating ? `${meta.rating} ★ · ${meta.review_count} reviews · ` : ""}
              {meta.onboarded ? "App onboarding complete" : "Registered on the website"}
              {meta.slug ? ` · ${meta.slug}` : ""}
            </Text>
          </View>

          {/* ---- photo ---- */}
          <Text style={styles.label}>Profile photo</Text>
          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoCircle} onPress={pickPhoto} testID="edit-photo">
              {currentPhoto ? (
                <Image source={{ uri: currentPhoto }} style={styles.photoImg} />
              ) : (
                <Feather name="camera" size={26} color={COLORS.textMuted} />
              )}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} testID="edit-photo-btn">
                <Feather
                  name={currentPhoto ? "refresh-cw" : "upload"}
                  size={14}
                  color={COLORS.brand}
                />
                <Text style={styles.photoBtnText}>
                  {currentPhoto ? "Change photo" : "Choose photo"}
                </Text>
              </TouchableOpacity>
              <Text style={styles.photoHint}>Square, well-lit headshot recommended.</Text>
            </View>
          </View>

          {/* ---- identity (users table) ---- */}
          <Text style={styles.section}>About you</Text>

          <Text style={styles.label}>Full name</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(v) => set("name", v)}
            placeholder="Dr. Your Name"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-name"
          />

          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={form.phone}
            onChangeText={(v) => set("phone", v)}
            keyboardType="phone-pad"
            placeholder="10-digit mobile number"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-phone"
          />
          {meta.email ? (
            <Text style={styles.hint}>Email {meta.email} is managed by the account and cannot be changed here.</Text>
          ) : null}

          <Text style={styles.label}>Gender</Text>
          <View style={styles.chipRow}>
            {["male", "female"].map((g) => (
              <TouchableOpacity
                key={g}
                onPress={() => set("gender", form.gender === g ? "" : g)}
                style={[styles.chip, form.gender === g && styles.chipActive]}
              >
                <Text style={[styles.chipText, form.gender === g && styles.chipTextActive]}>
                  {g === "male" ? "Male" : "Female"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ---- practice (doctors table) ---- */}
          <Text style={styles.section}>Practice</Text>

          <Text style={styles.label}>Type of Medicine</Text>
          <View style={styles.chipRow}>
            {(systems.length ? systems : Object.keys(SYSTEM_LABELS)).map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => set("system", form.system === s ? "" : s)}
                style={[styles.chip, form.system === s && styles.chipActive]}
              >
                <Text style={[styles.chipText, form.system === s && styles.chipTextActive]}>
                  {SYSTEM_LABELS[s] ?? s}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Specialization</Text>
          <View style={styles.chipRow}>
            {specializations.map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() =>
                  set(
                    "specialization_id",
                    form.specialization_id === String(s.id) ? "" : String(s.id),
                  )
                }
                style={[
                  styles.chip,
                  form.specialization_id === String(s.id) && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    form.specialization_id === String(s.id) && styles.chipTextActive,
                  ]}
                >
                  {s.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Qualification</Text>
          <TextInput
            style={styles.input}
            value={form.qualification}
            onChangeText={(v) => set("qualification", v)}
            placeholder="BAMS, MD in Ayurveda"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-qual"
          />

          <Text style={styles.label}>Years of experience</Text>
          <TextInput
            style={styles.input}
            value={form.experience}
            onChangeText={(v) => set("experience", v.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-exp"
          />

          <Text style={styles.label}>City</Text>
          <View style={styles.chipRow}>
            {cities.map((c) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => set("city", form.city === c.name ? "" : c.name)}
                style={[styles.chip, form.city === c.name && styles.chipActive]}
              >
                <Text style={[styles.chipText, form.city === c.name && styles.chipTextActive]}>
                  {c.state ? `${c.name}, ${c.state}` : c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={form.city}
            onChangeText={(v) => set("city", v)}
            placeholder="Or type your city"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-city"
          />

          <Text style={styles.label}>Consultation fee (₹)</Text>
          <TextInput
            style={styles.input}
            value={form.consultation_fee}
            onChangeText={(v) => set("consultation_fee", v.replace(/[^0-9.]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="Leave blank if not set"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-fee"
          />
          <Text style={styles.hint}>
            Leave this blank if you have not set a fee. Patients cannot book you until a fee is set.
          </Text>

          {/* ---- consultation modes ---- */}
          <Text style={styles.label}>Consultation modes</Text>
          {modeCount === 0 && (
            <Text style={[styles.hint, { color: "#C0392B" }]}>
              Pick at least one mode, otherwise patients will not see you as bookable.
            </Text>
          )}
          <View style={styles.modeRow}>
            <Text style={styles.modeLabel}>Online</Text>
            <Switch
              value={form.is_available_online}
              onValueChange={(v) => set("is_available_online", v)}
              trackColor={{ true: COLORS.brand, false: COLORS.border }}
              thumbColor={COLORS.surface}
            />
          </View>
          <View style={styles.modeRow}>
            <Text style={styles.modeLabel}>In-clinic</Text>
            <Switch
              value={form.is_available_offline}
              onValueChange={(v) => set("is_available_offline", v)}
              trackColor={{ true: COLORS.brand, false: COLORS.border }}
              thumbColor={COLORS.surface}
            />
          </View>

          {/* ---- content shown to patients ---- */}
          <Text style={styles.section}>Patient-facing copy</Text>

          <Text style={styles.label}>Languages</Text>
          <View style={styles.chipRow}>
            {LANGS.map((l) => (
              <TouchableOpacity
                key={l}
                onPress={() => toggleLang(l)}
                style={[styles.chip, form.languages.includes(l) && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    form.languages.includes(l) && styles.chipTextActive,
                  ]}
                >
                  {l}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Short bio</Text>
          <TextInput
            style={[styles.input, { minHeight: 84 }]}
            value={form.about}
            onChangeText={(v) => set("about", v)}
            multiline
            placeholder="A couple of lines patients see first"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-about"
          />

          <Text style={styles.label}>Detailed bio</Text>
          <TextInput
            style={[styles.input, { minHeight: 130 }]}
            value={form.bio}
            onChangeText={(v) => set("bio", v)}
            multiline
            placeholder="Training, approach and focus areas"
            placeholderTextColor={COLORS.textMuted}
            testID="edit-bio"
          />

          {/* ---- app-only extras ---- */}
          <Text style={styles.section}>Clinic details</Text>
          <Text style={styles.hint}>
            These are only visible inside the app; the website profile has no field for them.
          </Text>

          <Text style={styles.label}>Clinic name</Text>
          <TextInput
            style={styles.input}
            value={form.clinic_name}
            onChangeText={(v) => set("clinic_name", v)}
            placeholderTextColor={COLORS.textMuted}
            testID="edit-clinic"
          />

          <Text style={styles.label}>Clinic address</Text>
          <TextInput
            style={styles.input}
            value={form.clinic_address}
            onChangeText={(v) => set("clinic_address", v)}
            multiline
            placeholderTextColor={COLORS.textMuted}
            testID="edit-address"
          />

          <Text style={styles.label}>Registration number</Text>
          <TextInput
            style={styles.input}
            value={form.registration_number}
            onChangeText={(v) => set("registration_number", v)}
            placeholderTextColor={COLORS.textMuted}
            testID="edit-regno"
          />
        </ScrollView>

        {/* Save lives in a fixed footer, not at the end of a long form. It used
            to sit inside the ScrollView, so on shorter devices (and whenever the
            keyboard was open) the only way to reach it was to scroll to the very
            bottom - and on some devices the last field plus the button did not fit
            on screen at all. */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={save}
            testID="edit-save"
          >
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save changes"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: {
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row",
    alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md,
  },
  eyebrow: {
    textTransform: "uppercase", letterSpacing: 3, fontSize: 11,
    color: COLORS.accent, fontWeight: "700",
  },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: 2 },
  section: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary,
    marginTop: SPACING.xl, marginBottom: 2,
  },
  label: {
    color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase",
    letterSpacing: 2, marginTop: SPACING.md, marginBottom: 8, fontWeight: "700",
  },
  hint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6, lineHeight: 17 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12,
    color: COLORS.textPrimary, fontSize: 15,
  },
  statusCard: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, padding: SPACING.md, gap: 6,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  statusMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  photoRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: 4 },
  photoCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center",
    justifyContent: "center", overflow: "hidden",
  },
  photoImg: { width: "100%", height: "100%" },
  photoBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start",
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.brand, backgroundColor: COLORS.surface,
  },
  photoBtnText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  photoHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  modeRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: SPACING.sm,
  },
  modeLabel: { color: COLORS.textPrimary, fontSize: 15 },
  // Scroll body keeps a bottom pad so the last field is never hidden behind
  // the fixed footer.
  formBody: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  saveBtn: {
    backgroundColor: COLORS.brand, paddingVertical: 16,
    borderRadius: RADIUS.pill, alignItems: "center",
  },
  saveText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
});