// Reel creator — pick a short video, add caption + hashtags, publish.
import { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, ScrollView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const MAX_BYTES = 12_000_000;

export default function CreateReel() {
  const router = useRouter();
  const [video, setVideo] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [duration, setDuration] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const player = useVideoPlayer(video || "", (p) => { p.loop = true; p.muted = true; if (video) p.play(); });

  async function pickVideo() {
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      let status = perm.status;
      if (status !== "granted" && perm.canAskAgain) {
        const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
        status = r.status;
      }
      if (status !== "granted") {
        Alert.alert("Photos access needed", "We need access to your media library to attach a video.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        base64: true,
        quality: 0.7,
        videoMaxDuration: 60,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      const mime = asset.mimeType || (Platform.OS === "ios" ? "video/quicktime" : "video/mp4");
      const dataUri = `data:${mime};base64,${asset.base64}`;
      if (dataUri.length > MAX_BYTES) {
        Alert.alert(
          "Video too large",
          `Please pick a shorter clip. Max ~12 MB (about 15–20 s at 720p). Your clip is ${(dataUri.length / 1_000_000).toFixed(1)} MB.`,
        );
        return;
      }
      setDuration(Math.round((asset.duration || 0) / 1000));
      setVideo(dataUri);
      try { (player as any).replace?.(dataUri); } catch {}
    } catch (e: any) {
      Alert.alert("Could not pick", e?.message || "Try again");
    }
  }

  async function publish() {
    if (!video) {
      Alert.alert("Add a video", "Please pick a short video first.");
      return;
    }
    setBusy(true);
    try {
      const tags = hashtags.split(/[,\s]+/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean).slice(0, 15);
      await api.docComCreateReel({ video_url: video, caption: caption.trim(), hashtags: tags, duration_sec: duration });
      Alert.alert("Reel posted!", "Your video is live in the Reels feed.", [
        { text: "OK", onPress: () => router.replace("/doctor/community/reels") },
      ]);
    } catch (e: any) {
      Alert.alert("Could not publish", e?.message || "Try again");
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="reel-back">
          <Feather name="x" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>New reel</Text>
        <TouchableOpacity
          onPress={publish}
          disabled={busy || !video}
          style={[styles.publishBtn, (busy || !video) && { opacity: 0.5 }]}
          testID="reel-publish"
        >
          {busy ? <ActivityIndicator size="small" color={COLORS.surface} /> : <Text style={styles.publishText}>Share</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
        <TouchableOpacity style={styles.canvas} onPress={pickVideo} testID="reel-canvas">
          {video ? (
            <VideoView player={player} style={{ flex: 1 }} contentFit="cover" nativeControls={false} />
          ) : (
            <View style={styles.canvasEmpty}>
              <View style={styles.canvasIcon}>
                <Feather name="film" size={28} color={COLORS.surface} />
              </View>
              <Text style={styles.canvasHint}>Tap to pick a video</Text>
              <Text style={styles.canvasSub}>Under 60 s · Max 12 MB</Text>
            </View>
          )}
        </TouchableOpacity>

        {video ? (
          <TouchableOpacity onPress={pickVideo} style={styles.replaceBtn}>
            <Feather name="refresh-cw" size={13} color={COLORS.brand} />
            <Text style={styles.replaceText}>Change video</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.label}>Caption</Text>
        <TextInput
          style={[styles.input, { minHeight: 80 }]}
          value={caption}
          onChangeText={setCaption}
          placeholder="Share the story behind this clip…"
          placeholderTextColor={COLORS.textMuted}
          maxLength={2200}
          multiline
          testID="reel-caption"
        />

        <Text style={styles.label}>Hashtags</Text>
        <TextInput
          style={styles.input}
          value={hashtags}
          onChangeText={setHashtags}
          placeholder="Ayurveda YogaTherapy CaseStudy"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          maxLength={200}
          testID="reel-hashtags"
        />
        <Text style={styles.hint}>Separate by space or comma. No # needed.</Text>
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
    backgroundColor: "#111", borderRadius: RADIUS.lg, overflow: "hidden",
  },
  canvasEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  canvasIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  canvasHint: { color: COLORS.surface, fontSize: 14, fontWeight: "700" },
  canvasSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4 },
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
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, padding: SPACING.md,
    color: COLORS.textPrimary, fontSize: 14, textAlignVertical: "top",
  },
  hint: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
});
