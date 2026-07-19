import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!email.trim() || !password.trim()) {
      setErr("Enter email & password");
      return;
    }
    setBusy(true);
    try {
      const user = await login(email.trim().toLowerCase(), password);
      if (user?.is_admin) router.replace("/admin/dashboard");
      else router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} testID="login-back" style={{ width: 40 }}>
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.eyebrow}>Welcome back</Text>
          <Text style={styles.title}>Sign in to{"\n"}your Vaidhyaji</Text>

          <View style={{ marginTop: SPACING.lg }}>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={COLORS.textMuted} testID="login-email" />

            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={COLORS.textMuted} testID="login-password" />

            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

            <TouchableOpacity style={[styles.cta, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} testID="login-submit">
              <Text style={styles.ctaText}>{busy ? "Signing in…" : "Sign in"}</Text>
              <Feather name="arrow-right" size={18} color={COLORS.surface} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push("/auth/role")} style={{ alignSelf: "center", marginTop: SPACING.md }} testID="login-register-link">
              <Text style={{ color: COLORS.textSecondary }}>
                New here? <Text style={{ color: COLORS.brand, fontWeight: "700" }}>Create account</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  eyebrow: { marginTop: SPACING.md, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 40, color: COLORS.textPrimary, marginTop: 6, lineHeight: 44, letterSpacing: -1 },
  label: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700" },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  err: { color: COLORS.error, marginTop: SPACING.md, fontSize: 13 },
  cta: {
    marginTop: SPACING.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brand,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    gap: 8,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
});
