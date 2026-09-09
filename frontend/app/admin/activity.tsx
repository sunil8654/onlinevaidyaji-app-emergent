import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import Feather from "@react-native-vector-icons/feather";

const ICON: Record<string, any> = {
  patient_registered: "user-plus",
  doctor_enrolled: "user-plus",
  appointment_booked: "calendar",
  admin_doctor_approved: "check-circle",
  admin_doctor_rejected: "alert-circle",
  admin_doctor_removed: "trash-2",
  admin_doctor_added: "plus-circle",
  admin_doctor_edited: "edit-2",
  lead_captured: "target",
};

export default function AdminActivity() {
  const router = useRouter();
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [refresh, setRefresh] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.adminActivity(200)); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="al-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>{t("admin_dashboard")}</Text>
          <Text style={styles.title}>{t("activity_log")}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={<Text style={styles.empty}>No activity.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row} testID={`al-${item.id}`}>
            <View style={styles.iconBox}>
              <Feather name={ICON[item.kind] || "info"} size={16} color={COLORS.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kind}>{item.kind.replace(/_/g, " ")}</Text>
              <Text style={styles.meta}>
                {item.actor_name || "System"} · {new Date(item.at).toLocaleString()}
              </Text>
              {item.meta && Object.keys(item.meta).length > 0 ? (
                <Text style={styles.metaKv}>{Object.entries(item.meta).map(([k, v]) => `${k}: ${v}`).join(" · ")}</Text>
              ) : null}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  row: { flexDirection: "row", gap: 12, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  iconBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  kind: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary, textTransform: "capitalize" },
  meta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  metaKv: { color: COLORS.accent, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
});
