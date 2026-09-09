import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";
import { ComingSoonBanner } from "@/src/components/ComingSoon";

function generateSlots() {
  const out: { iso: string; label: string; day: string }[] = [];
  const now = new Date();
  for (let d = 0; d < 3; d++) {
    const day = new Date(now); day.setDate(now.getDate() + d);
    for (const h of [8, 10, 16, 18]) {
      const dt = new Date(day); dt.setHours(h, 0, 0, 0);
      if (dt.getTime() < Date.now() + 60 * 60 * 1000) continue;
      out.push({
        iso: dt.toISOString(),
        label: dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        day: d === 0 ? "Today" : d === 1 ? "Tomorrow" : dt.toLocaleDateString([], { weekday: "short" }),
      });
    }
  }
  return out;
}

export default function Labs() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const slots = generateSlots();

  useEffect(() => {
    (async () => { try { setItems(await api.listLabTests()); } catch {} })();
  }, []);

  const book = async () => {
    if (!selected || !slot) return;
    setBusy(true);
    try {
      await api.bookLabTest({ lab_test_id: selected.id, slot });
      setOk(true);
      setTimeout(() => { setSelected(null); setSlot(null); setOk(false); }, 1500);
    } catch {}
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="labs-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Diagnostics</Text>
          <Text style={styles.title}>Lab tests at home</Text>
        </View>
        <ComingSoonBanner />
      </View>

      <View style={styles.csBanner}>
        <Feather name="clock" size={14} color={COLORS.accent} />
        <Text style={styles.csText}>Home-lab pickup rolls out next month — bookings are demo.</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 60 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => { setSelected(item); setSlot(null); }} testID={`lab-${item.id}`} activeOpacity={0.9}>
            <View style={styles.iconBox}>
              <Feather name="activity" size={20} color={COLORS.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.turnaround} · {item.fasting ? "Fasting" : "No fasting"}</Text>
              <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
            </View>
            <View>
              <Text style={styles.price}>₹{item.price}</Text>
              <Text style={styles.book}>Book</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal visible={selected !== null} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>{selected?.name}</Text>
            <Text style={styles.sheetSub}>{selected?.description}</Text>

            <Text style={styles.label}>Pick a slot</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {slots.map((s) => (
                <TouchableOpacity key={s.iso} onPress={() => setSlot(s.iso)} style={[styles.slot, slot === s.iso && styles.slotActive]} testID={`lab-slot-${s.iso}`}>
                  <Text style={styles.slotDay}>{s.day}</Text>
                  <Text style={[styles.slotTime, slot === s.iso && { color: COLORS.surface }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.totalRow}>
              <View>
                <Text style={styles.totalLabel}>Home sample</Text>
                <Text style={styles.totalVal}>₹{selected?.price}</Text>
              </View>
              {ok ? (
                <View style={styles.okBox}>
                  <Feather name="check-circle" size={16} color={COLORS.success} />
                  <Text style={{ color: COLORS.success, fontWeight: "700" }}>Booked!</Text>
                </View>
              ) : (
                <TouchableOpacity style={[styles.bookBtn, (!slot || busy) && { opacity: 0.5 }]} onPress={book} disabled={!slot || busy} testID="lab-confirm">
                  <Text style={styles.bookBtnText}>{busy ? "Booking…" : "Confirm booking"}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { flexDirection: "row", gap: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  iconBox: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary, lineHeight: 20 },
  meta: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 2 },
  desc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 16 },
  price: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.brand, textAlign: "right" },
  book: { color: COLORS.accent, fontSize: 11, fontWeight: "700", textAlign: "right" },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.textPrimary },
  sheetSub: { color: COLORS.textSecondary, marginTop: 4, fontSize: 13, lineHeight: 18 },
  label: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, fontWeight: "700", marginTop: SPACING.md, marginBottom: 8 },
  slot: { padding: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", minWidth: 78 },
  slotActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  slotDay: { color: COLORS.textSecondary, fontSize: 10, letterSpacing: 1, fontWeight: "700", textTransform: "uppercase" },
  slotTime: { color: COLORS.textPrimary, fontFamily: FONTS.heading, fontSize: 16, marginTop: 2 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: SPACING.lg, marginBottom: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  totalLabel: { color: COLORS.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  totalVal: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.brand },
  bookBtn: { backgroundColor: COLORS.brand, paddingHorizontal: 20, paddingVertical: 14, borderRadius: RADIUS.pill },
  bookBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  okBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#E8F5E9", paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill },
  csBanner: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.accentSoft, paddingVertical: 8, marginHorizontal: SPACING.lg, borderRadius: RADIUS.pill, marginBottom: SPACING.sm },
  csText: { color: COLORS.accent, fontSize: 12, fontWeight: "700" },
});
