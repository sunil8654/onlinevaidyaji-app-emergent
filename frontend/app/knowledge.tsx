// Knowledge Hub v2 — one-stop portal for Blogs, Podcasts, Videos, FAQs.
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";

type Card = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  route: string;
  image: string;
};

const CARDS: Card[] = [
  {
    key: "blogs",
    title: "Articles & Blogs",
    subtitle: "Deep-dive reads on AYUSH, remedies & nutrition",
    icon: "book-open",
    color: COLORS.brand,
    route: "/blogs",
    image: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg",
  },
  {
    key: "podcasts",
    title: "Podcasts",
    subtitle: "Listen to AYUSH doctors & lifestyle coaches",
    icon: "headphones",
    color: COLORS.accent,
    route: "/podcasts",
    image: "https://images.pexels.com/photos/7005016/pexels-photo-7005016.jpeg",
  },
  {
    key: "videos",
    title: "Video Library",
    subtitle: "Guided yoga, cooking & wellness clips",
    icon: "video",
    color: COLORS.brand,
    route: "/videos",
    image: "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg",
  },
  {
    key: "faqs",
    title: "FAQs",
    subtitle: "Quick answers to your top AYUSH questions",
    icon: "help-circle",
    color: COLORS.accent,
    route: "/faqs",
    image: "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg",
  },
  {
    key: "quizzes",
    title: "Health Quizzes",
    subtitle: "Test yourself and earn reward points",
    icon: "check-square",
    color: COLORS.brand,
    route: "/quiz",
    image: "https://images.pexels.com/photos/5327585/pexels-photo-5327585.jpeg",
  },
];

const CATEGORIES = [
  { key: "ayurveda", label: "Ayurveda", icon: "leaf" as const },
  { key: "yoga",     label: "Yoga",     icon: "wind" as const },
  { key: "nutrition",label: "Nutrition",icon: "coffee" as const },
  { key: "remedy",   label: "Remedies", icon: "shield" as const },
  { key: "mind",     label: "Mind",     icon: "smile" as const },
];

export default function KnowledgeHub() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="kb-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Learn & explore</Text>
          <Text style={styles.title}>Knowledge Hub</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={styles.catChip}
              onPress={() => router.push({ pathname: "/blogs", params: { category: c.key } })}
              testID={`kb-cat-${c.key}`}
            >
              <Feather name={c.icon} size={14} color={COLORS.brand} />
              <Text style={styles.catText}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {CARDS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={styles.card}
            onPress={() => router.push(c.route as any)}
            testID={`kb-card-${c.key}`}
          >
            <Image source={{ uri: c.image }} style={styles.img} />
            <View style={styles.overlay} />
            <View style={styles.body}>
              <View style={[styles.iconWrap, { backgroundColor: c.color }]}>
                <Feather name={c.icon} size={18} color={COLORS.surface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardSub}>{c.subtitle}</Text>
              </View>
              <Feather name="arrow-right" size={18} color={COLORS.surface} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, marginTop: 2 },
  catRow: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, gap: SPACING.sm },
  catChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
    marginRight: SPACING.sm,
  },
  catText: { color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  card: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    borderRadius: RADIUS.lg, overflow: "hidden",
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, height: 130,
  },
  img: { width: "100%", height: "100%" },
  overlay: {
    position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(15,92,42,0.55)",
  },
  body: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 0,
    padding: SPACING.md, flexDirection: "row", alignItems: "center", gap: SPACING.md,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: COLORS.surface,
  },
  cardTitle: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 20 },
  cardSub: { color: COLORS.accentSoft, fontSize: 12, marginTop: 2 },
});
