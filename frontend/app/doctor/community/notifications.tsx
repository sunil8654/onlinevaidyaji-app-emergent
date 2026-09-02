// Notifications — likes, comments, follows, mentions, announcements.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, RefreshControl, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const ICON: Record<string, keyof typeof Feather.glyphMap> = {
  like: "heart", comment: "message-circle", follow: "user-plus",
  mention: "at-sign", announcement: "megaphone",
};

const VERB: Record<string, string> = {
  like: "liked your post",
  comment: "commented on your post",
  follow: "started following you",
  mention: "mentioned you",
  announcement: "Official announcement from VaidyaJi",
};

export default function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.docComNotifications();
      setItems(r.items || []);
      await api.docComReadNotifications();
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
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: 80 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
      }
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <Feather name="bell" size={28} color={COLORS.brand} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyBody}>Likes, comments and new followers will appear here.</Text>
        </View>
      )}
      renderItem={({ item: n }) => (
        <TouchableOpacity
          style={[styles.row, !n.read && styles.unread]}
          onPress={() => {
            if (n.type === "follow") {
              router.push({ pathname: "/doctor/community/profile/[id]", params: { id: n.actor_id } });
            } else if (n.post_id) {
              router.push({ pathname: "/doctor/community/post/[id]", params: { id: n.post_id } });
            }
          }}
          testID={`dcom-n-${n.id}`}
        >
          {n.actor?.avatar_url ? (
            <Image source={{ uri: n.actor.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFB]}>
              <Text style={styles.initial}>{(n.actor?.name || "V").slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.iconOverlay}>
            <Feather name={ICON[n.type] || "bell"} size={11} color={COLORS.surface} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>
              {n.type === "announcement" ? (
                <Text style={styles.name}>VaidyaJi Admin </Text>
              ) : (
                <Text style={styles.name}>{n.actor?.name || "A doctor"} </Text>
              )}
              <Text>{VERB[n.type] || n.type}</Text>
            </Text>
            {n.snippet ? <Text style={styles.snippet} numberOfLines={2}>“{n.snippet}”</Text> : null}
            <Text style={styles.time}>{new Date(n.at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
          </View>
          {!n.read && <View style={styles.unreadDot} />}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm, position: "relative",
  },
  unread: { borderColor: COLORS.brand, backgroundColor: COLORS.surfaceAlt },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  initial: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
  iconOverlay: {
    position: "absolute", left: 40, top: 40,
    width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.accent,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.surface,
  },
  body: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 18 },
  name: { fontWeight: "700" },
  snippet: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, fontStyle: "italic" },
  time: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  empty: { alignItems: "center", padding: SPACING.xl },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.sm },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
});
