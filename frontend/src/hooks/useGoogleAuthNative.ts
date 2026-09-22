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
//
// Expo Go fallback: when the native module is unavailable, we run a
// backend-mediated OAuth flow in an in-app browser instead:
//   app → GET /api/auth/google/oauth/start → Google consent →
//   /api/auth/google/oauth/callback → deep link back with our app JWT.
import { Platform, Alert } from "react-native";
import { useCallback, useState } from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

WebBrowser.maybeCompleteAuthSession();

// Configure once, lazily. EXPO_PUBLIC_* is inlined at build time.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

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

  /** Browser OAuth fallback (Expo Go / no native module). Opens an in-app
   * browser, completes Google consent, and comes back with our app JWT. */
  const startBrowserGoogle = useCallback(async () => {
    try {
      setGoogleBusy(true);
      const returnTo = Linking.createURL("oauth/callback");
      const startUrl = `${BASE}/api/auth/google/oauth/start?return_to=${encodeURIComponent(returnTo)}`;
      const result = await WebBrowser.openAuthSessionAsync(startUrl, returnTo);
      if (result.type !== "success" || !(result as any).url) {
        return; // user dismissed the browser — silent
      }
      const url = (result as any).url as string;
      // The app JWT arrives in the URL fragment: oauth/callback#token=...
      const m = url.match(/[#&?]token=([^&#]+)/);
      if (!m) {
        if (url.includes("error=google_denied")) return; // user denied consent
        throw new Error("Google sign-in did not return a session");
      }
      const token = decodeURIComponent(m[1]);
      // Fetch the full profile so AuthContext has a complete user object.
      const res = await fetch(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Could not load your profile after Google sign-in");
      const user = await res.json();
      await applySession(token, user);
      onSuccess({ token, user, is_new: false } as GoogleAuthResult);
    } catch (e: any) {
      const msg = e?.message || "Could not sign in with Google. Please try again.";
      if (onError) onError(msg);
      else Alert.alert("Sign in failed", msg);
    } finally {
      setGoogleBusy(false);
    }
  }, [applySession, onError, onSuccess]);

  const startGoogle = useCallback(async () => {
    if (Platform.OS !== "android") return;

    // Expo Go / builds without the native module → browser OAuth fallback.
    if (!loadGoogleSignin()) {
      await startBrowserGoogle();
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
  }, [applySession, onError, onSuccess, startBrowserGoogle]);

  return { startGoogle, googleBusy };
}
