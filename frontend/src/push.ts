// Push notification helper — call after login.
//
// ⚠️ CRITICAL: `expo-notifications` THROWS at import time when running inside
// Expo Go (SDK 53 removed remote-push from Expo Go). It must therefore NEVER
// be imported at module scope — only lazily, via getNotifications(), and only
// when we're NOT in Expo Go. Otherwise it crashes the whole app on boot.
import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "@/src/api";

/**
 * True when the app runs inside the free "Expo Go" tester (no remote push).
 *
 * ⚠️ Compare against the STRING `"storeClient"` — NOT the enum object
 * `Constants.ExecutionEnvironment`. That enum object is `undefined` on web,
 * so `.StoreClient` throws at module scope and crashes the whole boot.
 * The string compare works on every platform and never throws.
 */
const isExpoGo = Constants.executionEnvironment === "storeClient";

/**
 * Lazily load expo-notifications ONLY on a real (dev/prod native) build.
 * In Expo Go (or on web) this returns null and push is skipped entirely —
 * so it never crashes the boot path.
 */
export async function getNotifications(): Promise<any | null> {
  if (Platform.OS === "web") return null;
  if (isExpoGo) return null; // Expo Go removed remote push — skip silently
  try {
    return await import("expo-notifications");
  } catch {
    return null; // never lets push block the app — best effort only
  }
}

export async function registerForPush(userId: string): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return; // Expo Go / web / unavailable → nothing to do
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await api.registerPush({
      user_id: userId,
      platform: Platform.OS,
      device_token: tokenResp.data,
    }).catch(() => {});
  } catch {
    // silent — push is best-effort, never blocks auth
  }
}
