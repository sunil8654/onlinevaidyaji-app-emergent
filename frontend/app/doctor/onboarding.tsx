import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform, Image, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING, SPECIALTIES } from "@/src/theme";
import { api, type DoctorDocumentPayload, type WeeklySlotMap } from "@/src/api";
import { useAuth } from "@/src/auth";
import Feather from "@react-native-vector-icons/feather";
import { CREDENTIAL_TYPES, labelForDocType, pickCredentialFiles } from "@/src/utils/pickCredentials";

const LANGS = ["Hindi", "English", "Tamil", "Marathi", "Bengali", "Gujarati", "Urdu", "Kannada", "Telugu", "Malayalam"];

/** 0 = Sunday, matching `appointment_slots.day_of_week` and the website. */
const DAYS = [
  { idx: 0, short: "Sun", name: "Sunday" },
  { idx: 1, short: "Mon", name: "Monday" },
  { idx: 2, short: "Tue", name: "Tuesday" },
  { idx: 3, short: "Wed", name: "Wednesday" },
  { idx: 4, short: "Thu", name: "Thursday" },
  { idx: 5, short: "Fri", name: "Friday" },
  { idx: 6, short: "Sat", name: "Saturday" },
];

/** Time pickers in React Native need a simple list; 30-min steps match booking. */
const TIME_OPTIONS = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 22; h += 1) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
};

const fmt12h = (hhmm: string) => {
  const mins = toMinutes(hhmm);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

const TOTAL_STEPS = 5;

export default function DoctorOnboarding() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    specialty: "Ayurveda",
    specialization_id: "" as string,
    qualification: "",
    registration_number: "",
    experience_years: "",
    consultation_fee: "499",
    bio: "",
    clinic_name: "",
    clinic_address: "",
    city: "",
    gender: "" as "" | "male" | "female",
    languages: ["Hindi", "English"] as string[],
    avatar_base64: "" as string,  // profile photo (base64 or data URI)
  });
  /** Real base64 credential files, keyed by nothing - just an ordered list. */
  const [documents, setDocuments] = useState<DoctorDocumentPayload[]>([]);
  /** Recurring weekly schedule: day index -> start/end windows. */
  const [slots, setSlots] = useState<Record<number, { start: string; end: string }>>({
    1: { start: "09:00", end: "17:00" },
    2: { start: "09:00", end: "17:00" },
    3: { start: "09:00", end: "17:00" },
    4: { start: "09:00", end: "17:00" },
    5: { start: "09:00", end: "17:00" },
  });
  const [taxonomy, setTaxonomy] = useState<{ specializations: { id: number; name: string }[]; systems: string[] }>({
    specializations: [],
    systems: [],
  });
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState("");
  /** Set when the admin previously rejected us; drives the resubmit banner. */
  const [rejectReason, setRejectReason] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.doctorMe();
        if (!d) return;

        // Prefill from whatever is already saved, so a doctor coming back after a
        // rejection does not retype their whole profile just to swap one file.
        setForm((f) => ({
          ...f,
          specialty: d.specialty || d.system || f.specialty,
          specialization_id: d.specialization_id ? String(d.specialization_id) : f.specialization_id,
          qualification: d.qualification || "",
          registration_number: d.registration_number || "",
          experience_years: d.experience ? String(d.experience) : "",
          consultation_fee: d.consultation_fee ? String(d.consultation_fee) : "499",
          bio: d.bio || d.about || "",
          clinic_name: d.clinic_name || "",
          clinic_address: d.clinic_address || "",
          city: d.city || "",
          gender: (d.gender as "male" | "female" | null) || "",
          languages: d.languages
            ? String(d.languages).split(",").map((l) => l.trim()).filter(Boolean)
            : f.languages,
        }));

        // Skip the wizard only once a submission actually landed AND the admin
        // hasn't bounced it. `onboarded_at` alone is not enough: the old
        // registration path prefilled placeholder text, so a brand-new doctor
        // looked onboarded and never saw this screen. A rejected doctor is kept
        // here so they can fix the flagged reason and resubmit.
        const rejected = !!d.is_restricted || !!d.restriction_reason;
        if (d.onboarded_at && !rejected) router.replace("/(tabs)/home");
        if (rejected) setRejectReason(d.restriction_reason || "Your profile was returned for changes.");
      } catch {}
      try {
        const t = await api.listSpecializations();
        if (t?.specializations?.length) setTaxonomy(t as any);
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

  /** Opens the OS picker and appends the REAL files. */
  const pickDocuments = async () => {
    setErr("");
    setPicking(true);
    try {
      const res = await pickCredentialFiles();
      if (!res.ok) {
        if (res.reason === "error") setErr(res.message);
        return;
      }
      setDocuments((prev) => [...prev, ...res.files]);
    } finally {
      setPicking(false);
    }
  };

  const setDocType = (index: number, t: string) =>
    setDocuments((prev) => prev.map((d, i) => (i === index ? { ...d, documentType: t } : d)));

  const removeDoc = (index: number) => setDocuments((prev) => prev.filter((_, i) => i !== index));

  const toggleDay = (idx: number) =>
    setSlots((prev) => {
      const next = { ...prev };
      if (next[idx]) delete next[idx];
      else next[idx] = { start: "09:00", end: "17:00" };
      return next;
    });

  const setWindow = (idx: number, patch: Partial<{ start: string; end: string }>) =>
    setSlots((prev) => {
      const base = prev[idx] ?? { start: "09:00", end: "17:00" };
      return { ...prev, [idx]: { ...base, ...patch } };
    });

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  /** Day index -> the `{ "0": [{startTime,endTime}] }` shape the API expects. */
  const slotPayload = useMemo<WeeklySlotMap>(() => {
    const out: WeeklySlotMap = {};
    Object.entries(slots).forEach(([day, w]) => {
      if (!w) return;
      if (toMinutes(w.end) <= toMinutes(w.start)) return;
      out[String(day)] = [{ startTime: w.start, endTime: w.end }];
    });
    return out;
  }, [slots]);

  const activeDays = Object.keys(slotPayload).length;
  const invalidWindow = Object.values(slots).some(
    (w) => w && toMinutes(w.end) <= toMinutes(w.start)
  );

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.doctorOnboard({
        name: user?.name,
        specialty: form.specialty,
        specialization_id: form.specialization_id ? Number(form.specialization_id) : undefined,
        qualification: form.qualification,
        registration_number: form.registration_number,
        experience: parseInt(form.experience_years || "0", 10),
        consultation_fee: parseInt(form.consultation_fee || "499", 10),
        bio: form.bio,
        about: form.bio,
        clinic_name: form.clinic_name,
        clinic_address: form.clinic_address,
        city: form.city || undefined,
        gender: form.gender || undefined,
        languages: form.languages,
        avatar_base64: form.avatar_base64 || undefined,
        // Real files now, not placeholder filenames. The backend stores each as a
        // `doctor_verifications` row with status='pending' for an admin to review.
        documents,
        // Real `appointment_slots` rows, which is what booking reads.
        slots: slotPayload,
      });
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message || "Could not save");
    }
    setBusy(false);
  };

  const canNext = () => {
    if (step === 0) return !!form.specialty && !!form.qualification;
    if (step === 1) return !!form.registration_number && documents.length > 0;
    if (step === 2) return form.languages.length > 0 && !!form.experience_years;
    if (step === 4) return activeDays > 0 && !invalidWindow;
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
            <Text style={styles.eyebrow}>Vaidya onboarding · Step {step + 1} / {TOTAL_STEPS}</Text>
            <Text style={styles.title}>Welcome, {user?.name}</Text>
          </View>
        </View>

        <View style={styles.progress}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View key={i} style={[styles.dot, step >= i && styles.dotActive]} />
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {rejectReason && (
            <View style={styles.rejectBox} testID="do-reject-banner">
              <Feather name="alert-triangle" size={16} color={COLORS.error} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rejectTitle}>Admin asked for changes</Text>
                <Text style={styles.rejectBody}>{rejectReason}</Text>
                <Text style={styles.rejectHint}>
                  Fix the details below and upload fresh documents, then submit again.
                </Text>
              </View>
            </View>
          )}

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
              {taxonomy.specializations.length > 0 && (
                <>
                  <Text style={styles.label}>Specialization (public profile)</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {taxonomy.specializations.slice(0, 24).map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        onPress={() => setForm({ ...form, specialization_id: String(form.specialization_id) === String(s.id) ? "" : String(s.id) })}
                        style={[styles.chip, form.specialization_id === String(s.id) && styles.chipActive]}
                        testID={`do-specialization-${s.id}`}
                      >
                        <Text style={[styles.chipText, form.specialization_id === String(s.id) && styles.chipTextActive]}>{s.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <Text style={styles.label}>Qualification</Text>
              <TextInput style={styles.input} value={form.qualification} onChangeText={(v) => setForm({ ...form, qualification: v })} placeholder="e.g. BAMS, MD (Ayurveda)" placeholderTextColor={COLORS.textMuted} testID="do-qual" />
              <Text style={styles.label}>City</Text>
              <TextInput style={styles.input} value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} placeholder="e.g. Chandigarh" placeholderTextColor={COLORS.textMuted} testID="do-city" />
              <Text style={styles.label}>Gender</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["male", "female"] as const).map((g) => (
                  <TouchableOpacity key={g} onPress={() => setForm({ ...form, gender: form.gender === g ? "" : g })} style={[styles.chip, form.gender === g && styles.chipActive]} testID={`do-gender-${g}`}>
                    <Text style={[styles.chipText, form.gender === g && styles.chipTextActive]}>{g === "male" ? "Male" : "Female"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {step === 1 && (
            <View>
              <Text style={styles.sectionTitle}>Verification</Text>
              <Text style={styles.sectionSub}>Upload your AYUSH council registration and degree. An admin checks these before you go live.</Text>
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
                style={[styles.uploader, documents.length > 0 && styles.uploaderDone]}
                onPress={pickDocuments}
                disabled={picking}
                testID="do-upload"
              >
                <Feather name={documents.length > 0 ? "check-circle" : "upload"} size={24} color={documents.length > 0 ? COLORS.success : COLORS.brand} />
                <Text style={styles.uploaderTitle}>
                  {picking ? "Opening file picker…" : documents.length > 0 ? `${documents.length} file${documents.length > 1 ? "s" : ""} attached` : "Attach degree + reg certificate"}
                </Text>
                <Text style={styles.uploaderSub}>JPG / PNG / PDF / DOC · max 10 MB each</Text>
              </TouchableOpacity>

              {documents.length > 0 && (
                <View style={{ gap: 8, marginTop: SPACING.md }}>
                  {documents.map((d, i) => (
                    <View key={`${d.fileName}-${i}`} style={styles.docRow} testID={`do-doc-${i}`}>
                      <Feather name="file-text" size={18} color={COLORS.brand} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.docName} numberOfLines={1}>{d.fileName}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                          {CREDENTIAL_TYPES.map((t) => (
                            <TouchableOpacity
                              key={t.value}
                              onPress={() => setDocType(i, t.value)}
                              style={[styles.docTag, d.documentType === t.value && styles.docTagActive]}
                              testID={`do-doc-${i}-type-${t.value}`}
                            >
                              <Text style={[styles.docTagText, d.documentType === t.value && styles.docTagTextActive]}>{t.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                        <Text style={styles.docMeta}>
                          {labelForDocType(d.documentType)} · {(d.base64?.length ?? 0) > 0 ? `${Math.round((d.base64.length * 3) / 4 / 1024)} KB` : ""}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => removeDoc(i)} testID={`do-doc-${i}-remove`} hitSlop={8}>
                        <Feather name="trash-2" size={17} color={COLORS.error} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.info}>
                <Feather name="info" size={12} color={COLORS.brand} />
                <Text style={styles.infoText}>These files are sent to our admin team for review and kept private. You&apos;ll get a notification once your profile is approved.</Text>
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

          {step === 4 && (
            <View>
              <Text style={styles.sectionTitle}>Your availability</Text>
              <Text style={styles.sectionSub}>
                Pick the days and hours patients can book you. We&apos;ll split each range into
                30-minute slots, minus anything already booked.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: SPACING.md }}>
                {DAYS.map((d) => {
                  const on = !!slots[d.idx];
                  return (
                    <TouchableOpacity
                      key={d.idx}
                      onPress={() => toggleDay(d.idx)}
                      style={[styles.dayChip, on && styles.dayChipActive]}
                      testID={`do-day-${d.idx}`}
                    >
                      <Text style={[styles.dayChipText, on && styles.dayChipTextActive]}>{d.short}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {Object.keys(slots).length === 0 && (
                <View style={styles.info}>
                  <Feather name="alert-circle" size={12} color={COLORS.accent} />
                  <Text style={styles.infoText}>Select at least one day, otherwise patients won&apos;t be able to book you.</Text>
                </View>
              )}

              {Object.keys(slots)
                .sort((a, b) => Number(a) - Number(b))
                .map((key) => {
                  const idx = Number(key);
                  const w = slots[idx];
                  const day = DAYS.find((d) => d.idx === idx);
                  return (
                    <View key={key} style={styles.slotCard} testID={`do-slot-card-${idx}`}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={styles.slotDay}>{day?.name}</Text>
                        <TouchableOpacity onPress={() => toggleDay(idx)} hitSlop={8} testID={`do-slot-remove-${idx}`}>
                          <Feather name="x" size={16} color={COLORS.textMuted} />
                        </TouchableOpacity>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                          {TIME_OPTIONS.map((t) => (
                            <TouchableOpacity
                              key={`s-${t}`}
                              onPress={() => setWindow(idx, { start: t })}
                              style={[styles.timeChip, w.start === t && styles.timeChipActive]}
                              testID={`do-slot-${idx}-start-${t}`}
                            >
                              <Text style={[styles.timeChipText, w.start === t && styles.timeChipTextActive]}>{fmt12h(t)}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                      <Text style={styles.slotLabel}>to</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {TIME_OPTIONS.map((t) => (
                          <TouchableOpacity
                            key={`e-${t}`}
                            onPress={() => setWindow(idx, { end: t })}
                            style={[styles.timeChip, w.end === t && styles.timeChipActive]}
                            testID={`do-slot-${idx}-end-${t}`}
                          >
                            <Text style={[styles.timeChipText, w.end === t && styles.timeChipTextActive]}>{fmt12h(t)}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  );
                })}

              {invalidWindow && (
                <Text style={styles.err} testID="do-slot-invalid">
                  An end time is not after its start time. Fix the highlighted range.
                </Text>
              )}
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
            {step < TOTAL_STEPS - 1 ? (
              <TouchableOpacity style={[styles.nextBtn, !canNext() && { opacity: 0.5 }]} onPress={next} disabled={!canNext()} testID="do-next">
                <Text style={styles.nextText}>Continue</Text>
                <Feather name="arrow-right" size={16} color={COLORS.surface} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.nextBtn, (busy || !canNext()) && { opacity: 0.5 }]} onPress={submit} disabled={busy || !canNext()} testID="do-submit">
                <Text style={styles.nextText}>
                  {busy ? "Submitting…" : `Submit ${documents.length} doc${documents.length === 1 ? "" : "s"} · ${activeDays} day${activeDays === 1 ? "" : "s"}`}
                </Text>
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
  docRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 10 },
  docName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "700" },
  docMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  docTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceAlt },
  docTagActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  docTagText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: "600" },
  docTagTextActive: { color: COLORS.surface },
  dayChip: { width: 52, paddingVertical: 10, alignItems: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  dayChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  dayChipText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700" },
  dayChipTextActive: { color: COLORS.surface },
  slotCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginTop: SPACING.md },
  slotDay: { color: COLORS.textPrimary, fontSize: 15, fontWeight: "700" },
  slotLabel: { color: COLORS.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: 10, marginBottom: 4 },
  timeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceAlt },
  timeChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  timeChipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "600" },
  timeChipTextActive: { color: COLORS.surface },
  info: { flexDirection: "row", gap: 6, marginTop: SPACING.md, padding: 10, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, alignItems: "flex-start" },
  infoText: { color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 16 },
  err: { color: COLORS.error, marginTop: 12 },
  rejectBox: { flexDirection: "row", gap: 10, padding: SPACING.md, backgroundColor: "#FDECEA", borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.error, marginBottom: SPACING.md },
  rejectTitle: { color: COLORS.error, fontSize: 14, fontWeight: "700" },
  rejectBody: { color: COLORS.textPrimary, fontSize: 13, marginTop: 3, lineHeight: 18 },
  rejectHint: { color: COLORS.textSecondary, fontSize: 12, marginTop: 5, lineHeight: 16 },
  navRow: { flexDirection: "row", gap: 8, marginTop: SPACING.lg },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.pill },
  navBtnText: { color: COLORS.brand, fontWeight: "700" },
  nextBtn: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill },
  nextText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
});
