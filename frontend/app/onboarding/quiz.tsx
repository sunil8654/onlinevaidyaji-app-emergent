// Prakriti Quiz — intro · Q1..Q10 · result · call preference.
// Bilingual copy inline (spec-perfect). Auto-advance on tap. Resume via localStorage.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";

type Lang = "en" | "hi";
type Answer = "A" | "B" | "C";
const RESUME_KEY = "vaidhyaji.quiz.resume";

const T = {
  introTitle:  { en: "Know Your Prakriti — Free 2-Minute Quiz",           hi: "Apni Prakriti Jaanein — 2 Minute ka Free Quiz" },
  introSub:    { en: "Discover your Ayurvedic body type and get the right treatment direction",
                 hi: "Ayurveda ke anusaar apna body type jaanein aur sahi ilaaj ka rasta paayein" },
  introCta:    { en: "Start Quiz",                                         hi: "Quiz Shuru Karein" },
  disclaimer:  { en: "This quiz is for information only, not a medical diagnosis. Please consult a registered AYUSH practitioner for any health condition.",
                 hi: "Yeh quiz sirf jaankari ke liye hai, medical diagnosis nahi. Kisi bhi health condition ke liye registered AYUSH practitioner se salah lein." },
  yourPrakriti:{ en: "Your Prakriti",                                      hi: "Aapki Prakriti" },
  recFor:      { en: "Recommended for your concern",                       hi: "Aapke concern ke liye recommended" },
  recSub:      { en: "Final advice after consultation with our registered AYUSH doctor.",
                 hi: "Final salah hamare registered AYUSH doctor consultation ke baad milegi." },
  freeReady:   { en: "Your FREE first consultation is ready to book!",     hi: "Aapka FREE pehla consultation taiyaar hai!" },
  howTalk:     { en: "How would you like to talk to the doctor?",          hi: "Doctor se kaise baat karna chahenge?" },
  video:       { en: "Video Call",                                          hi: "Video Call" },
  phone:       { en: "Phone Call",                                          hi: "Phone Call" },
  finish:      { en: "Finish & Explore App",                                hi: "Aage Badhein" },
  back:        { en: "Back",                                                hi: "Peeche" },
};

const Q_OPT = (a: string, b: string, c: string) => ({ A: a, B: b, C: c });

const Q1 = {
  en: { q: "What is your body type?", ...Q_OPT("Thin, hard to gain weight", "Medium, muscular", "Heavy, gains weight easily") },
  hi: { q: "Aapka body type kaisa hai?", ...Q_OPT("Patla, weight badhna mushkil", "Medium build, muscular", "Heavy build, weight aasani se badhta hai") },
};
const Q2 = {
  en: { q: "How is your skin?", ...Q_OPT("Dry, rough", "Sensitive, pimples/redness", "Oily, smooth") },
  hi: { q: "Aapki skin kaisi rehti hai?", ...Q_OPT("Dry, rough", "Sensitive, pimples/redness", "Oily, smooth") },
};
const Q3 = {
  en: { q: "How is your appetite?", ...Q_OPT("Irregular — sometimes high, sometimes low", "Strong — can't skip meals", "Low — can easily go without food") },
  hi: { q: "Bhookh kaisi lagti hai?", ...Q_OPT("Kabhi zyada kabhi kam, irregular", "Tez bhookh, khana miss nahi kar sakte", "Kam bhookh, khaye bina bhi chal jata hai") },
};
const Q4 = {
  en: { q: "How is your sleep?", ...Q_OPT("Light, wakes up often", "Okay, but disturbed by stress", "Deep, hard to wake up in the morning") },
  hi: { q: "Neend kaisi aati hai?", ...Q_OPT("Halki neend, baar-baar khulti hai", "Theek hai, par tension mein disturb", "Gehri neend, subah uthna mushkil") },
};
const Q5 = {
  en: { q: "How is your digestion?", ...Q_OPT("Gas, bloating, constipation", "Acidity, burning", "Heaviness, sluggish after meals") },
  hi: { q: "Digestion kaisa hai?", ...Q_OPT("Gas, bloating, kabz", "Acidity, jalan", "Heavy pet, khane ke baad sust") },
};
const Q6 = {
  en: { q: "How do you react to stress?", ...Q_OPT("Worry, overthinking, anxiety", "Anger, irritability", "Withdraw quietly, eat more") },
  hi: { q: "Stress mein aap kaise react karte hain?", ...Q_OPT("Chinta, overthinking, ghabrahat", "Gussa, chidchidapan", "Chup ho jana, khana zyada") },
};
const Q7 = {
  en: { q: "Which weather do you prefer?", ...Q_OPT("Warm — cold bothers me", "Cool — can't stand heat", "Warm & dry — humidity/cold makes me sluggish") },
  hi: { q: "Mausam kaisa pasand hai?", ...Q_OPT("Garmi achhi lagti hai, thand pareshan karti hai", "Thand pasand hai, garmi bardasht nahi", "Sukha-garm mausam, humidity/thand se sust") },
};
const Q8 = {
  en: { q: "How is your energy through the day?", ...Q_OPT("Tire quickly, ups and downs", "High energy but burn out", "Steady but slow, sluggish mornings") },
  hi: { q: "Energy levels din bhar kaise rehte hain?", ...Q_OPT("Jaldi thak jata/jati hoon, energy up-down", "High energy, par burn-out ho jata hai", "Steady par slow, subah sust") },
};

const QUESTIONS = [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8];

const CONCERNS: Array<{ id: string; en: string; hi: string; icon: any }> = [
  { id: "madhu_niyantran", en: "Sugar / Diabetes",   hi: "Sugar / Diabetes",       icon: "activity" },
  { id: "sandhi_sudha",    en: "Joint pain",          hi: "Jodon ka dard",           icon: "shield" },
  { id: "gut_vaidya",      en: "Stomach / Digestion", hi: "Pet-Digestion",           icon: "circle" },
  { id: "sthul_haran",     en: "Weight",              hi: "Motapa",                  icon: "trending-down" },
  { id: "kesh_raksha",     en: "Hair fall",           hi: "Baal jhadna",             icon: "wind" },
  { id: "man_shanti",      en: "Sleep / Stress",      hi: "Neend / Stress",          icon: "moon" },
  { id: "purush_shakti",   en: "Men's health",        hi: "Purush health",           icon: "user" },
  { id: "nari_shakti",     en: "Periods / PCOS",      hi: "Periods / PCOS",          icon: "heart" },
  { id: "yakrit_raksha",   en: "Liver",               hi: "Liver",                   icon: "droplet" },
  { id: "shwas_raksha",    en: "Cough / Immunity",    hi: "Khansi / Immunity",       icon: "cloud" },
];

const AGE_GROUPS = ["18-25", "26-35", "36-45", "46-60", "60+"];
const KIT_IDS = new Set(CONCERNS.map((c) => c.id));

const Q9_LABEL = { en: "What is your biggest health concern?", hi: "Aapki sabse badi health concern kya hai?" };
const Q10_LABEL = { en: "Your age group", hi: "Aapka age group" };

const DOSHA_ICON = (p: string): any => {
  if (p.startsWith("Vata")) return "wind";
  if (p.startsWith("Pitta")) return "sun";
  if (p.startsWith("Kapha")) return "cloud-drizzle";
  return "compass";
};

type ResumeState = { step: number; answers: Record<string, Answer>; concern?: string; age?: string };

export default function QuizFlow() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { lang: appLang } = useI18n();
  const lang: Lang = ((user?.preferred_language as Lang) || appLang || "en");

  const [step, setStep] = useState<number>(-1);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [concern, setConcern] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [callPref, setCallPref] = useState<"video" | "phone" | null>(null);

  useEffect(() => {
    (async () => {
      const r = await storage.getItem<ResumeState | null>(RESUME_KEY, null as any);
      if (r && typeof r === "object" && r.step != null) {
        const savedAnswers = r.answers || {};
        setAnswers(savedAnswers);
        if (r.concern) setConcern(r.concern);
        if (r.age) setAge(r.age);
        // Don't jump the user past unanswered questions — resume at the first hole.
        const firstMissing = Array.from({ length: 8 }, (_, i) => `q${i + 1}`).findIndex((k) => !savedAnswers[k]);
        if (firstMissing >= 0 && r.step > firstMissing) {
          setStep(firstMissing);
        } else {
          setStep(r.step);
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (step >= 0 && step < 10) {
      storage.setItem(RESUME_KEY, { step, answers, concern, age });
    }
  }, [step, answers, concern, age]);

  const pickAnswer = useCallback((qNum: number, val: Answer) => {
    setAnswers((prev) => ({ ...prev, [`q${qNum}`]: val }));
    setTimeout(() => setStep((s) => s + 1), 180);
  }, []);

  const goBack = () => setStep((s) => Math.max(-1, s - 1));

  async function submit(withConcern: string, withAge: string) {
    // Guard: ensure all 8 dosha questions are answered before firing the API call.
    const missing = Array.from({ length: 8 }, (_, i) => `q${i + 1}`).filter((k) => !answers[k]);
    if (missing.length > 0) {
      // Redirect to the first unanswered question instead of a confusing 422.
      const firstMissing = parseInt(missing[0].slice(1), 10) - 1;
      Alert.alert(
        lang === "hi" ? "Kuch questions reh gaye" : "Some questions are missing",
        lang === "hi"
          ? `Kripya pehle Question ${firstMissing + 1} answer karein.`
          : `Please answer Question ${firstMissing + 1} first.`,
        [{ text: "OK", onPress: () => setStep(firstMissing) }],
      );
      return;
    }
    if (!withConcern || !KIT_IDS.has(withConcern)) {
      Alert.alert(lang === "hi" ? "Concern select karein" : "Please choose your health concern", "", [
        { text: "OK", onPress: () => setStep(8) },
      ]);
      return;
    }
    setSaving(true);
    try {
      const res = await api.submitQuiz({
        answers: answers as Record<string, Answer>,
        health_concern: withConcern,
        age_group: withAge,
      });
      setResult(res);
      setStep(10);
      await storage.removeItem(RESUME_KEY);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    } finally { setSaving(false); }
  }

  async function finishFunnel() {
    if (!callPref) {
      Alert.alert(lang === "hi" ? "Kripya select karein" : "Please choose", lang === "hi" ? "Video ya Phone select karein" : "Please choose Video or Phone.");
      return;
    }
    setSaving(true);
    try {
      await api.updateMe({ call_preference: callPref });
      await refresh();
      router.replace("/onboarding/what-next");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    } finally { setSaving(false); }
  }

  if (step === -1) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={styles.introBox}>
          <View style={styles.iconRing}>
            <Feather name="compass" size={30} color={COLORS.brand} />
          </View>
          <Text style={styles.introTitle}>{T.introTitle[lang]}</Text>
          <Text style={styles.introSub}>{T.introSub[lang]}</Text>
          <TouchableOpacity style={styles.startBtn} onPress={() => setStep(0)} testID="quiz-start">
            <Text style={styles.startBtnText}>{T.introCta[lang]}</Text>
            <Feather name="arrow-right" size={18} color={COLORS.surface} />
          </TouchableOpacity>
          <Text style={styles.disclaimer}>{T.disclaimer[lang]}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step >= 0 && step <= 7) {
    const q = QUESTIONS[step][lang];
    const currentAnswer = answers[`q${step + 1}`];
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <QuizHeader step={step + 1} total={10} onBack={goBack} />
        <ScrollView contentContainerStyle={styles.qBox}>
          <Text style={styles.qText}>{q.q}</Text>
          {(["A", "B", "C"] as const).map((k) => (
            <TouchableOpacity
              key={k}
              style={[styles.qOption, currentAnswer === k && styles.qOptionActive]}
              onPress={() => pickAnswer(step + 1, k)}
              testID={`quiz-q${step + 1}-${k}`}
            >
              <View style={[styles.qBullet, currentAnswer === k && { backgroundColor: COLORS.brand, borderColor: COLORS.brand }]}>
                <Text style={[styles.qBulletText, currentAnswer === k && { color: COLORS.surface }]}>{k}</Text>
              </View>
              <Text style={styles.qOptionText}>{(q as any)[k]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 8) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <QuizHeader step={9} total={10} onBack={goBack} />
        <ScrollView contentContainerStyle={styles.qBox}>
          <Text style={styles.qText}>{Q9_LABEL[lang]}</Text>
          <View style={styles.grid}>
            {CONCERNS.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.gridItem, concern === c.id && styles.gridItemActive]}
                onPress={() => { setConcern(c.id); setTimeout(() => setStep(9), 180); }}
                testID={`quiz-concern-${c.id}`}
              >
                <View style={[styles.gridIcon, concern === c.id && { backgroundColor: COLORS.brand }]}>
                  <Feather name={c.icon} size={20} color={concern === c.id ? COLORS.surface : COLORS.brand} />
                </View>
                <Text style={styles.gridText}>{(c as any)[lang]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 9) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <QuizHeader step={10} total={10} onBack={goBack} />
        <ScrollView contentContainerStyle={styles.qBox}>
          <Text style={styles.qText}>{Q10_LABEL[lang]}</Text>
          {AGE_GROUPS.map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.qOption, age === g && styles.qOptionActive]}
              onPress={() => { setAge(g); submit(concern, g); }}
              disabled={saving}
              testID={`quiz-age-${g}`}
            >
              <View style={[styles.qBullet, age === g && { backgroundColor: COLORS.brand, borderColor: COLORS.brand }]}>
                <Feather name="user" size={14} color={age === g ? COLORS.surface : COLORS.brand} />
              </View>
              <Text style={styles.qOptionText}>{g}</Text>
              {saving && age === g ? <ActivityIndicator size="small" color={COLORS.brand} /> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 10 && result) {
    const desc = result.description;
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
          <View style={styles.resultHeader}>
            <View style={styles.doshaIcon}>
              <Feather name={DOSHA_ICON(result.prakriti)} size={30} color={COLORS.surface} />
            </View>
            <Text style={styles.resultEyebrow}>{T.yourPrakriti[lang]}</Text>
            <Text style={styles.resultBig}>{result.prakriti}</Text>
          </View>

          <View style={styles.descCard}>
            <Text style={styles.descLine}>{desc.line1}</Text>
            <Text style={styles.descLine}>{desc.line2}</Text>
            <Text style={styles.descLine}>{desc.line3}</Text>
          </View>

          <View style={styles.recCard}>
            <View style={styles.recIcon}>
              <Feather name="package" size={20} color={COLORS.surface} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.recLabel}>{T.recFor[lang]}</Text>
              <Text style={styles.recKit}>{result.recommended_kit.name}</Text>
              <Text style={styles.recSub}>{T.recSub[lang]}</Text>
            </View>
          </View>

          <View style={styles.freeBanner}>
            <Feather name="gift" size={18} color="#4a3a00" />
            <Text style={styles.freeText}>{T.freeReady[lang]}</Text>
          </View>

          <Text style={styles.qText}>{T.howTalk[lang]}</Text>
          <View style={styles.callRow}>
            <TouchableOpacity
              style={[styles.callCard, callPref === "video" && styles.callCardActive]}
              onPress={() => setCallPref("video")}
              testID="quiz-call-video"
            >
              <Text style={styles.callEmoji}>🎥</Text>
              <Text style={[styles.callLabel, callPref === "video" && { color: COLORS.brand }]}>{T.video[lang]}</Text>
              {callPref === "video" && <Feather name="check-circle" size={16} color={COLORS.brand} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.callCard, callPref === "phone" && styles.callCardActive]}
              onPress={() => setCallPref("phone")}
              testID="quiz-call-phone"
            >
              <Text style={styles.callEmoji}>📞</Text>
              <Text style={[styles.callLabel, callPref === "phone" && { color: COLORS.brand }]}>{T.phone[lang]}</Text>
              {callPref === "phone" && <Feather name="check-circle" size={16} color={COLORS.brand} />}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.finishBtn, (!callPref || saving) && { opacity: 0.5 }]}
            onPress={finishFunnel}
            disabled={!callPref || saving}
            testID="quiz-finish"
          >
            {saving ? <ActivityIndicator size="small" color={COLORS.surface} /> : (
              <>
                <Text style={styles.finishText}>{T.finish[lang]}</Text>
                <Feather name="arrow-right" size={18} color={COLORS.surface} />
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>{T.disclaimer[lang]}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 60 }} color={COLORS.brand} /></SafeAreaView>;
}

function QuizHeader({ step, total, onBack }: any) {
  return (
    <View style={styles.headBar}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.backBtn} testID="quiz-back">
        <Feather name="arrow-left" size={20} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(step / total) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>Question {step}/{total}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  introBox: { padding: SPACING.lg, paddingTop: SPACING.xl, gap: SPACING.md },
  iconRing: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.brand, alignItems: "center", justifyContent: "center", marginBottom: SPACING.sm },
  introTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginTop: SPACING.md },
  introSub: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: SPACING.lg },
  startBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, minHeight: 56 },
  startBtnText: { color: COLORS.surface, fontWeight: "800", fontSize: 15 },
  disclaimer: { color: COLORS.textMuted, fontSize: 11, lineHeight: 17, marginTop: SPACING.lg, textAlign: "center" },
  headBar: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { padding: 4 },
  progressWrap: { flex: 1, gap: 4 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: COLORS.surfaceAlt, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: COLORS.brand },
  progressText: { color: COLORS.textMuted, fontSize: 11, fontWeight: "700" },
  qBox: { padding: SPACING.lg, gap: SPACING.sm },
  qText: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginBottom: SPACING.md, lineHeight: 28 },
  qOption: { flexDirection: "row", alignItems: "center", gap: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, minHeight: 56 },
  qOptionActive: { borderColor: COLORS.brand, backgroundColor: "#ffe082" },
  qBullet: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: COLORS.brand, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface },
  qBulletText: { color: COLORS.brand, fontWeight: "800", fontSize: 14 },
  qOptionText: { flex: 1, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  gridItem: { width: "48%", backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: "center", gap: 8, minHeight: 110 },
  gridItemActive: { borderColor: COLORS.brand, backgroundColor: "#ffe082" },
  gridIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  gridText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700", textAlign: "center" },
  resultHeader: { alignItems: "center", marginBottom: SPACING.lg },
  doshaIcon: { width: 78, height: 78, borderRadius: 39, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center", marginBottom: SPACING.md },
  resultEyebrow: { textTransform: "uppercase", letterSpacing: 3, color: COLORS.accent, fontWeight: "800", fontSize: 11 },
  resultBig: { fontFamily: FONTS.heading, fontSize: 34, color: COLORS.textPrimary, marginTop: 4 },
  descCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: 8, marginBottom: SPACING.md },
  descLine: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  recCard: { flexDirection: "row", gap: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.brand, marginBottom: SPACING.md },
  recIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  recLabel: { textTransform: "uppercase", letterSpacing: 2, color: COLORS.accent, fontSize: 10, fontWeight: "800" },
  recKit: { color: COLORS.textPrimary, fontSize: 15, fontWeight: "700", marginTop: 2 },
  recSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4, lineHeight: 15 },
  freeBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ffe082", padding: SPACING.md, borderRadius: RADIUS.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: "#f2c94c" },
  freeText: { color: "#4a3a00", fontWeight: "800", fontSize: 13, flex: 1 },
  callRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.lg },
  callCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 2, borderColor: COLORS.border, padding: SPACING.md, alignItems: "center", gap: 6, minHeight: 100 },
  callCardActive: { borderColor: COLORS.brand, backgroundColor: "#ffe082" },
  callEmoji: { fontSize: 30 },
  callLabel: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 14 },
  finishBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 16, borderRadius: RADIUS.pill, minHeight: 56 },
  finishText: { color: COLORS.surface, fontWeight: "800", fontSize: 15 },
});
