// Water intake tracker — daily goal 8 glasses.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { Feather } from "@expo/vector-icons";

const GOAL = 8;
const KEY = "vaidyaji.water.";

const todayKey = () => KEY + new Date().toISOString().slice(0, 10);

export default function Water() {
  const router = useRouter();
  const [count, setCount] = useState(0);

  useEffect(() => {
    (async () => {
      const v = await storage.getItem<number>(todayKey(), 0);
      setCount(v);
    })();
  }, []);

  const persist = async (n: number) => { await storage.setItem(todayKey(), n); };

  const add = async () => {
    const n = Math.min(count + 1, GOAL + 4);
    setCount(n);
    persist(n);
  };
  const remove = async () => {
    const n = Math.max(count - 1, 0);
    setCount(n);
    persist(n);
  };

  const pct = Math.min(count / GOAL, 1);
  const status = count >= GOAL ? "Goal reached! 🌊" : `${GOAL - count} glass${GOAL - count > 1 ? "es" : ""} to go`;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="wt-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>Ritual</Text>
          <Text style={styles.title}>Water intake</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.ring}>
          <View style={[styles.ringFill, { height: `${pct * 100}%` }]} />
          <Text style={styles.ringNum}>{count}<Text style={styles.ringDenom}>/ {GOAL}</Text></Text>
          <Text style={styles.ringLabel}>glasses today</Text>
        </View>

        <Text style={styles.status}>{status}</Text>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.minus} onPress={remove} testID="wt-minus">
            <Feather name="minus" size={22} color={COLORS.brand} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.plus} onPress={add} testID="wt-plus">
            <Feather name="plus" size={22} color={COLORS.surface} />
            <Text style={styles.plusLabel}>Add glass</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.glasses}>
          {Array.from({ length: GOAL }).map((_, i) => (
            <View key={i} style={[styles.glass, i < count && styles.glassFilled]}>
              <Feather name="droplet" size={14} color={i < count ? COLORS.surface : COLORS.textMuted} />
            </View>
          ))}
        </View>

        <Text style={styles.tip}>💧 Sip warm water — it kindles Agni (digestive fire) and gently detoxes your srotas (channels).</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  body: { flex: 1, padding: SPACING.lg, alignItems: "center" },
  ring: { width: 200, height: 200, borderRadius: 100, borderWidth: 6, borderColor: COLORS.brand, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", overflow: "hidden", marginTop: 20 },
  ringFill: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: COLORS.brand, opacity: 0.35 },
  ringNum: { fontFamily: FONTS.heading, fontSize: 56, color: COLORS.textPrimary, letterSpacing: -1 },
  ringDenom: { fontSize: 22, color: COLORS.textSecondary },
  ringLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginTop: -8 },
  status: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: SPACING.lg },
  controls: { flexDirection: "row", gap: 12, marginTop: SPACING.md, alignItems: "center" },
  minus: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  plus: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: COLORS.brand, paddingHorizontal: 20, paddingVertical: 14, borderRadius: RADIUS.pill },
  plusLabel: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  glasses: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: SPACING.lg, justifyContent: "center", maxWidth: 260 },
  glass: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  glassFilled: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tip: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.lg, fontSize: 13, lineHeight: 20, fontStyle: "italic" },
});
