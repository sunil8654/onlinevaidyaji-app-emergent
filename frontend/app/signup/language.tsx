// Language selection — stored in user profile, changes entire app UI.
import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

export default function LanguagePick() {
  const router = useRouter();
  const { setLang } = useI18n();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState<"en" | "hi" | null>(null);

  async function pick(l: "en" | "hi") {
    setBusy(l);
    try {
      await setLang(l);
      await api.updateMe({ preferred_language: l });
      await refresh();
      router.replace("/onboarding/quiz");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    } finally { setBusy(null); }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.content}>
        <View style={styles.iconRing}>
          <Feather name="globe" size={26} color={COLORS.brand} />
        </View>

        <Text style={styles.title}>अपनी भाषा चुनें</Text>
        <Text style={styles.title}>Choose Your Language</Text>
        <Text style={styles.sub}>App, quiz aur emails aapki chuni hui bhasha mein honge · You can switch anytime from Profile</Text>

        <TouchableOpacity
          style={[styles.card, busy === "hi" && { opacity: 0.5 }]}
          onPress={() => pick("hi")}
          disabled={busy !== null}
          testID="lang-hi"
        >
          <Text style={styles.big}>हिन्दी</Text>
          <Text style={styles.small}>Hindi</Text>
          {busy === "hi" ? <ActivityIndicator size="small" color={COLORS.brand} /> : <Feather name="chevron-right" size={22} color={COLORS.brand} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, busy === "en" && { opacity: 0.5 }]}
          onPress={() => pick("en")}
          disabled={busy !== null}
          testID="lang-en"
        >
          <Text style={styles.big}>English</Text>
          <Text style={styles.small}>English</Text>
          {busy === "en" ? <ActivityIndicator size="small" color={COLORS.brand} /> : <Feather name="chevron-right" size={22} color={COLORS.brand} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, padding: SPACING.lg, paddingTop: SPACING.xl, gap: SPACING.md },
  iconRing: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary },
  sub: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: SPACING.lg },
  card: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.surface, paddingHorizontal: SPACING.lg, paddingVertical: 22,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    minHeight: 76,
  },
  big: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.textPrimary },
  small: { color: COLORS.textMuted, fontSize: 12, flex: 1, marginLeft: SPACING.sm },
});
