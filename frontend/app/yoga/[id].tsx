// Yoga session detail — embedded YouTube video + guided pose timer.
// Web: iframe embed. Native (Expo Go/dev builds): react-native-webview.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Dimensions,
  ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";
import { WebView } from "react-native-webview";

const { width } = Dimensions.get("window");

type PoseT = { name: string; duration_sec: number; cue: string };
type SessionT = Awaited<ReturnType<typeof api.yogaSession>>;

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function YogaSessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionT | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Timer state
  const [running, setRunning] = useState(false);
  const [poseIdx, setPoseIdx] = useState(0);
  const [remaining, setRemaining] = useState(0); // seconds left in current pose
  const [elapsed, setElapsed] = useState(0);     // total seconds elapsed across the session
  const intervalRef = useRef<any>(null);
  const [logged, setLogged] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setErr("");
      const s = await api.yogaSession(id as string);
      setSession(s);
      setRemaining(s.poses[0]?.duration_sec || 0);
    } catch (e: any) {
      setErr(e?.message || "Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Timer tick
  useEffect(() => {
    if (!running || !session) return;
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          // move to next pose
          setPoseIdx((idx) => {
            const next = idx + 1;
            if (next >= session.poses.length) {
              // session complete
              setRunning(false);
              return idx;
            }
            setElapsed((e) => e + 1);
            setTimeout(() => setRemaining(session.poses[next].duration_sec), 0);
            return next;
          });
          return 0;
        }
        setElapsed((e) => e + 1);
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, session]);

  const total = useMemo(() => session?.poses.reduce((s, p) => s + p.duration_sec, 0) || 0, [session]);
  const isSessionDone = session && poseIdx === session.poses.length - 1 && remaining === 0 && elapsed > 0 && !running;

  // Auto-log when session completes
  useEffect(() => {
    if (isSessionDone && !logged && session) {
      (async () => {
        try {
          await api.yogaLog({
            session_id: session.id,
            completed_seconds: elapsed,
            total_seconds: total,
            completed_poses: session.poses.length,
          });
          setLogged(true);
        } catch { /* silent */ }
      })();
    }
  }, [isSessionDone, logged, session, elapsed, total]);

  const play = () => {
    if (!session) return;
    if (isSessionDone) {
      // restart
      setPoseIdx(0);
      setRemaining(session.poses[0].duration_sec);
      setElapsed(0);
      setLogged(false);
    }
    setRunning(true);
  };
  const pause = () => setRunning(false);

  const skipNext = () => {
    if (!session) return;
    setRunning(false);
    setPoseIdx((idx) => {
      const next = Math.min(idx + 1, session.poses.length - 1);
      setRemaining(session.poses[next].duration_sec);
      return next;
    });
  };
  const skipPrev = () => {
    if (!session) return;
    setRunning(false);
    setPoseIdx((idx) => {
      const next = Math.max(idx - 1, 0);
      setRemaining(session.poses[next].duration_sec);
      return next;
    });
  };
  const stopAndLog = async () => {
    if (!session) return;
    setRunning(false);
    try {
      await api.yogaLog({
        session_id: session.id,
        completed_seconds: elapsed,
        total_seconds: total,
        completed_poses: poseIdx + 1,
      });
      setLogged(true);
      if (Platform.OS === "web") window.alert("Session logged. Keep the streak going!");
      else Alert.alert("Logged", "Session saved to your history. Keep the streak going!");
      router.back();
    } catch (e: any) {
      setErr(e?.message || "Log failed");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      </SafeAreaView>
    );
  }
  if (err || !session) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <Feather name="alert-triangle" size={22} color={COLORS.warning} />
          <Text style={{ color: COLORS.textPrimary, marginTop: 12 }}>{err || "Not found"}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.linkBtn}><Text style={styles.linkText}>Go back</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const embedUrl = `https://www.youtube.com/embed/${session.youtube_id}?playsinline=1&rel=0&modestbranding=1`;
  const currentPose: PoseT = session.poses[poseIdx];
  const progress = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="ys-back">
          <Feather name="chevron-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{session.category} · {session.level}</Text>
          <Text style={styles.title} numberOfLines={1}>{session.title}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 200 }}>
        {/* Video player */}
        <View style={styles.videoWrap}>
          {Platform.OS === "web" ? (
            // @ts-ignore — web-only element
            <iframe
              src={embedUrl}
              style={{ width: "100%", height: (width - 32) * 9 / 16, border: 0, borderRadius: 12 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={session.title}
            />
          ) : (
            <WebView
              source={{ uri: embedUrl }}
              style={{ width: "100%", height: (width - 32) * 9 / 16, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}
              allowsFullscreenVideo
              javaScriptEnabled
              domStorageEnabled
              mediaPlaybackRequiresUserAction={false}
            />
          )}
        </View>

        {/* Info card */}
        <View style={styles.infoCard}>
          <Text style={styles.instructor}>with {session.instructor}</Text>
          <View style={styles.chipsRow}>
            <Chip icon="clock" text={`${session.duration_min} min`} />
            <Chip icon="feather" text={session.dosha_target.join(" · ")} />
            <Chip icon="globe" text={session.language} />
          </View>
        </View>

        {/* Guided timer */}
        <View style={styles.timerCard}>
          <View style={styles.timerHead}>
            <Text style={styles.timerEyebrow}>POSE {poseIdx + 1} OF {session.poses.length}</Text>
            <Text style={styles.timerRemaining}>{fmt(remaining)}</Text>
          </View>

          <Text style={styles.poseName}>{currentPose.name}</Text>
          <Text style={styles.poseCue}>{currentPose.cue}</Text>

          {/* Progress bar for whole session */}
          <View style={styles.progressBg}>
            <View style={[styles.progressFg, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {fmt(elapsed)} / {fmt(total)} · {progress}% done
          </Text>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity onPress={skipPrev} style={styles.ctrlSmall} testID="ys-prev">
              <Feather name="skip-back" size={18} color={COLORS.brand} />
            </TouchableOpacity>
            {running ? (
              <TouchableOpacity onPress={pause} style={styles.ctrlPlay} testID="ys-pause">
                <Feather name="pause" size={28} color={COLORS.surface} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={play} style={styles.ctrlPlay} testID="ys-play">
                <Feather name={isSessionDone ? "refresh-cw" : "play"} size={28} color={COLORS.surface} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={skipNext} style={styles.ctrlSmall} testID="ys-next">
              <Feather name="skip-forward" size={18} color={COLORS.brand} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={stopAndLog} style={styles.finishBtn} testID="ys-finish">
            <Feather name="check-circle" size={14} color={COLORS.surface} />
            <Text style={styles.finishText}>{isSessionDone ? "Log & exit" : "End session and log"}</Text>
          </TouchableOpacity>

          {logged && isSessionDone && (
            <View style={styles.completedBadge}>
              <Feather name="award" size={14} color={COLORS.success} />
              <Text style={styles.completedText}>Session logged. Streak updated!</Text>
            </View>
          )}
        </View>

        {/* Benefits */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Benefits</Text>
          {session.benefits.map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <View style={styles.benefitDot} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Full pose sequence */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pose sequence</Text>
          {session.poses.map((p, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.poseRow, i === poseIdx && styles.poseRowActive]}
              onPress={() => { setRunning(false); setPoseIdx(i); setRemaining(p.duration_sec); }}
              testID={`ys-pose-${i}`}
            >
              <Text style={[styles.poseIdx, i === poseIdx && styles.poseIdxActive]}>{(i + 1).toString().padStart(2, "0")}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.poseRowName, i === poseIdx && { color: COLORS.brand }]}>{p.name}</Text>
                <Text style={styles.poseRowCue} numberOfLines={2}>{p.cue}</Text>
              </View>
              <Text style={styles.poseDur}>{fmt(p.duration_sec)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.chip}>
      <Feather name={icon} size={11} color={COLORS.brand} />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  linkBtn: { marginTop: SPACING.md, paddingVertical: 12, paddingHorizontal: 20 },
  linkText: { color: COLORS.brand, fontWeight: "700" },

  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 3, fontSize: 10, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, letterSpacing: -0.3 },

  videoWrap: { marginHorizontal: SPACING.lg, borderRadius: RADIUS.lg, overflow: "hidden", backgroundColor: "#000" },

  infoCard: { padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  instructor: { color: COLORS.textSecondary, fontSize: 12, fontStyle: "italic" },
  chipsRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill },
  chipText: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },

  timerCard: { padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md, backgroundColor: COLORS.brand, borderRadius: RADIUS.lg },
  timerHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.sm },
  timerEyebrow: { color: COLORS.accentSoft, letterSpacing: 2, fontSize: 10, fontWeight: "700" },
  timerRemaining: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 32, letterSpacing: -1 },
  poseName: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 26, letterSpacing: -0.5 },
  poseCue: { color: COLORS.accentSoft, fontSize: 13, marginTop: 6, lineHeight: 18 },
  progressBg: { marginTop: SPACING.md, height: 6, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 3, overflow: "hidden" },
  progressFg: { height: "100%", backgroundColor: COLORS.accent, borderRadius: 3 },
  progressText: { color: COLORS.accentSoft, fontSize: 11, marginTop: 6, textAlign: "center" },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.lg, marginTop: SPACING.md },
  ctrlSmall: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  ctrlPlay: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" },
  finishBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: SPACING.md, paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: "rgba(0,0,0,0.35)" },
  finishText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  completedBadge: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#E8F5E9", paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, marginTop: SPACING.md },
  completedText: { color: COLORS.success, fontWeight: "700", fontSize: 12 },

  card: { padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  benefitDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: COLORS.brand },
  benefitText: { color: COLORS.textPrimary, fontSize: 13, flex: 1, lineHeight: 18 },

  poseRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  poseRowActive: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, paddingHorizontal: 8, borderBottomWidth: 0 },
  poseIdx: { color: COLORS.textMuted, fontFamily: FONTS.mono, fontSize: 12, width: 30 },
  poseIdxActive: { color: COLORS.brand, fontWeight: "700" },
  poseRowName: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary },
  poseRowCue: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  poseDur: { color: COLORS.brand, fontFamily: FONTS.mono, fontSize: 12, fontWeight: "700" },
});
