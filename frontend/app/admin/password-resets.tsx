// Admin — Password reset requests moderation.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Alert, ActivityIndicator, Modal, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

type Status = "pending" | "approved" | "rejected";

export default function AdminPasswordResets() {
  const router = useRouter();
  const [tab, setTab] = useState<Status>("pending");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [modal, setModal] = useState<{ email: string; temp_password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.adminListPasswordResets(tab);
      setItems(r.items || []);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load reset requests");
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function onApprove(id: string, email: string) {
    Alert.alert(
      "Approve reset for " + email + "?",
      "The user's current password will be replaced with a strong server-generated temporary password. They will be forced to change it on their next login.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setApproving(id);
            try {
              const r = await api.adminApprovePasswordReset(id);
              setModal({ email: r.email, temp_password: r.temp_password });
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Could not approve");
            } finally { setApproving(null); }
          },
        },
      ],
    );
  }

  async function onReject(id: string, email: string) {
    Alert.alert(
      "Reject request for " + email + "?",
      "The request will be marked rejected and no password change will happen.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject", style: "destructive",
          onPress: async () => {
            try {
              await api.adminRejectPasswordReset(id);
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Could not reject");
            }
          },
        },
      ],
    );
  }

  async function copyTemp() {
    if (!modal) return;
    try {
      await Clipboard.setStringAsync(modal.temp_password);
      Alert.alert("Copied", "Temporary password copied to clipboard.");
    } catch {}
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="pr-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Admin</Text>
          <Text style={styles.title}>Password Reset Requests</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(["pending", "approved", "rejected"] as Status[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, tab === s && styles.tabActive]}
            onPress={() => { setLoading(true); setTab(s); }}
            testID={`pr-tab-${s}`}
          >
            <Text style={[styles.tabText, tab === s && { color: COLORS.surface }]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
              tintColor={COLORS.brand}
            />
          }
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="inbox" size={28} color={COLORS.brand} />
              <Text style={styles.emptyTitle}>No {tab} requests</Text>
            </View>
          ) : items.map((r) => (
            <View key={r.id} style={styles.card} testID={`pr-item-${r.id}`}>
              <View style={styles.rowTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(r.name || r.email || "?").slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{r.name || "—"}</Text>
                  <Text style={styles.email}>{r.email}</Text>
                  <View style={styles.meta}>
                    <View style={[styles.roleTag, r.role === "doctor" && { backgroundColor: COLORS.accent }]}>
                      <Text style={styles.roleTagText}>{(r.role || "patient").toUpperCase()}</Text>
                    </View>
                    <Text style={styles.time}>
                      {new Date(r.requested_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </Text>
                  </View>
                </View>
              </View>

              {r.status === "pending" && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => onReject(r.id, r.email)}
                    testID={`pr-reject-${r.id}`}
                  >
                    <Feather name="x" size={14} color={COLORS.error} />
                    <Text style={styles.rejectText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approveBtn, approving === r.id && { opacity: 0.6 }]}
                    disabled={approving === r.id}
                    onPress={() => onApprove(r.id, r.email)}
                    testID={`pr-approve-${r.id}`}
                  >
                    {approving === r.id ? (
                      <ActivityIndicator color={COLORS.surface} size="small" />
                    ) : (
                      <>
                        <Feather name="check" size={14} color={COLORS.surface} />
                        <Text style={styles.approveText}>Approve & set temp password</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
              {r.status === "approved" && (
                <View style={styles.doneRow}>
                  <Feather name="check-circle" size={14} color={COLORS.success} />
                  <Text style={styles.doneText}>Approved at {new Date(r.approved_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
                </View>
              )}
              {r.status === "rejected" && (
                <View style={styles.doneRow}>
                  <Feather name="x-circle" size={14} color={COLORS.error} />
                  <Text style={[styles.doneText, { color: COLORS.error }]}>Rejected</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Temp password modal — shown once, admin copies & shares with user */}
      <Modal visible={!!modal} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetIcon}>
              <Feather name="key" size={24} color={COLORS.surface} />
            </View>
            <Text style={styles.sheetTitle}>Temporary password issued</Text>
            <Text style={styles.sheetBody}>
              Share this password with <Text style={{ fontWeight: "700" }}>{modal?.email}</Text>{" "}
              via WhatsApp or phone. They must change it on their next login.
            </Text>
            <View style={styles.tempBox}>
              <Text selectable style={styles.tempText}>{modal?.temp_password}</Text>
            </View>
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.copyBtn} onPress={copyTemp} testID="pr-modal-copy">
                <Feather name="copy" size={14} color={COLORS.brand} />
                <Text style={styles.copyText}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.doneBtn} onPress={() => setModal(null)} testID="pr-modal-done">
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.warn}>⚠️ This password won&apos;t be shown again. Copy it now.</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: 2 },
  tabs: {
    flexDirection: "row", gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
  },
  tab: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tabText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 12 },
  empty: { alignItems: "center", padding: SPACING.xl },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: SPACING.sm },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.md, marginBottom: SPACING.md,
  },
  rowTop: { flexDirection: "row", gap: SPACING.md, alignItems: "center" },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.brand },
  name: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 15 },
  email: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  roleTag: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.brand,
  },
  roleTagText: { color: COLORS.surface, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  time: { color: COLORS.textMuted, fontSize: 11 },
  actions: {
    flexDirection: "row", gap: SPACING.sm,
    marginTop: SPACING.md, paddingTop: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  rejectBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.error,
  },
  rejectText: { color: COLORS.error, fontWeight: "700", fontSize: 12 },
  approveBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brand,
  },
  approveText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  doneRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: SPACING.md, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  doneText: { color: COLORS.success, fontSize: 12, fontWeight: "700" },
  // Modal
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", padding: SPACING.lg,
  },
  sheet: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, width: "100%", maxWidth: 400,
    alignItems: "center",
  },
  sheetIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  sheetBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center" },
  tempBox: {
    marginTop: SPACING.md, marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: "center", width: "100%",
  },
  tempText: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 18, color: COLORS.brand, fontWeight: "700", letterSpacing: 1,
  },
  sheetActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.sm, width: "100%" },
  copyBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand,
  },
  copyText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  doneBtn: {
    flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brand, alignItems: "center",
  },
  doneBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  warn: { color: COLORS.warning, fontSize: 11, fontWeight: "700", marginTop: SPACING.sm, textAlign: "center" },
});
