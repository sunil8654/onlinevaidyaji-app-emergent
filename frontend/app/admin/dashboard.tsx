import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ImageBackground } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { Feather } from "@expo/vector-icons";

export default function AdminDashboard() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [stats, setStats] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [refresh, setRefresh] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.adminStats(), api.adminActivity(10)]);
      setStats(s); setActivity(a || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ImageBackground
        source={{ uri: "https://images.pexels.com/photos/7988013/pexels-photo-7988013.jpeg" }}
        style={styles.hero}
      >
        <View style={styles.heroOverlay}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.eyebrow}>{t("admin_dashboard")}</Text>
              <Text style={styles.name}>{user?.name}</Text>
            </View>
            <TouchableOpacity onPress={() => setLang(lang === "en" ? "hi" : "en")} style={styles.langBtn} testID="admin-lang">
              <Feather name="globe" size={12} color="#FFFDF3" />
              <Text style={styles.langText}>{lang === "en" ? "हि" : "EN"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.tag}>{t("overview")} · Online VaidyaJi</Text>
        </View>
      </ImageBackground>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={async () => { setRefresh(true); await load(); setRefresh(false); }} tintColor={COLORS.brand} />}
      >
        {/* Stats bento */}
        <View style={styles.grid}>
          <StatCard icon="users" label={t("patients")} value={stats?.patients ?? "—"} color={COLORS.brand} testID="stat-patients" />
          <StatCard icon="award" label={t("doctors")} value={stats?.verified_doctors ?? "—"} color={COLORS.accent} testID="stat-doctors" />
          <StatCard icon="clock" label={t("pending_approval")} value={stats?.pending_doctors ?? 0} color={COLORS.warning} testID="stat-pending" />
          <StatCard icon="calendar" label={t("appointments")} value={stats?.appointments ?? "—"} color={COLORS.brand} testID="stat-appointments" />
          <StatCard icon="activity" label="Today" value={stats?.consultations_today ?? 0} color={COLORS.accent} testID="stat-today" />
          <StatCard icon="target" label={t("leads")} value={stats?.leads ?? 0} color={COLORS.success} testID="stat-leads" />
        </View>

        <View style={styles.actions}>
          <ActionBtn icon="award" label={t("doctors")} onPress={() => router.push("/admin/doctors")} testID="admin-nav-doctors" />
          <ActionBtn icon="users" label={t("patients")} onPress={() => router.push("/admin/patients")} testID="admin-nav-patients" />
          <ActionBtn icon="phone-call" label="Pre-Sales Queue" onPress={() => router.push("/admin/presales")} testID="admin-nav-presales" />
          <ActionBtn icon="file-text" label="Docs Review" onPress={() => router.push("/admin/documents-review")} testID="admin-nav-docs-review" />
          <ActionBtn icon="user-check" label="Team & Staff" onPress={() => router.push("/admin/staff")} testID="admin-nav-staff" />
          <ActionBtn icon="key" label="Password resets" onPress={() => router.push("/admin/password-resets")} testID="admin-nav-resets" />
          <ActionBtn icon="message-square" label="Doctor Community" onPress={() => router.push("/admin/doctor-community")} testID="admin-nav-doc-community" />
          <ActionBtn icon="list" label={t("activity_log")} onPress={() => router.push("/admin/activity")} testID="admin-nav-activity" />
        </View>

        <Text style={styles.sectionTitle}>{t("activity_log")}</Text>
        {activity.length === 0 ? (
          <Text style={styles.empty}>No activity yet.</Text>
        ) : activity.map((a) => (
          <View key={a.id} style={styles.actCard} testID={`activity-${a.id}`}>
            <View style={styles.actDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.actKind}>{a.kind.replace(/_/g, " ").toUpperCase()}</Text>
              <Text style={styles.actMeta}>
                {a.actor_name || "System"} · {new Date(a.at).toLocaleString()}
              </Text>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.logout} onPress={async () => { await logout(); router.replace("/signup"); }} testID="admin-logout">
          <Feather name="log-out" size={16} color={COLORS.error} />
          <Text style={{ color: COLORS.error, fontWeight: "700" }}>{t("logout")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ icon, label, value, color, testID }: any) {
  return (
    <View style={[styles.stat, { borderColor: color }]} testID={testID}>
      <View style={[styles.statIcon, { backgroundColor: color }]}>
        <Feather name={icon} size={14} color={COLORS.surface} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, testID }: any) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} testID={testID}>
      <View style={styles.actionIcon}>
        <Feather name={icon} size={18} color={COLORS.brand} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      <Feather name="chevron-right" size={18} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  hero: { height: 180 },
  heroOverlay: { flex: 1, backgroundColor: "rgba(15,76,54,0.85)", padding: SPACING.lg, justifyContent: "space-between" },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  name: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 26, marginTop: 6 },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.2)" },
  langText: { color: COLORS.surface, fontSize: 11, fontWeight: "700" },
  tag: { color: COLORS.accentSoft, fontSize: 13 },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md, marginBottom: SPACING.md },
  stat: {
    width: "48%", backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1,
  },
  statIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  statValue: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.textPrimary, lineHeight: 32 },
  statLabel: { color: COLORS.textSecondary, textTransform: "uppercase", fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 2 },
  actions: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  action: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  actionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  actionLabel: { flex: 1, color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: SPACING.md },
  actCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  actDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  actKind: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  actMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  empty: { color: COLORS.textSecondary, textAlign: "center", padding: SPACING.md },
  logout: { marginTop: SPACING.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, backgroundColor: "#FCE8E6", borderRadius: RADIUS.pill },
});
