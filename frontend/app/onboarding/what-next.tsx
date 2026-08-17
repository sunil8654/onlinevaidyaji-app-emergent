// Post-quiz "What happens next" onboarding screen.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

const COPY = {
  hero: {
    en: "🎉 Great! Here's what happens next",
    hi: "🎉 Badhai ho! Ab aage kya hoga",
  },
  slaLead: {
    en: (m: number) => `📞 Our team will call you within ${m} minutes to book your FREE doctor consultation.`,
    hi: (m: number) => `📞 Hamari team aapko ${m} minute mein call karegi — aapka FREE doctor consultation book karne ke liye.`,
  },
  meanwhile: { en: "Meanwhile:", hi: "Tab tak:" },
  step1: {
    en: "📋 Keep your health records ready — previous blood test reports or any doctor prescriptions",
    hi: "📋 Apne health records taiyaar rakhein — purani blood test report ya kisi doctor ka prescription",
  },
  step2: {
    en: "📤 Upload them in Profile → Health Documents (our team will review and share with your AYUSH doctor)",
    hi: "📤 Unhe Profile → Health Documents mein upload karein (hamari team check karke aapke AYUSH doctor ko bhejegi)",
  },
  step3: {
    en: "📊 Add your health details (height, weight, BP, sugar readings) in Health Metrics — track them daily in the app",
    hi: "📊 Health Metrics mein apni details daalein (height, weight, BP, sugar) — roz app mein track karein",
  },
  step4: { en: "📖 Read our health blogs while you wait", hi: "📖 Intezaar mein hamare health blogs padhein" },
  tagline: { en: "Swasth Raho Hamesha!", hi: "Swasth Raho Hamesha!" },
  uploadCta: { en: "Upload Documents", hi: "Documents Upload karein" },
  metricsCta: { en: "Add Health Metrics", hi: "Health Metrics daalein" },
  blogsCta: { en: "Read Blogs", hi: "Blogs padhein" },
  homeCta: { en: "Go to Home", hi: "Home par jaayein" },
  waCta: { en: "WhatsApp Us", hi: "WhatsApp karein" },
};

export default function WhatNext() {
  const router = useRouter();
  const { lang } = useI18n();
  const { user } = useAuth();
  const [sla, setSla] = useState(10);
  const [wa, setWa] = useState<string>("https://wa.me/917290044081");

  useEffect(() => {
    api.onboardingConfig()
      .then((c) => { setSla(c.callback_sla_minutes); setWa(c.whatsapp_url); })
      .catch(() => {});
  }, []);

  const effLang = (user?.preferred_language as any) || lang;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Feather name="check-circle" size={30} color={COLORS.surface} />
          </View>
          <Text style={styles.heroText}>{COPY.hero[effLang]}</Text>
        </View>

        <View style={styles.slaCard}>
          <Text style={styles.slaText}>{COPY.slaLead[effLang](sla)}</Text>
        </View>

        <Text style={styles.eyebrow}>{COPY.meanwhile[effLang]}</Text>

        {[COPY.step1, COPY.step2, COPY.step3, COPY.step4].map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <Text style={styles.stepText}>{s[effLang]}</Text>
          </View>
        ))}

        <View style={styles.tagline}>
          <Feather name="heart" size={16} color={COLORS.brand} />
          <Text style={styles.taglineText}>{COPY.tagline[effLang]}</Text>
        </View>

        <View style={styles.ctaCol}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace("/(tabs)/home")}
            testID="wn-home"
          >
            <Feather name="home" size={16} color={COLORS.surface} />
            <Text style={styles.primaryText}>{COPY.homeCta[effLang]}</Text>
          </TouchableOpacity>

          <View style={styles.gridRow}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push("/(tabs)/profile")}
              testID="wn-upload"
            >
              <Feather name="upload" size={18} color={COLORS.brand} />
              <Text style={styles.tileText}>{COPY.uploadCta[effLang]}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push("/(tabs)/profile")}
              testID="wn-metrics"
            >
              <Feather name="activity" size={18} color={COLORS.brand} />
              <Text style={styles.tileText}>{COPY.metricsCta[effLang]}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.gridRow}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push("/knowledge")}
              testID="wn-blogs"
            >
              <Feather name="book-open" size={18} color={COLORS.brand} />
              <Text style={styles.tileText}>{COPY.blogsCta[effLang]}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tile, { backgroundColor: "#25D366" }]}
              onPress={() => { Linking.openURL(wa).catch(() => {}); }}
              testID="wn-whatsapp"
            >
              <Feather name="message-circle" size={18} color={COLORS.surface} />
              <Text style={[styles.tileText, { color: COLORS.surface }]}>{COPY.waCta[effLang]}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  hero: { alignItems: "center", marginBottom: SPACING.lg },
  heroIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center", marginBottom: SPACING.md },
  heroText: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, textAlign: "center" },
  slaCard: {
    backgroundColor: "#ffe082", padding: SPACING.md, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: "#f2c94c", marginBottom: SPACING.lg,
  },
  slaText: { color: "#4a3a00", fontWeight: "700", fontSize: 14, lineHeight: 21 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 2, color: COLORS.accent, fontWeight: "800", fontSize: 11, marginBottom: SPACING.sm },
  stepRow: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm },
  stepText: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 20 },
  tagline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginVertical: SPACING.lg },
  taglineText: { color: COLORS.brand, fontWeight: "800", fontSize: 14, letterSpacing: 0.5 },
  ctaCol: { gap: SPACING.sm, marginTop: SPACING.sm },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, minHeight: 56 },
  primaryText: { color: COLORS.surface, fontWeight: "800", fontSize: 15 },
  gridRow: { flexDirection: "row", gap: SPACING.sm },
  tile: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 14, borderRadius: RADIUS.md, minHeight: 56,
  },
  tileText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 13 },
});
