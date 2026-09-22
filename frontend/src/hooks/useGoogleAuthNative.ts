// Native Google Sign-In — Android-only. Bypasses the Emergent auth portal
// entirely: the device Google SDK returns an ID token which we exchange
// directly with our own backend (`POST /api/auth/google`).
//
// Usage (mirrors useAppleAuth):
//   const { startGoogle, googleBusy } = useGoogleAuthNative({ onSuccess });
//   if (Platform.OS === "android") <GoogleButton onPress={startGoogle} ... />
import { Platform, Alert } from "react-native";
import { useCallback, useState } from "react";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

// Configure once at module load. EXPO_PUBLIC_* is inlined at build time.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  offlineAccess: false, // we verify the ID token server-side; no OAuth code needed
});

export type GoogleAuthResult = {
  token: string;
  user: any;
  is_new: boolean;
};

export type UseGoogleAuthNativeOptions = {
  onSuccess: (res: GoogleAuthResult) => void;
  onError?: (message: string) => void;
};

const isCancel = (code: string | number | undefined) =>
  code === statusCodes.SIGN_IN_CANCELLED ||
  code === statusCodes.IN_PROGRESS;

export function useGoogleAuthNative({ onSuccess, onError }: UseGoogleAuthNativeOptions) {
  const { applySession } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);

  const startGoogle = useCallback(async () => {
    if (Platform.OS !== "android") return;
    try {
      setGoogleBusy(true);
      // Play Services must be available (and up-to-date) for the native SDK.
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const userInfo = await GoogleSignin.signIn();
      if (userInfo.type !== "success") {
        // Cancelled by the user — not an error.
        return;
      }
      const idToken = userInfo.data.idToken;
      if (!idToken) {
        throw new Error("Google did not return an ID token");
      }

      const res = await api.googleAuth(idToken);
      await applySession(res.token, res.user);
      onSuccess(res as GoogleAuthResult);
    } catch (e: any) {
      const code = e?.code;
      // Silently ignore user-cancelled + in-progress. Show real failures.
      if (!isCancel(code) && code !== statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        const msg =
          code === statusCodes.SIGN_IN_REQUIRED
            ? "Google Sign-In needs your account. Please sign in again."
            : e?.message || "Could not sign in with Google. Please try again.";
        if (onError) onError(msg);
        else Alert.alert("Sign in failed", msg);
      }
    } finally {
      setGoogleBusy(false);
    }
  }, [applySession, onError, onSuccess]);

  return { startGoogle, googleBusy };
}