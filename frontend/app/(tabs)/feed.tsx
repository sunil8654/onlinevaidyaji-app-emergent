import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, ImageBackground, RefreshControl, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";
import { useAuth } from "@/src/auth";
import DoctorAppointments from "@/app/doctor/appointments-list";

const CATS = ["all", "tip", "remedy", "yoga", "blog"];
const CAT_LABELS: Record<string, string> = { all: "All", tip: "Daily Tips", remedy: "Home Remedies", yoga: "Yoga", blog: "Blog" };

export default function Feed() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [blogItems, setBlogItems] = useState<any[]>([]);
  const [cat, setCat] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);

  const isDoctor = user?.role === "doctor";

  useEffect(() => {
    if (isDoctor) return;
    (async () => { try { setItems(await api.feed()); } catch {} })();
  }, [isDoctor]);

  useEffect(() => {
    if (cat !== "blog") return;
    (async () => { try { setBlogItems((await api.wpPosts())?.posts ?? []); } catch {} })();
  }, [cat]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (cat === "blog") setBlogItems((await api.wpPosts())?.posts ?? []);
      else if (!isDoctor) setItems(await api.feed());
    } catch {}
    setRefreshing(false);
  }, [cat, isDoctor]);

  // Role-aware content: doctors see their Appointments queue in this slot.
  if (isDoctor) return <DoctorAppointments />;

  const isBlog = cat === "blog";
  const filtered = isBlog
    ? blogItems
    : cat === "all" ? items : items.filter((i) => i.category === cat);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>AYUSH Wisdom</Text>
        <Text style={styles.title}>Daily wellness feed</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        style={styles.chipsWrap}
      >
        {CATS.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setCat(c)}
            style={[styles.chip, cat === c && styles.chipActive]}
            testID={`feed-chip-${c}`}
          >
            <Text style={[styles.chipText, cat === c && styles.chipTextActive]}>{CAT_LABELS[c]}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        renderItem={({ item }) => isBlog ? (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.9}
            onPress={() => router.push(`/blog/${item.slug}`)}
            testID={`feed-blog-${item.id}`}
          >
            {!!item.image_url && (
              <ImageBackground source={{ uri: item.image_url }} style={styles.img} imageStyle={{ borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg }} />
            )}
            <View style={styles.pad}>
              <View style={styles.metaRow}>
                <Text style={styles.catLabel}>{(item.category || "Blog").toUpperCase()}</Text>
                {!!item.author && <Text style={styles.authorText}>— {item.author}</Text>}
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {!!item.excerpt && <Text style={styles.cardBody} numberOfLines={3}>{item.excerpt}</Text>}
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.card} testID={`feed-item-${item.id}`}>
            <ImageBackground source={{ uri: item.image_url }} style={styles.img} imageStyle={{ borderRadius: RADIUS.lg }}>
              <View style={styles.badge}>
                <Feather name={item.category === "yoga" ? "wind" : item.category === "remedy" ? "coffee" : "sun"} size={12} color={COLORS.surface} />
                <Text style={styles.badgeText}>{(item.category || "tip").toUpperCase()}</Text>
              </View>
            </ImageBackground>
            <View style={styles.pad}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardBody}>{item.body}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isBlog ? "No blog posts yet — pull to refresh." : "No items yet — pull to refresh."}</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, marginTop: 4, letterSpacing: -1 },
  chipsWrap: { maxHeight: 56, marginTop: SPACING.md },
  chipsRow: { paddingHorizontal: SPACING.lg, gap: 8, alignItems: "center", height: 56 },
  chip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  card: { borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  img: { width: "100%", height: 180, justifyContent: "flex-start", padding: SPACING.md },
  badge: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.overlay, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill,
  },
  badgeText: { color: COLORS.surface, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  catLabel: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  authorText: { color: COLORS.textSecondary, fontSize: 11, fontStyle: "italic" },
  pad: { padding: SPACING.md },
  cardTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, lineHeight: 26 },
  cardBody: { color: COLORS.textSecondary, marginTop: 6, fontSize: 14, lineHeight: 20 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.xl },
});
