// Quiz taker — one question at a time with progress, then result screen.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

export default function QuizTaker() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const q = await api.getQuiz(id);
      setQuiz(q);
      setAnswers(new Array(q.questions.length).fill(-1));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not load quiz");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  if (loading || !quiz) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  // Result screen
  if (result) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace("/quiz")} testID="qz-close">
            <Feather name="x" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Result</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
          <View style={styles.resultHero}>
            <Text style={styles.resultPct}>{result.pct}%</Text>
            <Text style={styles.resultLine}>{result.score} of {result.total} correct</Text>
            <View style={[styles.pointsPill, result.points_awarded === 0 && { backgroundColor: COLORS.textMuted }]}>
              <Feather name={result.points_awarded === 0 ? "info" : "award"} size={13} color={COLORS.surface} />
              <Text style={styles.pointsPillText}>
                {result.points_awarded === 0
                  ? (result.already_attempted ? "No new points — already scored this or higher" : "No points awarded")
                  : `+${result.points_awarded} points`}
              </Text>
            </View>
            {result.new_badges?.length > 0 && (
              <Text style={styles.badgeUnlock}>🏅 Badge unlocked: {result.new_badges.join(", ")}</Text>
            )}
          </View>

          <Text style={styles.sectionLabel}>Review</Text>
          {result.details.map((d: any, i: number) => (
            <View key={i} style={styles.reviewCard}>
              <View style={styles.reviewHead}>
                <Text style={styles.reviewNum}>Q{i + 1}</Text>
                <Feather
                  name={d.ok ? "check-circle" : "x-circle"}
                  size={16}
                  color={d.ok ? COLORS.success : COLORS.error}
                />
              </View>
              <Text style={styles.reviewQ}>{d.q}</Text>
              <Text style={styles.reviewYours}>
                Your answer: <Text style={{ fontWeight: "700" }}>{quiz.questions[i].options[d.picked] ?? "—"}</Text>
              </Text>
              {!d.ok && (
                <Text style={styles.reviewCorrect}>
                  Correct: <Text style={{ fontWeight: "700" }}>{quiz.questions[i].options[d.correct]}</Text>
                </Text>
              )}
              {d.explain && (
                <View style={styles.explainBox}>
                  <Feather name="info" size={12} color={COLORS.brand} />
                  <Text style={styles.explainText}>{d.explain}</Text>
                </View>
              )}
            </View>
          ))}

          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.replace("/quiz")}
            testID="qz-done"
          >
            <Text style={styles.doneText}>Back to quizzes</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Take screen
  const q = quiz.questions[idx];
  const picked = answers[idx];
  const canNext = picked !== -1;
  const isLast = idx === quiz.questions.length - 1;

  function pick(i: number) {
    const next = [...answers];
    next[idx] = i;
    setAnswers(next);
  }

  async function submit() {
    if (answers.some((a) => a === -1)) {
      Alert.alert("Answer all questions", "Please answer every question before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.submitQuiz(quiz.id, answers);
      setResult(r);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="qz-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{idx + 1} / {quiz.questions.length}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.progressBg}>
        <View style={[styles.progressFill, { width: `${((idx + 1) / quiz.questions.length) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 140 }}>
        <Image source={{ uri: quiz.image_url }} style={styles.headImg} />
        <Text style={styles.quizTitle}>{quiz.title}</Text>
        <Text style={styles.qLabel}>Question {idx + 1}</Text>
        <Text style={styles.qText}>{q.q}</Text>

        {q.options.map((opt: string, i: number) => (
          <TouchableOpacity
            key={i}
            style={[styles.opt, picked === i && styles.optActive]}
            onPress={() => pick(i)}
            testID={`qz-opt-${idx}-${i}`}
          >
            <View style={[styles.radio, picked === i && styles.radioActive]}>
              {picked === i && <View style={styles.radioDot} />}
            </View>
            <Text style={[styles.optText, picked === i && { color: COLORS.brand, fontWeight: "700" }]}>
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {idx > 0 && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setIdx(idx - 1)}
            testID="qz-prev"
          >
            <Feather name="chevron-left" size={16} color={COLORS.brand} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextBtn, !canNext && { opacity: 0.5 }, submitting && { opacity: 0.6 }]}
          disabled={!canNext || submitting}
          onPress={() => (isLast ? submit() : setIdx(idx + 1))}
          testID={isLast ? "qz-submit" : "qz-next"}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.surface} />
          ) : (
            <>
              <Text style={styles.nextText}>{isLast ? "Submit" : "Next"}</Text>
              <Feather name={isLast ? "check" : "chevron-right"} size={16} color={COLORS.surface} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  progressBg: { height: 4, backgroundColor: COLORS.surfaceAlt },
  progressFill: { height: 4, backgroundColor: COLORS.brand },
  headImg: { width: "100%", height: 140, borderRadius: RADIUS.lg, marginBottom: SPACING.md },
  quizTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginBottom: SPACING.md },
  qLabel: { color: COLORS.accent, textTransform: "uppercase", letterSpacing: 2, fontSize: 11, fontWeight: "700" },
  qText: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: 4, marginBottom: SPACING.lg, lineHeight: 30 },
  opt: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  optActive: { borderColor: COLORS.brand, backgroundColor: COLORS.surfaceAlt },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: COLORS.border,
    alignItems: "center", justifyContent: "center",
  },
  radioActive: { borderColor: COLORS.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.brand },
  optText: { flex: 1, color: COLORS.textPrimary, fontSize: 15 },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: SPACING.md,
    padding: SPACING.lg, backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  backBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  backText: { color: COLORS.brand, fontWeight: "700", fontSize: 14 },
  nextBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand,
  },
  nextText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
  // Result screen
  resultHero: {
    margin: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.brand, borderRadius: RADIUS.lg,
    alignItems: "center",
  },
  resultPct: { fontFamily: FONTS.heading, color: COLORS.surface, fontSize: 68, lineHeight: 76 },
  resultLine: { color: COLORS.accentSoft, marginTop: -6, fontSize: 14 },
  pointsPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.pill, marginTop: SPACING.md,
  },
  pointsPillText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  badgeUnlock: { color: COLORS.accentSoft, marginTop: 8, fontSize: 13, fontWeight: "700" },
  sectionLabel: {
    paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  reviewCard: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.sm,
    padding: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewNum: { color: COLORS.accent, fontWeight: "700", fontSize: 11, letterSpacing: 2 },
  reviewQ: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 14, marginTop: 4, lineHeight: 20 },
  reviewYours: { color: COLORS.textSecondary, fontSize: 13, marginTop: 8 },
  reviewCorrect: { color: COLORS.success, fontSize: 13, marginTop: 4 },
  explainBox: {
    flexDirection: "row", gap: 6,
    marginTop: 8, padding: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.sm,
  },
  explainText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  doneBtn: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    backgroundColor: COLORS.brand, paddingVertical: 14,
    borderRadius: RADIUS.pill, alignItems: "center",
  },
  doneText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
});
