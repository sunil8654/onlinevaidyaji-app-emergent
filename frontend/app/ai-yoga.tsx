// AI Yoga classes subscription pitch page (₹500/month).
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ImageBackground } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";

const CLASSES = [
  { name: "Morning Energiser", time: "7:00 AM · 20 min", desc: "Suryanamaskar + gentle stretches" },
  { name: "Back-pain Relief", time: "11:00 AM · 25 min", desc: "Bhujangasana, Marjariasana flow" },
  { name: "PCOS & Hormonal Balance", time: "5:30 PM · 30 min", desc: "Butterfly, Setu Bandha, breathwork" },
  { name: "Stress-melter Nidra", time: "10:00 PM · 15 min", desc: "Guided Yoga Nidra to fall asleep" },
];

export default function AiYoga() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <ImageBackground source={{ uri: "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg" }} style={styles.hero}>
          <View style={styles.heroOverlay}>
            <TouchableOpacity onPress={() => router.back()} testID="yg-back" style={styles.back}>
              <Feather name="arrow-left" size={20} color={COLORS.surface} />
            </TouchableOpacity>
            <View>
              <Text style={styles.eyebrow}>AI YOGA TEACHER</Text>
              <Text style={styles.title}>Your personal{"\n"}yoga guru</Text>
              <Text style={styles.sub}>An AI-guided yoga class delivered to your mat every single day — adapted to your body, condition and goal.</Text>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.body}>
          <Text style={styles.section}>What you get</Text>
          {[
            { i: "sunrise", t: "Daily 20-min sessions", b: "New class every morning, personalised to your dosha & problem area." },
            { i: "trending-up", t: "Progressive difficulty", b: "Difficulty ramps up week by week — no plateaus." },
            { i: "heart", t: "Condition-first flows", b: "PCOS, back pain, anxiety, weight loss, thyroid — pick your focus." },
            { i: "message-circle", t: "Weekly yogacharya check-in", b: "Chat with a real teacher every Sunday to review progress." },
          ].map((f) => (
            <View key={f.t} style={styles.featRow}>
              <View style={styles.featIcon}>
                <Feather name={f.i as any} size={16} color={COLORS.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featTitle}>{f.t}</Text>
                <Text style={styles.featBody}>{f.b}</Text>
              </View>
            </View>
          ))}

          <Text style={styles.section}>Today&apos;s classes</Text>
          {CLASSES.map((c) => (
            <View key={c.name} style={styles.classRow} testID={`yg-class-${c.name}`}>
              <View style={styles.classIcon}>
                <Feather name="play" size={14} color={COLORS.surface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.className}>{c.name}</Text>
                <Text style={styles.classMeta}>{c.time} · {c.desc}</Text>
              </View>
              <View style={styles.lock}>
                <Feather name="lock" size={12} color={COLORS.textMuted} />
              </View>
            </View>
          ))}

          <View style={styles.priceCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.priceKicker}>MONTHLY SUBSCRIPTION</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                <Text style={styles.priceBig}>₹500</Text>
                <Text style={styles.pricePer}>/ month</Text>
              </View>
              <Text style={styles.priceNote}>Cancel anytime · 3-day free trial</Text>
            </View>
            <TouchableOpacity
              style={styles.subBtn}
              onPress={() => router.push("/plan-checkout?type=ai-yoga&price=500")}
              testID="yg-subscribe"
            >
              <Text style={styles.subText}>Start free trial</Text>
              <Feather name="arrow-right" size={14} color={COLORS.surface} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  hero: { height: 300 },
  heroOverlay: { flex: 1, backgroundColor: "rgba(15,76,54,0.7)", padding: SPACING.lg, justifyContent: "space-between" },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  eyebrow: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 40, marginTop: 6, letterSpacing: -1, lineHeight: 44 },
  sub: { color: "#F7F5F0", marginTop: 10, fontSize: 14, lineHeight: 20 },
  body: { padding: SPACING.lg },
  section: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: SPACING.sm, letterSpacing: -0.3 },
  featRow: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginTop: SPACING.sm, marginBottom: SPACING.sm },
  featIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  featTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary },
  featBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  classRow: { flexDirection: "row", gap: 12, alignItems: "center", padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  classIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  className: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary },
  classMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  lock: { padding: 6 },
  priceCard: { marginTop: SPACING.lg, backgroundColor: COLORS.brand, borderRadius: RADIUS.lg, padding: SPACING.md, flexDirection: "row", alignItems: "center", gap: 12 },
  priceKicker: { color: COLORS.accentSoft, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  priceBig: { fontFamily: FONTS.heading, fontSize: 34, color: COLORS.surface, letterSpacing: -1 },
  pricePer: { color: COLORS.accentSoft, fontSize: 12 },
  priceNote: { color: "#F7F5F0", fontSize: 11, marginTop: 4 },
  subBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 12, borderRadius: RADIUS.pill },
  subText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
});
