// Post detail — full post + comments thread.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { DoctorPostCard } from "@/src/components/DoctorPostCard";
import { useAuth } from "@/src/auth";

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, cs] = await Promise.all([api.docComGetPost(id), api.docComListComments(id)]);
      setPost(p);
      setComments(cs);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Post not found");
      router.back();
    } finally { setLoading(false); }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  async function submitComment() {
    const t = text.trim();
    if (!t || !post) return;
    setPosting(true);
    try {
      const c = await api.docComAddComment(post.id, t);
      setComments((arr) => [...arr, c]);
      setPost((p: any) => ({ ...p, comments_count: (p?.comments_count || 0) + 1 }));
      setText("");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not post comment");
    } finally { setPosting(false); }
  }

  async function deleteComment(cid: string) {
    Alert.alert("Delete comment?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await api.docComDeleteComment(cid);
            setComments((arr) => arr.filter((c) => c.id !== cid));
            setPost((p: any) => ({ ...p, comments_count: Math.max(0, (p?.comments_count || 1) - 1) }));
          } catch (e: any) { Alert.alert("Error", e?.message || "Could not delete"); }
        },
      },
    ]);
  }

  async function deletePost() {
    if (!post) return;
    Alert.alert("Delete this post?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await api.docComDeletePost(post.id);
            router.replace("/doctor/community");
          } catch (e: any) { Alert.alert("Error", e?.message || "Could not delete"); }
        },
      },
    ]);
  }

  if (loading || !post) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  const canDeletePost = user?.id === post.author?.id || user?.is_admin;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={styles.subHead}>
        <TouchableOpacity onPress={() => router.back()} testID="pd-back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Post</Text>
        {canDeletePost ? (
          <TouchableOpacity onPress={deletePost} testID="pd-delete-post" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="trash-2" size={18} color={COLORS.error} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
      </View>
      <ScrollView
        style={{ flex: 1, backgroundColor: COLORS.bg }}
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
        }
      >
        <DoctorPostCard post={post} onChange={(p) => setPost(p)} />

        <Text style={styles.sectionLabel}>Comments ({post.comments_count || 0})</Text>
        {comments.length === 0 ? (
          <Text style={styles.emptyCmt}>Be the first to comment.</Text>
        ) : comments.map((c) => (
          <View key={c.id} style={styles.commentRow} testID={`pd-cmt-${c.id}`}>
            {c.author?.avatar_url ? (
              <Image source={{ uri: c.author.avatar_url }} style={styles.cAvatar} />
            ) : (
              <View style={[styles.cAvatar, { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" }]}>
                <Text style={styles.cInitial}>{(c.author?.name || "D").slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={styles.cName}>{c.author?.name || "Doctor"}</Text>
                {c.author?.verified && <Feather name="check-circle" size={11} color={COLORS.brand} />}
                <Text style={styles.cTime}>{new Date(c.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
              </View>
              <Text style={styles.cText}>{c.text}</Text>
            </View>
            {(c.author?.id === user?.id || user?.is_admin) && (
              <TouchableOpacity onPress={() => deleteComment(c.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID={`pd-cmt-del-${c.id}`}>
                <Feather name="trash-2" size={14} color={COLORS.error} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Comment composer */}
      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          style={styles.cInput}
          placeholder="Add a comment…"
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={800}
          testID="pd-cmt-input"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || posting) && { opacity: 0.5 }]}
          disabled={!text.trim() || posting}
          onPress={submitComment}
          testID="pd-cmt-send"
        >
          {posting ? <ActivityIndicator color={COLORS.surface} size="small" /> : <Feather name="send" size={14} color={COLORS.surface} />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  subHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  subTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  sectionLabel: {
    marginTop: SPACING.md, marginBottom: SPACING.sm,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  emptyCmt: { color: COLORS.textMuted, textAlign: "center", padding: SPACING.md, fontStyle: "italic" },
  commentRow: {
    flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.md,
  },
  cAvatar: { width: 32, height: 32, borderRadius: 16 },
  cInitial: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  cName: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 12 },
  cTime: { color: COLORS.textMuted, fontSize: 10, marginLeft: 4 },
  cText: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  composer: {
    flexDirection: "row", gap: SPACING.sm, alignItems: "center",
    padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  cInput: {
    flex: 1, minHeight: 40, maxHeight: 100,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: COLORS.bg, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textPrimary,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center",
  },
});
