// Forgot Password — user requests admin-mediated reset (option C).
import { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    const em = email.trim().toLowerCase();
    if (!em || !em.includes("@")) {
      setErr("Enter your registered email");
      return;
    }
    setBusy(true);
    try {
      await api.requestPasswordReset(em);
      setDone(true);
    } catch (e: any) {
      setErr(e.message || "Could not submit request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} testID="fp-back" style={{ width: 40 }}>
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.eyebrow}>Account recovery</Text>
          <Text style={styles.title}>Forgot{"\n"}password?</Text>

          {done ? (
            <View style={styles.doneCard}>
              <View style={styles.checkIcon}>
                <Feather name="check-circle" size={28} color={COLORS.brand} />
              </View>
              <Text style={styles.doneTitle}>Request received</Text>
              <Text style={styles.doneBody}>
                If an account exists for that email, our VaidyaJi admin team will
                verify it and reach out to you within 24 hours with a temporary password.
                You will be asked to change it on your next login.
              </Text>
              <Text style={styles.doneBody}>
                Need faster help? Message us at{" "}
                <Text style={{ color: COLORS.brand, fontWeight: "700" }}>info@onlinevaidyaji.com</Text>.
              </Text>
              <TouchableOpacity
                style={styles.homeBtn}
                onPress={() => router.replace("/auth/login")}
                testID="fp-back-to-login"
              >
                <Text style={styles.homeText}>Back to login</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.body}>
                Enter your registered email below. Our admin team will manually verify
                and share a secure temporary password with you.
              </Text>

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
                testID="fp-email"
              />

              {err ? <Text style={styles.err}>{err}</Text> : null}

              <TouchableOpacity
                style={[styles.cta, busy && { opacity: 0.6 }]}
                onPress={submit}
                disabled={busy}
                testID="fp-submit"
              >
                {busy ? <ActivityIndicator color={COLORS.surface} /> : (
                  <>
                    <Text style={styles.ctaText}>Send reset request</Text>
                    <Feather name="send" size={16} color={COLORS.surface} />
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.infoBox}>
                <Feather name="shield" size={14} color={COLORS.brand} />
                <Text style={styles.infoText}>
                  For your safety, we never reveal whether an email is registered. If it is,
                  our team will contact you personally with next steps.
                </Text>
              </View>
            </>
          )}
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
  body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, marginTop: SPACING.md },
  label: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginTop: SPACING.md, marginBottom: 6, fontWeight: "700" },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 14,
    fontSize: 15, color: COLORS.textPrimary,
  },
  err: { color: COLORS.error, marginTop: SPACING.md, fontSize: 13 },
  cta: {
    marginTop: SPACING.lg, flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, gap: 8,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
  infoBox: {
    marginTop: SPACING.lg, padding: SPACING.md,
    backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    flexDirection: "row", gap: SPACING.sm,
  },
  infoText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  doneCard: {
    marginTop: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center",
  },
  checkIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  doneTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  doneBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: SPACING.sm },
  homeBtn: {
    marginTop: SPACING.lg,
    paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: COLORS.brand, borderRadius: RADIUS.pill,
  },
  homeText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
});
