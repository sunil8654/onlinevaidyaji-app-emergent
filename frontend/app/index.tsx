import { useEffect } from "react";
import { View, StyleSheet, ActivityIndicator, ImageBackground } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { COLORS } from "@/src/theme";
import { LogoBlock } from "@/src/components/Logo";

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
        <LogoBlock size={180} tagline={t("tagline")} light />
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
});
