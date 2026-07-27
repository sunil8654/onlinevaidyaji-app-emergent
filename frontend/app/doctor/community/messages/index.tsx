// Doctor DM — thread list (inbox).
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

function fmtWhen(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
    return d.toLocaleDateString();
  } catch { return ""; }
}

export default function MessagesInbox() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.docComDMThreads();
      setItems(res.items || []);
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
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="dm-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Messages</Text>
        <TouchableOpacity
          onPress={() => router.push("/doctor/community/explore")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="dm-new"
        >
          <Feather name="edit" size={20} color={COLORS.brand} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
        }
        contentContainerStyle={{ paddingBottom: 80 }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push({ pathname: "/doctor/community/messages/[id]", params: { id: item.id, name: item.other?.name || "Doctor" } })}
            testID={`dm-thread-${item.id}`}
          >
            {item.other?.avatar_url ? (
              <Image source={{ uri: item.other.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFB]}>
                <Text style={styles.avatarInitial}>{(item.other?.name || "D").slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.other?.name || "Doctor"}</Text>
                  {item.other?.verified && <Feather name="check-circle" size={12} color={COLORS.brand} />}
                </View>
                <Text style={styles.time}>{fmtWhen(item.last_at)}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
                <Text style={[styles.preview, item.unread > 0 && { fontWeight: "700", color: COLORS.textPrimary }]} numberOfLines={1}>
                  {item.last_message || "Say hello 👋"}
                </Text>
                {item.unread > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{item.unread > 9 ? "9+" : item.unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="message-circle" size={30} color={COLORS.surface} />
            </View>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptyBody}>
              Start a chat with any verified doctor from their profile.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/doctor/community/explore")}>
              <Feather name="search" size={14} color={COLORS.surface} />
              <Text style={styles.emptyBtnText}>Find doctors</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  row: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    backgroundColor: COLORS.bg,
  },
  sep: { height: 1, backgroundColor: COLORS.border, marginLeft: 72 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.surfaceAlt },
  avatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 20 },
  name: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  time: { color: COLORS.textMuted, fontSize: 11 },
  preview: { color: COLORS.textSecondary, fontSize: 13, flex: 1, marginRight: SPACING.sm },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: COLORS.brand, paddingHorizontal: 6,
    alignItems: "center", justifyContent: "center",
  },
  unreadText: { color: COLORS.surface, fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", padding: SPACING.lg, marginTop: SPACING.xl },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: SPACING.sm, marginBottom: SPACING.md },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill },
  emptyBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
});
