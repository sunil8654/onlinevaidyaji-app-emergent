// Sign in with Apple button — native only (iOS). Hidden on Android/Web per
// Apple's App Review rules (Android users must have an alternative sign-in
// path — we provide Google + email + phone OTP).
//
// Usage:
//   const { startApple, appleBusy, appleAvailable } = useAppleAuth({ onSuccess });
//   if (appleAvailable) <AppleButton onPress={startApple} busy={appleBusy} />
import { Platform, View, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { useEffect, useState, useCallback } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { COLORS } from "@/src/theme";

export type AppleAuthResult = {
  token: string;
  user: any;
  is_new: boolean;
};

export type UseAppleAuthOptions = {
  onSuccess: (res: AppleAuthResult) => void;
  onError?: (message: string) => void;
};

export function useAppleAuth({ onSuccess, onError }: UseAppleAuthOptions) {
  const { applySession } = useAuth();
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (Platform.OS !== "ios") {
        if (alive) setAppleAvailable(false);
        return;
      }
      try {
        const ok = await AppleAuthentication.isAvailableAsync();
        if (alive) setAppleAvailable(ok);
      } catch {
        if (alive) setAppleAvailable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const startApple = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    try {
      setAppleBusy(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error("Apple did not return an identity token");
      }
      const fullName = [
        credential.fullName?.givenName,
        credential.fullName?.familyName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || null;

      const res = await api.appleAuth(
        credential.identityToken,
        fullName,
        credential.email ?? null,
      );
      await applySession(res.token, res.user);
      onSuccess(res as AppleAuthResult);
    } catch (e: any) {
      // User cancelled — no alert needed.
      const code = e?.code || "";
      if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") {
        // silent cancel
      } else {
        const msg = e?.message || "Could not sign in with Apple. Please try again.";
        if (onError) onError(msg);
        else Alert.alert("Sign in failed", msg);
      }
    } finally {
      setAppleBusy(false);
    }
  }, [applySession, onError, onSuccess]);

  return { startApple, appleBusy, appleAvailable };
}

export function AppleButton({
  onPress,
  busy,
}: {
  onPress: () => void;
  busy?: boolean;
}) {
  if (Platform.OS !== "ios") return null;
  return (
    <View style={styles.wrapper} testID="apple-button-wrap">
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="small" color={COLORS.surface} />
        </View>
      ) : (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={999}
          style={styles.button}
          onPress={onPress}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: "100%" },
  button: { width: "100%", height: 52 },
  busy: {
    width: "100%", height: 52, borderRadius: 999,
    backgroundColor: "#000", alignItems: "center", justifyContent: "center",
  },
});
