import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";

const HIGHLIGHTS = [
  { icon: "message-circle", label: "AI Vaidhyaji chatbot for symptoms & remedies" },
  { icon: "calendar", label: "Book AYUSH doctors in minutes" },
  { icon: "clock", label: "Medicine reminders & wellness streaks" },
  { icon: "book-open", label: "Daily home remedies from all 5 AYUSH systems" },
];

export default function Onboarding() {
  const router = useRouter();

  return (
    <ImageBackground
      source={{ uri: "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg" }}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.top}>
              <Text style={styles.eyebrow}>India&apos;s AI Vaidyaji</Text>
              <Text style={styles.title}>Online{"\n"}Vaidhyaji</Text>
              <Text style={styles.sub}>
                Swasth Raho Hamesha —{"\n"}Ab AI ke saath.
              </Text>
            </View>

            <View style={styles.card}>
              {HIGHLIGHTS.map((h) => (
                <View key={h.label} style={styles.row}>
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
              <Text style={styles.ctaText}>Begin Your Wellness Journey</Text>
              <Feather name="arrow-right" size={18} color={COLORS.surface} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/auth/login")}
              testID="onboarding-signin-link"
              style={{ alignSelf: "center", marginTop: SPACING.md }}
            >
              <Text style={styles.linkText}>
                Already have an account?  <Text style={{ color: COLORS.accentSoft, fontWeight: "700" }}>Sign in</Text>
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
  top: { marginTop: SPACING.xl },
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
