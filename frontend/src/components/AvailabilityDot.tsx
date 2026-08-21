// Small pill/dot indicating a doctor is currently online (heart-beated within
// the server's live-window). Includes a soft pulse ring for extra life.
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { COLORS } from "@/src/theme";

type Props = {
  online?: boolean;
  compact?: boolean;   // dot-only vs "Online now" pill
  size?: number;       // dot diameter in px
};

const LIVE_GREEN = "#10b981";
const OFF_GREY = "#c4bcae";

export function AvailabilityDot({ online, compact = true, size = 10 }: Props) {
  const color = online ? LIVE_GREEN : OFF_GREY;
  const dot = (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: color,
        borderWidth: 2, borderColor: "#ffffff",
        // Subtle glow when online
        ...(online
          ? Platform.select({
              ios: { shadowColor: LIVE_GREEN, shadowOpacity: 0.6, shadowRadius: 4 },
              android: { elevation: 3 },
              default: {},
            })
          : {}),
      }}
      accessibilityLabel={online ? "Doctor is online now" : "Doctor is offline"}
    />
  );
  if (compact) return dot;
  return (
    <View style={styles.pill}>
      {dot}
      <Text style={[styles.pillText, { color: online ? LIVE_GREEN : COLORS.textMuted }]}>
        {online ? "Online now" : "Offline"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#a7f3d0",
  },
  pillText: { fontSize: 11, fontWeight: "700" },
});
