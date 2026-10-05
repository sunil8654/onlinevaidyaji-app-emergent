import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api, type PatientProfile } from "@/src/api";
import { useI18n } from "@/src/i18n";
import Feather from "@react-native-vector-icons/feather";

export default function Profile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [engagement, setEngagement] = useState<{
    streak_current: number;
    badges_earned: number;
    badges_total: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      if (user?.role === "patient") {
        // Independent reads, so one slow endpoint can't blank the whole screen.
        const [p, c, e] = await Promise.allSettled([
          api.getPatientProfile(),
          api.listChallenges(),
          api.engagementMe(),
        ]);
        if (p.status === "fulfilled") setProfile(p.value);
        if (c.status === "fulfilled") setChallenges(c.value);
        if (e.status === "fulfilled") {
          setEngagement({
            streak_current: e.value.streak_current,
            badges_earned: e.value.badges_earned,
            badges_total: e.value.badges_total,
          });
        }
      } else {
        try { setChallenges(await api.listChallenges()); } catch {}
      }
    })();
  }, [user]);

  const joined = challenges.filter((c) => c.joined);
  // Real numbers only. The previous "Badges" tile just repeated the challenge
  // count, so a patient with zero badges still saw a number.
  const totalStreak = engagement?.streak_current ?? 0;
  const badgesEarned = engagement?.badges_earned ?? 0;
  const badgesTotal = engagement?.badges_total ?? 0;

  // Identity + photo come from the backend, which reads the same `users` row
  // the website uses. Fall back to the session user while loading.
  const name = profile?.name || user?.name || "";
  const email = profile?.email || user?.email || "";
  const phone = profile?.phone || user?.phone || "";
  const photo = profile?.photo_url || profile?.image || user?.profile_photo || null;
  const initials = name
    .split(" ").filter(Boolean).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join("") || "?";
  const isPatient = user?.role === "patient";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.avatarBig} testID="profile-avatar">
              {photo ? (
                <Image source={{ uri: photo }} style={styles.avatarImg} testID="profile-avatar-photo" />
              ) : (
                <Text style={styles.avatarInitials}>{initials}</Text>
              )}
            </View>
            <Text style={styles.userName} testID="profile-name">{name}</Text>
            {phone ? (
              <Text style={styles.userMeta} testID="profile-phone">
                <Feather name="phone" size={11} color={COLORS.surface} /> {phone}
              </Text>
            ) : null}
            {email ? <Text style={styles.userMeta} testID="profile-email">{email}</Text> : null}
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{user?.role?.toUpperCase()}</Text>
            </View>
            {isPatient ? (
              <TouchableOpacity
                style={styles.editProfileBtn}
                onPress={() => router.push("/patient/edit-profile")}
                testID="profile-edit-patient"
              >
                <Feather name="edit-2" size={14} color={COLORS.brand} />
                <Text style={styles.editProfileText}>Edit profile</Text>
              </TouchableOpacity>
            ) : user?.role === "doctor" ? (
              <TouchableOpacity
                style={styles.editProfileBtn}
                onPress={() => router.push("/doctor/edit-profile")}
                testID="profile-edit-doctor"
              >
                <Feather name="camera" size={14} color={COLORS.brand} />
                <Text style={styles.editProfileText}>Edit profile & photo</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {isPatient && (
          <View style={styles.card} testID="patient-details-card">
            <Text style={styles.cardKicker}>Personal details</Text>
            <Text style={styles.pdSummary}>
              Age, gender, address and contact details live on their own page now.
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/patient/personal-details")}
              style={styles.pdLink}
              testID="pd-view-all"
            >
              <Feather name="user" size={14} color={COLORS.brand} />
              <Text style={styles.pdLinkText}>View &amp; edit personal details</Text>
              <Feather name="chevron-right" size={16} color={COLORS.brand} />
            </TouchableOpacity>
          </View>
        )}

        {profile && (
          <View style={styles.card}>
            <Text style={styles.cardKicker}>Your dosha</Text>
            <Text style={styles.doshaHeading}>{profile.dosha || "Not set"}</Text>
            <View style={styles.chips}>
              {profile.age ? <View style={styles.chip}><Text style={styles.chipText}>{profile.age} yrs</Text></View> : null}
              {profile.gender ? <View style={styles.chip}><Text style={styles.chipText}>{profile.gender}</Text></View> : null}
              {(profile.conditions || []).map((c: string) => (
                <View key={c} style={styles.chip}>
                  <Text style={styles.chipText}>{c}</Text>
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
            <Text style={styles.statLabel}>Day streak</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{joined.length}</Text>
            <Text style={styles.statLabel}>Challenges</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>
              {badgesTotal ? badgesEarned : "—"}
            </Text>
            <Text style={styles.statLabel}>
              {badgesTotal ? `of ${badgesTotal} badges` : "Badges"}
            </Text>
          </View>
        </View>

        <View style={styles.menu}>
          {/* Patients only. `/patient/personal-details` reads GET /api/patient/profile,
              which answers 403 for a doctor, so a shared row would dead-end
              every doctor on an error screen. */}
          {isPatient ? (
            <MenuItem
              icon="user"
              label="Personal details"
              onPress={() => router.push("/patient/personal-details")}
              testID="profile-menu-personal-details"
            />
          ) : null}
          <MenuItem
            icon="calendar"
            label={t("my_appointments")}
            onPress={() =>
              isPatient
                ? router.push("/appointments")
                : router.push({ pathname: "/doctor/appointments-list", params: { standalone: "1" } })
            }
            testID="profile-menu-appointments"
          />
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
  // `minHeight` + natural growth, not a fixed `height`: at 240px the "Edit
  // profile" pill and the role badge fell outside the box and `overflow:
  // "hidden"` silently ate them on short/large-font devices.
  header: { minHeight: 260, overflow: "hidden", backgroundColor: COLORS.brand },
  headerContent: { minHeight: 260, alignItems: "center", justifyContent: "center", padding: SPACING.md, paddingTop: SPACING.xl },
  // Translucent fill, not `COLORS.brand`: the header behind it is now solid
  // brand green, so a green avatar circle would have disappeared into it.
  avatarBig: { width: 76, height: 76, borderRadius: 38, backgroundColor: "rgba(255,255,255,0.22)", borderWidth: 3, borderColor: COLORS.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitials: { color: COLORS.surface, fontSize: 28, fontWeight: "700" },
  pdSummary: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 },
  pdLink: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: SPACING.md,
    paddingVertical: 12, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
  },
  pdLinkText: { flex: 1, color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  userName: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 26, marginTop: 10, letterSpacing: -0.5 },
  userMeta: { color: COLORS.surface, marginTop: 2, fontSize: 13 },
  rolePill: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: COLORS.accent, borderRadius: RADIUS.pill },
  rolePillText: { color: COLORS.surface, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  editProfileBtn: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.brand, backgroundColor: COLORS.surface },
  editProfileText: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  card: { margin: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  cardKicker: { textTransform: "uppercase", letterSpacing: 2, color: COLORS.accent, fontSize: 10, fontWeight: "700" },
  doshaHeading: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.pill },
  chipText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "600" },
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
