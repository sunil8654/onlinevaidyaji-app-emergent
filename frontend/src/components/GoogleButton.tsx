// Reusable "Continue with Google" button. Bilingual label + Emergent auth flow.
import { TouchableOpacity, Text, StyleSheet, Image, ActivityIndicator } from "react-native";
import { COLORS, RADIUS, SPACING } from "@/src/theme";

type Props = {
  onPress: () => void;
  busy?: boolean;
  label?: string;
  testID?: string;
};

export function GoogleButton({ onPress, busy, label = "Continue with Google", testID }: Props) {
  return (
    <TouchableOpacity
      style={[styles.googleBtn, busy && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.9}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator size="small" color={COLORS.textPrimary} />
      ) : (
        <>
          <Image
            source={{ uri: "https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" }}
            style={styles.googleLogo}
          />
          <Text style={styles.googleText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    minHeight: 52,
  },
  googleLogo: { width: 20, height: 20 },
  googleText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
});
