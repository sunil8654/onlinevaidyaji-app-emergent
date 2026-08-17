// Sign-up funnel entry — FREE consult banner · Google + Phone OTP · Language toggle.
// Spec-perfect bilingual copy for the FIRST touchpoint patients see.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Platform, Image,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

WebBrowser.maybeCompleteAuthSession();

// Copy is inline (not i18n dictionary) so it matches the spec verbatim.
const COPY = {
  banner: {
    en: "🎁 Sign Up & Get Your FIRST DOCTOR CONSULTATION FREE",
    hi: "🎁 Sign Up karein aur paayein PEHLA DOCTOR CONSULTATION बिल्कुल FREE",
  },
  title: { en: "Welcome to Online Vaidhyaji", hi: "Online Vaidhyaji mein Swagat hai" },
  sub: { en: "Verified AYUSH doctors · Hindi + English · Consult from home", hi: "Verified AYUSH doctors · Hindi + English · Ghar baithe consult karein" },
  google: { en: "Continue with Google", hi: "Google se aage badhein" },
  phone: { en: "Continue with Phone Number", hi: "Phone Number se aage badhein" },
  or: { en: "OR", hi: "YA" },
  enterPhone: { en: "Enter your 10-digit mobile number", hi: "Apna 10-digit mobile number daalein" },
  sendOtp: { en: "Send OTP", hi: "OTP Bhejein" },
  sending: { en: "Sending…", hi: "Bhej rahe hain…" },
  existing: { en: "Already have an account?", hi: "Pehle se account hai?" },
  signIn: { en: "Sign in", hi: "Sign in" },
  disclaimer: {
    en: "By continuing you agree to our Terms & Privacy Policy. This service supports your health under registered AYUSH practitioners.",
    hi: "Aage badhne se aap hamari Terms & Privacy Policy se sehmat hain. Yeh service registered AYUSH practitioners ke tehat aapki health support karti hai.",
  },
  invalidPhone: { en: "Please enter a valid 10-digit Indian mobile number.", hi: "Kripya valid 10-digit mobile number daalein." },
  googleFail: { en: "Could not sign in with Google. Please try again.", hi: "Google se sign-in nahi ho paaya. Kripya dobara try karein." },
};

const AUTH_URL = (redirect: string) => `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
const sentSessionIds = new Set<string>();

function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function Signup() {
  const router = useRouter();
  const { lang, setLang } = useI18n();
  const { applySession } = useAuth();
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogleCallback = useCallback(async (url: string | null) => {
    const sessionId = extractSessionId(url);
    if (!sessionId || sentSessionIds.has(sessionId)) return;
    sentSessionIds.add(sessionId);
    try {
      setGoogleBusy(true);
      const res = await api.googleSession(sessionId);
      await applySession(res.token, res.user);
      // New Google users always land in language pick; returning users go straight home.
      if (res.is_new || !res.user.preferred_language) router.replace("/signup/language");
      else router.replace("/");
    } catch (e: any) {
      Alert.alert("Sign in failed", e?.message || COPY.googleFail[lang]);
    } finally {
      setGoogleBusy(false);
    }
  }, [applySession, lang, router]);

  // Handle cold-start deep link + hot deep link.
  useEffect(() => {
    Linking.getInitialURL().then(handleGoogleCallback);
    const sub = Linking.addEventListener("url", (evt) => handleGoogleCallback(evt.url));
    return () => sub.remove();
  }, [handleGoogleCallback]);

  async function startGoogle() {
    try {
      setGoogleBusy(true);
      const redirect = Platform.OS === "web"
        ? (typeof window !== "undefined" ? window.location.origin + "/" : "")
        : Linking.createURL("");
      const authUrl = AUTH_URL(redirect);
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      const url = (result as any)?.url || null;
      // Fall through to Linking listener if url is empty (Android often returns "dismiss").
      if (url) handleGoogleCallback(url);
    } catch (e: any) {
      Alert.alert("Sign in failed", e?.message || COPY.googleFail[lang]);
    } finally {
      setGoogleBusy(false);
    }
  }

  function isValidIndianPhone(v: string) {
    const digits = v.replace(/\D/g, "").replace(/^91/, "");
    return digits.length === 10 && "6789".includes(digits[0]);
  }

  async function sendOtp() {
    if (!isValidIndianPhone(phone)) {
      Alert.alert(lang === "hi" ? "Galat number" : "Invalid number", COPY.invalidPhone[lang]);
      return;
    }
    setSending(true);
    try {
      const res = await api.sendPhoneOtp(phone);
      // Show dev hint in an alert so mock OTP is easy in testing
      if (res.dev_hint) console.log(res.dev_hint);
      router.push({ pathname: "/signup/otp", params: { phone } });
    } catch (e: any) {
      Alert.alert(lang === "hi" ? "Error" : "Error", e?.message || "Try again");
    } finally { setSending(false); }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.langRow}>
        <TouchableOpacity
          onPress={() => setLang(lang === "en" ? "hi" : "en")}
          style={styles.langBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="signup-lang-toggle"
        >
          <Feather name="globe" size={12} color={COLORS.brand} />
          <Text style={styles.langText}>{lang === "en" ? "हिन्दी" : "English"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Free-consult banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{COPY.banner[lang]}</Text>
        </View>

        {/* Brand */}
        <View style={styles.brandBlock}>
          <View style={styles.logoRing}>
            <Feather name="heart" size={32} color={COLORS.brand} />
          </View>
          <Text style={styles.title}>{COPY.title[lang]}</Text>
          <Text style={styles.sub}>{COPY.sub[lang]}</Text>
        </View>

        {/* Google button */}
        <TouchableOpacity
          style={[styles.googleBtn, googleBusy && { opacity: 0.6 }]}
          onPress={startGoogle}
          disabled={googleBusy}
          activeOpacity={0.9}
          testID="signup-google"
        >
          {googleBusy ? (
            <ActivityIndicator size="small" color={COLORS.textPrimary} />
          ) : (
            <>
              <Image
                source={{ uri: "https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" }}
                style={styles.googleLogo}
              />
              <Text style={styles.googleText}>{COPY.google[lang]}</Text>
            </>
          )}
        </TouchableOpacity>

        {/* OR divider */}
        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.dividerText}>{COPY.or[lang]}</Text>
          <View style={styles.line} />
        </View>

        {/* Phone entry */}
        <Text style={styles.label}>{COPY.enterPhone[lang]}</Text>
        <View style={styles.phoneRow}>
          <View style={styles.ccBox}><Text style={styles.ccText}>+91</Text></View>
          <TextInput
            style={styles.phoneInput}
            value={phone}
            onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
            placeholder="98765 43210"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="phone-pad"
            maxLength={10}
            testID="signup-phone"
          />
        </View>

        <TouchableOpacity
          style={[styles.phoneCta, (!isValidIndianPhone(phone) || sending) && { opacity: 0.55 }]}
          onPress={sendOtp}
          disabled={!isValidIndianPhone(phone) || sending}
          testID="signup-send-otp"
        >
          {sending ? (
            <ActivityIndicator size="small" color={COLORS.surface} />
          ) : (
            <>
              <Feather name="smartphone" size={16} color={COLORS.surface} />
              <Text style={styles.phoneCtaText}>{COPY.phone[lang]}</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Sign-in link for existing users */}
        <TouchableOpacity
          onPress={() => router.push("/auth/login")}
          style={{ alignSelf: "center", marginTop: SPACING.lg }}
          testID="signup-signin"
        >
          <Text style={styles.linkText}>
            {COPY.existing[lang]}  <Text style={{ color: COLORS.brand, fontWeight: "700" }}>{COPY.signIn[lang]}</Text>
          </Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>{COPY.disclaimer[lang]}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  langRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  langText: { color: COLORS.brand, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  banner: {
    backgroundColor: "#ffe082",
    paddingHorizontal: SPACING.md, paddingVertical: 14, borderRadius: RADIUS.md,
    marginBottom: SPACING.lg,
    borderWidth: 1, borderColor: "#f2c94c",
  },
  bannerText: { textAlign: "center", fontWeight: "800", color: "#4a3a00", fontSize: 14, lineHeight: 19 },
  brandBlock: { alignItems: "center", marginBottom: SPACING.lg },
  logoRing: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, textAlign: "center" },
  sub: { color: COLORS.textSecondary, fontSize: 13, textAlign: "center", marginTop: 6, lineHeight: 19 },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 14, borderRadius: RADIUS.pill, marginTop: SPACING.sm, minHeight: 56,
  },
  googleLogo: { width: 20, height: 20 },
  googleText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  divider: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginVertical: SPACING.lg },
  line: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { color: COLORS.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  label: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  phoneRow: { flexDirection: "row", gap: 8 },
  ccBox: { paddingHorizontal: 14, justifyContent: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  ccText: { color: COLORS.textPrimary, fontWeight: "700" },
  phoneInput: {
    flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 14,
    color: COLORS.textPrimary, fontSize: 16, letterSpacing: 1,
  },
  phoneCta: {
    marginTop: SPACING.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill,
    minHeight: 56,
  },
  phoneCtaText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
  linkText: { color: COLORS.textSecondary, fontSize: 14 },
  disclaimer: { color: COLORS.textMuted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: SPACING.lg },
});
