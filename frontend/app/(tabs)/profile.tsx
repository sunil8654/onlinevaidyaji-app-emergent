import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

export default function Profile() {
  const router = useRouter();
  const { user, logout } = useAuth();
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
            <TouchableOpacity onPress={() => router.push("/auth/health-profile")} style={styles.editBtn} testID="profile-edit">
              <Feather name="edit-2" size={14} color={COLORS.brand} />
              <Text style={styles.editText}>Edit health profile</Text>
            </TouchableOpacity>
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
          <MenuItem icon="calendar" label="My appointments" onPress={() => router.push("/appointments")} testID="profile-menu-appointments" />
          <MenuItem icon="folder" label="Health records vault" onPress={() => router.push("/records")} testID="profile-menu-records" />
          <MenuItem icon="award" label="Challenges & badges" onPress={() => router.push("/challenges")} testID="profile-menu-challenges" />
          <MenuItem icon="message-circle" label="Chat with AI Vaidhyaji" onPress={() => router.push("/chatbot")} testID="profile-menu-chatbot" />
          <MenuItem
            icon="log-out"
            label="Sign out"
            danger
            onPress={async () => { await logout(); router.replace("/onboarding"); }}
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
  card: { margin: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  cardKicker: { textTransform: "uppercase", letterSpacing: 2, color: COLORS.accent, fontSize: 10, fontWeight: "700" },
  doshaHeading: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.pill },
  chipText: { color: COLORS.brand, fontSize: 12, fontWeight: "600" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  editText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  statRow: { flexDirection: "row", marginHorizontal: SPACING.lg, gap: SPACING.md, marginBottom: SPACING.md },
  stat: { flex: 1, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  statNum: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.brand },
  statLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  menu: { marginHorizontal: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: 14, paddingHorizontal: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  menuIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" },
});
