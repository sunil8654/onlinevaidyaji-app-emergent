// FAQs — accordion of the most common patient questions.
import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";

type Faq = { q: string; a: string; category: string };

const FAQ_DATA: Faq[] = [
  { category: "Getting Started",
    q: "What is Online VaidyaJi?",
    a: "An AI-powered AYUSH healthcare super-app that connects you with verified doctors across Ayurveda, Homoeopathy, Yoga, Unani and Siddha. You can book teleconsultations, take health quizzes, get personalised diet + yoga plans, and track wellness — all in one place." },
  { category: "Getting Started",
    q: "Do I need to register?",
    a: "Yes — a free account lets you book doctors, save health records, chat with our AI VaidyaJi, and track your wellness. You'll need a valid Indian mobile number for OTP and appointment reminders." },
  { category: "Consultation",
    q: "How do teleconsultations work?",
    a: "Once you book and pay for a slot, both you and the doctor receive a secure video-call link. Just tap 'Join' at the appointment time. Sessions are typically 15–30 minutes and end with a digital prescription." },
  { category: "Consultation",
    q: "Are Vaidyas verified?",
    a: "Every doctor on VaidyaJi uploads their AYUSH registration number and qualifications during onboarding. Our admin team verifies each document before granting the 'Verified' badge." },
  { category: "Payments",
    q: "How do I pay?",
    a: "We use Razorpay for consultations and premium plans. UPI, cards, wallets and net-banking are supported. Refunds for cancellations are processed to the original payment method within 5–7 working days." },
  { category: "Payments",
    q: "What if I cancel an appointment?",
    a: "You can cancel up to 2 hours before the slot for a full refund. Within 2 hours, we hold a 20% booking fee to compensate the doctor's blocked time." },
  { category: "Prescriptions",
    q: "How do I get my prescription?",
    a: "After the consultation, the doctor writes a digital prescription right inside the app. You can view it under 'Appointments' → 'Prescription' and export as PDF anytime." },
  { category: "Prescriptions",
    q: "Are prescriptions valid at pharmacies?",
    a: "Yes — our digital prescriptions include the doctor's AYUSH registration number and digital signature, accepted at all licensed Indian pharmacies." },
  { category: "AI & Data",
    q: "How does the AI Symptom Checker work?",
    a: "Our AI VaidyaJi is powered by Claude (Anthropic) with an AYUSH-specific prompt. It suggests home remedies, yoga and doshic insights — but always recommends seeing a qualified doctor for serious symptoms." },
  { category: "AI & Data",
    q: "Is my health data private?",
    a: "All records are stored on encrypted servers. Only you and the doctors you consult can see your history. We never sell data to advertisers, and you can request full deletion at any time from Profile → Data & Privacy." },
  { category: "Wellness",
    q: "What is the Wellness Dashboard?",
    a: "A daily tracker for BMI, weight, steps, sleep, blood pressure, blood sugar, water intake and mood. Log any metric and see your 30-day trend with AYUSH-aligned tips." },
  { category: "Wellness",
    q: "How do reward points work?",
    a: "You earn points by checking in daily, completing quizzes, joining challenges and posting in the community. Points unlock badges and levels — from Seeker all the way to Vaidhya Ratna." },
  { category: "Family",
    q: "Can I manage my family's health here?",
    a: "Yes — under 'Family Health' you can add child profiles, track vaccinations, developmental milestones, and even book consultations on their behalf." },
  { category: "Support",
    q: "How do I contact support?",
    a: "Tap the chat bubble on the home screen for our lead-gen bot, or email info@onlinevaidyaji.com. Emergency medical issues should always go to your nearest hospital or dial 112." },
];

export default function Faqs() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return FAQ_DATA;
    return FAQ_DATA.filter((f) =>
      f.q.toLowerCase().includes(s) ||
      f.a.toLowerCase().includes(s) ||
      f.category.toLowerCase().includes(s)
    );
  }, [q]);

  // Group by category
  const grouped = useMemo(() => {
    const g: Record<string, { faq: Faq; i: number }[]> = {};
    filtered.forEach((f) => {
      const i = FAQ_DATA.indexOf(f);
      if (!g[f.category]) g[f.category] = [];
      g[f.category].push({ faq: f, i });
    });
    return g;
  }, [filtered]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="faq-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.eyebrow}>Answers</Text>
          <Text style={styles.title}>Help & FAQs</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search FAQs…"
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          testID="faq-search"
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}>
        {Object.keys(grouped).length === 0 && (
          <Text style={styles.empty}>No FAQs match your search.</Text>
        )}
        {Object.entries(grouped).map(([cat, arr]) => (
          <View key={cat} style={{ marginBottom: SPACING.md }}>
            <Text style={styles.catLabel}>{cat}</Text>
            {arr.map(({ faq, i }) => {
              const isOpen = !!open[i];
              return (
                <TouchableOpacity
                  key={i}
                  style={styles.card}
                  onPress={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                  activeOpacity={0.85}
                  testID={`faq-${i}`}
                >
                  <View style={styles.qRow}>
                    <Text style={styles.qText}>{faq.q}</Text>
                    <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={COLORS.brand} />
                  </View>
                  {isOpen && <Text style={styles.aText}>{faq.a}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary, marginTop: 2 },
  searchWrap: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, paddingVertical: 12, color: COLORS.textPrimary },
  catLabel: {
    textTransform: "uppercase", letterSpacing: 2,
    fontSize: 11, color: COLORS.accent, fontWeight: "700",
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  qRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  qText: { flex: 1, color: COLORS.textPrimary, fontWeight: "700", fontSize: 14, lineHeight: 20 },
  aText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginTop: SPACING.sm },
  empty: { textAlign: "center", color: COLORS.textMuted, fontStyle: "italic", marginTop: SPACING.lg },
});
