import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ImageBackground } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";

// Fully mocked video-call screen — no WebRTC dependency.
export default function VideoCall() {
  const router = useRouter();
  const { doctor_name, doctor_specialty, appt_id } = useLocalSearchParams<{ doctor_name?: string; doctor_specialty?: string; appt_id?: string }>();
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (ended) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [ended]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const end = () => {
    setEnded(true);
    setTimeout(() => router.replace(appt_id ? { pathname: "/appointments" } : "/(tabs)/home"), 400);
  };

  return (
    <View style={styles.root}>
      <ImageBackground
        source={{ uri: "https://images.pexels.com/photos/5738735/pexels-photo-5738735.jpeg" }}
        style={StyleSheet.absoluteFillObject as any}
        blurRadius={camOff ? 30 : 0}
      >
        <View style={styles.overlay} />
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          {/* Top bar */}
          <View style={styles.top}>
            <View>
              <Text style={styles.docName}>{doctor_name || "Dr. Meera Sharma"}</Text>
              <Text style={styles.docMeta}>{doctor_specialty || "Ayurveda"} · Consultation</Text>
            </View>
            <View style={styles.timer}>
              <View style={styles.liveDot} />
              <Text style={styles.timerText}>{mm}:{ss}</Text>
            </View>
          </View>

          {/* Self-preview */}
          <View style={styles.selfWrap}>
            <View style={styles.self}>
              {camOff ? (
                <View style={styles.selfOff}>
                  <Feather name="camera-off" size={20} color={COLORS.surface} />
                  <Text style={styles.selfLabel}>Camera off</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg" }}
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </View>
          </View>

          {/* Bottom controls */}
          <View style={styles.controls}>
            <TouchableOpacity style={[styles.ctrlBtn, muted && styles.ctrlActive]} onPress={() => setMuted((m) => !m)} testID="call-mute">
              <Feather name={muted ? "mic-off" : "mic"} size={22} color={COLORS.surface} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ctrlBtn, camOff && styles.ctrlActive]} onPress={() => setCamOff((c) => !c)} testID="call-camera">
              <Feather name={camOff ? "video-off" : "video"} size={22} color={COLORS.surface} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlBtn} testID="call-chat">
              <Feather name="message-square" size={22} color={COLORS.surface} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.endBtn} onPress={end} testID="call-end">
              <Feather name="phone-off" size={22} color={COLORS.surface} />
            </TouchableOpacity>
          </View>

          <Text style={styles.demo}>Demo call — real video powered by your future Agora/Twilio SDK.</Text>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,76,54,0.4)" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: SPACING.lg },
  docName: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.surface },
  docMeta: { color: COLORS.accentSoft, marginTop: 2, fontSize: 12, letterSpacing: 1 },
  timer: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.error },
  timerText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  selfWrap: { flex: 1, justifyContent: "flex-end", alignItems: "flex-end", padding: SPACING.lg },
  self: {
    width: 120, height: 160,
    borderRadius: RADIUS.lg, overflow: "hidden",
    borderWidth: 2, borderColor: COLORS.surface,
    backgroundColor: COLORS.brand,
  },
  selfOff: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: COLORS.brandDark },
  selfLabel: { color: COLORS.surface, fontSize: 10 },
  controls: { flexDirection: "row", justifyContent: "center", gap: 14, paddingHorizontal: SPACING.lg, marginBottom: 8 },
  ctrlBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  ctrlActive: { backgroundColor: COLORS.accent },
  endBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.error, alignItems: "center", justifyContent: "center" },
  demo: { color: "#F7F5F0", textAlign: "center", fontSize: 11, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, opacity: 0.9 },
});
