import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";

export default function Register() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: "patient" | "doctor" }>();
  const isPatient = role !== "doctor";
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!name.trim() || !email.trim() || !password.trim()) {
      setErr("Please fill all required fields");
      return;
    }
    // Phone mandatory + Indian 10-digit validation
    const cleanedPhone = phone.replace(/[^0-9]/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(cleanedPhone)) {
      setErr("Enter a valid 10-digit Indian mobile number");
      return;
    }
    if (!isPatient && !regNumber.trim()) {
      setErr("Registration number is required for doctors");
      return;
    }
    setBusy(true);
    try {
      await register({
        name,
        email: email.trim().toLowerCase(),
        password,
        role: isPatient ? "patient" : "doctor",
        phone: cleanedPhone,
        registration_number: isPatient ? undefined : regNumber,
      });
      router.replace({ pathname: "/auth/otp", params: { phone: cleanedPhone } });
    } catch (e: any) {
      setErr(e.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} testID="register-back" style={{ width: 40 }}>
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.eyebrow}>{isPatient ? "Patient sign-up" : "Doctor sign-up"}</Text>
          <Text style={styles.title}>Create your{"\n"}account</Text>
          <Text style={styles.sub}>
            {isPatient
              ? "Free forever for wellness tracking."
              : "Verification takes ~24 hrs after documents are uploaded."}
          </Text>

          <View style={{ marginTop: SPACING.lg }}>
            <Label>Full name</Label>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Aarav Kumar" placeholderTextColor={COLORS.textMuted} testID="register-name" />

            <Label>Email</Label>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={COLORS.textMuted} testID="register-email" />

            <Label>Password</Label>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 6 characters" placeholderTextColor={COLORS.textMuted} testID="register-password" />

            <Label>Phone Number *</Label>
            <View style={styles.phoneRow}>
              <View style={styles.phonePrefix}>
                <Text style={styles.phonePrefixText}>+91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, "").slice(0, 10))}
                keyboardType="phone-pad"
                placeholder="98xxxxxxxx"
                placeholderTextColor={COLORS.textMuted}
                maxLength={10}
                testID="register-phone"
              />
            </View>

            {!isPatient && (
              <>
                <Label>AYUSH Registration No.</Label>
                <TextInput
                  style={styles.input}
                  value={regNumber}
                  onChangeText={setRegNumber}
                  autoCapitalize="characters"
                  placeholder="e.g. AYUSH/BAMS/2016/12345"
                  placeholderTextColor={COLORS.textMuted}
                  testID="register-regnumber"
                />
                <View style={styles.docBox}>
                  <Feather name="check-circle" size={16} color={COLORS.success} />
                  <Text style={styles.docText}>Qualification certificate attached (demo)</Text>
                </View>
              </>
            )}

            {err ? <Text style={styles.err} testID="register-error">{err}</Text> : null}

            <TouchableOpacity
              style={[styles.cta, busy && { opacity: 0.6 }]}
              onPress={submit}
              disabled={busy}
              testID="register-submit"
            >
              <Text style={styles.ctaText}>{busy ? "Creating account…" : "Continue"}</Text>
              <Feather name="arrow-right" size={18} color={COLORS.surface} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push("/auth/login")} style={{ alignSelf: "center", marginTop: SPACING.md }} testID="register-signin-link">
              <Text style={{ color: COLORS.textSecondary }}>
                Already have an account? <Text style={{ color: COLORS.brand, fontWeight: "700" }}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, paddingBottom: SPACING.xl },
  eyebrow: { marginTop: SPACING.md, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 40, color: COLORS.textPrimary, marginTop: 6, lineHeight: 44, letterSpacing: -1 },
  sub: { color: COLORS.textSecondary, marginTop: 8, fontSize: 14, lineHeight: 20 },
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
  docBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 10, padding: 12, backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  docText: { color: COLORS.textSecondary, fontSize: 13 },
  phoneRow: { flexDirection: "row", gap: 8 },
  phonePrefix: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  phonePrefixText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  phoneInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
    letterSpacing: 1,
  },
});
