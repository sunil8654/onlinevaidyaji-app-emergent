// Text-based logo used throughout the app.
import { View, Text, StyleSheet } from "react-native";
import { COLORS, FONTS } from "@/src/theme";

export function Logo({ size = 28, color = COLORS.brand, tagline = false }: { size?: number; color?: string; tagline?: boolean }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={[styles.om, { fontSize: size * 0.9, color }]}>ॐ</Text>
        <View style={{ marginLeft: 6 }}>
          <Text style={[styles.brand, { fontSize: size * 0.7, color }]}>
            Online<Text style={{ color: COLORS.accent }}>Vaidhyaji</Text>
          </Text>
          {tagline && <Text style={styles.tag}>AYUSH · AI · Wellness</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center" },
  om: { fontFamily: FONTS.heading, lineHeight: undefined as any },
  brand: { fontFamily: FONTS.heading, letterSpacing: -0.5, fontWeight: "700" },
  tag: { color: COLORS.textSecondary, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginTop: 1 },
});
