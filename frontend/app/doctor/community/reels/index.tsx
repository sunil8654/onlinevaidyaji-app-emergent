// Reels — vertical swipe feed of doctor short videos.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Dimensions, TouchableOpacity, ActivityIndicator,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { COLORS, FONTS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const { width, height } = Dimensions.get("window");
const REEL_H = height - 60;  // leave room for top bar

function ReelItem({ item, active, onLikeToggle }: any) {
  const player = useVideoPlayer(item.video_url, (p) => {
    p.loop = true;
    p.muted = false;
  });
  const [liked, setLiked] = useState(item.liked_by_me);
  const [likes, setLikes] = useState(item.likes_count || 0);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (active) {
      player.play();
      api.docComReelView(item.id).catch(() => {});
    } else {
      player.pause();
    }
  }, [active]);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    const wasLiked = liked;
    setLiked(!wasLiked); setLikes((n: number) => n + (wasLiked ? -1 : 1));
    try {
      const r = await api.docComReelLike(item.id);
      setLiked(r.liked);
      onLikeToggle?.(item.id, r.liked);
    } catch {
      setLiked(wasLiked); setLikes((n: number) => n + (wasLiked ? 1 : -1));
    } finally { setBusy(false); }
  }

  return (
    <View style={styles.reel}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />

      {/* Bottom info */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.authorRow}
          onPress={() => router.push({ pathname: "/doctor/community/profile/[id]", params: { id: item.author?.id } })}
        >
          {item.author?.avatar_url ? (
            <Image source={{ uri: item.author.avatar_url }} style={styles.authorAvatar} />
          ) : (
            <View style={[styles.authorAvatar, styles.authorAvatarFB]}>
              <Text style={styles.authorInit}>{(item.author?.name || "D").slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={styles.authorName} numberOfLines={1}>{item.author?.name || "Doctor"}</Text>
              {item.author?.verified && <Feather name="check-circle" size={11} color={COLORS.surface} />}
            </View>
            <Text style={styles.authorSpec} numberOfLines={1}>{item.author?.specialty || "AYUSH"}</Text>
          </View>
        </TouchableOpacity>
        {item.caption ? (
          <Text style={styles.caption} numberOfLines={3}>{item.caption}</Text>
        ) : null}
      </View>

      {/* Right actions */}
      <View style={styles.actionsCol}>
        <TouchableOpacity onPress={toggleLike} style={styles.actionBtn} testID={`reel-like-${item.id}`}>
          <Feather name="heart" size={26} color={liked ? "#ff4d6d" : COLORS.surface} />
          <Text style={styles.actionText}>{likes}</Text>
        </TouchableOpacity>
        <View style={styles.actionBtn}>
          <Feather name="eye" size={22} color={COLORS.surface} />
          <Text style={styles.actionText}>{item.views_count || 0}</Text>
        </View>
      </View>
    </View>
  );
}

export default function ReelsFeed() {
  const { start } = useLocalSearchParams<{ start?: string }>();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.docComReelsFeed();
      const list = r.items || [];
      setItems(list);
      // If a start reel_id was passed, scroll there
      if (start) {
        const i = list.findIndex((x: any) => x.id === start);
        if (i > 0) {
          setActiveIdx(i);
          setTimeout(() => listRef.current?.scrollToIndex({ index: i, animated: false }), 40);
        }
      }
    } catch {}
    finally { setLoading(false); }
  }, [start]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.surface} /></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="reels-back">
          <Feather name="arrow-left" size={22} color={COLORS.surface} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Reels</Text>
        <TouchableOpacity onPress={() => router.push("/doctor/community/reels/create")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="reels-add">
          <Feather name="plus-circle" size={22} color={COLORS.surface} />
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={styles.emptyIcon}>
            <Feather name="film" size={32} color={COLORS.surface} />
          </View>
          <Text style={styles.emptyTitle}>No reels yet</Text>
          <Text style={styles.emptyBody}>Be the first to share a short educational video for your peers.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/doctor/community/reels/create")}>
            <Feather name="plus" size={16} color={COLORS.textPrimary} />
            <Text style={styles.emptyBtnText}>Create a reel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(r) => r.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={REEL_H}
          decelerationRate="fast"
          getItemLayout={(_, i) => ({ length: REEL_H, offset: REEL_H * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.y / REEL_H);
            if (i !== activeIdx) setActiveIdx(i);
          }}
          renderItem={({ item, index }) => (
            <ReelItem item={item} active={index === activeIdx} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  topBar: {
    height: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
  },
  topTitle: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 20 },
  reel: { width, height: REEL_H, backgroundColor: "#000" },
  bottomBar: {
    position: "absolute", left: SPACING.md, right: 72, bottom: 24,
    gap: SPACING.sm,
  },
  authorRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  authorAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: COLORS.surface },
  authorAvatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  authorInit: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 16 },
  authorName: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  authorSpec: { color: "rgba(255,255,255,0.75)", fontSize: 11 },
  caption: { color: COLORS.surface, fontSize: 13, lineHeight: 18 },
  actionsCol: {
    position: "absolute", right: SPACING.md, bottom: 40,
    alignItems: "center", gap: SPACING.md,
  },
  actionBtn: { alignItems: "center", gap: 2 },
  actionText: { color: COLORS.surface, fontSize: 11, fontWeight: "700" },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  emptyTitle: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 22 },
  emptyBody: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: SPACING.sm, marginBottom: SPACING.md, paddingHorizontal: SPACING.lg },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.surface, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 22 },
  emptyBtnText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 13 },
});
