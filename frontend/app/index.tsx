import { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ImageBackground } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { COLORS, FONTS } from "@/src/theme";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/(tabs)/home");
    else router.replace("/onboarding");
  }, [loading, user, router]);

  return (
    <ImageBackground
      source={{ uri: "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg" }}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <Text style={styles.brand} testID="splash-brand">Online Vaidhyaji</Text>
        <Text style={styles.tag} testID="splash-tagline">Swasth Raho Hamesha — Ab AI ke saath.</Text>
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
