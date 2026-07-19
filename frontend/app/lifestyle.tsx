// Lifestyle diseases — inspired by onlinevaidyaji.com specialties.
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";

const DISEASES = [
  { key: "digestive", name: "Digestive Health", tag: "Ayurveda", desc: "Acidity, IBS, bloating, constipation", img: "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg" },
  { key: "diabetes", name: "Diabetes & Sugar", tag: "Lifestyle", desc: "Type-2 diabetes, prediabetes, insulin resistance", img: "https://images.pexels.com/photos/5407206/pexels-photo-5407206.jpeg" },
  { key: "hypertension", name: "Hypertension", tag: "Cardio", desc: "High BP, palpitations, stress-related", img: "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg" },
  { key: "obesity", name: "Weight & Obesity", tag: "Lifestyle", desc: "Weight loss, metabolic syndrome, thyroid", img: "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg" },
  { key: "pcos", name: "PCOS / PCOD", tag: "Women's Health", desc: "Hormonal balance, irregular cycles, fertility", img: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg" },
  { key: "skin", name: "Skin & Hair", tag: "Ayurveda", desc: "Acne, eczema, psoriasis, hair fall, dandruff", img: "https://images.pexels.com/photos/5407206/pexels-photo-5407206.jpeg" },
  { key: "sleep", name: "Insomnia & Anxiety", tag: "Mental", desc: "Sleep issues, anxiety, chronic stress, panic", img: "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg" },
  { key: "joint", name: "Joint & Back Pain", tag: "Orthopedics", desc: "Arthritis, sciatica, cervical, lower-back pain", img: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg" },
  { key: "sexual", name: "Sexual Wellness", tag: "Men's Health", desc: "Vitality, stamina, fertility support", img: "https://images.pexels.com/photos/5738735/pexels-photo-5738735.jpeg" },
  { key: "respiratory", name: "Respiratory", tag: "Ayurveda", desc: "Cough, cold, asthma, chronic sinusitis", img: "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg" },
];

export default function Lifestyle() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="lf-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>Lifestyle & AYUSH</Text>
          <Text style={styles.title}>What can we treat?</Text>
        </View>
      </View>

      <FlatList
        data={DISEASES}
        keyExtractor={(d) => d.key}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 60 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: "/(tabs)/consult" })}
            activeOpacity={0.9}
            testID={`lf-${item.key}`}
          >
            <Image source={{ uri: item.img }} style={styles.img} />
            <View style={styles.pad}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{item.tag.toUpperCase()}</Text>
              </View>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.desc}>{item.desc}</Text>
              <View style={styles.cta}>
                <Text style={styles.ctaText}>Find a Vaidya</Text>
                <Feather name="arrow-right" size={12} color={COLORS.brand} />
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { flexDirection: "row", backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  img: { width: 100, height: 120 },
  pad: { flex: 1, padding: SPACING.md, justifyContent: "space-between" },
  tag: { alignSelf: "flex-start", backgroundColor: COLORS.accentSoft, paddingHorizontal: 6, paddingVertical: 3, borderRadius: RADIUS.pill },
  tagText: { color: COLORS.accent, fontSize: 9, letterSpacing: 1, fontWeight: "700" },
  name: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary, marginTop: 4 },
  desc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  cta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  ctaText: { color: COLORS.brand, fontWeight: "700", fontSize: 12 },
});
