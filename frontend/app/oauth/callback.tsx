// OAuth callback route — handles Google browser-OAuth deep links when the app
// cold-starts from the redirect (the warm path is handled by
// openAuthSessionAsync inside useGoogleAuthNative). The backend redirects to
//   {return_to}#token=<app JWT>
// so we extract the token, load the profile, apply the session, and go home.
import { useEffect, useRef } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useAuth } from "@/src/auth";
import { COLORS } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export default function OAuthCallback() {
  const router = useRouter();
  const { applySession } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    (async () => {
      if (handled.current) return;
      handled.current = true;
      try {
        const url = await Linking.getInitialURL();
        const m = url?.match(/[#&?]token=([^&#]+)/);
        if (!m) {
          router.replace("/auth/login");
          return;
        }
        const token = decodeURIComponent(m[1]);
        const res = await fetch(`${BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("profile fetch failed");
        const user = await res.json();
        await applySession(token, user);
        router.replace("/");
      } catch {
        router.replace("/auth/login");
      }
    })();
  }, [applySession, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.background,
  },
});
