// Catches render-time throws and shows a recoverable screen instead of letting
// the JS thread die.
//
// Without this, a single TypeError thrown while rendering a screen is fatal: on
// a release build the app terminates and the patient just sees it close. That is
// what "the page crashed and the app closed" always turned out to be - never a
// native crash, always an unhandled JS exception during render.
//
// This is deliberately a last-resort net, not a substitute for fixing the throw.
// The message is surfaced verbatim (minus the component stack) because that is
// the only clue whoever hits this will get.
import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";

import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept out of the UI: a component stack is noise to a patient but it is the
    // single most useful thing to have when tracking the throw down.
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) return <Fallback error={this.state.error} onRetry={this.reset} />;
    return this.props.children;
  }
}

function Fallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const router = useRouter();
  const goHome = () => {
    onRetry();
    router.replace("/(tabs)/home");
  };
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconWrap}>
          <Feather name="alert-triangle" size={30} color={COLORS.error} />
        </View>
        <Text style={styles.title}>This screen could not open</Text>
        <Text style={styles.copy}>
          Something on our side went wrong loading this page. Your account and data
          are fine.
        </Text>

        <View style={styles.errBox}>
          <Text style={styles.errText} selectable>
            {error?.message || String(error)}
          </Text>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={goHome} testID="eb-home">
          <Feather name="home" size={15} color={COLORS.surface} />
          <Text style={styles.primaryText}>Back to home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={onRetry} testID="eb-retry">
          <Feather name="refresh-cw" size={15} color={COLORS.brand} />
          <Text style={styles.secondaryText}>Try again</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  body: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  iconWrap: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: "#FDECEC",
    alignItems: "center", justifyContent: "center",
  },
  title: {
    fontFamily: FONTS.heading, fontSize: 23, color: COLORS.textPrimary,
    marginTop: SPACING.lg, textAlign: "center",
  },
  copy: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8 },
  errBox: {
    alignSelf: "stretch", marginTop: SPACING.lg, padding: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  errText: { color: COLORS.error, fontSize: 12, lineHeight: 18 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    alignSelf: "stretch", marginTop: SPACING.lg, paddingVertical: 15,
    backgroundColor: COLORS.brand, borderRadius: RADIUS.pill,
  },
  primaryText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    alignSelf: "stretch", marginTop: SPACING.sm, paddingVertical: 13,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.brand,
  },
  secondaryText: { color: COLORS.brand, fontSize: 14, fontWeight: "700" },
});