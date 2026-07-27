// Story creator — pick an image, add optional caption, publish. Auto-expires in 24h.
import { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Image, Alert,
  ActivityIndicator, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function CreateStory() {
  const router = useRouter();
  const [media, setMedia] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  async function pickMedia() {
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      let status = perm.status;
      if (status !== "granted" && perm.canAskAgain) {
        const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
        status = r.status;
      }
      if (status !== "granted") {
        Alert.alert("Photos access needed", "We need access to your photos to add a story.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true, quality: 0.7, allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      const dataUri = `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
      if (dataUri.length > 4_500_000) {
        Alert.alert("Image too large", "Please pick a smaller photo (< 4 MB).");
        return;
      }
      setMedia(dataUri);
    } catch (e: any) {
      Alert.alert("Could not pick", e?.message || "Try again");
    }
  }

  async function publish() {
    if (!media) {
      Alert.alert("Add a photo", "Please pick an image for your story.");
      return;
    }
    setBusy(true);
    try {
      await api.docComCreateStory({ media_url: media, media_type: "image", caption: caption.trim() });
      Alert.alert("Story posted!", "Your story will be visible for 24 hours.", [
        { text: "OK", onPress: () => router.replace("/doctor/community") },
      ]);
    } catch (e: any) {
      Alert.alert("Could not post", e?.message || "Try again");
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="story-back">
          <Feather name="x" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>New story</Text>
        <TouchableOpacity
          onPress={publish}
          disabled={busy || !media}
          style={[styles.publishBtn, (busy || !media) && { opacity: 0.5 }]}
          testID="story-publish"
        >
          {busy ? <ActivityIndicator size="small" color={COLORS.surface} /> : <Text style={styles.publishText}>Share</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
        <TouchableOpacity style={styles.canvas} onPress={pickMedia} testID="story-canvas">
          {media ? (
            <Image source={{ uri: media }} style={styles.canvasImg} />
          ) : (
            <View style={styles.canvasEmpty}>
              <View style={styles.canvasIcon}>
                <Feather name="camera" size={30} color={COLORS.surface} />
              </View>
              <Text style={styles.canvasHint}>Tap to pick a photo</Text>
              <Text style={styles.canvasSub}>Auto-expires in 24 hours</Text>
            </View>
          )}
        </TouchableOpacity>

        {media ? (
          <TouchableOpacity onPress={pickMedia} style={styles.replaceBtn}>
            <Feather name="refresh-cw" size={13} color={COLORS.brand} />
            <Text style={styles.replaceText}>Change photo</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.label}>Add a caption (optional)</Text>
        <TextInput
          style={styles.input}
          value={caption}
          onChangeText={setCaption}
          placeholder="What's happening at your clinic today?"
          placeholderTextColor={COLORS.textMuted}
          maxLength={280}
          multiline
          testID="story-caption"
        />
        <Text style={styles.hint}>{caption.length}/280</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  publishBtn: {
    backgroundColor: COLORS.brand, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  publishText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  canvas: {
    aspectRatio: 9 / 16,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: "hidden",
  },
  canvasImg: { width: "100%", height: "100%" },
  canvasEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  canvasIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  canvasHint: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "700" },
  canvasSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  replaceBtn: {
    marginTop: SPACING.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand,
  },
  replaceText: { color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  label: {
    marginTop: SPACING.lg, marginBottom: SPACING.sm,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  input: {
    minHeight: 80,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, padding: SPACING.md,
    color: COLORS.textPrimary, fontSize: 14, textAlignVertical: "top",
  },
  hint: { color: COLORS.textMuted, fontSize: 11, textAlign: "right", marginTop: 4 },
});
