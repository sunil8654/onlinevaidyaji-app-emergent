// Shared Emergent Google Auth hook.
// Handles the auth.emergentagent.com redirect flow on Web and Native.
// Strips session_id from browser URL (SEC-002) and de-duplicates callbacks.
import { useCallback, useEffect, useState } from "react";
import { Platform, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

WebBrowser.maybeCompleteAuthSession();

const AUTH_URL = (redirect: string) =>
  `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;

const sentSessionIds = new Set<string>();

function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export type GoogleAuthResult = {
  token: string;
  user: any;
  is_new: boolean;
};

export type UseGoogleAuthOptions = {
  /** Called after a successful Emergent session exchange. Router push logic lives here. */
  onSuccess: (res: GoogleAuthResult) => void;
  /** Optional callback on error. Defaults to Alert. */
  onError?: (message: string) => void;
};

export function useGoogleAuth({ onSuccess, onError }: UseGoogleAuthOptions) {
  const { applySession } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogleCallback = useCallback(
    async (url: string | null) => {
      const sessionId = extractSessionId(url);
      if (!sessionId || sentSessionIds.has(sessionId)) return;
      sentSessionIds.add(sessionId);

      // SEC-002: strip session_id from the browser URL/history immediately.
      if (Platform.OS === "web" && typeof window !== "undefined" && window.history?.replaceState) {
        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch {}
      }

      try {
        setGoogleBusy(true);
        const res = await api.googleSession(sessionId);
        await applySession(res.token, res.user);
        onSuccess(res as GoogleAuthResult);
      } catch (e: any) {
        const msg = e?.message || "Could not sign in with Google. Please try again.";
        if (onError) onError(msg);
        else Alert.alert("Sign in failed", msg);
      } finally {
        setGoogleBusy(false);
      }
    },
    [applySession, onError, onSuccess]
  );

  useEffect(() => {
    Linking.getInitialURL().then(handleGoogleCallback);
    const sub = Linking.addEventListener("url", (evt) => handleGoogleCallback(evt.url));
    return () => sub.remove();
  }, [handleGoogleCallback]);

  const startGoogle = useCallback(async () => {
    try {
      setGoogleBusy(true);
      const redirect =
        Platform.OS === "web"
          ? typeof window !== "undefined"
            ? window.location.origin + "/"
            : ""
          : Linking.createURL("");
      const authUrl = AUTH_URL(redirect);
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      const url = (result as any)?.url || null;
      if (url) handleGoogleCallback(url);
    } catch (e: any) {
      const msg = e?.message || "Could not sign in with Google. Please try again.";
      if (onError) onError(msg);
      else Alert.alert("Sign in failed", msg);
    } finally {
      setGoogleBusy(false);
    }
  }, [handleGoogleCallback, onError]);

  return { startGoogle, googleBusy };
}
