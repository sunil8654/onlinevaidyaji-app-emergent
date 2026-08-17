// OTP verify + capture name (+ optional email) for new users.
import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const COPY = {
  headTitle: { en: "Verify your number", hi: "Apna number verify karein" },
  headSub: {
    en: "We sent a 6-digit code to +91",
    hi: "Humne 6-digit ka code bheja hai +91 par",
  },
  otpLabel: { en: "Enter OTP", hi: "OTP daalein" },
  nameLabel: { en: "Your full name", hi: "Aapka poora naam" },
  namePlaceholder: { en: "e.g. Priya Sharma", hi: "e.g. Priya Sharma" },
  emailLabel: { en: "Email (optional — for app guide)", hi: "Email (optional — app guide ke liye)" },
  emailPlaceholder: { en: "Email daalein — hum aapko app guide bhejenge", hi: "Email daalein — hum aapko app guide bhejenge" },
  verify: { en: "Verify & Continue", hi: "Verify karke Aage badhein" },
  verifying: { en: "Verifying…", hi: "Verify kar rahe hain…" },
  resend: { en: "Resend OTP", hi: "OTP dobara bhejein" },
  resendIn: { en: (s: number) => `Resend in ${s}s`, hi: (s: number) => `${s}s mein dobara bhejein` },
  freeConsult: {
    en: "Your FREE consultation is reserved! 🎉",
    hi: "Aapka FREE consultation reserve ho gaya! 🎉",
  },
  wrongNumber: { en: "Change number", hi: "Number badlein" },
  devHint: {
    en: "For testing use OTP: 123456",
    hi: "Testing ke liye OTP: 123456",
  },
};

const RESEND_COOLDOWN = 30;

export default function OtpVerify() {
  const router = useRouter();
  const { lang } = useI18n();
  const { applySession } = useAuth();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(intervalRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => intervalRef.current && clearInterval(intervalRef.current);
  }, []);

  async function verify() {
    if (otp.length < 4) return;
    if (!name.trim()) {
      Alert.alert(lang === "hi" ? "Naam zaroori hai" : "Name required", lang === "hi" ? "Kripya apna naam daalein." : "Please enter your name.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.verifyPhoneOtp({
        phone: phone as string,
        otp,
        name: name.trim(),
        email: email.trim() || undefined,
      });
      await applySession(res.token, res.user);
      Alert.alert(
        lang === "hi" ? "Ho gaya!" : "You're in!",
        COPY.freeConsult[lang],
        [{ text: "OK", onPress: () => {
          // New users → language pick then quiz. Existing users → home.
          if (res.is_new || !res.user.preferred_language) router.replace("/signup/language");
          else router.replace("/");
        }}],
      );
    } catch (e: any) {
      Alert.alert(lang === "hi" ? "OTP galat" : "Wrong OTP", e?.message || "Try again");
    } finally { setBusy(false); }
  }

  async function resend() {
    if (cooldown > 0) return;
    try {
      await api.sendPhoneOtp(phone as string);
      setCooldown(RESEND_COOLDOWN);
      const iv = setInterval(() => setCooldown((c) => c <= 1 ? (clearInterval(iv), 0) : c - 1), 1000);
      intervalRef.current = iv;
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="otp-back">
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <View style={styles.iconRing}>
            <Feather name="shield" size={26} color={COLORS.brand} />
          </View>

          <Text style={styles.title}>{COPY.headTitle[lang]}</Text>
          <Text style={styles.sub}>{COPY.headSub[lang]} {phone} · <Text style={styles.changeLink} onPress={() => router.back()}>{COPY.wrongNumber[lang]}</Text></Text>

          <Text style={styles.label}>{COPY.otpLabel[lang]}</Text>
          <TextInput
            style={styles.otpInput}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            testID="otp-input"
          />
          <Text style={styles.devHint}>{COPY.devHint[lang]}</Text>

          <Text style={styles.label}>{COPY.nameLabel[lang]}</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder={COPY.namePlaceholder[lang]}
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="words"
            testID="otp-name"
          />

          <Text style={styles.label}>{COPY.emailLabel[lang]}</Text>
          <TextInput
            style={styles.textInput}
            value={email}
            onChangeText={setEmail}
            placeholder={COPY.emailPlaceholder[lang]}
            placeholderTextColor={COLORS.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            testID="otp-email"
          />

          <TouchableOpacity
            onPress={verify}
            disabled={otp.length < 4 || !name.trim() || busy}
            style={[styles.cta, (otp.length < 4 || !name.trim() || busy) && { opacity: 0.55 }]}
            testID="otp-verify"
          >
            {busy ? <ActivityIndicator size="small" color={COLORS.surface} /> : <Text style={styles.ctaText}>{COPY.verify[lang]}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={resend} disabled={cooldown > 0} style={styles.resend} testID="otp-resend">
            <Text style={[styles.resendText, cooldown > 0 && { opacity: 0.5 }]}>
              {cooldown > 0 ? COPY.resendIn[lang](cooldown) : COPY.resend[lang]}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  back: { width: 40, marginBottom: SPACING.md },
  iconRing: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.brand, alignItems: "center", justifyContent: "center", marginBottom: SPACING.md },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  sub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: SPACING.lg, lineHeight: 19 },
  changeLink: { color: COLORS.brand, fontWeight: "700" },
  label: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600", marginTop: SPACING.md, marginBottom: 8 },
  otpInput: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 16,
    color: COLORS.textPrimary, fontSize: 24, letterSpacing: 12, textAlign: "center", fontWeight: "800",
  },
  devHint: { color: COLORS.textMuted, fontSize: 11, textAlign: "center", marginTop: 6, fontStyle: "italic" },
  textInput: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 14,
    color: COLORS.textPrimary, fontSize: 15,
  },
  cta: { marginTop: SPACING.lg, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, alignItems: "center", minHeight: 56, justifyContent: "center" },
  ctaText: { color: COLORS.surface, fontWeight: "800", fontSize: 15, letterSpacing: 0.3 },
  resend: { marginTop: SPACING.md, alignSelf: "center", padding: 8 },
  resendText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
});
