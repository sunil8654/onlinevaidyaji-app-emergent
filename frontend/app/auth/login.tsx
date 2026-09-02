import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { useGoogleAuth } from "@/src/hooks/useGoogleAuth";
import { GoogleButton } from "@/src/components/GoogleButton";

const COPY = {
  or: { en: "OR", hi: "YA" },
  google: { en: "Continue with Google", hi: "Google se aage badhein" },
  googleFail: { en: "Could not sign in with Google. Please try again.", hi: "Google se sign-in nahi ho paaya." },
};

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const { lang } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Route the user based on the Emergent session response.
  const { startGoogle, googleBusy } = useGoogleAuth({
    onSuccess: (res) => {
      // If the returning user is missing a language preference, treat them
      // as onboarding-incomplete and send them through the language step.
      if (res.is_new || !res.user?.preferred_language) {
        router.replace("/signup/language");
      } else if (res.user?.is_admin) {
        router.replace("/admin/dashboard");
      } else if (res.user?.role === "doctor") {
        router.replace("/doctor/home");
      } else {
        router.replace("/(tabs)/home");
      }
    },
    onError: (msg) => setErr(msg || COPY.googleFail[lang]),
  });

  const submit = async () => {
    setErr("");
    if (!email.trim() || !password.trim()) {
      setErr("Enter email & password");
      return;
    }
    setBusy(true);
    try {
      const { user, must_change_password } = await login(email.trim().toLowerCase(), password);
      if (must_change_password) {
        router.replace("/auth/change-password");
      } else if (user?.is_admin) {
        router.replace("/admin/dashboard");
      } else if (user?.role === "doctor") {
        router.replace("/doctor/home");
      } else {
        router.replace("/(tabs)/home");
      }
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
          <Text style={styles.title}>Sign in to{"\n"}your VaidyaJi</Text>

          {/* Google sign-in first — matches signup flow so users who created their
              account via Google can log back in the same way. */}
          <View style={{ marginTop: SPACING.lg }}>
            <GoogleButton
              onPress={startGoogle}
              busy={googleBusy}
              label={COPY.google[lang]}
              testID="login-google"
            />

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>{COPY.or[lang]}</Text>
              <View style={styles.line} />
            </View>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
              placeholderTextColor={COLORS.textMuted}
              testID="login-email"
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.pwWrap}>
              <TextInput
                style={styles.pwInput}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoComplete="password"
                placeholder="••••••••"
                placeholderTextColor={COLORS.textMuted}
                testID="login-password"
              />
              <TouchableOpacity
                onPress={() => setShowPw((s) => !s)}
                style={styles.eyeBtn}
                testID="login-show-pw"
                accessibilityLabel={showPw ? "Hide password" : "Show password"}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Feather name={showPw ? "eye-off" : "eye"} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => router.push("/auth/forgot-password")}
              style={{ alignSelf: "flex-end", marginTop: 8 }}
              testID="login-forgot"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

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
  pwWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  pwInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  eyeBtn: {
    padding: 6,
  },
  divider: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginVertical: SPACING.md },
  line: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { color: COLORS.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  forgotText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
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
