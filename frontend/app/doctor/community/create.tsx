// Create Post — multi-image picker + caption + hashtags + specialty + clinical flag.
import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const SPECIALTIES = ["Ayurveda", "Homoeopathy", "Yoga", "Naturopathy", "Unani", "Siddha", "General"];

export default function CreatePost() {
  const router = useRouter();
  const [images, setImages] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [specialty, setSpecialty] = useState<string>("");
  const [clinical, setClinical] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pickImages() {
    const slotsLeft = 5 - images.length;
    if (slotsLeft <= 0) {
      Alert.alert("Limit reached", "You can attach up to 5 images per post.");
      return;
    }
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted" && perm.canAskAgain) {
      const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
      status = r.status;
    }
    if (status !== "granted") {
      Alert.alert(
        "Photos access needed",
        "We need access to your photos to attach images to your post.",
      );
      return;
    }
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        allowsMultipleSelection: true,
        selectionLimit: slotsLeft,
        quality: 0.7,
      });
      if (res.canceled) return;
      const b64s = (res.assets || [])
        .filter((a) => !!a.base64)
        .map((a) => `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
      const next = [...images, ...b64s].slice(0, 5);
      // Reject any single image over 4 MB (approx: 4.5 MB base64 string)
      for (const b of b64s) {
        if (b.length > 4_500_000) {
          Alert.alert("Image too large", "Each image must be under 4 MB. Please crop or compress.");
          return;
        }
      }
      setImages(next);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not attach image");
    }
  }

  function removeImage(i: number) {
    setImages((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function publish() {
    if (!images.length && !caption.trim()) {
      Alert.alert("Nothing to post", "Add an image or write a caption.");
      return;
    }
    const tags = hashtags
      .split(/[,\s]+/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 15);
    setBusy(true);
    try {
      await api.docComCreatePost({
        images, caption: caption.trim(),
        hashtags: tags,
        specialty_tag: specialty || undefined,
        clinical_flag: clinical,
      });
      Alert.alert("Posted!", "Your post is live in the community feed.", [
        { text: "OK", onPress: () => router.replace("/doctor/community") },
      ]);
    } catch (e: any) {
      Alert.alert("Could not publish", e?.message || "Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} testID="cp-back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>New post</Text>
          <TouchableOpacity
            style={[styles.publishBtn, (busy || (!images.length && !caption.trim())) && { opacity: 0.5 }]}
            onPress={publish}
            disabled={busy || (!images.length && !caption.trim())}
            testID="cp-publish"
          >
            {busy ? <ActivityIndicator color={COLORS.surface} size="small" /> : <Text style={styles.publishText}>Share</Text>}
          </TouchableOpacity>
        </View>

        {/* Image picker */}
        <View style={styles.imagesRow}>
          {images.map((src, i) => (
            <View key={i} style={styles.imgTile}>
              <Image source={{ uri: src }} style={styles.imgThumb} />
              <TouchableOpacity onPress={() => removeImage(i)} style={styles.removeBtn} testID={`cp-remove-${i}`}>
                <Feather name="x" size={12} color={COLORS.surface} />
              </TouchableOpacity>
            </View>
          ))}
          {images.length < 5 && (
            <TouchableOpacity style={styles.addTile} onPress={pickImages} testID="cp-add-images">
              <Feather name="image" size={22} color={COLORS.brand} />
              <Text style={styles.addText}>Add photos</Text>
              <Text style={styles.addSub}>{images.length}/5</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Caption */}
        <Text style={styles.label}>Caption</Text>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          multiline
          placeholder="Share a case, insight or observation with the community…"
          placeholderTextColor={COLORS.textMuted}
          style={styles.caption}
          maxLength={2200}
          testID="cp-caption"
        />
        <Text style={styles.count}>{caption.length}/2200</Text>

        {/* Hashtags */}
        <Text style={styles.label}>Hashtags</Text>
        <TextInput
          value={hashtags}
          onChangeText={setHashtags}
          placeholder="Ayurveda WomensHealth CaseStudy"
          placeholderTextColor={COLORS.textMuted}
          style={styles.tagInput}
          autoCapitalize="none"
          maxLength={200}
          testID="cp-hashtags"
        />
        <Text style={styles.hint}>Separate by space or comma. No # needed.</Text>

        {/* Specialty */}
        <Text style={styles.label}>Specialty tag</Text>
        <View style={styles.specRow}>
          {SPECIALTIES.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.specChip, specialty === s && styles.specChipActive]}
              onPress={() => setSpecialty(specialty === s ? "" : s)}
              testID={`cp-spec-${s}`}
            >
              <Text style={[styles.specText, specialty === s && { color: COLORS.surface }]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Clinical flag */}
        <View style={styles.clinRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.clinTitle}>Clinical / case study</Text>
            <Text style={styles.clinBody}>
              I confirm the patient&apos;s identity is fully hidden. No name, face, ID or unique detail is shared.
            </Text>
          </View>
          <Switch value={clinical} onValueChange={setClinical} trackColor={{ true: COLORS.brand, false: COLORS.border }} thumbColor={COLORS.surface} testID="cp-clinical" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: SPACING.lg,
  },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  publishBtn: {
    backgroundColor: COLORS.brand, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  publishText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  imagesRow: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  imgTile: {
    width: 96, height: 96, borderRadius: RADIUS.md, overflow: "hidden", position: "relative",
    backgroundColor: COLORS.surfaceAlt,
  },
  imgThumb: { width: "100%", height: "100%" },
  removeBtn: {
    position: "absolute", top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
  },
  addTile: {
    width: 96, height: 96, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderStyle: "dashed", alignItems: "center", justifyContent: "center",
  },
  addText: { color: COLORS.brand, fontSize: 11, fontWeight: "700", marginTop: 4 },
  addSub: { color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  label: {
    marginTop: SPACING.lg, marginBottom: SPACING.sm,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  caption: {
    minHeight: 100,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, padding: SPACING.md,
    color: COLORS.textPrimary, textAlignVertical: "top", fontSize: 14,
  },
  count: { color: COLORS.textMuted, fontSize: 11, textAlign: "right", marginTop: 4 },
  tagInput: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, padding: SPACING.md,
    color: COLORS.textPrimary, fontSize: 14,
  },
  hint: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  specRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  specChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  specChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  specText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 12 },
  clinRow: {
    marginTop: SPACING.lg, flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  clinTitle: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 13 },
  clinBody: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2, lineHeight: 15 },
});
