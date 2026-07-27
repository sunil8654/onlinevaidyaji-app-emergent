// Admin — Doctor Community moderation: reports, broadcast, pin/hide/ban.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  RefreshControl, ActivityIndicator, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function AdminDocCommunity() {
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [broadcast, setBroadcast] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.adminDocComReports(tab === "closed");
      setItems(r.items || []);
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not load"); }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function hidePost(postId: string) {
    Alert.prompt?.(
      "Hide this post?",
      "Enter reason (patient will not see this)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Hide", style: "destructive",
          onPress: async (reason?: string) => {
            try {
              await api.adminDocComHide(postId, reason || "Removed by moderators");
              await load();
              Alert.alert("Done", "Post hidden.");
            } catch (e: any) { Alert.alert("Error", e?.message || "Could not hide"); }
          },
        },
      ],
      "plain-text",
      "Guideline violation"
    );
  }

  async function banDoctor(doctorId: string) {
    Alert.prompt?.(
      "Ban this doctor from community?",
      "Reason (required)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Ban", style: "destructive",
          onPress: async (reason?: string) => {
            if (!reason || reason.trim().length < 3) {
              Alert.alert("Reason required", "Please enter a reason (min 3 chars).");
              return;
            }
            try {
              await api.adminDocComBan(doctorId, reason.trim());
              Alert.alert("Done", "Doctor is banned from the community.");
              await load();
            } catch (e: any) { Alert.alert("Error", e?.message || "Could not ban"); }
          },
        },
      ],
      "plain-text",
    );
  }

  async function resolve(id: string) {
    try {
      await api.adminDocComResolveReport(id);
      await load();
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not resolve"); }
  }

  async function submitBroadcast() {
    if (broadcast.trim().length < 3) {
      Alert.alert("Too short", "Please write a longer message.");
      return;
    }
    setBroadcasting(true);
    try {
      await api.adminDocComBroadcast(broadcast.trim());
      Alert.alert("Broadcast sent", "All doctors will see this in their feed and notifications.");
      setBroadcast("");
      setShowBroadcast(false);
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not send"); }
    finally { setBroadcasting(false); }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="ad-back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Admin</Text>
          <Text style={styles.title}>Doctor Community</Text>
        </View>
        <TouchableOpacity style={styles.bcBtn} onPress={() => setShowBroadcast(true)} testID="ad-broadcast">
          <Feather name="megaphone" size={14} color={COLORS.surface} />
          <Text style={styles.bcText}>Broadcast</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {(["open", "closed"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => { setLoading(true); setTab(t); }}
            testID={`ad-tab-${t}`}
          >
            <Text style={[styles.tabText, tab === t && { color: COLORS.surface }]}>
              {t === "open" ? "Open reports" : "Resolved"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={COLORS.brand} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />}
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="check-circle" size={28} color={COLORS.brand} />
              <Text style={styles.emptyTitle}>All clear</Text>
              <Text style={styles.emptyBody}>No {tab === "open" ? "open" : "resolved"} reports.</Text>
            </View>
          ) : items.map((r) => (
            <View key={r.id} style={styles.card}>
              <View style={styles.rowTop}>
                <View style={styles.typeChip}>
                  <Feather name={r.target_type === "post" ? "image" : "message-circle"} size={11} color={COLORS.surface} />
                  <Text style={styles.typeText}>{r.target_type.toUpperCase()}</Text>
                </View>
                <Text style={styles.time}>{new Date(r.at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
              </View>
              <Text style={styles.reason}>{r.reason}</Text>
              <Text style={styles.reporter}>Reported by {r.reporter?.name || "a doctor"}</Text>
              {r.post && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewLabel}>Post preview:</Text>
                  <Text style={styles.previewText} numberOfLines={3}>{r.post.caption || "(no caption)"}</Text>
                </View>
              )}
              {r.comment && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewLabel}>Comment:</Text>
                  <Text style={styles.previewText} numberOfLines={3}>{r.comment.text}</Text>
                </View>
              )}
              {tab === "open" && (
                <View style={styles.actionRow}>
                  {r.target_type === "post" && r.post && (
                    <>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => hidePost(r.target_id)} testID={`ad-hide-${r.id}`}>
                        <Feather name="eye-off" size={12} color={COLORS.error} />
                        <Text style={[styles.actionText, { color: COLORS.error }]}>Hide post</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => banDoctor(r.post.doctor_id)} testID={`ad-ban-${r.id}`}>
                        <Feather name="user-x" size={12} color={COLORS.error} />
                        <Text style={[styles.actionText, { color: COLORS.error }]}>Ban doctor</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity style={[styles.actionBtn, styles.resolveBtn]} onPress={() => resolve(r.id)} testID={`ad-resolve-${r.id}`}>
                    <Feather name="check" size={12} color={COLORS.surface} />
                    <Text style={[styles.actionText, { color: COLORS.surface }]}>Resolve</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal transparent visible={showBroadcast} animationType="fade" onRequestClose={() => setShowBroadcast(false)}>
        <View style={styles.bdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Broadcast to all doctors</Text>
            <Text style={styles.sheetBody}>Message will be pinned to every doctor&apos;s feed and sent as a notification.</Text>
            <TextInput
              value={broadcast}
              onChangeText={setBroadcast}
              multiline
              placeholder="Your message…"
              placeholderTextColor={COLORS.textMuted}
              style={styles.bcInput}
              maxLength={500}
              testID="ad-bc-input"
            />
            <View style={{ flexDirection: "row", gap: SPACING.sm }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowBroadcast(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sendBtn, broadcasting && { opacity: 0.6 }]} disabled={broadcasting} onPress={submitBroadcast} testID="ad-bc-send">
                {broadcasting ? <ActivityIndicator color={COLORS.surface} size="small" /> : <Text style={styles.sendText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: 2 },
  bcBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill },
  bcText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  tabs: { flexDirection: "row", gap: 8, padding: SPACING.md, paddingHorizontal: SPACING.lg },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tabText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 12 },
  empty: { alignItems: "center", padding: SPACING.xl },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.sm },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.md, marginBottom: SPACING.md,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  typeText: { color: COLORS.surface, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  time: { color: COLORS.textMuted, fontSize: 11 },
  reason: { color: COLORS.textPrimary, fontSize: 14, marginTop: 8, lineHeight: 20 },
  reporter: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },
  previewBox: { marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.sm },
  previewLabel: { color: COLORS.textMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  previewText: { color: COLORS.textPrimary, fontSize: 12, marginTop: 2, lineHeight: 17 },
  actionRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    marginTop: SPACING.md, paddingTop: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  resolveBtn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand, marginLeft: "auto" },
  actionText: { fontWeight: "700", fontSize: 11 },
  bdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  sheet: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, width: "100%", maxWidth: 500 },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginBottom: 4 },
  sheetBody: { color: COLORS.textSecondary, fontSize: 12, marginBottom: SPACING.md },
  bcInput: {
    minHeight: 100, padding: SPACING.md,
    backgroundColor: COLORS.bg, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textPrimary, textAlignVertical: "top",
    marginBottom: SPACING.md,
  },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceAlt, alignItems: "center" },
  cancelText: { color: COLORS.textPrimary, fontWeight: "700" },
  sendBtn: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand, alignItems: "center" },
  sendText: { color: COLORS.surface, fontWeight: "700" },
});
