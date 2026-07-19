import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";

export default function Role() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="role-back">
        <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>

      <View style={styles.body}>
        <Text style={styles.eyebrow}>Choose Your Path</Text>
        <Text style={styles.title}>Who&apos;s joining today?</Text>
        <Text style={styles.sub}>Both patients and AYUSH practitioners are welcome here.</Text>

        <TouchableOpacity
          style={[styles.card, { borderColor: COLORS.brand }]}
          onPress={() => router.push({ pathname: "/auth/register", params: { role: "patient" } })}
          activeOpacity={0.85}
          testID="role-select-patient"
        >
          <Image source={{ uri: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg" }} style={styles.cardImg} />
          <View style={styles.cardOverlay}>
            <View>
              <Text style={styles.cardKicker}>For Patients</Text>
              <Text style={styles.cardTitle}>I need care</Text>
              <Text style={styles.cardBody}>Symptom checker, doctors, reminders, remedies</Text>
            </View>
            <View style={styles.cardArrow}>
              <Feather name="arrow-right" size={18} color={COLORS.surface} />
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, { borderColor: COLORS.accent }]}
          onPress={() => router.push({ pathname: "/auth/register", params: { role: "doctor" } })}
          activeOpacity={0.85}
          testID="role-select-doctor"
        >
          <Image source={{ uri: "https://images.pexels.com/photos/5738735/pexels-photo-5738735.jpeg" }} style={styles.cardImg} />
          <View style={[styles.cardOverlay, { backgroundColor: "rgba(217,102,61,0.85)" }]}>
            <View>
              <Text style={styles.cardKicker}>For Practitioners</Text>
              <Text style={styles.cardTitle}>I am a doctor</Text>
              <Text style={styles.cardBody}>Onboard, verify, and consult in minutes</Text>
            </View>
            <View style={[styles.cardArrow, { backgroundColor: COLORS.brand }]}>
              <Feather name="arrow-right" size={18} color={COLORS.surface} />
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/auth/login")} style={{ marginTop: SPACING.lg, alignSelf: "center" }} testID="role-signin-link">
          <Text style={{ color: COLORS.textSecondary }}>
            Already a member? <Text style={{ color: COLORS.brand, fontWeight: "700" }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: SPACING.lg },
  back: { paddingVertical: SPACING.sm, width: 40 },
  body: { flex: 1 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 40, color: COLORS.textPrimary, marginTop: 8, lineHeight: 46, letterSpacing: -1 },
  sub: { color: COLORS.textSecondary, marginTop: 8, marginBottom: SPACING.lg, fontSize: 15, lineHeight: 22 },
  card: {
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    marginBottom: SPACING.md,
    borderWidth: 1,
    height: 180,
    backgroundColor: COLORS.surface,
  },
  cardImg: { width: "100%", height: "100%", position: "absolute" },
  cardOverlay: {
    flex: 1,
    padding: SPACING.md,
    backgroundColor: "rgba(15,76,54,0.85)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  cardKicker: { color: COLORS.accentSoft, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  cardTitle: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 30, marginTop: 6, letterSpacing: -0.5 },
  cardBody: { color: "#F7F5F0", fontSize: 13, marginTop: 4, maxWidth: 260 },
  cardArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
