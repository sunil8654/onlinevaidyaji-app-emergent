import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ImageBackground, RefreshControl, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import DoctorHome from "@/app/doctor/home";
import { Logo } from "@/src/components/Logo";

export default function Home() {
  const { user } = useAuth();
  if (user?.role === "doctor") return <DoctorHome />;
  return <PatientHome />;
}

function PatientHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [tip, setTip] = useState<any>(null);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [appts, setAppts] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c, a] = await Promise.all([
        api.dailyTip(),
        api.listChallenges().catch(() => []),
        api.listAppointments().catch(() => []),
      ]);
      setTip(t);
      setChallenges(c || []);
      setAppts(a || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const hour = new Date().getHours();
  const greet = hour < 12 ? t("good_morning") : hour < 17 ? t("good_afternoon") : t("good_evening");
  const upcoming = appts.find((a) => new Date(a.slot) > new Date());

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Logo size={22} />
            <Text style={styles.greet}>{t("namaste")}, {greet.toLowerCase()}</Text>
            <Text style={styles.name} testID="home-username">{user?.name?.split(" ")[0] || t("friend")}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/(tabs)/profile")} style={styles.avatar} testID="home-profile-avatar">
            <Feather name="user" size={20} color={COLORS.brand} />
          </TouchableOpacity>
        </View>

        {/* Instant consult hero */}
        <TouchableOpacity style={styles.instantHero} onPress={() => router.push("/instant-consult")} testID="home-instant-consult" activeOpacity={0.9}>
          <View style={styles.pulseDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.instantKicker}>⚡  INSTANT VIDEO · UNDER 30 MIN</Text>
            <Text style={styles.instantTitle}>Consult a Vaidya right now</Text>
          </View>
          <Feather name="video" size={22} color={COLORS.surface} />
        </TouchableOpacity>

        {/* Daily Tip Hero */}
        {tip && (
          <TouchableOpacity activeOpacity={0.9} testID="home-daily-tip" style={styles.tipCard}>
            <ImageBackground
              source={{ uri: tip.image_url || "https://images.pexels.com/photos/20689437/pexels-photo-20689437.jpeg" }}
              style={styles.tipBg}
              imageStyle={{ borderRadius: RADIUS.lg }}
            >
              <View style={styles.tipOverlay}>
                <Text style={styles.tipKicker}>{t("todays_tip")}</Text>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipBody} numberOfLines={2}>{tip.body}</Text>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        )}

        {/* Engagement quick actions row — revenue drivers */}
        <View style={styles.engagementRow}>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/shop")} testID="home-shop" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="shopping-bag" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>Pharmacy</Text>
            <Text style={styles.engBadge}>SOON</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/labs")} testID="home-labs" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="activity" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Lab Tests</Text>
            <Text style={styles.engBadge}>SOON</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/diet-plan")} testID="home-diet" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="sunrise" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Diet Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/ai-yoga")} testID="home-yoga" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="wind" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>AI Yoga</Text>
          </TouchableOpacity>
        </View>

        {/* Row 2: water, journal, lifestyle, near-you */}
        <View style={styles.engagementRow}>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/wellness")} testID="home-wellness" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="activity" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Wellness</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/family")} testID="home-family" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="users" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>Family</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/water")} testID="home-water" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="droplet" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Water</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/prakriti-quiz")} testID="home-prakriti" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="feather" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>Prakriti</Text>
          </TouchableOpacity>
        </View>

        {/* Row 3: women, journal, diseases */}
        <View style={styles.engagementRow}>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/womens-health")} testID="home-womens" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="heart" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>Women</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/blogs")} testID="home-blogs" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="book-open" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>Journal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/lifestyle")} testID="home-lifestyle" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="activity" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Diseases</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/knowledge")} testID="home-knowledge-r3" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="book" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Knowledge</Text>
          </TouchableOpacity>
        </View>

        {/* Row 4: rewards, knowledge, quizzes, challenges */}
        <View style={styles.engagementRow}>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/engagement")} testID="home-rewards" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="award" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>Rewards</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/knowledge")} testID="home-knowledge" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="book" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Knowledge</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/quiz")} testID="home-quiz" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: "#FFE082" }]}>
              <Feather name="check-square" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.engLabel}>Quizzes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.engBtn} onPress={() => router.push("/challenges")} testID="home-challenges" activeOpacity={0.85}>
            <View style={[styles.engIcon, { backgroundColor: COLORS.surfaceAlt }]}>
              <Feather name="target" size={16} color={COLORS.brand} />
            </View>
            <Text style={styles.engLabel}>Challenges</Text>
          </TouchableOpacity>
        </View>

        {/* Bento grid */}
        <View style={styles.bento}>
          <TouchableOpacity
            style={[styles.bentoCard, styles.bentoBig, { backgroundColor: COLORS.brand }]}
            onPress={() => router.push("/chatbot")}
            testID="home-open-chatbot"
            activeOpacity={0.9}
          >
            <View>
              <Text style={[styles.bentoKicker, { color: COLORS.accentSoft }]}>{t("ai_symptom_checker")}</Text>
              <Text style={[styles.bentoTitle, { color: COLORS.surface }]}>{t("talk_to_vaidhyaji")}</Text>
            </View>
            <View style={styles.chatAvatar}>
              <Feather name="message-circle" size={20} color={COLORS.brand} />
            </View>
          </TouchableOpacity>

          <View style={{ flex: 1, gap: SPACING.md }}>
            <TouchableOpacity
              style={[styles.bentoCard, styles.bentoSmall]}
              onPress={() => router.push("/(tabs)/consult")}
              testID="home-book-doctor"
              activeOpacity={0.9}
            >
              <Feather name="calendar" size={22} color={COLORS.brand} />
              <Text style={styles.bentoSmallTitle}>{t("book_doctor")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bentoCard, styles.bentoSmall, { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accent }]}
              onPress={() => router.push("/challenges")}
              testID="home-challenges"
              activeOpacity={0.9}
            >
              <Feather name="award" size={22} color={COLORS.accent} />
              <Text style={[styles.bentoSmallTitle, { color: COLORS.accent }]}>{t("wellness_streaks")}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Upcoming appointment */}
        {upcoming && (
          <TouchableOpacity style={styles.upcoming} onPress={() => router.push("/appointments")} testID="home-upcoming-appointment">
            <View style={{ flex: 1 }}>
              <Text style={styles.upcomingKicker}>{t("upcoming_consultation")}</Text>
              <Text style={styles.upcomingTitle}>{upcoming.doctor_name}</Text>
              <Text style={styles.upcomingSub}>{upcoming.doctor_specialty} · {new Date(upcoming.slot).toLocaleString()}</Text>
            </View>
            <View style={styles.upcomingIcon}>
              <Feather name="video" size={18} color={COLORS.surface} />
            </View>
          </TouchableOpacity>
        )}

        {/* Challenges preview */}
        {challenges.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t("community_challenges")}</Text>
              <TouchableOpacity onPress={() => router.push("/challenges")} testID="home-see-all-challenges">
                <Text style={styles.link}>{t("see_all")}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.md, paddingRight: SPACING.md }}>
              {challenges.slice(0, 5).map((c) => (
                <TouchableOpacity key={c.id} style={styles.challengeCard} onPress={() => router.push("/challenges")} testID={`home-challenge-${c.id}`}>
                  <Image source={{ uri: c.image_url }} style={styles.challengeImg} />
                  <View style={styles.challengePad}>
                    <Text style={styles.challengeTitle} numberOfLines={2}>{c.title}</Text>
                    <Text style={styles.challengeMeta}>{c.duration_days} days · {c.badge}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating support-chat bubble */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/support-chat")}
        activeOpacity={0.85}
        testID="home-support-fab"
      >
        <Feather name="headphones" size={20} color={COLORS.surface} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.md },
  greet: { color: COLORS.textSecondary, fontSize: 13, letterSpacing: 0.5 },
  name: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, lineHeight: 34, marginTop: 2 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: "center", justifyContent: "center",
  },
  tipCard: { borderRadius: RADIUS.lg, overflow: "hidden", height: 200, marginBottom: SPACING.md },
  tipBg: { flex: 1 },
  tipOverlay: { flex: 1, padding: SPACING.md, justifyContent: "flex-end", backgroundColor: "rgba(15,76,54,0.55)" },
  tipKicker: { color: COLORS.accentSoft, textTransform: "uppercase", letterSpacing: 3, fontSize: 11, fontWeight: "700" },
  tipTitle: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 26, lineHeight: 30, marginTop: 4 },
  tipBody: { color: "#FFFDF3", marginTop: 4, fontSize: 13, lineHeight: 18 },
  bento: { flexDirection: "row", gap: SPACING.md, marginBottom: SPACING.md },
  bentoCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  bentoBig: { flex: 1.2, height: 220, justifyContent: "space-between" },
  bentoSmall: { flex: 1, height: 102, justifyContent: "space-between" },
  bentoKicker: { textTransform: "uppercase", letterSpacing: 2, fontSize: 10, fontWeight: "700" },
  bentoTitle: { fontFamily: FONTS.heading, fontSize: 26, lineHeight: 28, marginTop: 6, letterSpacing: -0.5 },
  bentoSmallTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, lineHeight: 20 },
  chatAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center",
    alignSelf: "flex-end",
  },
  upcoming: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.surfaceAlt, borderColor: COLORS.brand, borderWidth: 1,
    padding: SPACING.md, borderRadius: RADIUS.lg, marginBottom: SPACING.md,
  },
  upcomingKicker: { textTransform: "uppercase", letterSpacing: 2, fontSize: 10, color: COLORS.brand, fontWeight: "700" },
  upcomingTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: 2 },
  upcomingSub: { color: COLORS.textSecondary, marginTop: 2, fontSize: 12 },
  upcomingIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: SPACING.sm, marginBottom: SPACING.md },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary },
  link: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  challengeCard: {
    width: 220, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
  },
  challengeImg: { width: "100%", height: 110 },
  challengePad: { padding: SPACING.md },
  challengeTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, lineHeight: 22 },
  challengeMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  engagementRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  engBtn: { flex: 1, alignItems: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 8, position: "relative" },
  engIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  engLabel: { fontSize: 10, color: COLORS.textPrimary, fontWeight: "700", textAlign: "center" },
  engBadge: { position: "absolute", top: 4, right: 4, backgroundColor: COLORS.accent, color: COLORS.surface, fontSize: 7, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6, fontWeight: "700", letterSpacing: 0.5, overflow: "hidden" },
  instantHero: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.brand, borderRadius: RADIUS.lg, padding: 12, marginBottom: SPACING.md },
  pulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.accent },
  instantKicker: { color: COLORS.accentSoft, fontSize: 9, letterSpacing: 1.5, fontWeight: "700" },
  instantTitle: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 16, marginTop: 2 },
  fab: {
    position: "absolute", right: 20, bottom: 110,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
  },
});
