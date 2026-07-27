// Feed — the main Doctor Community landing screen.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, RefreshControl, ActivityIndicator, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { DoctorPostCard } from "@/src/components/DoctorPostCard";

export default function DoctorCommunityFeed() {
  const router = useRouter();
  const [posts, setPosts] = useState<any[]>([]);
  const [suggest, setSuggest] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [feed, sug] = await Promise.all([
        api.docComFeed(),
        api.docComSuggest().catch(() => []),
      ]);
      setPosts(feed);
      setSuggest(sug);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: 80 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
      }
      renderItem={({ item }) => <DoctorPostCard post={item} />}
      ListHeaderComponent={
        suggest.length ? (
          <View style={styles.suggestBlock}>
            <View style={styles.sHead}>
              <Text style={styles.sTitle}>Suggested doctors</Text>
              <TouchableOpacity onPress={() => router.push("/doctor/community/explore")}>
                <Text style={styles.sMore}>See all</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm }}>
              {suggest.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={styles.sCard}
                  onPress={() => router.push({ pathname: "/doctor/community/profile/[id]", params: { id: d.id } })}
                  testID={`dcom-suggest-${d.id}`}
                >
                  {d.avatar_url ? (
                    <Image source={{ uri: d.avatar_url }} style={styles.sAvatar} />
                  ) : (
                    <View style={[styles.sAvatar, styles.sAvatarFB]}>
                      <Text style={styles.sInitial}>{(d.name || "D").slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Text style={styles.sName} numberOfLines={1}>{d.name}</Text>
                    {d.verified && <Feather name="check-circle" size={11} color={COLORS.brand} />}
                  </View>
                  <Text style={styles.sSpecialty} numberOfLines={1}>{d.specialty || "AYUSH Doctor"}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null
      }
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Feather name="users" size={30} color={COLORS.surface} />
          </View>
          <Text style={styles.emptyTitle}>Welcome to Vaidya Charcha</Text>
          <Text style={styles.emptyBody}>
            A quiet, verified space for AYUSH doctors to share cases, insights and grow together. Post something to get started, or follow a few peers to fill your feed.
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/doctor/community/create")}>
            <Feather name="plus" size={16} color={COLORS.surface} />
            <Text style={styles.emptyBtnText}>Create your first post</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  suggestBlock: { marginBottom: SPACING.md },
  sHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.sm },
  sTitle: { textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  sMore: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  sCard: {
    width: 130, backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.sm, alignItems: "center",
  },
  sAvatar: { width: 56, height: 56, borderRadius: 28, marginBottom: 8 },
  sAvatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  sInitial: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 22 },
  sName: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 12 },
  sSpecialty: { color: COLORS.textMuted, fontSize: 10, marginTop: 2, textAlign: "center" },
  empty: { alignItems: "center", padding: SPACING.lg, marginTop: SPACING.lg },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: SPACING.sm, marginBottom: SPACING.md },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill },
  emptyBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
});
