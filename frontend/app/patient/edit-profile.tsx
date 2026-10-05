import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Image, Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";

const GENDERS = ["Male", "Female", "Other"];

/**
 * Edits the fields the website also owns. Saving writes name/phone/email/photo
 * back into the shared `users` row and address into `patient_profiles`, so the
 * app and the website stop drifting apart.
 */
export default function EditPatientProfile() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [newPhoto, setNewPhoto] = useState<string | undefined>(undefined);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.getPatientProfile();
        setName(p.name || "");
        setPhone(p.phone || "");
        setEmail(p.email || "");
        setAddress(p.address || "");
        setAge(p.age != null ? String(p.age) : "");
        setGender(p.gender || "");
        setPhoto(p.photo_url || null);
      } catch {
        setName(user?.name || "");
        setPhone(user?.phone || "");
        setEmail(user?.email || "");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pickPhoto = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not supported", "Please change your photo from the website on a browser.");
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to change your profile picture.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const asset = res.assets[0];
    const dataUri = asset.uri?.startsWith("data:")
      ? asset.uri
      : `data:image/jpeg;base64,${asset.base64}`;
    setNewPhoto(dataUri);
    setRemovePhoto(false);
    setPhoto(dataUri);
  };

  const save = async () => {
    if (!name.trim()) {
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
    setBusy(true);
    try {
      // account fields (name/phone/email/photo) -> shared `users` row
      await api.updatePatientAccount({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        image_base64: newPhoto,
        remove_photo: removePhoto,
      });
      // age/gender live in patient_profiles
      await api.savePatientProfile({
        age: age ? parseInt(age, 10) : null,
        gender,
        address: address.trim(),
      });
      Alert.alert("Saved", "Your profile has been updated.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      const msg = e?.message || "Could not save. Please try again.";
      Alert.alert("Couldn't save", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="epp-back">
          <Feather name="arrow-left" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Edit profile</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.photoWrap}>
          <View style={styles.photo}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.photoImg} testID="epp-photo" />
            ) : (
              <Text style={styles.photoInitials}>
                {(name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")) || "?"}
              </Text>
            )}
          </View>
          <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} testID="epp-pick">
            <Feather name="camera" size={14} color={COLORS.surface} />
            <Text style={styles.photoBtnText}>
              {newPhoto ? "Change photo" : photo ? "Change photo" : "Add photo"}
            </Text>
          </TouchableOpacity>
          {photo && !newPhoto && !removePhoto ? (
            <TouchableOpacity
              onPress={() => { setRemovePhoto(true); setNewPhoto(undefined); setPhoto(null); }}
              style={styles.removeBtn}
              testID="epp-remove"
            >
              <Text style={styles.removeText}>Remove photo</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.note}>
          Saved to your account and shared with the website, so you only maintain one profile.
        </Text>

        <Text style={styles.label}>Full name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={COLORS.textMuted} testID="epp-name" />

        <Text style={styles.label}>Mobile number</Text>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" placeholderTextColor={COLORS.textMuted} testID="epp-phone" />

        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" placeholderTextColor={COLORS.textMuted} testID="epp-email" />

        <Text style={styles.label}>Address</Text>
        <TextInput style={[styles.input, styles.multiline]} value={address} onChangeText={setAddress} placeholder="House, street, city, pincode" placeholderTextColor={COLORS.textMuted} multiline numberOfLines={3} testID="epp-address" />

        <Text style={styles.label}>Age</Text>
        <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="numeric" placeholder="28" placeholderTextColor={COLORS.textMuted} testID="epp-age" />

        <Text style={styles.label}>Gender</Text>
        <View style={styles.row}>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.chip, gender === g && styles.chipActive]}
              onPress={() => setGender(g)}
              testID={`epp-gender-${g.toLowerCase()}`}
            >
              <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.cta, (busy || loading) && { opacity: 0.6 }]}
          onPress={save}
          disabled={busy || loading}
          testID="epp-save"
        >
          <Text style={styles.ctaText}>{busy ? "Saving…" : "Save changes"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  topTitle: { fontFamily: FONTS.heading, fontSize: 19, color: COLORS.textPrimary },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  photoWrap: { alignItems: "center", marginTop: SPACING.md },
  photo: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImg: { width: "100%", height: "100%" },
  photoInitials: { color: COLORS.surface, fontSize: 34, fontWeight: "700" },
  photoBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: COLORS.brand, borderRadius: RADIUS.pill },
  photoBtnText: { color: COLORS.surface, fontSize: 13, fontWeight: "700" },
  removeBtn: { marginTop: 10 },
  removeText: { color: COLORS.error, fontSize: 13, fontWeight: "600" },
  note: { color: COLORS.textSecondary, fontSize: 12, textAlign: "center", marginTop: 12, paddingHorizontal: SPACING.md, lineHeight: 17 },
  label: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.lg, marginBottom: 8, fontWeight: "700" },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  multiline: { minHeight: 84, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  cta: { marginTop: SPACING.xl, alignItems: "center", backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
});
