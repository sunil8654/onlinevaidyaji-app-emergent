import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api, type PatientProfile } from "@/src/api";
import { ListState, type IconName } from "@/src/components/ComingSoon";
import Feather from "@react-native-vector-icons/feather";

const GENDERS = ["Male", "Female", "Other"];

/**
 * Personal details — a single honest view of everything the app actually stores
 * about the patient, with the parts that are really editable editable in place.
 *
 * Scope note: `patient_profiles` has `age`, `gender`, `address`, `dosha`,
 * `conditions`, `lifestyle` and nothing else. There is no DOB, city, state,
 * blood group or Aadhaar column, so this screen does not offer those fields —
 * adding them would mean typing values the save call silently throws away.
 * `dosha`/`conditions` are quiz-derived, so they are shown and pointed at the
 * Prakriti quiz rather than hand-edited.
 */
export default function PersonalDetails() {
  const router = useRouter();

  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Editable fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [address, setAddress] = useState("");

  const hydrate = useCallback((p: PatientProfile) => {
    setProfile(p);
    setName(p.name || "");
    setPhone(p.phone || "");
    setEmail(p.email || "");
    setAge(p.age != null ? String(p.age) : "");
    setGender(p.gender || "");
    setAddress(p.address || "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      hydrate(await api.getPatientProfile());
    } catch (e: any) {
      setError(e?.message || "Could not load your details.");
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Please enter your name.");
      return;
    }
    if (phone.trim() && !/^[+0-9][0-9\s\-]{5,19}$/.test(phone.trim())) {
      Alert.alert("Invalid mobile", "Enter a valid mobile number.");
      return;
    }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      Alert.alert("Invalid email", "Enter a valid email address.");
      return;
    }
    const parsedAge = age.trim() ? parseInt(age.trim(), 10) : null;
    if (parsedAge !== null && (Number.isNaN(parsedAge) || parsedAge < 0 || parsedAge > 120)) {
      Alert.alert("Invalid age", "Enter an age between 0 and 120.");
      return;
    }

    setBusy(true);
    try {
      // Two real endpoints, because the data genuinely lives in two tables:
      // identity in `users` (shared with the website), health in `patient_profiles`.
      const account = await api.updatePatientAccount({
        name: trimmedName,
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
      });
      await api.savePatientProfile({
        age: parsedAge,
        gender,
        address: address.trim(),
      });
      // Re-read so the screen reflects what the database actually stored.
      hydrate(await api.getPatientProfile().catch(() => ({ ...account, age: parsedAge, gender, address: address.trim() } as PatientProfile)));
      setEditing(false);
      Alert.alert("Saved", "Your personal details have been updated.");
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const photo = profile?.photo_url || profile?.image || null;
  const initials = (profile?.name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
  const conditions = Array.isArray(profile?.conditions) ? profile!.conditions! : [];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          testID="pd-back"
        >
          <Feather name="arrow-left" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Personal details</Text>
        {editing ? (
          <TouchableOpacity onPress={save} disabled={busy} style={styles.topAction} testID="pd-save">
            {busy ? (
              <ActivityIndicator size="small" color={COLORS.brand} />
            ) : (
              <Text style={styles.topActionText}>Save</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 46 }} />
        )}
      </View>

      {loading ? (
        <View style={{ paddingVertical: SPACING.xl }}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      ) : error ? (
        <ListState
          icon="wifi-off"
          tone="error"
          title="Could not load your details"
          body={error}
          actionLabel="Try again"
          onAction={load}
          testID="pd-error"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.idCard}>
            <View style={styles.avatar}>
              {photo ? (
                <Image source={{ uri: photo }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitials}>{initials}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.idName} testID="pdp-name">
                {profile?.name || "—"}
              </Text>
              <Text style={styles.idMeta}>
                {profile?.is_verified ? "Verified" : "Not verified"} · Patient
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/patient/edit-profile")}
                style={styles.photoLink}
                testID="pd-change-photo"
              >
                <Feather name="camera" size={12} color={COLORS.brand} />
                <Text style={styles.photoLinkText}>Change photo</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Section
            kicker="Contact"
            action={
              editing ? undefined : (
                <TouchableOpacity onPress={() => setEditing(true)} testID="pd-edit">
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              )
            }
          >
            {editing ? (
              <>
                <Field label="Full name" value={name} onChange={setName} testID="pd-input-name" />
                <Field
                  label="Mobile number"
                  value={phone}
                  onChange={setPhone}
                  keyboardType="phone-pad"
                  testID="pd-input-phone"
                />
                <Field
                  label="Email"
                  value={email}
                  onChange={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="pd-input-email"
                />
              </>
            ) : (
              <>
                <Row icon="phone" label="Mobile" value={profile?.phone} testID="pdv-phone" />
                <Row icon="mail" label="Email" value={profile?.email} testID="pdv-email" />
              </>
            )}
          </Section>

          <Section kicker="Health profile">
            {editing ? (
              <>
                <Field
                  label="Age"
                  value={age}
                  onChange={setAge}
                  keyboardType="numeric"
                  placeholder="28"
                  testID="pd-input-age"
                />
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.chipRow}>
                  {GENDERS.map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[styles.chip, gender === g && styles.chipActive]}
                      onPress={() => setGender(g)}
                      testID={`pd-gender-${g.toLowerCase()}`}
                    >
                      <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>
                        {g}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Field
                  label="Address"
                  value={address}
                  onChange={setAddress}
                  multiline
                  placeholder="House, street, city, pincode"
                  testID="pd-input-address"
                />
              </>
            ) : (
              <>
                <Row
                  icon="calendar"
                  label="Age"
                  value={profile?.age != null ? `${profile.age} yrs` : null}
                  testID="pdv-age"
                />
                <Row icon="user" label="Gender" value={profile?.gender} testID="pdv-gender" />
                <Row
                  icon="map-pin"
                  label="Address"
                  value={profile?.address}
                  last
                  testID="pdv-address"
                />
              </>
            )}
          </Section>

          <Section kicker="Ayurvedic profile">
            <Row icon="wind" label="Dosha" value={profile?.dosha} testID="pdv-dosha" />
            <View style={styles.detailRow} testID="pdv-conditions">
              <View style={styles.detailIcon}>
                <Feather name="heart" size={14} color={COLORS.brand} />
              </View>
              <Text style={styles.detailLabel}>Conditions</Text>
              <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                {conditions.length ? (
                  conditions.map((c) => (
                    <View key={c} style={styles.tag}>
                      <Text style={styles.tagText}>{c}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.detailEmpty}>Not set</Text>
                )}
              </View>
            </View>
            <Row icon="activity" label="Lifestyle" value={profile?.lifestyle} last testID="pdv-lifestyle" />
          </Section>

          <TouchableOpacity
            style={styles.quizBtn}
            onPress={() => router.push("/prakriti-quiz")}
            testID="pd-prakriti"
          >
            <Feather name="feather" size={15} color={COLORS.surface} />
            <Text style={styles.quizText}>
              {profile?.dosha ? "Retake Prakriti quiz" : "Discover my Prakriti"}
            </Text>
          </TouchableOpacity>
          <Text style={styles.footnote}>
            Dosha, conditions and lifestyle come from the Prakriti quiz, so they are
            updated by retaking it rather than typed in by hand.
          </Text>

          {editing ? (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                if (profile) hydrate(profile);
                setEditing(false);
              }}
              testID="pd-cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Section({
  kicker,
  action,
  children,
}: {
  kicker: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardKicker}>{kicker}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  last,
  testID,
}: {
  icon: IconName;
  label: string;
  value?: string | null;
  last?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]} testID={testID}>
      <View style={styles.detailIcon}>
        <Feather name={icon} size={14} color={COLORS.brand} />
      </View>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, !value && styles.detailEmpty]} numberOfLines={2}>
        {value || "Not set"}
      </Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  keyboardType,
  autoCapitalize,
  placeholder,
  testID,
}: any) {
  return (
    <View style={{ marginTop: SPACING.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multiline]}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: { fontFamily: FONTS.heading, fontSize: 19, color: COLORS.textPrimary },
  topAction: { minWidth: 46, alignItems: "flex-end" },
  topActionText: { color: COLORS.brand, fontWeight: "700", fontSize: 15 },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  idCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.brand,
    borderRadius: RADIUS.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitials: { color: COLORS.surface, fontSize: 24, fontWeight: "700" },
  idName: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.surface },
  idMeta: { color: COLORS.accentSoft, fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  photoLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  photoLinkText: { color: COLORS.surface, fontSize: 12, fontWeight: "700" },
  card: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardKicker: {
    textTransform: "uppercase",
    letterSpacing: 2,
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: "700",
  },
  editLink: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  detailLabel: {
    width: 76,
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailValue: { flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" },
  detailEmpty: { color: COLORS.textMuted, fontWeight: "400", fontStyle: "italic" },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagText: { color: COLORS.textPrimary, fontSize: 11, fontWeight: "600" },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
    fontWeight: "700",
  },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  quizBtn: {
    marginTop: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.accent,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
  },
  quizText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  footnote: {
    color: COLORS.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  cancelBtn: {
    marginTop: SPACING.md,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelText: { color: COLORS.textPrimary, fontWeight: "700" },
});
