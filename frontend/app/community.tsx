// Community feed — posts, likes, comments, hashtag filter, verified badges, doctor Q&A.
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform, Alert, RefreshControl, FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const SUGGESTED_TAGS = ["ayurveda", "womenshealth", "childcare", "diabetes", "yoga", "diet"];

export default function Community() {
  const router = useRouter();
  const { user } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [hashtags, setHashtags] = useState<any[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [showQ, setShowQ] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composer, setComposer] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        api.listPosts({ hashtag: filter || undefined, is_question: showQ ? true : undefined, limit: 20 }),
        api.listHashtags().catch(() => ({ items: [] })),
      ]);
      setPosts(p.items || []);
      setHashtags(t.items || []);
    } catch (e: any) { console.log("community load err", e.message); }
  }, [filter, showQ]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const toggleLike = async (id: string, currentlyLiked: boolean) => {
    // Optimistic UI
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, liked_by_me: !currentlyLiked, like_count: p.like_count + (currentlyLiked ? -1 : 1) } : p));
    try { await api.togglePostLike(id); }
    catch { /* revert */ setPosts((prev) => prev.map((p) => p.id === id ? { ...p, liked_by_me: currentlyLiked, like_count: p.like_count + (currentlyLiked ? 1 : -1) } : p)); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="community-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Community</Text>
          <Text style={styles.title}>Vaidhya Charcha</Text>
        </View>
        <TouchableOpacity style={styles.composeBtn} onPress={() => setComposer(true)} testID="community-compose">
          <Feather name="edit-3" size={14} color={COLORS.surface} />
          <Text style={styles.composeText}>Post</Text>
        </TouchableOpacity>
      </View>

      {/* Filter row */}
      <View style={{ maxHeight: 44 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterPill label="All" active={!filter && !showQ} onPress={() => { setFilter(null); setShowQ(false); }} />
          <FilterPill label="❓ Questions" active={showQ} onPress={() => { setShowQ(!showQ); setFilter(null); }} />
          {SUGGESTED_TAGS.map((t) => (
            <FilterPill key={t} label={`#${t}`} active={filter === t} onPress={() => { setFilter(filter === t ? null : t); setShowQ(false); }} />
          ))}
          {hashtags.filter((h) => !SUGGESTED_TAGS.includes(h.tag)).slice(0, 8).map((h) => (
            <FilterPill key={h.tag} label={`#${h.tag}`} active={filter === h.tag} onPress={() => { setFilter(filter === h.tag ? null : h.tag); setShowQ(false); }} />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="message-circle" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No posts yet. Be the first!</Text>
          </View>
        }
        renderItem={({ item: p }) => (
          <TouchableOpacity style={styles.postCard} activeOpacity={0.9} onPress={() => router.push({ pathname: "/community/[id]", params: { id: p.id } })} testID={`community-post-${p.id}`}>
            <View style={styles.postHead}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(p.author?.name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={styles.authorName}>{p.author?.name || "User"}</Text>
                  {p.author?.verified && <Feather name="check-circle" size={12} color={COLORS.brand} />}
                  {p.author?.role === "doctor" && <Text style={styles.roleBadge}>Vaidya</Text>}
                  {p.author?.role === "admin" && <Text style={[styles.roleBadge, { backgroundColor: COLORS.accent, color: COLORS.surface }]}>Official</Text>}
                </View>
                <Text style={styles.postTime}>{formatRelative(p.created_at)}{p.is_question ? " · ❓ Question" : ""}</Text>
              </View>
            </View>
            <Text style={styles.postContent} numberOfLines={4}>{p.content}</Text>
            {p.hashtags?.length > 0 && (
              <Text style={styles.postTags}>{p.hashtags.map((t: string) => `#${t}`).join(" ")}</Text>
            )}
            <View style={styles.postActions}>
              <TouchableOpacity style={styles.action} onPress={() => toggleLike(p.id, p.liked_by_me)} testID={`community-like-${p.id}`}>
                <Feather name="heart" size={16} color={p.liked_by_me ? COLORS.accent : COLORS.textMuted} />
                <Text style={styles.actionText}>{p.like_count || 0}</Text>
              </TouchableOpacity>
              <View style={styles.action}>
                <Feather name="message-circle" size={16} color={COLORS.textMuted} />
                <Text style={styles.actionText}>{p.comment_count || 0}</Text>
              </View>
              <TouchableOpacity style={[styles.action, { marginLeft: "auto" }]} onPress={() => router.push("/(tabs)/consult")}>
                <Text style={styles.ctaSmall}>Consult karo →</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />

      {composer && (
        <Composer defaultTag={filter} onClose={() => setComposer(false)} onPosted={async () => { setComposer(false); await load(); }} />
      )}
    </SafeAreaView>
  );
}

function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.filterPill, active && styles.filterActive]} onPress={onPress}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------- Composer ----------------
function Composer({ defaultTag, onClose, onPosted }: { defaultTag: string | null; onClose: () => void; onPosted: () => void }) {
  const [content, setContent] = useState("");
  const [tags, setTags] = useState(defaultTag || "");
  const [isQuestion, setIsQuestion] = useState(false);
  const [busy, setBusy] = useState(false);

  const post = async () => {
    if (!content.trim()) { Alert.alert("Write something first"); return; }
    setBusy(true);
    try {
      await api.createPost({
        content: content.trim(),
        hashtags: tags.split(/[\s,#]+/).map((t) => t.trim()).filter(Boolean),
        is_question: isQuestion,
      });
      onPosted();
    } catch (e: any) { Alert.alert("Post failed", e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Share with the community</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={COLORS.textPrimary} /></TouchableOpacity>
          </View>

          <View style={styles.rowBetween}>
            <TouchableOpacity style={[styles.qToggle, !isQuestion && styles.qActive]} onPress={() => setIsQuestion(false)}>
              <Text style={[styles.qText, !isQuestion && styles.qTextActive]}>💬 Share tip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.qToggle, isQuestion && styles.qActive]} onPress={() => setIsQuestion(true)}>
              <Text style={[styles.qText, isQuestion && styles.qTextActive]}>❓ Ask doctor</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.composerInput}
            multiline
            value={content}
            onChangeText={setContent}
            placeholder={isQuestion ? "Ask a health question…" : "Share your experience, tip, or wellness win…"}
            placeholderTextColor={COLORS.textMuted}
            maxLength={2000}
            testID="composer-content"
          />
          <Text style={styles.charCount}>{content.length} / 2000</Text>

          <Text style={styles.miniLabel}>Hashtags (space-separated)</Text>
          <TextInput
            style={styles.input}
            value={tags}
            onChangeText={setTags}
            placeholder="ayurveda yoga pcos"
            placeholderTextColor={COLORS.textMuted}
            testID="composer-tags"
          />

          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={post} testID="composer-post">
            <Text style={styles.saveText}>{busy ? "Posting…" : isQuestion ? "Ask community" : "Post"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  } catch { return ""; }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.sm },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary },
  composeBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill },
  composeText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  filterRow: { paddingHorizontal: SPACING.lg, gap: 8, paddingBottom: SPACING.sm, alignItems: "center" },
  filterPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, height: 30, justifyContent: "center" },
  filterActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  filterText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "600" },
  filterTextActive: { color: COLORS.surface },
  empty: { alignItems: "center", padding: SPACING.xl * 2 },
  emptyText: { color: COLORS.textMuted, marginTop: 12, fontSize: 14 },
  postCard: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm },
  postHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: SPACING.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.brand },
  authorName: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  roleBadge: { fontSize: 10, backgroundColor: COLORS.accentSoft, color: COLORS.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: "700", overflow: "hidden" },
  postTime: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  postContent: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 21 },
  postTags: { color: COLORS.brand, fontSize: 12, marginTop: 6, fontWeight: "600" },
  postActions: { flexDirection: "row", gap: 20, marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, alignItems: "center" },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: COLORS.textMuted, fontSize: 12, fontWeight: "600" },
  ctaSmall: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  // Composer
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.lg, paddingBottom: SPACING.xl },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.md },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  rowBetween: { flexDirection: "row", gap: 8, marginBottom: SPACING.md },
  qToggle: { flex: 1, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", backgroundColor: COLORS.bg },
  qActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  qText: { color: COLORS.textSecondary, fontWeight: "600", fontSize: 13 },
  qTextActive: { color: COLORS.surface, fontWeight: "700" },
  composerInput: { minHeight: 140, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, fontSize: 15, color: COLORS.textPrimary, textAlignVertical: "top" },
  charCount: { color: COLORS.textMuted, fontSize: 11, textAlign: "right", marginTop: 4 },
  input: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, fontSize: 15, color: COLORS.textPrimary },
  miniLabel: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.sm, marginBottom: 6, fontWeight: "700" },
  saveBtn: { marginTop: SPACING.lg, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, alignItems: "center" },
  saveText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
});
