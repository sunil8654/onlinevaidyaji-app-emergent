// Official Online Vaidhyaji logo — uses the brand image.
import { View, Text, Image, StyleSheet } from "react-native";
import { COLORS, FONTS } from "@/src/theme";

// Local asset — resized responsively via the `size` prop.
const LOGO = require("../../assets/images/logo.jpeg");

export function Logo({ size = 32, tagline = false, showText = true, tint }: { size?: number; tagline?: boolean; showText?: boolean; tint?: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Image source={LOGO} style={{ width: size * 1.1, height: size * 1.1, borderRadius: size * 0.2 }} resizeMode="contain" />
        {showText && (
          <View style={{ marginLeft: 8 }}>
            <Text style={[styles.brand, { fontSize: size * 0.62, color: tint || COLORS.brand }]}>
              Online<Text style={{ color: tint ? tint : COLORS.accent }}>Vaidhyaji</Text>
            </Text>
            {tagline && (
              <Text style={[styles.tag, { color: tint ? tint : COLORS.textSecondary }]}>
                AYUSH · AI · Wellness
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// Bigger square version for splash / hero / about screens.
export function LogoBlock({ size = 160, tagline = "Swasth Raho Hamesha", light = false }: { size?: number; tagline?: string; light?: boolean }) {
  return (
    <View style={styles.block}>
      <Image source={LOGO} style={{ width: size, height: size, borderRadius: 24 }} resizeMode="contain" />
      {tagline ? (
        <Text style={[styles.blockTag, light && { color: "#FFE082" }]}>{tagline}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center" },
  brand: { fontFamily: FONTS.heading, letterSpacing: -0.5, fontWeight: "700" },
  tag: { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginTop: 2 },
  block: { alignItems: "center" },
  blockTag: { color: COLORS.accent, marginTop: 10, fontSize: 12, letterSpacing: 3, textTransform: "uppercase", fontWeight: "700" },
});
