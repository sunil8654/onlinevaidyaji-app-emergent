// Simple plan-purchase mock screen used for Weekly Diet Plan (₹200) and AI Yoga (₹500/mo).
import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";

const PLANS: Record<string, { title: string; price: number; period: string; features: string[]; kicker: string }> = {
  "weekly-diet": {
    title: "7-Day AYUSH Diet Plan",
    price: 200,
    period: "one-time",
    kicker: "Certified Vaidhyaji Dietician",
    features: [
      "Full 7-day meal chart tailored to your dosha",
      "Groceries + recipes list included",
      "1 WhatsApp check-in per day",
      "Portion sizes for Indian kitchens",
      "Free reroll if you dislike a day",
    ],
  },
  "ai-yoga": {
    title: "AI Yoga Teacher · Monthly",
    price: 500,
    period: "per month",
    kicker: "Daily 20-min personalised sessions",
    features: [
      "Daily AI-guided yoga class (20 min)",
      "Personalised to your condition (back pain, PCOS, anxiety…)",
      "Progressive difficulty",
      "Pause / skip anytime",
      "Chat with a real yogacharya weekly",
    ],
  },
};

export default function PlanCheckout() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type?: string }>();
  const plan = PLANS[type || "weekly-diet"] || PLANS["weekly-diet"];
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const pay = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 900));
    setBusy(false);
    setOk(true);
    setTimeout(() => router.back(), 1400);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="pc-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>Checkout</Text>
          <Text style={styles.title}>Upgrade plan</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}>
        <View style={styles.card}>
          <Text style={styles.kicker}>{plan.kicker}</Text>
          <Text style={styles.big}>{plan.title}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>₹{plan.price}</Text>
            <Text style={styles.period}>{plan.period}</Text>
          </View>
          {plan.features.map((f) => (
            <View key={f} style={styles.featRow}>
              <View style={styles.check}>
                <Feather name="check" size={12} color={COLORS.surface} />
              </View>
              <Text style={styles.featText}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={styles.method}>
          <Feather name="credit-card" size={18} color={COLORS.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.methodTitle}>UPI / Cards (Demo)</Text>
            <Text style={styles.methodSub}>Real Razorpay integration plugs in on deploy.</Text>
          </View>
          <Feather name="check-circle" size={18} color={COLORS.success} />
        </View>

        {ok ? (
          <View style={styles.okBox}>
            <Feather name="check-circle" size={20} color={COLORS.success} />
            <Text style={styles.okText}>Payment successful (demo). We&apos;ve sent a WhatsApp confirmation.</Text>
          </View>
        ) : (
          <TouchableOpacity style={[styles.payBtn, busy && { opacity: 0.6 }]} onPress={pay} disabled={busy} testID="pc-pay">
            <Text style={styles.payBtnText}>{busy ? "Processing…" : `Pay ₹${plan.price}`}</Text>
            <Feather name="arrow-right" size={18} color={COLORS.surface} />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg },
  kicker: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, fontWeight: "700", textTransform: "uppercase" },
  big: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: 6, letterSpacing: -0.5, lineHeight: 30 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 10 },
  price: { fontFamily: FONTS.heading, fontSize: 40, color: COLORS.brand, letterSpacing: -1 },
  period: { color: COLORS.textSecondary, fontSize: 13 },
  featRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 10 },
  check: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  featText: { flex: 1, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  method: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md },
  methodTitle: { fontWeight: "700", color: COLORS.textPrimary },
  methodSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  payBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, marginTop: SPACING.lg },
  payBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
  okBox: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#E8F5E9", padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.md },
  okText: { flex: 1, color: COLORS.success, fontWeight: "700", fontSize: 14 },
});
