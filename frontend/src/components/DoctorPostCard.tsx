// Reusable card for a Doctor Community post (feed + profile + saved).
import { useState } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Dimensions, Alert } from "react-native";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const { width } = Dimensions.get("window");
const IMG_H = Math.min(width - 32, 420);

type Props = {
  post: any;
  onChange?: (updated: any) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
};

export function DoctorPostCard({ post: initial, onChange, onDelete, compact }: Props) {
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [idx, setIdx] = useState(0);

  async function toggleLike() {
    // Optimistic
    const wasLiked = post.liked_by_me;
    const next = { ...post, liked_by_me: !wasLiked, likes_count: (post.likes_count || 0) + (wasLiked ? -1 : 1) };
    setPost(next);
    onChange?.(next);
    try {
      if (wasLiked) await api.docComUnlike(post.id);
      else await api.docComLike(post.id);
    } catch {
      // rollback
      setPost(post);
      onChange?.(post);
    }
  }

  async function toggleSave() {
    const wasSaved = post.saved_by_me;
    const next = { ...post, saved_by_me: !wasSaved };
    setPost(next);
    onChange?.(next);
    try {
      if (wasSaved) await api.docComUnsave(post.id);
      else await api.docComSave(post.id);
    } catch {
      setPost(post);
      onChange?.(post);
    }
  }

  function openReport() {
    Alert.prompt?.(
      "Report post",
      "Why are you reporting this post?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit", onPress: async (reason?: string) => {
            if (!reason || !reason.trim()) return;
            try {
              await api.docComReport("post", post.id, reason.trim());
              Alert.alert("Reported", "Thank you. Our team will review this shortly.");
            } catch (e: any) { Alert.alert("Error", e?.message || "Could not report"); }
          },
        },
      ],
      "plain-text"
    );
  }

  const images: string[] = Array.isArray(post.images) ? post.images : [];
  const hasImages = images.length > 0;

  return (
    <View style={styles.card} testID={`doc-post-${post.id}`}>
      <TouchableOpacity
        style={styles.head}
        onPress={() => router.push({ pathname: "/doctor/community/profile/[id]", params: { id: post.author?.id || post.doctor_id } })}
        activeOpacity={0.85}
      >
        {post.author?.avatar_url ? (
          <Image source={{ uri: post.author.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText}>{(post.author?.name || "D").slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.name}>{post.author?.name || "Doctor"}</Text>
            {post.author?.verified && (
              <Feather name="check-circle" size={13} color={COLORS.brand} />
            )}
            {post.pinned && (
              <View style={styles.pinChip}>
                <Feather name="star" size={9} color={COLORS.surface} />
                <Text style={styles.pinText}>PINNED</Text>
              </View>
            )}
          </View>
          <Text style={styles.sub}>
            {post.author?.specialty || "AYUSH Doctor"}{post.author?.clinic_name ? ` · ${post.author.clinic_name}` : ""}
          </Text>
        </View>
        <TouchableOpacity onPress={openReport} testID={`doc-post-more-${post.id}`} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="more-horizontal" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>

      {hasImages && !compact && (
        <View style={styles.imgWrap}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const w = e.nativeEvent.layoutMeasurement.width;
              setIdx(Math.round(e.nativeEvent.contentOffset.x / w));
            }}
          >
            {images.map((src, i) => (
              <Image key={i} source={{ uri: src }} style={{ width: width - 32, height: IMG_H, backgroundColor: COLORS.surfaceAlt }} />
            ))}
          </ScrollView>
          {images.length > 1 && (
            <View style={styles.dotsRow}>
              {images.map((_, i) => (
                <View key={i} style={[styles.dot, i === idx && { backgroundColor: COLORS.brand, width: 16 }]} />
              ))}
            </View>
          )}
          {post.clinical_flag && (
            <View style={styles.clinicalChip}>
              <Feather name="shield" size={10} color={COLORS.surface} />
              <Text style={styles.clinicalText}>CLINICAL · Patient identity hidden</Text>
            </View>
          )}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity onPress={toggleLike} style={styles.actionBtn} testID={`doc-post-like-${post.id}`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="heart" size={22} color={post.liked_by_me ? COLORS.error : COLORS.textPrimary} style={post.liked_by_me ? { opacity: 1 } : undefined} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          testID={`doc-post-comment-${post.id}`}
          onPress={() => router.push({ pathname: "/doctor/community/post/[id]", params: { id: post.id } })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="message-circle" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={toggleSave} style={styles.actionBtn} testID={`doc-post-save-${post.id}`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="bookmark" size={22} color={post.saved_by_me ? COLORS.accent : COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      {post.likes_count > 0 && (
        <Text style={styles.likes}>{post.likes_count} {post.likes_count === 1 ? "like" : "likes"}</Text>
      )}

      {post.caption ? (
        <Text style={styles.caption}>
          <Text style={styles.captionName}>{post.author?.name || "Doctor"} </Text>
          {post.caption}
        </Text>
      ) : null}

      {post.hashtags?.length ? (
        <View style={styles.tagRow}>
          {post.hashtags.slice(0, 6).map((t: string) => (
            <TouchableOpacity
              key={t}
              onPress={() => router.push({ pathname: "/doctor/community/hashtag/[tag]", params: { tag: t } })}
            >
              <Text style={styles.tag}>#{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {post.comments_count > 0 && (
        <TouchableOpacity onPress={() => router.push({ pathname: "/doctor/community/post/[id]", params: { id: post.id } })}>
          <Text style={styles.viewComments}>View all {post.comments_count} comments</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.time}>{new Date(post.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.md, overflow: "hidden",
  },
  head: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
  name: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  sub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  pinChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: COLORS.accent, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: RADIUS.pill, marginLeft: 6,
  },
  pinText: { color: COLORS.surface, fontSize: 8, fontWeight: "700", letterSpacing: 1 },
  imgWrap: { backgroundColor: COLORS.surfaceAlt, position: "relative" },
  dotsRow: {
    position: "absolute", bottom: 8, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.7)" },
  clinicalChip: {
    position: "absolute", top: 8, left: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: COLORS.brand, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  clinicalText: { color: COLORS.surface, fontSize: 9, letterSpacing: 1, fontWeight: "700" },
  actions: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: 4,
  },
  actionBtn: { padding: 4 },
  likes: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 13, paddingHorizontal: SPACING.md, marginTop: 2 },
  caption: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 19, paddingHorizontal: SPACING.md, marginTop: 4 },
  captionName: { fontWeight: "700" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: SPACING.md, marginTop: 4 },
  tag: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  viewComments: { color: COLORS.textMuted, fontSize: 12, paddingHorizontal: SPACING.md, marginTop: 4 },
  time: { color: COLORS.textMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
});
