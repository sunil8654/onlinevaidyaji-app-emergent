// Community post detail — view full post, comments, doctor answers.
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function PostDetail() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        api.getPost(id as string),
        api.listComments(id as string),
      ]);
      setPost(p);
      setComments(c.items || []);
    } catch (e: any) { Alert.alert("Load failed", e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const submitComment = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addComment(id as string, text.trim());
      setText("");
      await load();
    } catch (e: any) { Alert.alert("Comment failed", e.message); }
    finally { setBusy(false); }
  };

  const toggleLike = async () => {
    if (!post) return;
    setPost({ ...post, liked_by_me: !post.liked_by_me, like_count: post.like_count + (post.liked_by_me ? -1 : 1) });
    try { await api.togglePostLike(post.id); }
    catch { await load(); }
  };

  const deletePost = () => {
    Alert.alert("Delete post?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.deletePost(id as string); router.back(); }
        catch (e: any) { Alert.alert("Delete failed", e.message); }
      }},
    ]);
  };

  const canDelete = post && user && (post.author?.id === user.id || user.is_admin);

  if (!post) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.centerLoader}><Text style={{ color: COLORS.textSecondary }}>Loading…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="post-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headTitle}>Post</Text>
        <View style={{ flex: 1 }} />
        {canDelete && (
          <TouchableOpacity onPress={deletePost} testID="post-delete">
            <Feather name="trash-2" size={18} color={COLORS.error} />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
        <ScrollView
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
        >
          {/* Post card */}
          <View style={styles.postCard}>
            <View style={styles.postHead}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(post.author?.name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={styles.authorName}>{post.author?.name}</Text>
                  {post.author?.verified && <Feather name="check-circle" size={12} color={COLORS.brand} />}
                  {post.author?.role === "doctor" && <Text style={styles.roleBadge}>Vaidya</Text>}
                  {post.author?.role === "admin" && <Text style={[styles.roleBadge, { backgroundColor: COLORS.accent, color: COLORS.surface }]}>Official</Text>}
                </View>
                <Text style={styles.postTime}>{post.created_at?.slice(0, 16).replace("T", " ")}{post.is_question ? " · ❓ Question" : ""}</Text>
              </View>
            </View>
            <Text style={styles.postContent}>{post.content}</Text>
            {post.hashtags?.length > 0 && (
              <Text style={styles.postTags}>{post.hashtags.map((t: string) => `#${t}`).join(" ")}</Text>
            )}
            <View style={styles.postActions}>
              <TouchableOpacity style={styles.action} onPress={toggleLike} testID="post-like">
                <Feather name="heart" size={16} color={post.liked_by_me ? COLORS.accent : COLORS.textMuted} />
                <Text style={styles.actionText}>{post.like_count || 0}</Text>
              </TouchableOpacity>
              <View style={styles.action}>
                <Feather name="message-circle" size={16} color={COLORS.textMuted} />
                <Text style={styles.actionText}>{post.comment_count || 0}</Text>
              </View>
              <TouchableOpacity style={[styles.action, { marginLeft: "auto" }]} onPress={() => router.push("/(tabs)/consult")}>
                <Text style={styles.cta}>Consult karo →</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Comments */}
          <Text style={styles.section}>Comments ({comments.length})</Text>
          {comments.length === 0 && <Text style={styles.empty}>Be the first to reply.</Text>}
          {comments.map((c) => (
            <View key={c.id} style={styles.commentCard}>
              <View style={styles.commentHead}>
                <View style={styles.avatarSm}>
                  <Text style={styles.avatarText}>{(c.author?.name || "?").slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text style={styles.authorName}>{c.author?.name}</Text>
                    {c.author?.verified && <Feather name="check-circle" size={10} color={COLORS.brand} />}
                    {c.author?.role === "doctor" && <Text style={styles.roleBadge}>Vaidya</Text>}
                  </View>
                  <Text style={styles.postTime}>{c.created_at?.slice(0, 16).replace("T", " ")}</Text>
                </View>
              </View>
              <Text style={styles.commentText}>{c.text}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Reply bar */}
        <View style={styles.replyBar}>
          <TextInput
            style={styles.replyInput}
            value={text}
            onChangeText={setText}
            placeholder="Add a reply…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={1000}
            testID="post-reply-input"
          />
          <TouchableOpacity style={[styles.sendBtn, busy && { opacity: 0.6 }]} disabled={busy || !text.trim()} onPress={submitComment} testID="post-reply-send">
            <Feather name="send" size={18} color={COLORS.surface} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  centerLoader: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  postCard: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  postHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: SPACING.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarSm: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.brand },
  authorName: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  roleBadge: { fontSize: 10, backgroundColor: COLORS.accentSoft, color: COLORS.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: "700", overflow: "hidden" },
  postTime: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  postContent: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 22 },
  postTags: { color: COLORS.brand, fontSize: 12, marginTop: 8, fontWeight: "600" },
  postActions: { flexDirection: "row", gap: 20, marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, alignItems: "center" },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: COLORS.textMuted, fontSize: 12, fontWeight: "600" },
  cta: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  section: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  empty: { color: COLORS.textMuted, fontStyle: "italic", fontSize: 13 },
  commentCard: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  commentHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  commentText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20, marginLeft: 42 },
  replyBar: { flexDirection: "row", padding: SPACING.md, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, alignItems: "flex-end", gap: 8 },
  replyInput: { flex: 1, maxHeight: 100, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 10, fontSize: 14, color: COLORS.textPrimary },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
});
