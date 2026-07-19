// Real video consultation powered by Daily.co (WebView + Daily Prebuilt).
// Works in Expo Go without a native build.
import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export default function VideoCall() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    doctor_name?: string;
    doctor_specialty?: string;
    appt_id?: string;
    doctor_id?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [ended, setEnded] = useState(false);
  const webviewRef = useRef<WebView>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const payload: any = {};
        if (params.appt_id) payload.appointment_id = String(params.appt_id);
        if (params.doctor_id) payload.doctor_id = String(params.doctor_id);
        if (!payload.appointment_id && !payload.doctor_id) {
          throw new Error("Missing appointment or doctor id");
        }
        const res = await api.createVideoSession(payload);
        if (!alive) return;
        // Prepend backend base URL to embed_url (starts with /api/...)
        setEmbedUrl(`${BASE}${res.embed_url}`);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to start consultation");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.appt_id, params.doctor_id]);

  // Call duration timer starts when the WebView reports "joined"
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    if (!joined || ended) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [joined, ended]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const handleMessage = (evt: any) => {
    try {
      const msg = JSON.parse(evt.nativeEvent.data);
      if (msg?.type === "left") handleEnd();
      if (msg?.type === "joined") setJoined(true);
    } catch {}
  };

  const handleEnd = () => {
    if (ended) return;
    setEnded(true);
    setTimeout(() => router.replace(params.appt_id ? "/appointments" : "/(tabs)/home"), 300);
  };

  const confirmEnd = () => {
    Alert.alert(
      "End consultation?",
      "Are you sure you want to leave the video call?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "End Call", style: "destructive", onPress: handleEnd },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* Top bar */}
        <View style={styles.top}>
          <View style={{ flex: 1 }}>
            <Text style={styles.docName} numberOfLines={1}>
              {params.doctor_name || "AYUSH Vaidya"}
            </Text>
            <Text style={styles.docMeta} numberOfLines={1}>
              {params.doctor_specialty || "Consultation"} · Secure video
            </Text>
          </View>
          {joined && (
            <View style={styles.timer}>
              <View style={styles.liveDot} />
              <Text style={styles.timerText}>
                {mm}:{ss}
              </Text>
            </View>
          )}
        </View>

        {/* Video area */}
        <View style={styles.videoWrap}>
          {loading && (
            <View style={styles.state}>
              <ActivityIndicator color={COLORS.accent} size="large" />
              <Text style={styles.stateText}>Connecting to your Vaidya…</Text>
            </View>
          )}
          {!loading && error && (
            <View style={styles.state}>
              <Feather name="alert-circle" size={40} color={COLORS.error} />
              <Text style={styles.stateText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
                <Text style={styles.retryText}>Go back</Text>
              </TouchableOpacity>
            </View>
          )}
          {!loading && !error && embedUrl && (
            <WebView
              ref={webviewRef}
              source={{ uri: embedUrl }}
              style={{ flex: 1, backgroundColor: "#0F4C36" }}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={["*"]}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              onMessage={handleMessage}
              onLoad={() => setJoined(true)}
              onError={(e) => setError("Video failed to load")}
              // Grant camera/mic on Android
              onPermissionRequest={(event: any) => {
                event?.grant?.(event.resources);
              }}
              mixedContentMode="always"
            />
          )}
        </View>

        {/* Bottom end-call bar */}
        {!loading && !error && (
          <View style={styles.bottomBar}>
            <Text style={styles.bottomHint}>Use in-video controls for mic/camera</Text>
            <TouchableOpacity style={styles.endBtn} onPress={confirmEnd} testID="call-end">
              <Feather name="phone-off" size={20} color={COLORS.surface} />
              <Text style={styles.endText}>End</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.brand },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.brandDark,
  },
  docName: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.surface },
  docMeta: { color: COLORS.accentSoft, marginTop: 2, fontSize: 11, letterSpacing: 1 },
  timer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.error },
  timerText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  videoWrap: { flex: 1, backgroundColor: COLORS.brand },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.md },
  stateText: { color: COLORS.surface, textAlign: "center", paddingHorizontal: SPACING.lg, fontSize: 14 },
  retryBtn: {
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
  },
  retryText: { color: COLORS.surface, fontWeight: "700" },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.brandDark,
  },
  bottomHint: { color: COLORS.accentSoft, fontSize: 11, flex: 1, marginRight: SPACING.md },
  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.error,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
  },
  endText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
});
