// Reusable "Coming Soon" overlay banner.
import { View, Text, StyleSheet } from "react-native";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, RADIUS, FONTS } from "@/src/theme";

export function ComingSoonBanner({ label = "Coming soon" }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Feather name="clock" size={11} color={COLORS.surface} />
        <Text style={styles.text}>{label.toUpperCase()}</Text>
      </View>
    </View>
  );
}

export function ComingSoonScreen({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.center}>
      <View style={styles.iconBig}>
        <Feather name="clock" size={30} color={COLORS.accent} />
      </View>
      <Text style={styles.hero}>{title}</Text>
      <Text style={styles.copy}>{body}</Text>
      <View style={styles.pill}>
        <Text style={styles.pillText}>LAUNCHING SOON</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 12, right: 12, zIndex: 3 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  text: { color: COLORS.surface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: 32 },
  iconBig: { width: 84, height: 84, borderRadius: 42, backgroundColor: COLORS.accentSoft, alignItems: "center", justifyContent: "center" },
  hero: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: 16, textAlign: "center", letterSpacing: -0.5 },
  copy: { color: COLORS.textSecondary, textAlign: "center", marginTop: 8, fontSize: 14, lineHeight: 20 },
  pill: { backgroundColor: COLORS.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, marginTop: 20 },
  pillText: { color: COLORS.surface, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
});
