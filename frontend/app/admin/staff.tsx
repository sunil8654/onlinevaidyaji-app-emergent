// Admin — Staff / Team management (super_admin can add/remove/reset admins).
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, RefreshControl, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import * as Clipboard from "expo-clipboard";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function AdminStaff() {
  const router = useRouter();
  const { user: me } = useAuth();
  const isSuper = me?.admin_role === "super_admin";
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tempPwModal, setTempPwModal] = useState<{ email: string; temp: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.adminListStaff();
      setItems(rows);
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not load staff"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (name.trim().length < 2) { Alert.alert("Name required"); return; }
    if (!email.includes("@")) { Alert.alert("Valid email required"); return; }
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      Alert.alert("Weak password", "Min 8 chars, letters + digits."); return;
    }
    setCreating(true);
    try {
      await api.adminCreateStaff(name.trim(), email.trim().toLowerCase(), pw);
      setTempPwModal({ email: email.trim().toLowerCase(), temp: pw });
      setName(""); setEmail(""); setPw("");
      setShowAdd(false);
      await load();
    } catch (e: any) { Alert.alert("Error", e?.message || "Could not create"); }
    finally { setCreating(false); }
  }

  async function resetPw(s: any) {
    Alert.prompt?.(
      "Reset password for " + s.email,
      "Enter a NEW temporary password (min 8 chars, letters+digits)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          onPress: async (v?: string) => {
            const val = (v || "").trim();
            if (val.length < 8) { Alert.alert("Too short"); return; }
            try {
              const r = await api.adminResetStaffPassword(s.id, val);
              setTempPwModal({ email: s.email, temp: r.temp_password });
              await load();
            } catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
          },
        },
      ],
      "plain-text",
    );
  }

  async function del(s: any) {
    Alert.alert("Remove " + s.email + "?", "They will lose admin access immediately.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try { await api.adminDeleteStaff(s.id); await load(); }
          catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
        },
      },
    ]);
  }

  async function copyTemp() {
    if (!tempPwModal) return;
    await Clipboard.setStringAsync(tempPwModal.temp);
    Alert.alert("Copied", "Temporary password copied.");
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="staff-back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Admin</Text>
          <Text style={styles.title}>Team & Staff</Text>
        </View>
        {isSuper && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)} testID="staff-add">
            <Feather name="user-plus" size={14} color={COLORS.surface} />
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        )}
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
          {!isSuper && (
            <View style={styles.notice}>
              <Feather name="info" size={14} color={COLORS.accent} />
              <Text style={styles.noticeText}>
                Only the Super Admin can add or remove team members. You can still view the roster.
              </Text>
            </View>
          )}
          {items.map((s) => {
            const isThisSuper = s.admin_role === "super_admin";
            const isMe = s.id === me?.id;
            return (
              <View key={s.id} style={styles.card}>
                <View style={styles.avatar}>
                  <Text style={styles.initial}>{(s.name || "A").slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={styles.name}>{s.name}</Text>
                    {isThisSuper && (
                      <View style={styles.superChip}>
                        <Feather name="star" size={9} color={COLORS.surface} />
                        <Text style={styles.superText}>SUPER ADMIN</Text>
                      </View>
                    )}
                    {isMe && <Text style={styles.meTag}>(you)</Text>}
                  </View>
                  <Text style={styles.email}>{s.email}</Text>
                  <Text style={styles.since}>Since {new Date(s.created_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</Text>
                  {s.must_change_password && (
                    <Text style={styles.warn}>⚠️ Must change password on next login</Text>
                  )}
                </View>
                {isSuper && !isThisSuper && !isMe && (
                  <View style={styles.rowActions}>
                    <TouchableOpacity onPress={() => resetPw(s)} style={styles.actBtn} testID={`staff-reset-${s.id}`}>
                      <Feather name="key" size={13} color={COLORS.brand} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => del(s)} style={styles.actBtn} testID={`staff-del-${s.id}`}>
                      <Feather name="trash-2" size={13} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Add-staff modal */}
      <Modal transparent visible={showAdd} animationType="fade" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.bdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Invite backend team member</Text>
            <Text style={styles.sheetBody}>They will be forced to change the temporary password on first login.</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={COLORS.textMuted} testID="staff-name" />
            <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={COLORS.textMuted} testID="staff-email" />
            <View style={styles.pwWrap}>
              <TextInput style={styles.pwInput} value={pw} onChangeText={setPw} placeholder="Temporary password" secureTextEntry={!showPw} autoCapitalize="none" placeholderTextColor={COLORS.textMuted} testID="staff-pw" />
              <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Feather name={showPw ? "eye-off" : "eye"} size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.createBtn, creating && { opacity: 0.5 }]} disabled={creating} onPress={create} testID="staff-create">
                {creating ? <ActivityIndicator color={COLORS.surface} size="small" /> : <Text style={styles.createText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Temp password modal */}
      <Modal transparent visible={!!tempPwModal} animationType="fade" onRequestClose={() => setTempPwModal(null)}>
        <View style={styles.bdrop}>
          <View style={styles.sheet}>
            <View style={styles.icon}>
              <Feather name="key" size={22} color={COLORS.surface} />
            </View>
            <Text style={styles.sheetTitle}>Temporary password</Text>
            <Text style={styles.sheetBody}>Share with <Text style={{ fontWeight: "700" }}>{tempPwModal?.email}</Text> via WhatsApp / secure channel. They must change it on first login.</Text>
            <View style={styles.tempBox}>
              <Text selectable style={styles.tempText}>{tempPwModal?.temp}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, width: "100%" }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={copyTemp}>
                <Feather name="copy" size={12} color={COLORS.brand} />
                <Text style={[styles.cancelText, { color: COLORS.brand }]}>  Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createBtn} onPress={() => setTempPwModal(null)}>
                <Text style={styles.createText}>Done</Text>
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
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill },
  addText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  notice: { flexDirection: "row", gap: 6, alignItems: "center", padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  noticeText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  card: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  initial: { color: COLORS.surface, fontWeight: "700", fontSize: 18 },
  name: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  email: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  since: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  warn: { color: COLORS.warning, fontSize: 11, fontWeight: "700", marginTop: 4 },
  superChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: COLORS.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.pill },
  superText: { color: COLORS.surface, fontSize: 8, fontWeight: "700", letterSpacing: 1 },
  meTag: { color: COLORS.textMuted, fontSize: 11 },
  rowActions: { flexDirection: "row", gap: 4 },
  actBtn: { padding: 8, borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceAlt },
  bdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  sheet: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, width: "100%", maxWidth: 440, alignItems: "center" },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginBottom: 4 },
  sheetBody: { color: COLORS.textSecondary, fontSize: 12, textAlign: "center", marginBottom: SPACING.md, lineHeight: 18 },
  input: { width: "100%", padding: SPACING.md, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  pwWrap: { width: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  pwInput: { flex: 1, paddingVertical: SPACING.md, color: COLORS.textPrimary },
  cancelBtn: { flex: 1, flexDirection: "row", justifyContent: "center", paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceAlt, alignItems: "center" },
  cancelText: { color: COLORS.textPrimary, fontWeight: "700" },
  createBtn: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand, alignItems: "center" },
  createText: { color: COLORS.surface, fontWeight: "700" },
  tempBox: { padding: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md, width: "100%", alignItems: "center" },
  tempText: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontSize: 16, color: COLORS.brand, fontWeight: "700", letterSpacing: 1 },
});
