// Account deletion request page — required for Play Store & App Store review.
// Public route (no auth). Deliberately simple: instructs users how to email
// support@ to request full deletion of their account + associated data.
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";

const SUPPORT_EMAIL = "info@onlinevaidyaji.com";
const SUBJECT = "Account Deletion Request";
const BODY_TEMPLATE =
  "Hello Online Vaidhyaji team,\n\n" +
  "I would like to request deletion of my account and all associated data " +
  "(profile, health records, consultation history).\n\n" +
  "Registered email/phone: <please fill in>\n\n" +
  "Thank you.";

export default function DeleteAccount() {
  const router = useRouter();

  const openEmailClient = async () => {
    const mailto =
      `mailto:${SUPPORT_EMAIL}` +
      `?subject=${encodeURIComponent(SUBJECT)}` +
      `&body=${encodeURIComponent(BODY_TEMPLATE)}`;
    try {
      const supported = await Linking.canOpenURL(mailto);
      if (supported) {
        await Linking.openURL(mailto);
      } else if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = mailto;
      }
    } catch {
      // no-op: users can still copy the address below
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          testID="delete-account-back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>

        <View style={styles.hero}>
          <View style={styles.iconRing}>
            <Feather name="user-x" size={26} color={COLORS.brand} />
          </View>
          <Text style={styles.eyebrow}>Privacy · Account controls</Text>
          <Text style={styles.title}>Delete your Online Vaidhyaji account</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.body}>
            To request deletion of your{" "}
            <Text style={styles.bold}>OnlineVaidyaji</Text> account and all
            associated data — including your profile, health records, and
            consultation history — email us at{" "}
            <Text style={styles.link} onPress={openEmailClient} testID="delete-account-email">
              {SUPPORT_EMAIL}
            </Text>{" "}
            with subject line{" "}
            <Text style={styles.bold}>“{SUBJECT}”</Text>.
          </Text>
          <Text style={styles.body}>
            We will process your request within <Text style={styles.bold}>30 days</Text>.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.cta}
          onPress={openEmailClient}
          testID="delete-account-open-mail"
          activeOpacity={0.9}
        >
          <Feather name="mail" size={16} color={COLORS.surface} />
          <Text style={styles.ctaText}>Email us now</Text>
        </TouchableOpacity>

        <View style={styles.helperBox}>
          <Feather name="info" size={14} color={COLORS.textSecondary} />
          <Text style={styles.helperText}>
            Tip: send the email from the same address linked to your account so
            we can verify ownership quickly.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  back: { width: 40, height: 40, justifyContent: "center" },
  hero: { alignItems: "center", marginTop: SPACING.md, marginBottom: SPACING.lg },
  iconRing: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.sm,
  },
  eyebrow: {
    textTransform: "uppercase", letterSpacing: 3, fontSize: 11,
    color: COLORS.accent, fontWeight: "700", textAlign: "center",
  },
  title: {
    fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary,
    textAlign: "center", marginTop: 6, lineHeight: 32,
  },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg,
    gap: SPACING.md,
  },
  body: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 24 },
  bold: { fontWeight: "700", color: COLORS.textPrimary },
  link: { color: COLORS.brand, fontWeight: "700", textDecorationLine: "underline" },
  cta: {
    marginTop: SPACING.lg, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8, backgroundColor: COLORS.brand,
    paddingVertical: 14, borderRadius: RADIUS.pill, minHeight: 52,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
  helperBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    marginTop: SPACING.md, paddingHorizontal: SPACING.sm,
  },
  helperText: {
    flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 18,
  },
});
