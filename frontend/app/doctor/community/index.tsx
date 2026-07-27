// Feed — the main Doctor Community landing screen with stories strip.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, RefreshControl, ActivityIndicator, ScrollView,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { DoctorPostCard } from "@/src/components/DoctorPostCard";

export default function DoctorCommunityFeed() {
  const router = useRouter();
  const [posts, setPosts] = useState<any[]>([]);
  const [suggest, setSuggest] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [feed, sug, st] = await Promise.all([
        api.docComFeed(),
        api.docComSuggest().catch(() => []),
        api.docComStoriesFeed().catch(() => ({ items: [] })),
      ]);
      setPosts(feed);
      setSuggest(sug);
      setStories(st.items || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

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
        <View>
          {/* Stories strip */}
          <View style={styles.storyStrip}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingHorizontal: 2 }}>
              {/* Add-story tile always first */}
              <StoryAddTile onPress={() => router.push("/doctor/community/stories/create")} />
              {stories.map((b: any) => (
                <StoryBubble
                  key={b.doctor.id}
                  bucket={b}
                  onPress={() => router.push({ pathname: "/doctor/community/stories/[doctor_id]", params: { doctor_id: b.doctor.id } })}
                />
              ))}
            </ScrollView>
          </View>

          {suggest.length ? (
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
          ) : null}
        </View>
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

function StoryAddTile({ onPress }: any) {
  return (
    <TouchableOpacity style={styles.storyItem} onPress={onPress} testID="story-add">
      <View style={[styles.storyRing, { borderColor: "transparent" }]}>
        <View style={[styles.storyImg, styles.addImg]}>
          <Feather name="plus" size={22} color={COLORS.surface} />
        </View>
      </View>
      <Text style={styles.storyName} numberOfLines={1}>Your story</Text>
    </TouchableOpacity>
  );
}

function StoryBubble({ bucket, onPress }: any) {
  const seen = bucket.all_seen;
  return (
    <TouchableOpacity style={styles.storyItem} onPress={onPress} testID={`story-${bucket.doctor.id}`}>
      <View style={[styles.storyRing, seen ? styles.ringSeen : styles.ringNew]}>
        {bucket.doctor.avatar_url ? (
          <Image source={{ uri: bucket.doctor.avatar_url }} style={styles.storyImg} />
        ) : (
          <View style={[styles.storyImg, styles.storyImgFB]}>
            <Text style={styles.storyInit}>{(bucket.doctor.name || "D").slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
      </View>
      <Text style={styles.storyName} numberOfLines={1}>{bucket.is_me ? "You" : bucket.doctor.name}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  storyStrip: {
    paddingBottom: SPACING.md,
    marginBottom: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  storyItem: { alignItems: "center", width: 72 },
  storyRing: {
    width: 68, height: 68, borderRadius: 34, borderWidth: 2.5,
    padding: 3, alignItems: "center", justifyContent: "center",
  },
  ringNew: { borderColor: COLORS.brand },
  ringSeen: { borderColor: COLORS.border },
  storyImg: { width: "100%", height: "100%", borderRadius: 30, backgroundColor: COLORS.surfaceAlt },
  storyImgFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  storyInit: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 22 },
  addImg: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  storyName: { fontSize: 11, color: COLORS.textPrimary, marginTop: 4, fontWeight: "600", textAlign: "center" },
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
