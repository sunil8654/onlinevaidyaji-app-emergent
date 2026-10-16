// Full detail page for a Daily Wellness Feed item (tip / remedy / yoga).
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const CAT_LABEL: Record<string, string> = { tip: "Daily Tip", remedy: "Home Remedy", yoga: "Yoga" };
const CAT_ICON: Record<string, any> = { tip: "sun", remedy: "coffee", yoga: "wind" };

export default function FeedItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setItem(null);
    setError(false);
    api.feedItem(String(id)).then(setItem).catch(() => setError(true));
  }, [id]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/feed"));

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} testID="feed-detail-back">
          <Feather name="arrow-left" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{item ? CAT_LABEL[item.category] || "Wellness" : "Wellness"}</Text>
        <View style={{ width: 44 }} />
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Couldn't load this item.</Text>
          <TouchableOpacity onPress={goBack} style={styles.retry}><Text style={styles.retryText}>Go back</Text></TouchableOpacity>
        </View>
      ) : !item ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} testID="feed-detail">
          {!!item.image_url && (
            <Image source={{ uri: item.image_url }} style={styles.hero} contentFit="cover" cachePolicy="memory-disk" />
          )}
          <View style={styles.badge}>
            <Feather name={CAT_ICON[item.category] || "sun"} size={12} color={COLORS.surface} />
            <Text style={styles.badgeText}>{(CAT_LABEL[item.category] || "Tip").toUpperCase()}</Text>
          </View>
          <Text style={styles.title} testID="feed-detail-title">{item.title}</Text>
          <Text style={styles.body}>{item.body}</Text>

          {item.related?.length > 0 && (
            <View style={{ marginTop: SPACING.xl }}>
              <Text style={styles.section}>More like this</Text>
              {item.related.map((r: any) => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.related}
                  onPress={() => router.replace(`/feed-item/${r.id}`)}
                  testID={`feed-related-${r.id}`}
                >
                  {!!r.image_url && <Image source={{ uri: r.image_url }} style={styles.relImg} contentFit="cover" cachePolicy="memory-disk" />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.relTitle} numberOfLines={2}>{r.title}</Text>
                    <Text style={styles.muted} numberOfLines={2}>{r.body}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  topTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: COLORS.textPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  hero: { width: "100%", aspectRatio: 16 / 10, borderRadius: RADIUS.lg, backgroundColor: COLORS.surfaceAlt },
  badge: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, marginTop: SPACING.md,
    backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill,
  },
  badgeText: { color: COLORS.surface, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 28, lineHeight: 34, color: COLORS.textPrimary, marginTop: SPACING.md },
  body: { color: COLORS.textPrimary, fontSize: 16, lineHeight: 26, marginTop: SPACING.md },
  section: { fontSize: 13, letterSpacing: 2, fontWeight: "700", color: COLORS.accent, textTransform: "uppercase", marginBottom: SPACING.sm },
  related: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.sm, marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  relImg: { width: 64, height: 64, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceAlt },
  relTitle: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  muted: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  retry: { marginTop: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
  retryText: { color: COLORS.surface, fontWeight: "700" },
});
