import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";
import { useI18n } from "@/src/i18n";
import { LogoBlock } from "@/src/components/Logo";

export default function Onboarding() {
  const router = useRouter();
  const { t, lang, setLang } = useI18n();

  const HIGHLIGHTS = [
    { icon: "message-circle", label: t("patient_features").split(",")[0] || t("ai_symptom_checker") },
    { icon: "calendar", label: t("book_doctor") },
    { icon: "clock", label: t("medicine_reminders") },
    { icon: "book-open", label: t("home_remedies") },
  ];

  return (
    <ImageBackground
      source={{ uri: "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg" }}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <View style={styles.langRow}>
            <TouchableOpacity onPress={() => setLang(lang === "en" ? "hi" : "en")} style={styles.langBtn} testID="onboarding-lang-toggle">
              <Feather name="globe" size={12} color="#F7F5F0" />
              <Text style={styles.langText}>{lang === "en" ? "हिन्दी" : "English"}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.top}>
              <LogoBlock size={110} tagline="" light />
              <Text style={[styles.eyebrow, { marginTop: 16 }]}>{t("eyebrow_india")}</Text>
              <Text style={styles.title}>{t("brand")}</Text>
              <Text style={styles.sub}>{t("tagline")}</Text>
            </View>

            <View style={styles.card}>
              {HIGHLIGHTS.map((h, i) => (
                <View key={`${h.label}-${i}`} style={styles.row}>
                  <View style={styles.iconWrap}>
                    <Feather name={h.icon as any} size={18} color={COLORS.brand} />
                  </View>
                  <Text style={styles.rowText}>{h.label}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.cta}
              onPress={() => router.push("/auth/role")}
              activeOpacity={0.85}
              testID="onboarding-get-started"
            >
              <Text style={styles.ctaText}>{t("begin_journey")}</Text>
              <Feather name="arrow-right" size={18} color={COLORS.surface} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/auth/login")}
              testID="onboarding-signin-link"
              style={{ alignSelf: "center", marginTop: SPACING.md }}
            >
              <Text style={styles.linkText}>
                {t("already_account")}  <Text style={{ color: COLORS.accentSoft, fontWeight: "700" }}>{t("sign_in")}</Text>
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { flex: 1, backgroundColor: COLORS.overlay },
  content: { flexGrow: 1, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.lg, justifyContent: "space-between" },
  langRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.15)" },
  langText: { color: "#F7F5F0", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  top: { marginTop: SPACING.md, alignItems: "flex-start" },
  eyebrow: {
    color: COLORS.accentSoft,
    letterSpacing: 3,
    fontSize: 11,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  title: {
    fontFamily: FONTS.heading,
    color: "#F7F5F0",
    fontSize: 56,
    letterSpacing: -1.5,
    marginTop: SPACING.sm,
    lineHeight: 58,
  },
  sub: {
    color: "#F3D9CD",
    marginTop: SPACING.md,
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: "rgba(247,245,240,0.96)",
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACING.md,
  },
  rowText: { flex: 1, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
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
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16, letterSpacing: 0.3 },
  linkText: { color: "#F7F5F0", fontSize: 14 },
});
