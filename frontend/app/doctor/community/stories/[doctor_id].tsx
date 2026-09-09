// Story viewer — full-screen carousel with progress bars, tap-to-advance, hold-to-pause.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Dimensions, ActivityIndicator,
  Alert, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const STORY_DURATION_MS = 5000;
const { width, height } = Dimensions.get("window");

function fmtWhen(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return d.toLocaleDateString();
  } catch { return ""; }
}

export default function StoryViewer() {
  const { doctor_id } = useLocalSearchParams<{ doctor_id: string }>();
  const router = useRouter();
  const [author, setAuthor] = useState<any>(null);
  const [stories, setStories] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMe, setIsMe] = useState(false);
  const timerRef = useRef<any>(null);
  const startedAtRef = useRef<number>(0);
  const carriedRef = useRef<number>(0);

  const load = useCallback(async () => {
    if (!doctor_id) return;
    try {
      const r = await api.docComStoriesBy(doctor_id);
      setAuthor(r.author);
      setStories(r.stories || []);
      setIsMe(!!r.is_me);
    } catch (e: any) {
      Alert.alert("Story unavailable", e?.message || "Try again");
      router.back();
    } finally { setLoading(false); }
  }, [doctor_id, router]);

  useEffect(() => { load(); }, [load]);

  const currentStory = stories[idx];

  // mark view when story shown
  useEffect(() => {
    if (!currentStory) return;
    api.docComViewStory(currentStory.id).catch(() => {});
  }, [currentStory?.id]);

  const advance = useCallback(() => {
    setIdx((i) => {
      if (i + 1 >= stories.length) {
        router.back();
        return i;
      }
      carriedRef.current = 0;
      setProgress(0);
      return i + 1;
    });
  }, [stories.length, router]);

  // progress timer
  useEffect(() => {
    if (loading || !currentStory) return;
    if (paused) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      carriedRef.current = progress;
      return;
    }
    startedAtRef.current = Date.now();
    const startFrom = carriedRef.current;
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const pct = Math.min(1, startFrom + elapsed / STORY_DURATION_MS);
      setProgress(pct);
      if (pct >= 1) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        advance();
      }
    }, 50);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [idx, paused, loading, currentStory, advance]);

  async function deleteStory() {
    if (!currentStory) return;
    Alert.alert("Delete story?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api.docComDeleteStory(currentStory.id);
          const remaining = stories.filter((s) => s.id !== currentStory.id);
          if (remaining.length === 0) router.back();
          else {
            setStories(remaining);
            setIdx(Math.min(idx, remaining.length - 1));
            setProgress(0); carriedRef.current = 0;
          }
        } catch (e: any) { Alert.alert("Delete failed", e?.message || "Try again"); }
      }},
    ]);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.surface} /></View>;
  }
  if (!currentStory) {
    return <View style={styles.center}><Text style={{ color: COLORS.surface }}>No stories</Text></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {/* Progress bars */}
      <View style={styles.progressRow}>
        {stories.map((_, i) => (
          <View key={i} style={styles.progressTrack}>
            <View style={[
              styles.progressFill,
              { width: `${i < idx ? 100 : i === idx ? progress * 100 : 0}%` },
            ]} />
          </View>
        ))}
      </View>

      {/* Header */}
      <View style={styles.header}>
        {author?.avatar_url ? (
          <Image source={{ uri: author.avatar_url }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, styles.headerAvatarFB]}>
            <Text style={styles.headerInit}>{(author?.name || "D").slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.headerName} numberOfLines={1}>{author?.name || "Doctor"}</Text>
            {author?.verified && <Feather name="check-circle" size={12} color={COLORS.surface} />}
          </View>
          <Text style={styles.headerTime}>{fmtWhen(currentStory.created_at)}</Text>
        </View>
        {isMe && (
          <TouchableOpacity onPress={deleteStory} style={styles.iconBtn} testID="story-delete">
            <Feather name="trash-2" size={18} color={COLORS.surface} />
          </TouchableOpacity>
        )}
        {!isMe && (
          <TouchableOpacity
            onPress={() => {
              setPaused(true);
              Alert.alert(
                "Report this story?",
                "Only report content that violates community guidelines. Admins will review shortly.",
                [
                  { text: "Cancel", style: "cancel", onPress: () => setPaused(false) },
                  { text: "Report", style: "destructive", onPress: async () => {
                    try {
                      await api.docComReport("story", currentStory.id, "Inappropriate content");
                      Alert.alert("Reported", "A moderator will review this story shortly.");
                    } catch (e: any) {
                      Alert.alert("Could not report", e?.message || "Try again");
                    } finally { setPaused(false); }
                  } },
                ],
              );
            }}
            style={styles.iconBtn}
            testID="story-report"
          >
            <Feather name="flag" size={18} color={COLORS.surface} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="story-close">
          <Feather name="x" size={22} color={COLORS.surface} />
        </TouchableOpacity>
      </View>

      {/* Story media + tap targets */}
      <View style={{ flex: 1 }}>
        <Image source={{ uri: currentStory.media_url }} style={styles.media} resizeMode="contain" />

        {/* Tap left = prev, tap right = next */}
        <Pressable
          style={[styles.tapZone, { left: 0, right: width / 2 }]}
          onPressIn={() => setPaused(true)}
          onPressOut={() => { setPaused(false); }}
          onPress={() => {
            setIdx((i) => {
              if (i === 0) return i;
              carriedRef.current = 0; setProgress(0);
              return i - 1;
            });
          }}
        />
        <Pressable
          style={[styles.tapZone, { left: width / 2, right: 0 }]}
          onPressIn={() => setPaused(true)}
          onPressOut={() => { setPaused(false); }}
          onPress={advance}
        />

        {currentStory.caption ? (
          <View style={styles.captionBar}>
            <Text style={styles.captionText}>{currentStory.caption}</Text>
          </View>
        ) : null}

        {isMe && (
          <View style={styles.viewsBar}>
            <Feather name="eye" size={12} color={COLORS.surface} />
            <Text style={styles.viewsText}>{currentStory.views_count || 0}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  progressRow: {
    flexDirection: "row", gap: 3, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm,
  },
  progressTrack: {
    flex: 1, height: 3, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: COLORS.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  headerAvatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: COLORS.surface },
  headerAvatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  headerInit: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 14 },
  headerName: { color: COLORS.surface, fontSize: 14, fontWeight: "700" },
  headerTime: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
  iconBtn: { padding: 6 },
  media: { flex: 1, width, height: height * 0.75 },
  tapZone: { position: "absolute", top: 0, bottom: 0 },
  captionBar: {
    position: "absolute", left: 0, right: 0, bottom: 40,
    paddingHorizontal: SPACING.lg,
  },
  captionText: {
    color: COLORS.surface, fontSize: 14, textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.4)", padding: 10, borderRadius: 8,
  },
  viewsBar: {
    position: "absolute", left: SPACING.md, bottom: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  viewsText: { color: COLORS.surface, fontSize: 11, fontWeight: "700" },
});
