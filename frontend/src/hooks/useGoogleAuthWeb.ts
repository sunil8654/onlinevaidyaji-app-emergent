// Web (browser) Google Sign-In via Google Identity Services (GIS).
// Replaces the Emergent auth portal on the APP's WEB build. GIS returns a
// Google ID token (credential JWT) directly to the page, which we exchange
// with our own backend (POST /api/auth/google) — no Emergent involved.
// Android uses the native SDK (useGoogleAuthNative) instead of this hook.
import { useCallback, useRef, useState } from "react";
import { Platform, Alert } from "react-native";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let gisReady: Promise<boolean> | null = null;

function loadGis(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const w = window as any;
  if (w.google?.accounts?.id) return Promise.resolve(true);
  if (!gisReady) {
    gisReady = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = GIS_SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return gisReady;
}

export type GoogleAuthResult = {
  token: string;
  user: any;
  is_new: boolean;
};

export type UseGoogleAuthWebOptions = {
  onSuccess: (res: GoogleAuthResult) => void;
  onError?: (message: string) => void;
};

export function useGoogleAuthWeb({ onSuccess, onError }: UseGoogleAuthWebOptions) {
  const { applySession } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);
  const initRef = useRef(false);
  const triggerRef = useRef<(() => void) | null>(null);

  const handleCredential = useCallback(
    async (credential: string) => {
      try {
        const res = await api.googleAuth(credential);
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

  const startGoogle = useCallback(async () => {
    if (Platform.OS !== "web") return;
    if (!WEB_CLIENT_ID) {
      const msg = "Google Sign-In is not configured on this build.";
      if (onError) onError(msg);
      else Alert.alert("Sign in failed", msg);
      return;
    }
    try {
      setGoogleBusy(true);
      const ready = await loadGis();
      const gid = (window as any).google?.accounts?.id;
      if (!ready || !gid) {
        setGoogleBusy(false);
        const msg = "Could not load Google Sign-In. Check your connection and try again.";
        if (onError) onError(msg);
        else Alert.alert("Sign in failed", msg);
        return;
      }
      if (!initRef.current) {
        gid.initialize({
          client_id: WEB_CLIENT_ID,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (resp: any) => {
            setGoogleBusy(false);
            if (resp?.credential) handleCredential(resp.credential);
            else if (onError) onError("Sign in was cancelled.");
          },
        });
        initRef.current = true;
      }
      // Render Google's official button into a hidden container, then trigger
      // it so our custom button opens the real Google account-chooser popup.
      if (!triggerRef.current) {
        const host = document.createElement("div");
        host.style.cssText =
          "position:fixed;left:-9999px;top:0;width:240px;height:48px;opacity:0.01;pointer-events:none;z-index:-1;";
        document.body.appendChild(host);
        gid.renderButton(host, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "rectangular",
        });
        triggerRef.current = () => {
          const el = host.querySelector<HTMLElement>("div[role=button],button");
          if (el) el.click();
          else host.click();
        };
      }
      triggerRef.current?.();
    } catch (e: any) {
      setGoogleBusy(false);
      const msg = e?.message || "Could not sign in with Google. Please try again.";
      if (onError) onError(msg);
      else Alert.alert("Sign in failed", msg);
    }
  }, [handleCredential, onError]);

  return { startGoogle, googleBusy };
}