import { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ImageBackground } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { COLORS, FONTS } from "@/src/theme";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    if (loading) return;
    if (user?.is_admin) router.replace("/admin/dashboard");
    else if (user) router.replace("/(tabs)/home");
    else router.replace("/onboarding");
  }, [loading, user, router]);

  return (
    <ImageBackground
      source={{ uri: "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg" }}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <Text style={styles.om}>ॐ</Text>
        <Text style={styles.brand} testID="splash-brand">{t("brand")}</Text>
        <Text style={styles.tag} testID="splash-tagline">{t("tagline")}</Text>
        <ActivityIndicator size="small" color="#F7F5F0" style={{ marginTop: 32 }} />
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  om: { color: "#F3D9CD", fontSize: 60, marginBottom: 12, lineHeight: 66 },
  brand: {
    fontFamily: FONTS.heading,
    color: "#F7F5F0",
    fontSize: 40,
    letterSpacing: -1,
    textAlign: "center",
  },
  tag: {
    color: "#F3D9CD",
    marginTop: 12,
    fontSize: 15,
    textAlign: "center",
    letterSpacing: 0.5,
  },
});
