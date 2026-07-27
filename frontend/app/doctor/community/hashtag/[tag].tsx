// Hashtag view — posts filtered by a tag.
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { DoctorPostCard } from "@/src/components/DoctorPostCard";

export default function HashtagView() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const router = useRouter();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tag) return;
    try {
      const items = await api.docComByHashtag(tag);
      setPosts(items);
    } catch {}
    finally { setLoading(false); }
  }, [tag]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.subHead}>
        <TouchableOpacity onPress={() => router.back()} testID="hash-back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>#{tag}</Text>
        <Text style={styles.count}>{posts.length} posts</Text>
      </View>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
        }
        renderItem={({ item }) => <DoctorPostCard post={item} />}
        ListEmptyComponent={<Text style={styles.empty}>No posts under this tag yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  subHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.brand },
  count: { color: COLORS.textMuted, fontSize: 11, fontWeight: "700" },
  empty: { textAlign: "center", color: COLORS.textMuted, padding: SPACING.xl, fontStyle: "italic" },
});
