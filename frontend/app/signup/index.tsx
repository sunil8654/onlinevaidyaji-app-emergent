// Sign-up funnel entry — FREE consult banner · Google + Phone OTP · Language toggle.
// Role tabs at top: Patient (default) or AYUSH Doctor route to dedicated flows.
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

const COPY = {
  // Role tabs
  patientTab: { en: "I'm a Patient", hi: "Main Patient hoon" },
  doctorTab:  { en: "I'm an AYUSH Doctor", hi: "Main AYUSH Doctor hoon" },
  patientSubtab: { en: "Book a consultation · Get FREE first consult", hi: "Consultation book karein · Pehla FREE consult" },
  doctorSubtab:  { en: "Consult patients · Join Vaidya Charcha", hi: "Patients ko consult karein · Vaidya Charcha join karein" },
  // Doctor panel
  doctorPanelTitle: { en: "For verified AYUSH practitioners", hi: "Verified AYUSH doctors ke liye" },
  doctorPanelBody: {
    en: "Consult patients online · Manage your calendar & clinic · Join the doctors-only community. Sign-up needs your Ayurveda / Homeopathy / Unani / Siddha / Naturopathy / Yoga registration number.",
    hi: "Patients ko online consult karein · Apna calendar aur clinic manage karein · Sirf doctors ki community join karein. Sign-up ke liye Ayurveda / Homeopathy / Unani / Siddha / Naturopathy / Yoga registration number chahiye.",
  },
  doctorSignIn: { en: "Sign in as Doctor", hi: "Doctor ke roop mein sign in karein" },
  doctorRegister: { en: "Register as Doctor", hi: "Doctor ke roop mein register karein" },
  // Patient panel
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
  const [role, setRole] = useState<"patient" | "doctor">("patient");
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
      if (res.is_new || !res.user.preferred_language) router.replace("/signup/language");
      else router.replace("/");
    } catch (e: any) {
      Alert.alert("Sign in failed", e?.message || COPY.googleFail[lang]);
    } finally {
      setGoogleBusy(false);
    }
  }, [applySession, lang, router]);

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
        {/* Brand */}
        <View style={styles.brandBlock}>
          <View style={styles.logoRing}>
            <Feather name="heart" size={28} color={COLORS.brand} />
          </View>
          <Text style={styles.title}>{COPY.title[lang]}</Text>
          <Text style={styles.sub}>{COPY.sub[lang]}</Text>
        </View>

        {/* Role tabs — the "each column" the user asked for */}
        <View style={styles.roleTabs}>
          <TouchableOpacity
            style={[styles.roleTab, role === "patient" && styles.roleTabActive]}
            onPress={() => setRole("patient")}
            testID="role-tab-patient"
            activeOpacity={0.85}
          >
            <View style={[styles.roleIcon, role === "patient" && { backgroundColor: COLORS.surface }]}>
              <Feather name="user" size={22} color={role === "patient" ? COLORS.brand : COLORS.surface} />
            </View>
            <Text style={[styles.roleTitle, role === "patient" && { color: COLORS.surface }]}>{COPY.patientTab[lang]}</Text>
            <Text style={[styles.roleSubtitle, role === "patient" && { color: "rgba(255,255,255,0.9)" }]} numberOfLines={2}>
              {COPY.patientSubtab[lang]}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleTab, role === "doctor" && styles.roleTabActive]}
            onPress={() => setRole("doctor")}
            testID="role-tab-doctor"
            activeOpacity={0.85}
          >
            <View style={[styles.roleIcon, role === "doctor" && { backgroundColor: COLORS.surface }]}>
              <Feather name="award" size={22} color={role === "doctor" ? COLORS.brand : COLORS.surface} />
            </View>
            <Text style={[styles.roleTitle, role === "doctor" && { color: COLORS.surface }]}>{COPY.doctorTab[lang]}</Text>
            <Text style={[styles.roleSubtitle, role === "doctor" && { color: "rgba(255,255,255,0.9)" }]} numberOfLines={2}>
              {COPY.doctorSubtab[lang]}
            </Text>
          </TouchableOpacity>
        </View>

        {role === "patient" ? (
          <>
            {/* Free-consult banner */}
            <View style={styles.banner}>
              <Text style={styles.bannerText}>{COPY.banner[lang]}</Text>
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

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>{COPY.or[lang]}</Text>
              <View style={styles.line} />
            </View>

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

            <TouchableOpacity
              onPress={() => router.push("/auth/login")}
              style={{ alignSelf: "center", marginTop: SPACING.lg }}
              testID="signup-signin"
            >
              <Text style={styles.linkText}>
                {COPY.existing[lang]}  <Text style={{ color: COLORS.brand, fontWeight: "700" }}>{COPY.signIn[lang]}</Text>
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.doctorPanel}>
            <View style={styles.doctorHead}>
              <Feather name="shield" size={16} color={COLORS.brand} />
              <Text style={styles.doctorPanelTitle}>{COPY.doctorPanelTitle[lang]}</Text>
            </View>
            <Text style={styles.doctorPanelBody}>{COPY.doctorPanelBody[lang]}</Text>

            <TouchableOpacity
              style={styles.doctorPrimaryBtn}
              onPress={() => router.push({ pathname: "/auth/register", params: { role: "doctor" } })}
              testID="doctor-register"
            >
              <Feather name="user-plus" size={16} color={COLORS.surface} />
              <Text style={styles.doctorPrimaryText}>{COPY.doctorRegister[lang]}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.doctorSecondaryBtn}
              onPress={() => router.push("/auth/login")}
              testID="doctor-signin"
            >
              <Feather name="log-in" size={16} color={COLORS.brand} />
              <Text style={styles.doctorSecondaryText}>{COPY.doctorSignIn[lang]}</Text>
            </TouchableOpacity>

            <View style={styles.doctorFactRow}>
              <Fact icon="check-circle" text={lang === "hi" ? "Verified badge" : "Verified badge"} />
              <Fact icon="calendar" text={lang === "hi" ? "Slot calendar" : "Slot calendar"} />
              <Fact icon="users" text={lang === "hi" ? "Vaidya Charcha" : "Vaidya Charcha"} />
            </View>
          </View>
        )}

        <Text style={styles.disclaimer}>{COPY.disclaimer[lang]}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.factChip}>
      <Feather name={icon} size={10} color={COLORS.brand} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  langRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  langText: { color: COLORS.brand, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  brandBlock: { alignItems: "center", marginBottom: SPACING.md },
  logoRing: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.brand, alignItems: "center", justifyContent: "center", marginBottom: SPACING.sm },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, textAlign: "center" },
  sub: { color: COLORS.textSecondary, fontSize: 12, textAlign: "center", marginTop: 4, lineHeight: 18 },
  // Role tabs
  roleTabs: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md, marginBottom: SPACING.lg },
  roleTab: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 2, borderColor: COLORS.border, padding: SPACING.md, alignItems: "center", gap: 6, minHeight: 130 },
  roleTabActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  roleIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  roleTitle: { color: COLORS.textPrimary, fontFamily: FONTS.heading, fontSize: 14, textAlign: "center" },
  roleSubtitle: { color: COLORS.textMuted, fontSize: 10, textAlign: "center", lineHeight: 14 },
  // Patient
  banner: { backgroundColor: "#ffe082", paddingHorizontal: SPACING.md, paddingVertical: 12, borderRadius: RADIUS.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: "#f2c94c" },
  bannerText: { textAlign: "center", fontWeight: "800", color: "#4a3a00", fontSize: 13, lineHeight: 18 },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 14, borderRadius: RADIUS.pill, minHeight: 56 },
  googleLogo: { width: 20, height: 20 },
  googleText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  divider: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginVertical: SPACING.md },
  line: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { color: COLORS.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  label: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  phoneRow: { flexDirection: "row", gap: 8 },
  ccBox: { paddingHorizontal: 14, justifyContent: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  ccText: { color: COLORS.textPrimary, fontWeight: "700" },
  phoneInput: { flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 14, color: COLORS.textPrimary, fontSize: 16, letterSpacing: 1 },
  phoneCta: { marginTop: SPACING.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, minHeight: 56 },
  phoneCtaText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
  linkText: { color: COLORS.textSecondary, fontSize: 14 },
  // Doctor panel
  doctorPanel: { backgroundColor: COLORS.surface, padding: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.sm },
  doctorHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  doctorPanelTitle: { color: COLORS.brand, fontWeight: "800", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.5 },
  doctorPanelBody: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 20 },
  doctorPrimaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill, minHeight: 52, marginTop: SPACING.sm },
  doctorPrimaryText: { color: COLORS.surface, fontWeight: "800", fontSize: 14 },
  doctorSecondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill, minHeight: 52 },
  doctorSecondaryText: { color: COLORS.brand, fontWeight: "800", fontSize: 14 },
  doctorFactRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: SPACING.sm },
  factChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#ffe082", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  factText: { color: "#8a6d00", fontSize: 10, fontWeight: "700" },
  disclaimer: { color: COLORS.textMuted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: SPACING.lg },
});

