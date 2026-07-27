// Change Password — mandatory screen after admin issues a temp password.
import { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function ChangePassword() {
  const router = useRouter();
  const { user, refresh, logout } = useAuth();
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (newPw.length < 8) {
      setErr("Password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmPw) {
      setErr("Passwords do not match");
      return;
    }
    const hasLetter = /[A-Za-z]/.test(newPw);
    const hasDigit = /[0-9]/.test(newPw);
    if (!hasLetter || !hasDigit) {
      setErr("Password must contain letters AND digits");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(newPw, confirmPw);
      await refresh();
      Alert.alert("Password updated", "You're all set!", [
        {
          text: "Continue",
          onPress: () => {
            if (user?.is_admin) router.replace("/admin/dashboard");
            else router.replace("/(tabs)/home");
          },
        },
      ]);
    } catch (e: any) {
      setErr(e.message || "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    Alert.alert(
      "Sign out?",
      "You must change your temporary password before continuing. If you sign out now, you'll need to log in again.",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Sign out", style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/auth/login");
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={cancel} testID="cp-cancel" style={{ width: 40 }}>
            <Feather name="x" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <View style={styles.iconBadge}>
            <Feather name="lock" size={28} color={COLORS.surface} />
          </View>

          <Text style={styles.eyebrow}>Required step</Text>
          <Text style={styles.title}>Set a new{"\n"}password</Text>

          <Text style={styles.body}>
            For security, please replace the temporary password sent to you.
            Choose something you&apos;ll remember — at least 8 characters, with letters and digits.
          </Text>

          <Text style={styles.label}>New password</Text>
          <View style={styles.pwWrap}>
            <TextInput
              style={styles.pwInput}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry={!showNew}
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              placeholderTextColor={COLORS.textMuted}
              testID="cp-new"
            />
            <TouchableOpacity onPress={() => setShowNew((s) => !s)} style={styles.eyeBtn} testID="cp-show-new" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Feather name={showNew ? "eye-off" : "eye"} size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Confirm password</Text>
          <View style={styles.pwWrap}>
            <TextInput
              style={styles.pwInput}
              value={confirmPw}
              onChangeText={setConfirmPw}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="Re-enter password"
              placeholderTextColor={COLORS.textMuted}
              testID="cp-confirm"
            />
            <TouchableOpacity onPress={() => setShowConfirm((s) => !s)} style={styles.eyeBtn} testID="cp-show-confirm" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Feather name={showConfirm ? "eye-off" : "eye"} size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          {err ? <Text style={styles.err}>{err}</Text> : null}

          <TouchableOpacity style={[styles.cta, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} testID="cp-submit">
            {busy ? <ActivityIndicator color={COLORS.surface} /> : (
              <>
                <Text style={styles.ctaText}>Update password</Text>
                <Feather name="check" size={16} color={COLORS.surface} />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  iconBadge: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center",
    marginTop: SPACING.lg, marginBottom: SPACING.md,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 36, color: COLORS.textPrimary, marginTop: 4, lineHeight: 40, letterSpacing: -1 },
  body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, marginTop: SPACING.md },
  label: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700" },
  pwWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md,
  },
  pwInput: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.textPrimary },
  eyeBtn: { padding: 6 },
  err: { color: COLORS.error, marginTop: SPACING.md, fontSize: 13 },
  cta: {
    marginTop: SPACING.lg, flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, gap: 8,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
});
