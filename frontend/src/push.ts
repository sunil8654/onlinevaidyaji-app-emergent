// Push notification helper — call after login.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api } from "@/src/api";

export async function registerForPush(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
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
