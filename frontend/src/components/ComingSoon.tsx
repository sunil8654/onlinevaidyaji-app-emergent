// Reusable "Coming Soon" surfaces.
//
// Used wherever a capability is not genuinely available yet. The rule this
// encodes: show the real thing when the backend can serve it, and say plainly
// "coming soon" when it cannot. Never fake the missing half - a made-up slot
// picker or a checkout that writes an order nobody will fulfil is worse than an
// honest notice, because the patient believes it worked.
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import type { ComponentProps } from "react";
import Feather from "@react-native-vector-icons/feather";

import { COLORS, RADIUS, FONTS, SPACING } from "@/src/theme";

/** Derived from the icon component's own props so a typo is a compile error. */
export type IconName = ComponentProps<typeof Feather>["name"];

export function ComingSoonBanner({ label = "Coming soon" }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Feather name="clock" size={11} color={COLORS.surface} />
        <Text style={styles.text}>{label.toUpperCase()}</Text>
      </View>
    </View>
  );
}

type ScreenProps = {
  title: string;
  body: string;
  /** Short bullet list of what will be possible when it launches. */
  features?: string[];
  icon?: IconName;
  onBack?: () => void;
  backLabel?: string;
  testID?: string;
};

/** Full-page Coming Soon state, used when a whole screen has nothing real to show. */
export function ComingSoonScreen({
  title,
  body,
  features = [],
  icon = "clock",
  onBack,
  backLabel = "Go back",
  testID = "coming-soon",
}: ScreenProps) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenPad}
      testID={testID}
    >
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} testID={`${testID}-back`}>
          <Feather name="arrow-left" size={18} color={COLORS.brand} />
          <Text style={styles.backText}>{backLabel}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.heroArt}>
        <View style={styles.heroRing} />
        <View style={styles.iconBig}>
          <Feather name={icon} size={34} color={COLORS.accent} />
        </View>
      </View>

      <View style={styles.pill}>
        <Text style={styles.pillText}>COMING SOON</Text>
      </View>

      <Text style={styles.hero}>{title}</Text>
      <Text style={styles.copy}>{body}</Text>

      {features.length ? (
        <View style={styles.featureCard}>
          {features.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Feather name="check-circle" size={15} color={COLORS.brand} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.footNote}>
        We are not showing sample data here. This section opens when the service
        is live for everyone.
      </Text>
    </ScrollView>
  );
}

type SheetProps = ScreenProps & {
  /** Rendered above the notice - typically the real item the user picked. */
  header?: React.ReactNode;
};

/**
 * Bottom-sheet variant for "you can look, but not transact yet".
 *
 * Keeps the real catalog on screen and makes the missing piece explicit instead
 * of inventing it.
 */
export function ComingSoonSheet({
  title,
  body,
  features = [],
  icon = "clock",
  header,
  onBack,
  testID = "coming-soon-sheet",
}: SheetProps) {
  return (
    <View style={styles.sheetWrap} testID={testID}>
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {header}
        <View style={styles.sheetIcon}>
          <Feather name={icon} size={22} color={COLORS.accent} />
        </View>
        <Text style={styles.sheetPill}>COMING SOON</Text>
        <Text style={styles.sheetTitle}>{title}</Text>
        <Text style={styles.sheetBody}>{body}</Text>

        {features.length ? (
          <View style={styles.sheetFeatures}>
            {features.map((f) => (
              <View key={f} style={styles.featureRow}>
                <Feather name="check-circle" size={14} color={COLORS.brand} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {onBack ? (
          <TouchableOpacity style={styles.sheetBtn} onPress={onBack} testID={`${testID}-close`}>
            <Text style={styles.sheetBtnText}>Got it</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/** Inline notice strip for the top of a screen that is partly real. */
export function ComingSoonNotice({
  text,
  testID = "coming-soon-notice",
}: {
  text: string;
  testID?: string;
}) {
  return (
    <View style={styles.notice} testID={testID}>
      <Feather name="info" size={14} color={COLORS.accent} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

/** Shared empty / error state so every list in the app fails the same way. */
export function ListState({
  icon = "inbox",
  title,
  body,
  actionLabel,
  onAction,
  tone = "neutral",
  testID,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "error";
  testID?: string;
}) {
  const color = tone === "error" ? COLORS.error : COLORS.textMuted;
  return (
    <View style={styles.stateBox} testID={testID}>
      <View
        style={[
          styles.stateIcon,
          tone === "error" && { backgroundColor: "#FDECEC" },
        ]}
      >
        <Feather name={icon} size={22} color={color} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.stateBtn} onPress={onAction} testID={testID ? `${testID}-retry` : undefined}>
          <Text style={styles.stateBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 12, right: 12, zIndex: 3 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  text: { color: COLORS.surface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },

  // ---- full screen ---------------------------------------------------------
  screen: { flex: 1, backgroundColor: COLORS.bg },
  screenPad: { padding: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xxl, alignItems: "center" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6, paddingRight: 12 },
  backText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  heroArt: { alignItems: "center", justifyContent: "center", marginBottom: SPACING.md },
  heroRing: { position: "absolute", width: 132, height: 132, borderRadius: 66, backgroundColor: COLORS.surfaceAlt },
  iconBig: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  pill: { backgroundColor: COLORS.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, marginTop: SPACING.md },
  pillText: { color: COLORS.surface, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  hero: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: SPACING.md, textAlign: "center", letterSpacing: -0.5 },
  copy: { color: COLORS.textSecondary, textAlign: "center", marginTop: 8, fontSize: 14, lineHeight: 21, paddingHorizontal: SPACING.sm },
  featureCard: { alignSelf: "stretch", marginTop: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, gap: 10 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  featureText: { flex: 1, color: COLORS.textPrimary, fontSize: 13, lineHeight: 19 },
  footNote: { color: COLORS.textMuted, fontSize: 11, textAlign: "center", marginTop: SPACING.lg, lineHeight: 17 },

  // ---- bottom sheet --------------------------------------------------------
  sheetWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: SPACING.xl },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.accentSoft, alignItems: "center", justifyContent: "center" },
  sheetPill: { color: COLORS.brand, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: 4 },
  sheetBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 6 },
  sheetFeatures: { marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, gap: 8 },
  sheetBtn: { marginTop: SPACING.lg, backgroundColor: COLORS.brand, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill },
  sheetBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },

  // ---- inline notice -------------------------------------------------------
  notice: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: COLORS.accentSoft, padding: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, borderRadius: RADIUS.md },
  noticeText: { flex: 1, color: COLORS.textPrimary, fontSize: 12, lineHeight: 18 },

  // ---- list state ----------------------------------------------------------
  stateBox: { alignItems: "center", paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg },
  stateIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  stateTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginTop: SPACING.md, textAlign: "center" },
  stateBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: "center" },
  stateBtn: { marginTop: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: 11, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
  stateBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
});
