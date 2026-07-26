// Video Library — curated static list, opens YouTube via Linking.
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";

type Video = {
  id: string;
  title: string;
  duration: string;
  category: string;
  image: string;
  url: string;
};

const VIDEOS: Video[] = [
  { id: "v-1", title: "10-Min Morning Yoga for Beginners", duration: "10:24", category: "YOGA",
    image: "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg",
    url: "https://www.youtube.com/results?search_query=morning+yoga+10+minute" },
  { id: "v-2", title: "Anulom Vilom Pranayama — Full Guide", duration: "6:12", category: "PRANAYAMA",
    image: "https://images.pexels.com/photos/13943905/pexels-photo-13943905.jpeg",
    url: "https://www.youtube.com/results?search_query=anulom+vilom+guide" },
  { id: "v-3", title: "AYUSH Breakfast: Moong Dal Chilla", duration: "8:45", category: "COOKING",
    image: "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg",
    url: "https://www.youtube.com/results?search_query=moong+dal+chilla+recipe" },
  { id: "v-4", title: "Surya Namaskar Step-by-Step", duration: "12:03", category: "YOGA",
    image: "https://images.pexels.com/photos/8436587/pexels-photo-8436587.jpeg",
    url: "https://www.youtube.com/results?search_query=surya+namaskar+guide" },
  { id: "v-5", title: "How to Make Golden Milk (Haldi Doodh)", duration: "4:38", category: "REMEDY",
    image: "https://images.pexels.com/photos/17859378/pexels-photo-17859378.jpeg",
    url: "https://www.youtube.com/results?search_query=golden+milk+haldi+doodh+recipe" },
  { id: "v-6", title: "Yoga for Better Sleep — 20 Min", duration: "20:15", category: "SLEEP",
    image: "https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg",
    url: "https://www.youtube.com/results?search_query=yoga+for+better+sleep" },
  { id: "v-7", title: "Bhastrika for Energy — 5 Min", duration: "5:02", category: "PRANAYAMA",
    image: "https://images.pexels.com/photos/13943905/pexels-photo-13943905.jpeg",
    url: "https://www.youtube.com/results?search_query=bhastrika+pranayama" },
  { id: "v-8", title: "Ashwagandha: Benefits & How to Take", duration: "9:20", category: "HERBS",
    image: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg",
    url: "https://www.youtube.com/results?search_query=ashwagandha+benefits" },
];

export default function Videos() {
  const router = useRouter();

  async function play(v: Video) {
    try {
      const can = await Linking.canOpenURL(v.url);
      if (can) await Linking.openURL(v.url);
      else Alert.alert("Cannot open", "Please connect to the internet.");
    } catch {
      Alert.alert("Cannot open", "Please try again.");
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="vid-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Watch & learn</Text>
          <Text style={styles.title}>Video Library</Text>
        </View>
      </View>

      <FlatList
        data={VIDEOS}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}
        numColumns={2}
        columnWrapperStyle={{ gap: SPACING.md }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => play(item)} testID={`vid-${item.id}`}>
            <View style={styles.thumbWrap}>
              <Image source={{ uri: item.image }} style={styles.thumb} />
              <View style={styles.playOverlay}>
                <Feather name="play" size={22} color={COLORS.surface} />
              </View>
              <View style={styles.durationChip}>
                <Text style={styles.durationText}>{item.duration}</Text>
              </View>
            </View>
            <View style={styles.body}>
              <Text style={styles.cat}>{item.category}</Text>
              <Text style={styles.vTitle} numberOfLines={2}>{item.title}</Text>
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
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
  },
  thumbWrap: { position: "relative" },
  thumb: { width: "100%", height: 100 },
  playOverlay: {
    position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(15,92,42,0.35)",
  },
  durationChip: {
    position: "absolute", right: 6, bottom: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: { color: COLORS.surface, fontSize: 10, fontWeight: "700" },
  body: { padding: SPACING.sm },
  cat: { color: COLORS.accent, fontSize: 9, fontWeight: "700", letterSpacing: 1.5 },
  vTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "700", marginTop: 4, lineHeight: 17, minHeight: 34 },
});
