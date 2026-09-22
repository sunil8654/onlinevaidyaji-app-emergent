// Native Google Sign-In — Android-only. Bypasses the Emergent auth portal
// entirely: the device Google SDK returns an ID token which we exchange
// directly with our own backend (`POST /api/auth/google`).
//
// Usage (mirrors useAppleAuth):
//   const { startGoogle, googleBusy } = useGoogleAuthNative({ onSuccess });
//   if (Platform.OS === "android") <GoogleButton onPress={startGoogle} ... />
//
// ⚠️ The native module (@react-native-google-signin/google-signin) does NOT
// exist inside Expo Go or on web. Importing it at module scope crashes the
// whole bundle with "RNGoogleSignin could not be found" — which then breaks
// every screen that imports this hook. So it is loaded lazily, only when the
// user actually taps "Continue with Google" on a real Android build.
import { Platform, Alert } from "react-native";
import { useCallback, useState } from "react";
import Constants from "expo-constants";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

// Configure once, lazily. EXPO_PUBLIC_* is inlined at build time.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

const isExpoGo = Constants.executionEnvironment === "storeClient";

let _gs: any = null;
let _statusCodes: any = null;
let _configured = false;

/** Lazily load + configure the native Google Sign-In SDK. Returns false when
 * unavailable (Expo Go / web / module missing) instead of crashing. */
function loadGoogleSignin(): boolean {
  if (_gs) return true;
  if (Platform.OS !== "android") return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-google-signin/google-signin");
    _gs = mod.GoogleSignin;
    _statusCodes = mod.statusCodes;
    if (!_configured) {
      _gs.configure({
        webClientId: WEB_CLIENT_ID,
        offlineAccess: false, // we verify the ID token server-side; no OAuth code needed
      });
      _configured = true;
    }
    return true;
  } catch {
    return false; // Expo Go / missing native module — handled by caller
  }
}

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
  code === _statusCodes?.SIGN_IN_CANCELLED ||
  code === _statusCodes?.IN_PROGRESS;

export function useGoogleAuthNative({ onSuccess, onError }: UseGoogleAuthNativeOptions) {
  const { applySession } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);

  const startGoogle = useCallback(async () => {
    if (Platform.OS !== "android") return;

    if (!loadGoogleSignin()) {
      const msg = isExpoGo
        ? "Google Sign-In is not available inside Expo Go. It works in the installed app build."
        : "Google Sign-In is not available on this device build.";
      if (onError) onError(msg);
      else Alert.alert("Google Sign-In", msg);
      return;
    }

    try {
      setGoogleBusy(true);
      // Play Services must be available (and up-to-date) for the native SDK.
      await _gs.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const userInfo = await _gs.signIn();
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
      if (!isCancel(code) && code !== _statusCodes?.PLAY_SERVICES_NOT_AVAILABLE) {
        const msg =
          code === _statusCodes?.SIGN_IN_REQUIRED
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
