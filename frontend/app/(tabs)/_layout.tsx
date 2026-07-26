import { Tabs } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, RADIUS } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth";

type TabDef = { key: string; icon: keyof typeof Feather.glyphMap; label_key: string; label_override?: string };

const PATIENT_TABS: Record<string, TabDef> = {
  home: { key: "home", icon: "home", label_key: "tabs_home" },
  feed: { key: "feed", icon: "book-open", label_key: "tabs_feed" },
  consult: { key: "consult", icon: "activity", label_key: "tabs_consult" },
  reminders: { key: "reminders", icon: "clock", label_key: "tabs_reminders" },
  profile: { key: "profile", icon: "user", label_key: "tabs_profile" },
};

// For doctors: repurpose the same slots with clinic-management labels & icons.
// The underlying tab-screen files also render role-aware content.
const DOCTOR_TABS: Record<string, TabDef> = {
  home: { key: "home", icon: "grid", label_key: "tabs_home", label_override: "Dashboard" },
  feed: { key: "feed", icon: "calendar", label_key: "tabs_feed", label_override: "Appointments" },
  consult: { key: "consult", icon: "users", label_key: "tabs_consult", label_override: "Patients" },
  reminders: { key: "reminders", icon: "trending-up", label_key: "tabs_reminders", label_override: "Earnings" },
  profile: { key: "profile", icon: "user", label_key: "tabs_profile" },
};

function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user } = useAuth();
  const TABS = user?.role === "doctor" ? DOCTOR_TABS : PATIENT_TABS;
  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + 10 }]}>
      <View style={styles.bar}>
        {state.routes.map((route: any, idx: number) => {
          const focused = state.index === idx;
          const def = TABS[route.name];
          if (!def) return null;
          return (
            <TouchableOpacity
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={styles.item}
              activeOpacity={0.8}
              testID={`tab-${def.key}`}
            >
              <View style={[styles.iconWrap, focused && styles.iconActive]}>
                <Feather name={def.icon} size={18} color={focused ? COLORS.surface : COLORS.textSecondary} />
              </View>
              <Text style={[styles.label, focused && { color: COLORS.brand, fontWeight: "700" }]}>
                {def.label_override || t(def.label_key)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: COLORS.bg } }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="consult" />
      <Tabs.Screen name="reminders" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.bg,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 0,
  },
  bar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 6,
    paddingHorizontal: 6,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10 },
      android: { elevation: 3 },
    }),
  },
  item: { flex: 1, alignItems: "center", paddingVertical: 4 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  iconActive: { backgroundColor: COLORS.brand },
  label: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
});
