// About / Legal / Contact / Support / FAQ / Policies — all consolidated.
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { Feather } from "@expo/vector-icons";
import { Logo } from "@/src/components/Logo";

const CONTACT_PHONE = "+917290044081";
const CONTACT_EMAIL = "support@onlinevaidyaji.com";
const WHATSAPP = "https://wa.me/917290044081?text=Hi%2C%20I%20need%20help";
const SOCIAL = {
  instagram: "https://www.instagram.com/onlinevaidyaji",
  facebook: "https://www.facebook.com/onlinevaidyaji",
  youtube: "https://www.youtube.com/@onlinevaidyaji",
  linkedin: "https://www.linkedin.com/company/onlinevaidyaji",
  twitter: "https://twitter.com/onlinevaidyaji",
};

const SECTIONS: Record<string, { title: string; body: string }> = {
  privacy: {
    title: "Privacy Policy",
    body: "Online VaidyaJi is committed to protecting your privacy. We collect only the data necessary to provide AYUSH consultations, medicine delivery, and wellness features — your name, contact details, health profile (age, gender, dosha, conditions), and your interactions with the app.\n\nHow we use your data:\n• To match you with the right AYUSH doctor.\n• To deliver medicines and lab test bookings.\n• To personalise your daily tips, diet plans, and yoga classes.\n• To send appointment reminders and important updates via push notifications and SMS.\n\nWe never sell your personal or health data to third parties. We share it only with the doctors you consult and delivery partners for orders you place. All chat messages with the AI VaidyaJi are stored securely and used only to improve your experience.\n\nYou can request data export or account deletion anytime by writing to support@onlinevaidyaji.com. We comply with the Digital Personal Data Protection Act, 2023 of India.",
  },
  terms: {
    title: "Terms & Conditions",
    body: "By using the Online VaidyaJi app, you agree to these terms:\n\n1. Eligibility — you must be 18+ or use the app under a parent/guardian's supervision.\n\n2. Consultations — all consultations are with independently practising AYUSH doctors licensed in India. Online VaidyaJi is a facilitator, not the treating provider.\n\n3. Payments — all consultation fees, medicine orders, and subscription payments are processed by Razorpay. Refunds are subject to the individual service's refund policy (see Shipping & Delivery Policy).\n\n4. AI features — the AI VaidyaJi chatbot, AI Diet Plans, and AI Yoga classes are informational tools and do NOT constitute medical advice. Always consult a qualified doctor for medical decisions.\n\n5. Content — content on the app (blogs, articles, videos) is protected by copyright; you may share links but not reproduce.\n\n6. Termination — we may suspend accounts that violate these terms or applicable laws.\n\n7. Jurisdiction — these terms are governed by the laws of India; disputes are subject to the courts of Delhi.",
  },
  disclaimer: {
    title: "Medical Disclaimer",
    body: "The information provided by Online VaidyaJi — including AI VaidyaJi chatbot responses, AI Diet Plans, AI Yoga classes, blog articles, home remedies, and daily tips — is for educational and informational purposes only.\n\nIt is NOT a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of a qualified AYUSH doctor or medical professional for any questions you may have regarding a medical condition.\n\nNever disregard professional medical advice or delay seeking it because of something you read or saw on this app. If you think you may have a medical emergency, call your doctor or go to the nearest emergency department immediately.\n\nOnline VaidyaJi does not recommend or endorse any specific tests, physicians, procedures, opinions, or other information mentioned by our AI features. Reliance on any information provided by Online VaidyaJi is solely at your own risk.",
  },
  shipping: {
    title: "Shipping & Delivery Policy",
    body: "Medicine orders placed through Online VaidyaJi Pharmacy are shipped from our partnered AYUSH-licensed pharmacies.\n\nDelivery timelines:\n• Metro cities (Delhi NCR, Mumbai, Bangalore, Chennai, Hyderabad, Kolkata, Pune, Ahmedabad): 2-3 business days.\n• Other cities: 4-7 business days.\n• Remote / rural areas: up to 10 business days.\n\nShipping charges:\n• Free shipping on orders above ₹499.\n• ₹49 flat charge for orders below ₹499.\n\nOrder tracking is available in the 'My Orders' section of your profile. You will receive SMS / WhatsApp updates at each dispatch stage.\n\nReturns & refunds:\n• Sealed, unopened medicine packs can be returned within 7 days of delivery.\n• Opened packs, personal-care items, and consumables are not eligible for return.\n• Refunds are processed within 5-7 business days to the original payment method.\n\nFor any delivery-related query, WhatsApp us at +91 72900 44081.",
  },
  faq: {
    title: "Frequently Asked Questions",
    body: "Q: Are Online VaidyaJi doctors licensed?\nA: Yes. Every doctor undergoes a verification of their AYUSH council registration, degree, and identity before they can consult on our platform. Look for the green 'VERIFIED' badge.\n\nQ: How does an online consultation work?\nA: You book a slot, pay the fee, and connect with the doctor over a secure video call at the appointed time. The doctor writes a digital prescription that appears in your Health Records vault immediately after.\n\nQ: Is the AI VaidyaJi chatbot free?\nA: Yes, unlimited use for registered patients.\n\nQ: Are AI Diet Plans and AI Yoga free?\nA: The 1-day AI Diet Plan is free. The 7-day dietician-curated plan is ₹200. The AI Yoga subscription is ₹500 / month with a 3-day free trial.\n\nQ: Can I choose the doctor's language?\nA: Yes — filter by language on the Consult tab. Our doctors speak Hindi, English, Tamil, Marathi, Bengali, Gujarati, Urdu, Malayalam, Telugu, Kannada.\n\nQ: How is my health data protected?\nA: All data is encrypted at rest and in transit. See our Privacy Policy for full details.",
  },
};

export default function About() {
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const active = section && SECTIONS[section];

  if (active) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} testID="ab-back" style={{ width: 40 }}>
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{active.title}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
          <Text style={styles.artBody}>{active.body}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="ab-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>About & Support</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
        <View style={styles.brandBox}>
          <Logo size={40} tagline />
          <Text style={styles.brandTag}>Your Health, Our Priority</Text>
        </View>

        <Text style={styles.section}>Contact us</Text>
        <ContactRow icon="phone" label="+91 72900 44081" onPress={() => Linking.openURL(`tel:${CONTACT_PHONE}`)} testID="ab-phone" />
        <ContactRow icon="message-circle" label="WhatsApp us" onPress={() => Linking.openURL(WHATSAPP)} testID="ab-whatsapp" />
        <ContactRow icon="mail" label={CONTACT_EMAIL} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)} testID="ab-email" />

        <Text style={styles.section}>Follow us</Text>
        <View style={styles.socialRow}>
          {[
            { i: "instagram", u: SOCIAL.instagram, c: "#E1306C" },
            { i: "facebook", u: SOCIAL.facebook, c: "#1877F2" },
            { i: "youtube", u: SOCIAL.youtube, c: "#FF0000" },
            { i: "linkedin", u: SOCIAL.linkedin, c: "#0A66C2" },
            { i: "twitter", u: SOCIAL.twitter, c: "#1DA1F2" },
          ].map((s) => (
            <TouchableOpacity key={s.i} style={[styles.social, { backgroundColor: s.c }]} onPress={() => Linking.openURL(s.u)} testID={`ab-${s.i}`}>
              <Feather name={s.i as any} size={18} color={COLORS.surface} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>Legal & policies</Text>
        <LegalRow icon="shield" label="Privacy Policy" onPress={() => router.push("/about?section=privacy")} testID="ab-privacy" />
        <LegalRow icon="file-text" label="Terms & Conditions" onPress={() => router.push("/about?section=terms")} testID="ab-terms" />
        <LegalRow icon="alert-circle" label="Medical Disclaimer" onPress={() => router.push("/about?section=disclaimer")} testID="ab-disclaimer" />
        <LegalRow icon="truck" label="Shipping & Delivery Policy" onPress={() => router.push("/about?section=shipping")} testID="ab-shipping" />
        <LegalRow icon="help-circle" label="FAQs" onPress={() => router.push("/about?section=faq")} testID="ab-faq" />

        <Text style={styles.footerText}>© 2026 Online VaidyaJi · Made with 💚 in Bharat</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ContactRow({ icon, label, onPress, testID }: any) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} testID={testID}>
      <View style={styles.rowIcon}>
        <Feather name={icon} size={16} color={COLORS.brand} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Feather name="external-link" size={14} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

function LegalRow({ icon, label, onPress, testID }: any) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} testID={testID}>
      <View style={styles.rowIcon}>
        <Feather name={icon} size={16} color={COLORS.brand} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Feather name="chevron-right" size={16} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary },
  brandBox: { padding: SPACING.lg, alignItems: "flex-start", backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  brandTag: { color: COLORS.accent, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginTop: 12 },
  section: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" },
  socialRow: { flexDirection: "row", gap: 10 },
  social: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  footerText: { color: COLORS.textMuted, textAlign: "center", fontSize: 12, marginTop: SPACING.xl },
  artBody: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 22 },
});
