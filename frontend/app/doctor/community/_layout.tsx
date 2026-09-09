// Doctor Community — layout with access gate + top bar navigation.
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Slot, useRouter, usePathname, useFocusEffect } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

// Routes that should render full-screen without the community top bar.
const FULL_SCREEN_ROUTES = [
  "/doctor/community/stories/",
  "/doctor/community/messages/",
  "/doctor/community/reels",
];

export default function DoctorCommunityLayout() {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<"loading" | "ok" | "blocked">("loading");
  const [reason, setReason] = useState<string>("");
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);

  const loadCounters = useCallback(async () => {
    try {
      const [n, d] = await Promise.all([
        api.docComNotifications().catch(() => ({ unread: 0, items: [] } as any)),
        api.docComDMThreads().catch(() => ({ unread_total: 0, items: [] } as any)),
      ]);
      setUnread(n.unread || 0);
      setDmUnread(d.unread_total || 0);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.docComAccess();
        if (r.has_access) {
          setState("ok");
          loadCounters();
        } else {
          setReason(r.reason || "");
          setState("blocked");
        }
      } catch {
        setReason("error");
        setState("blocked");
      }
    })();
  }, [loadCounters]);

  useFocusEffect(useCallback(() => {
    if (state === "ok") loadCounters();
  }, [state, loadCounters]));

  if (state === "loading") {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  if (state === "blocked") {
    const messages: Record<string, { title: string; body: string; showContact: boolean }> = {
      patient_role: {
        title: "For verified doctors only",
        body: "This community is a professional network for verified AYUSH practitioners. Patients cannot join.",
        showContact: false,
      },
      not_verified: {
        title: "Verification pending",
        body: "Your doctor account is waiting for admin verification. Please make sure you've completed onboarding with your registration number and degree, then reach out to us.",
        showContact: true,
      },
      banned: {
        title: "Access suspended",
        body: "Your access to the community has been suspended by moderators. Please contact support if you believe this is a mistake.",
        showContact: true,
      },
    };
    const info = messages[reason] || {
      title: "Access denied",
      body: "You don't have access to the Doctor Community.",
      showContact: false,
    };
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={{ padding: SPACING.lg }}>
          <TouchableOpacity onPress={() => router.back()} testID="dcom-block-back" style={{ width: 40 }}>
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.blockedCard}>
          <View style={styles.blockIcon}>
            <Feather name="shield" size={30} color={COLORS.surface} />
          </View>
          <Text style={styles.blockTitle}>{info.title}</Text>
          <Text style={styles.blockBody}>{info.body}</Text>
          {info.showContact && (
            <Text style={styles.contact}>Email: info@onlinevaidyaji.com  ·  +91 84680 08464</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // Full-screen sub-routes: no top bar, own SafeAreaView.
  const isFullScreen = path ? FULL_SCREEN_ROUTES.some((p) => path.startsWith(p)) : false;
  if (isFullScreen) {
    return <Slot />;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Vaidya Charcha</Text>
          <Text style={styles.title}>Doctor Community</Text>
        </View>
        <View style={styles.topActions}>
          <TabIcon icon="home" active={path === "/doctor/community"} onPress={() => router.push("/doctor/community")} testID="dcom-tab-feed" />
          <TabIcon icon="search" active={path?.includes("explore")} onPress={() => router.push("/doctor/community/explore")} testID="dcom-tab-explore" />
          <TabIcon icon="film" active={path?.includes("/reels")} onPress={() => router.push("/doctor/community/reels")} testID="dcom-tab-reels" />
          <TabIcon icon="plus-square" active={path?.includes("/create")} onPress={() => router.push("/doctor/community/create")} testID="dcom-tab-create" />
          <TabIcon
            icon="send"
            active={path?.includes("/messages")}
            onPress={() => router.push("/doctor/community/messages")}
            badge={dmUnread}
            testID="dcom-tab-dm"
          />
          <TabIcon
            icon="bell"
            active={path?.includes("/notifications")}
            onPress={() => router.push("/doctor/community/notifications")}
            badge={unread}
            testID="dcom-tab-notif"
          />
        </View>
      </View>
      <Slot />
    </SafeAreaView>
  );
}

function TabIcon({ icon, active, onPress, badge, testID }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.tabIcon} testID={testID} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Feather name={icon} size={19} color={active ? COLORS.brand : COLORS.textPrimary} />
      {badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { justifyContent: "center", alignItems: "center" },
  topBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 9, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  topActions: { flexDirection: "row", gap: 2 },
  tabIcon: { padding: 7, position: "relative" },
  badge: {
    position: "absolute", top: 2, right: 2,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    backgroundColor: COLORS.error,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: COLORS.surface, fontSize: 9, fontWeight: "700" },
  blockedCard: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
    padding: SPACING.lg, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    alignItems: "center",
  },
  blockIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  blockTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginBottom: SPACING.sm, textAlign: "center" },
  blockBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: SPACING.md },
  contact: { color: COLORS.brand, fontWeight: "700", fontSize: 12, marginTop: SPACING.sm, textAlign: "center" },
});
