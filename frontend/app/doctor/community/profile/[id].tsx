// Doctor community profile — stats, follow, and posts grid.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, RefreshControl,
  ActivityIndicator, Alert, Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const { width } = Dimensions.get("window");
const CELL = Math.floor((width - 32 - 4) / 3);

export default function DoctorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, ps] = await Promise.all([api.docComProfile(id), api.docComProfilePosts(id)]);
      setProfile(p);
      setPosts(ps);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Profile not found");
      router.back();
    } finally { setLoading(false); }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  async function toggleFollow() {
    if (!profile) return;
    setFollowBusy(true);
    const wasFollowing = profile.is_following;
    setProfile({ ...profile, is_following: !wasFollowing, followers_count: (profile.followers_count || 0) + (wasFollowing ? -1 : 1) });
    try {
      if (wasFollowing) await api.docComUnfollow(profile.id);
      else await api.docComFollow(profile.id);
    } catch {
      setProfile(profile);
    } finally { setFollowBusy(false); }
  }

  if (loading || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
      }
    >
      <View style={styles.subHead}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="dp-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.subTitle} numberOfLines={1}>{profile.name}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.header}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFB]}>
            <Text style={styles.avatarInitial}>{(profile.name || "D").slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.stats}>
          <Stat label="Posts" value={profile.posts_count} />
          <Stat label="Followers" value={profile.followers_count} />
          <Stat label="Following" value={profile.following_count} />
        </View>
      </View>

      <View style={{ paddingHorizontal: SPACING.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={styles.nameBig}>{profile.name}</Text>
          {profile.verified && <Feather name="check-circle" size={16} color={COLORS.brand} />}
        </View>
        <Text style={styles.specialty}>
          {profile.specialty}{profile.qualification ? ` · ${profile.qualification}` : ""}
        </Text>
        {profile.clinic_name ? <Text style={styles.clinic}>{profile.clinic_name}</Text> : null}
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      </View>

      {!profile.is_me && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.followBtn, profile.is_following && styles.unfollowBtn, followBusy && { opacity: 0.6 }]}
            onPress={toggleFollow}
            disabled={followBusy}
            testID="dp-follow"
          >
            {followBusy ? <ActivityIndicator color={profile.is_following ? COLORS.brand : COLORS.surface} size="small" /> : (
              <>
                <Feather name={profile.is_following ? "user-check" : "user-plus"} size={14} color={profile.is_following ? COLORS.brand : COLORS.surface} />
                <Text style={[styles.followText, profile.is_following && { color: COLORS.brand }]}>
                  {profile.is_following ? "Following" : "Follow"}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push({ pathname: "/doctor/[id]", params: { id: profile.id } })}
            testID="dp-view-booking"
          >
            <Feather name="calendar" size={14} color={COLORS.brand} />
            <Text style={styles.secondaryText}>View booking profile</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.gridLabel}>Posts</Text>
      {posts.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="image" size={22} color={COLORS.brand} />
          <Text style={styles.emptyText}>No posts yet</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {posts.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.cell}
              onPress={() => router.push({ pathname: "/doctor/community/post/[id]", params: { id: p.id } })}
              testID={`dp-post-${p.id}`}
            >
              {p.images?.length ? (
                <Image source={{ uri: p.images[0] }} style={styles.cellImg} />
              ) : (
                <View style={[styles.cellImg, styles.cellText]}>
                  <Text style={styles.cellCaption} numberOfLines={5}>{p.caption}</Text>
                </View>
              )}
              {p.images?.length > 1 && (
                <View style={styles.cellChip}>
                  <Feather name="copy" size={10} color={COLORS.surface} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: any) {
  return (
    <View style={styles.statCol}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  subHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  subTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.textPrimary, flex: 1, textAlign: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: SPACING.lg,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg,
  },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  avatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 36 },
  stats: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  statCol: { alignItems: "center" },
  statVal: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  statLbl: { color: COLORS.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700", marginTop: 2 },
  nameBig: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: SPACING.md },
  specialty: { color: COLORS.brand, fontSize: 13, fontWeight: "700", marginTop: 2 },
  clinic: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  bio: { color: COLORS.textPrimary, fontSize: 13, marginTop: SPACING.sm, lineHeight: 19 },
  actions: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  followBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand,
  },
  unfollowBtn: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand },
  followText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  secondaryBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  secondaryText: { color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  gridLabel: {
    marginTop: SPACING.lg, paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, paddingHorizontal: SPACING.md },
  cell: { width: CELL, height: CELL, position: "relative", backgroundColor: COLORS.surfaceAlt },
  cellImg: { width: "100%", height: "100%" },
  cellText: { padding: SPACING.sm, backgroundColor: COLORS.brand, justifyContent: "center" },
  cellCaption: { color: COLORS.surface, fontSize: 11, lineHeight: 14 },
  cellChip: {
    position: "absolute", top: 4, right: 4,
    width: 18, height: 18, borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  empty: { alignItems: "center", padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, marginTop: 8, fontSize: 13 },
});
