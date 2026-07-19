import { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";

const CELLS = 4;

export default function Otp() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone?: string }>();
  const { user } = useAuth();
  const [digits, setDigits] = useState<string[]>(Array(CELLS).fill(""));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const refs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const onChange = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = clean;
      return next;
    });
    if (clean && i < CELLS - 1) refs.current[i + 1]?.focus();
  };

  const verify = async () => {
    setErr("");
    const code = digits.join("");
    if (code.length !== CELLS) {
      setErr("Enter the 4-digit code");
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 500));
    setBusy(false);
    // Demo: any 4 digits accepted
    if (user?.role === "patient") router.replace("/auth/health-profile");
    else router.replace("/(tabs)/home");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ margin: SPACING.md, width: 40 }} testID="otp-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>

        <View style={styles.body}>
          <Text style={styles.eyebrow}>One-time password</Text>
          <Text style={styles.title}>Verify your{"\n"}mobile number</Text>
          <Text style={styles.sub}>
            We&apos;ve sent a 4-digit code to {phone || "your phone"}.{"\n"}
            (Demo mode — any 4 digits work.)
          </Text>

          <View style={styles.cells}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={(r) => { refs.current[i] = r; }}
                style={[styles.cell, d && styles.cellFilled]}
                keyboardType="number-pad"
                maxLength={1}
                value={d}
                onChangeText={(v) => onChange(i, v)}
                testID={`otp-cell-${i}`}
              />
            ))}
          </View>

          {err ? <Text style={styles.err}>{err}</Text> : null}

          <TouchableOpacity style={[styles.cta, busy && { opacity: 0.6 }]} onPress={verify} disabled={busy} testID="otp-verify">
            <Text style={styles.ctaText}>{busy ? "Verifying…" : "Verify & continue"}</Text>
            <Feather name="arrow-right" size={18} color={COLORS.surface} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { if (seconds === 0) setSeconds(30); }}
            disabled={seconds > 0}
            style={{ alignSelf: "center", marginTop: SPACING.md }}
            testID="otp-resend"
          >
            <Text style={{ color: seconds > 0 ? COLORS.textMuted : COLORS.brand, fontWeight: "600" }}>
              {seconds > 0 ? `Resend code in ${seconds}s` : "Resend code"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  body: { flex: 1, paddingHorizontal: SPACING.lg },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 38, color: COLORS.textPrimary, marginTop: 6, lineHeight: 42, letterSpacing: -1 },
  sub: { color: COLORS.textSecondary, marginTop: 8, fontSize: 14, lineHeight: 20 },
  cells: { flexDirection: "row", gap: 12, marginTop: SPACING.lg, justifyContent: "center" },
  cell: {
    width: 60, height: 68,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, textAlign: "center",
    fontSize: 26, fontFamily: FONTS.heading, color: COLORS.textPrimary,
  },
  cellFilled: { borderColor: COLORS.brand, backgroundColor: COLORS.surfaceAlt },
  err: { color: COLORS.error, marginTop: SPACING.md, textAlign: "center" },
  cta: {
    marginTop: SPACING.lg, flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, gap: 8,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
});
