// Doctor community profile — Facebook-style profile with cover, about, clinic, posts.
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
  const [reels, setReels] = useState<any[]>([]);
  const [tab, setTab] = useState<"posts" | "reels" | "about">("posts");
  const [loading, setLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dmBusy, setDmBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, ps, rs] = await Promise.all([
        api.docComProfile(id),
        api.docComProfilePosts(id),
        api.docComReelsBy(id).catch(() => ({ items: [] })),
      ]);
      setProfile(p);
      setPosts(ps);
      setReels(rs.items || []);
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

  async function openDM() {
    if (!profile || dmBusy) return;
    setDmBusy(true);
    try {
      const thread = await api.docComDMStart(profile.id);
      router.push({ pathname: "/doctor/community/messages/[id]", params: { id: thread.id, name: profile.name } });
    } catch (e: any) {
      Alert.alert("Could not start chat", e?.message || "Try again");
    } finally { setDmBusy(false); }
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
      {/* Sub header */}
      <View style={styles.subHead}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="dp-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.subTitle} numberOfLines={1}>{profile.name}</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Cover strip */}
      <View style={styles.cover} />

      {/* Avatar overlaps cover */}
      <View style={styles.avatarWrap}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFB]}>
            <Text style={styles.avatarInitial}>{(profile.name || "D").slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
      </View>

      {/* Name + specialty + verified */}
      <View style={styles.identity}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          <Text style={styles.nameBig}>{profile.name}</Text>
          {profile.verified && <Feather name="check-circle" size={18} color={COLORS.brand} />}
        </View>
        <Text style={styles.specialty}>
          {profile.specialty || "AYUSH Doctor"}
          {profile.qualification ? ` · ${profile.qualification}` : ""}
        </Text>
        {profile.experience_years > 0 && (
          <Text style={styles.subMeta}>
            <Feather name="award" size={11} color={COLORS.textMuted} /> {profile.experience_years} year{profile.experience_years > 1 ? "s" : ""} of experience
          </Text>
        )}
      </View>

      {/* Stats row */}
      <View style={styles.stats}>
        <Stat label="Posts" value={profile.posts_count || 0} />
        <View style={styles.statDivider} />
        <Stat label="Followers" value={profile.followers_count || 0} />
        <View style={styles.statDivider} />
        <Stat label="Following" value={profile.following_count || 0} />
      </View>

      {/* Actions row */}
      {!profile.is_me ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, profile.is_following && styles.followingBtn, followBusy && { opacity: 0.6 }]}
            onPress={toggleFollow}
            disabled={followBusy}
            testID="dp-follow"
          >
            {followBusy ? <ActivityIndicator color={profile.is_following ? COLORS.brand : COLORS.surface} size="small" /> : (
              <>
                <Feather name={profile.is_following ? "user-check" : "user-plus"} size={14} color={profile.is_following ? COLORS.brand : COLORS.surface} />
                <Text style={[styles.primaryText, profile.is_following && { color: COLORS.brand }]}>
                  {profile.is_following ? "Following" : "Follow"}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.messageBtn} onPress={openDM} disabled={dmBusy} testID="dp-message">
            <Feather name="message-circle" size={14} color={COLORS.brand} />
            <Text style={styles.secondaryText}>Message</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.messageBtn}
            onPress={() => router.push("/doctor/edit-profile")}
            testID="dp-edit"
          >
            <Feather name="edit-3" size={14} color={COLORS.brand} />
            <Text style={styles.secondaryText}>Edit profile</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* About + Clinic cards */}
      {(profile.bio || profile.clinic_name || profile.clinic_address) && (
        <View style={styles.infoBlock}>
          {profile.bio ? (
            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>About</Text>
              <Text style={styles.cardBody}>{profile.bio}</Text>
            </View>
          ) : null}

          {(profile.clinic_name || profile.clinic_address) && (
            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Clinic</Text>
              {profile.clinic_name ? (
                <View style={styles.iconRow}>
                  <Feather name="home" size={14} color={COLORS.brand} />
                  <Text style={styles.iconRowText}>{profile.clinic_name}</Text>
                </View>
              ) : null}
              {profile.clinic_address ? (
                <View style={styles.iconRow}>
                  <Feather name="map-pin" size={14} color={COLORS.brand} />
                  <Text style={styles.iconRowText}>{profile.clinic_address}</Text>
                </View>
              ) : null}
              {profile.consultation_fee > 0 && (
                <View style={styles.iconRow}>
                  <Feather name="tag" size={14} color={COLORS.brand} />
                  <Text style={styles.iconRowText}>Consultation ₹{profile.consultation_fee}</Text>
                </View>
              )}
              {profile.languages?.length ? (
                <View style={styles.iconRow}>
                  <Feather name="globe" size={14} color={COLORS.brand} />
                  <Text style={styles.iconRowText}>{profile.languages.join(", ")}</Text>
                </View>
              ) : null}
              {!profile.is_me && (
                <TouchableOpacity
                  style={styles.bookBtn}
                  onPress={() => router.push({ pathname: "/doctor/[id]", params: { id: profile.id } })}
                  testID="dp-view-booking"
                >
                  <Feather name="calendar" size={14} color={COLORS.surface} />
                  <Text style={styles.bookBtnText}>View booking profile</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabsRow}>
        <TabPill label="Posts" active={tab === "posts"} onPress={() => setTab("posts")} testID="dp-tab-posts" />
        <TabPill label="Reels" active={tab === "reels"} onPress={() => setTab("reels")} testID="dp-tab-reels" />
        <TabPill label="About" active={tab === "about"} onPress={() => setTab("about")} testID="dp-tab-about" />
      </View>

      {tab === "posts" && (
        posts.length === 0 ? (
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
        )
      )}

      {tab === "reels" && (
        reels.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="film" size={22} color={COLORS.brand} />
            <Text style={styles.emptyText}>No reels yet</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {reels.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.cell}
                onPress={() => router.push({ pathname: "/doctor/community/reels", params: { start: r.id } })}
                testID={`dp-reel-${r.id}`}
              >
                {r.thumbnail_url ? (
                  <Image source={{ uri: r.thumbnail_url }} style={styles.cellImg} />
                ) : (
                  <View style={[styles.cellImg, styles.cellText]}>
                    <Feather name="play" size={22} color={COLORS.surface} />
                  </View>
                )}
                <View style={styles.reelBadge}>
                  <Feather name="play" size={10} color={COLORS.surface} />
                  <Text style={styles.reelViews}>{r.views_count || 0}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )
      )}

      {tab === "about" && (
        <View style={{ paddingHorizontal: SPACING.lg, gap: SPACING.md }}>
          <AboutRow icon="briefcase" label="Specialty" value={profile.specialty || "—"} />
          <AboutRow icon="award" label="Qualification" value={profile.qualification || "—"} />
          <AboutRow icon="clock" label="Experience" value={profile.experience_years > 0 ? `${profile.experience_years} years` : "—"} />
          <AboutRow icon="globe" label="Languages" value={profile.languages?.length ? profile.languages.join(", ") : "—"} />
          <AboutRow icon="home" label="Clinic" value={profile.clinic_name || "—"} />
          <AboutRow icon="map-pin" label="Address" value={profile.clinic_address || "—"} multiline />
          <AboutRow icon="tag" label="Consultation fee" value={profile.consultation_fee > 0 ? `₹${profile.consultation_fee}` : "—"} />
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

function TabPill({ label, active, onPress, testID }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tabPill, active && styles.tabPillActive]} testID={testID}>
      <Text style={[styles.tabPillText, active && styles.tabPillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AboutRow({ icon, label, value, multiline }: any) {
  return (
    <View style={styles.aboutRow}>
      <View style={styles.aboutIcon}>
        <Feather name={icon} size={16} color={COLORS.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.aboutLabel}>{label}</Text>
        <Text style={styles.aboutValue} numberOfLines={multiline ? 4 : 2}>{value}</Text>
      </View>
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
  cover: { height: 110, backgroundColor: COLORS.brand, opacity: 0.85 },
  avatarWrap: {
    alignItems: "center", marginTop: -50,
  },
  avatar: {
    width: 108, height: 108, borderRadius: 54,
    borderWidth: 4, borderColor: COLORS.bg,
    backgroundColor: COLORS.surfaceAlt,
  },
  avatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 44 },
  identity: {
    alignItems: "center", paddingHorizontal: SPACING.lg, marginTop: SPACING.sm,
  },
  nameBig: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary },
  specialty: { color: COLORS.brand, fontSize: 13, fontWeight: "700", marginTop: 4, textAlign: "center" },
  subMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  stats: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    paddingVertical: SPACING.md, marginTop: SPACING.md,
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  statCol: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, height: 30, backgroundColor: COLORS.border },
  statVal: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  statLbl: { color: COLORS.textMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700", marginTop: 2 },
  actions: {
    flexDirection: "row", gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, marginTop: SPACING.md,
  },
  primaryBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 11, borderRadius: RADIUS.md, backgroundColor: COLORS.brand,
  },
  followingBtn: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand },
  primaryText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  messageBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 11, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand,
  },
  secondaryText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  infoBlock: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md, gap: SPACING.md },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
  },
  cardEyebrow: {
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
    marginBottom: SPACING.sm,
  },
  cardBody: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 19 },
  iconRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginBottom: 6 },
  iconRowText: { color: COLORS.textPrimary, fontSize: 13, flex: 1 },
  bookBtn: {
    marginTop: SPACING.sm, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, backgroundColor: COLORS.brand, paddingVertical: 10, borderRadius: RADIUS.pill,
  },
  bookBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  tabsRow: {
    flexDirection: "row", gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.sm,
  },
  tabPill: {
    flex: 1, paddingVertical: 10, alignItems: "center",
    backgroundColor: COLORS.surface, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabPillActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tabPillText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 12 },
  tabPillTextActive: { color: COLORS.surface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, paddingHorizontal: SPACING.md },
  cell: { width: CELL, height: CELL, position: "relative", backgroundColor: COLORS.surfaceAlt },
  cellImg: { width: "100%", height: "100%" },
  cellText: { padding: SPACING.sm, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  cellCaption: { color: COLORS.surface, fontSize: 11, lineHeight: 14, textAlign: "center" },
  cellChip: {
    position: "absolute", top: 4, right: 4,
    width: 18, height: 18, borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  reelBadge: {
    position: "absolute", bottom: 4, left: 4,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3,
  },
  reelViews: { color: COLORS.surface, fontSize: 9, fontWeight: "700" },
  empty: { alignItems: "center", padding: SPACING.xl, marginTop: SPACING.md },
  emptyText: { color: COLORS.textMuted, marginTop: 8, fontSize: 13 },
  aboutRow: {
    flexDirection: "row", gap: SPACING.md, alignItems: "flex-start",
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
  },
  aboutIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  aboutLabel: {
    textTransform: "uppercase", letterSpacing: 1, fontSize: 10, color: COLORS.textMuted, fontWeight: "700",
    marginBottom: 2,
  },
  aboutValue: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 18 },
});
