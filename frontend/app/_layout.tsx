import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { I18nProvider } from "@/src/i18n";
import { registerForPush, getNotifications } from "@/src/push";

LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const router = useRouter();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    // Push notifications — lazily initialized ONLY when NOT in Expo Go / web.
    // `expo-notifications` THROWS at import time inside Expo Go (SDK 53+)
    // and on web it's not supported — so we delegate to the guarded helper
    // which returns null in those environments and imports lazily otherwise.
    let alive = true;
    let tapSub: { remove(): void } | null = null;

    getNotifications()
      .then((Notifications) => {
        if (!Notifications || !alive) return; // Expo Go / web / unavailable
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        if (Platform.OS === "android") {
          Notifications.setNotificationChannelAsync("default", {
            name: "Default",
            importance: Notifications.AndroidImportance.MAX,
            sound: "default",
          });
        }

        tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = (response.notification.request.content.data || {}) as any;
          const url = data.deeplink || data.action_url;
          if (!url) return;
          if (url.startsWith("http")) {
            Linking.openURL(url);
          } else {
            router.push(url);
          }
        });

        Notifications.getLastNotificationResponseAsync().then((response) => {
          if (!response || !alive) return;
          const data = (response.notification.request.content.data || {}) as any;
          const url = data.deeplink || data.action_url;
          if (!url) return;
          if (url.startsWith("http")) {
            Linking.openURL(url);
          } else {
            router.push(url);
          }
        });
      })
      .catch(() => {}); // never let push block boot — best effort only

    return () => {
      alive = false;
      tapSub?.remove();
    };
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <PushRegistrar />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#FFFDF3" } }} />
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

// Re-registers push token whenever the user changes (login/reopen).
function PushRegistrar() {
  const { user } = useAuth();
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!user?.id) return;
    registerForPush(user.id).catch(() => {});
  }, [user?.id]);
  return null;
}
