// Podcasts — curated static list, opens external audio via Linking.
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";

type Podcast = {
  id: string;
  title: string;
  host: string;
  duration: string;
  description: string;
  category: string;
  image: string;
  url: string;
};

const PODCASTS: Podcast[] = [
  {
    id: "pod-1",
    title: "Ayurveda 101: Understanding Your Prakriti",
    host: "Dr. Meera Sharma",
    duration: "24 min",
    category: "AYURVEDA",
    description: "A beginner-friendly walkthrough of Vata, Pitta, Kapha and how to eat, sleep and work in tune with your unique constitution.",
    image: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg",
    url: "https://www.youtube.com/results?search_query=ayurveda+prakriti+podcast",
  },
  {
    id: "pod-2",
    title: "Better Sleep, the AYUSH Way",
    host: "Yogacharya Riya Patel",
    duration: "18 min",
    category: "SLEEP",
    description: "Nidra rituals, herbal teas and pranayama that pacify Vata and help you fall asleep in under 10 minutes.",
    image: "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg",
    url: "https://www.youtube.com/results?search_query=ayurveda+sleep+podcast",
  },
  {
    id: "pod-3",
    title: "Immunity Boosters from Your Kitchen",
    host: "Dr. Arjun Nair",
    duration: "31 min",
    category: "IMMUNITY",
    description: "Chyawanprash, giloy, tulsi and turmeric — how to build daily immunity from what you already have.",
    image: "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg",
    url: "https://www.youtube.com/results?search_query=ayurveda+immunity+podcast",
  },
  {
    id: "pod-4",
    title: "Yoga for Modern Desk Workers",
    host: "Yogacharya Riya Patel",
    duration: "22 min",
    category: "YOGA",
    description: "5 essential asanas and micro-breaks to counter screen fatigue, neck pain and lower-back stiffness.",
    image: "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg",
    url: "https://www.youtube.com/results?search_query=desk+worker+yoga+podcast",
  },
  {
    id: "pod-5",
    title: "Menstrual Health in Ayurveda",
    host: "Dr. Meera Sharma",
    duration: "27 min",
    category: "WOMEN",
    description: "Doshic view of the menstrual cycle, foods and herbs to ease PMS, and simple daily practices.",
    image: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg",
    url: "https://www.youtube.com/results?search_query=ayurveda+menstrual+health+podcast",
  },
  {
    id: "pod-6",
    title: "Stress, Cortisol & Adaptogens",
    host: "Dr. Arjun Nair",
    duration: "20 min",
    category: "MIND",
    description: "How ashwagandha, brahmi and shatavari work at the endocrine level to calm the mind and body.",
    image: "https://images.pexels.com/photos/13943905/pexels-photo-13943905.jpeg",
    url: "https://www.youtube.com/results?search_query=ashwagandha+adaptogens+podcast",
  },
];

export default function Podcasts() {
  const router = useRouter();

  async function play(p: Podcast) {
    try {
      const can = await Linking.canOpenURL(p.url);
      if (can) await Linking.openURL(p.url);
      else Alert.alert("Cannot open", "Please connect to the internet.");
    } catch {
      Alert.alert("Cannot open", "Please try again.");
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="pod-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Listen & learn</Text>
          <Text style={styles.title}>Podcasts</Text>
        </View>
      </View>

      <FlatList
        data={PODCASTS}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => play(item)} testID={`pod-${item.id}`}>
            <Image source={{ uri: item.image }} style={styles.img} />
            <View style={styles.body}>
              <Text style={styles.cat}>{item.category}</Text>
              <Text style={styles.pTitle}>{item.title}</Text>
              <Text style={styles.pHost}>{item.host} · {item.duration}</Text>
              <Text style={styles.pDesc} numberOfLines={2}>{item.description}</Text>
              <View style={styles.playRow}>
                <View style={styles.playBtn}>
                  <Feather name="play" size={12} color={COLORS.surface} />
                  <Text style={styles.playText}>Play</Text>
                </View>
                <Feather name="external-link" size={14} color={COLORS.textMuted} />
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
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, marginTop: 2 },
  card: {
    flexDirection: "row", gap: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.md,
  },
  img: { width: 92, height: 92, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceAlt },
  body: { flex: 1 },
  cat: { color: COLORS.accent, fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  pTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary, marginTop: 2, lineHeight: 21 },
  pHost: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
  pDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 16 },
  playRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  playBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  playText: { color: COLORS.surface, fontSize: 11, fontWeight: "700" },
});
