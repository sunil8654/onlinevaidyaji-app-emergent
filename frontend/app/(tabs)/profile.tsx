import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import Feather from "@react-native-vector-icons/feather";

export default function Profile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [profile, setProfile] = useState<any>(null);
  const [challenges, setChallenges] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      if (user?.role === "patient") {
        try { setProfile(await api.getPatientProfile()); } catch {}
      }
      try { setChallenges(await api.listChallenges()); } catch {}
    })();
  }, [user]);

  const joined = challenges.filter((c) => c.joined);
  const totalStreak = joined.reduce((s, c) => s + (c.streak || 0), 0);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          <Image
            source={{ uri: "https://images.pexels.com/photos/6663565/pexels-photo-6663565.jpeg" }}
            style={StyleSheet.absoluteFillObject as any}
          />
          <View style={styles.headerOverlay} />
          <View style={styles.headerContent}>
            <View style={styles.avatarBig}>
              <Feather name="user" size={30} color={COLORS.surface} />
            </View>
            <Text style={styles.userName} testID="profile-name">{user?.name}</Text>
            <Text style={styles.userMeta}>{user?.email}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{user?.role?.toUpperCase()}</Text>
            </View>
            {user?.role === "doctor" && (
              <TouchableOpacity
                style={styles.editProfileBtn}
                onPress={() => router.push("/doctor/edit-profile")}
                testID="profile-edit-doctor"
              >
                <Feather name="camera" size={14} color={COLORS.brand} />
                <Text style={styles.editProfileText}>Edit profile & photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {profile && (
          <View style={styles.card}>
            <Text style={styles.cardKicker}>Your dosha</Text>
            <Text style={styles.doshaHeading}>{profile.dosha || "Not set"}</Text>
            <View style={styles.chips}>
              {profile.age ? <View style={styles.chip}><Text style={styles.chipText}>{profile.age} yrs</Text></View> : null}
              {profile.gender ? <View style={styles.chip}><Text style={styles.chipText}>{profile.gender}</Text></View> : null}
              {(profile.conditions || []).map((c: string) => (
                <View key={c} style={[styles.chip, { backgroundColor: COLORS.accentSoft }]}>
                  <Text style={[styles.chipText, { color: COLORS.accent }]}>{c}</Text>
                </View>
              ))}
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity onPress={() => router.push("/prakriti-quiz")} style={styles.prakritiCta} testID="profile-prakriti">
                <Feather name="feather" size={14} color={COLORS.surface} />
                <Text style={styles.prakritiCtaText}>{profile.dosha ? "Retake Prakriti quiz" : "Discover my Prakriti"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/auth/health-profile")} style={styles.editBtn} testID="profile-edit">
                <Feather name="edit-2" size={14} color={COLORS.brand} />
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{totalStreak}</Text>
            <Text style={styles.statLabel}>Total streak</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{joined.length}</Text>
            <Text style={styles.statLabel}>Challenges</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{joined.length}</Text>
            <Text style={styles.statLabel}>Badges</Text>
          </View>
        </View>

        <View style={styles.menu}>
          <MenuItem icon="calendar" label={t("my_appointments")} onPress={() => router.push("/appointments")} testID="profile-menu-appointments" />
          <MenuItem icon="folder" label={t("health_records")} onPress={() => router.push("/records")} testID="profile-menu-records" />
          <MenuItem icon="upload-cloud" label="Health Documents" onPress={() => router.push("/health-documents")} testID="profile-menu-health-docs" />
          <MenuItem icon="droplet" label="Water tracker" onPress={() => router.push("/water")} testID="profile-menu-water" />
          <MenuItem icon="wind" label="AI Yoga classes" onPress={() => router.push("/ai-yoga")} testID="profile-menu-yoga" />
          <MenuItem icon="heart" label="Lifestyle & diseases" onPress={() => router.push("/lifestyle")} testID="profile-menu-lifestyle" />
          <MenuItem icon="award" label={t("community_challenges")} onPress={() => router.push("/challenges")} testID="profile-menu-challenges" />
          <MenuItem icon="message-circle" label={t("talk_to_vaidhyaji")} onPress={() => router.push("/chatbot")} testID="profile-menu-chatbot" />
          <MenuItem icon="headphones" label={t("support_chat")} onPress={() => router.push("/support-chat")} testID="profile-menu-support" />
          <MenuItem icon="info" label="About, policies & contact" onPress={() => router.push("/about")} testID="profile-menu-about" />
          <MenuItem
            icon="globe"
            label={`${t("language")}: ${lang === "en" ? "English" : "हिन्दी"}`}
            onPress={() => setLang(lang === "en" ? "hi" : "en")}
            testID="profile-menu-language"
          />
          <MenuItem
            icon="log-out"
            label={t("logout")}
            danger
            onPress={async () => { await logout(); router.replace("/signup"); }}
            testID="profile-menu-logout"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({ icon, label, onPress, danger, testID }: any) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} testID={testID}>
      <View style={[styles.menuIcon, danger && { backgroundColor: "#FCE8E6" }]}>
        <Feather name={icon} size={16} color={danger ? COLORS.error : COLORS.brand} />
      </View>
      <Text style={[styles.menuLabel, danger && { color: COLORS.error }]}>{label}</Text>
      <Feather name="chevron-right" size={18} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { height: 240, overflow: "hidden" },
  headerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,76,54,0.78)" },
  headerContent: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.md },
  avatarBig: { width: 76, height: 76, borderRadius: 38, backgroundColor: COLORS.brand, borderWidth: 3, borderColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  userName: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 26, marginTop: 10, letterSpacing: -0.5 },
  userMeta: { color: COLORS.accentSoft, marginTop: 2, fontSize: 13 },
  rolePill: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: COLORS.accent, borderRadius: RADIUS.pill },
  rolePillText: { color: COLORS.surface, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  editProfileBtn: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.brand, backgroundColor: COLORS.surface },
  editProfileText: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  card: { margin: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  cardKicker: { textTransform: "uppercase", letterSpacing: 2, color: COLORS.accent, fontSize: 10, fontWeight: "700" },
  doshaHeading: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.pill },
  chipText: { color: COLORS.brand, fontSize: 12, fontWeight: "600" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  editText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: 12 },
  prakritiCta: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: COLORS.brand, paddingVertical: 10, borderRadius: RADIUS.pill },
  prakritiCtaText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  statRow: { flexDirection: "row", marginHorizontal: SPACING.lg, gap: SPACING.md, marginBottom: SPACING.md },
  stat: { flex: 1, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  statNum: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.brand },
  statLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  menu: { marginHorizontal: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: 14, paddingHorizontal: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  menuIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" },
});
