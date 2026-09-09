// Doctor Availability — online/offline toggle + weekly slot calendar.
import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert,
  ActivityIndicator, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

type Mode = "online" | "offline" | "both";

const DAYS: { key: string; label: string; short: string }[] = [
  { key: "0", label: "Monday", short: "Mon" },
  { key: "1", label: "Tuesday", short: "Tue" },
  { key: "2", label: "Wednesday", short: "Wed" },
  { key: "3", label: "Thursday", short: "Thu" },
  { key: "4", label: "Friday", short: "Fri" },
  { key: "5", label: "Saturday", short: "Sat" },
  { key: "6", label: "Sunday", short: "Sun" },
];

// Preset slot grid (8:00 – 20:00 in 30-min steps) for one-tap toggle.
const SLOT_PRESETS: string[] = (() => {
  const arr: string[] = [];
  for (let h = 8; h <= 20; h++) {
    arr.push(`${String(h).padStart(2, "0")}:00`);
    if (h !== 20) arr.push(`${String(h).padStart(2, "0")}:30`);
  }
  return arr;
})();

export default function DoctorAvailability() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [mode, setMode] = useState<Mode>("both");
  const [slotDuration, setSlotDuration] = useState(30);
  const [notes, setNotes] = useState("");
  const [schedule, setSchedule] = useState<Record<string, string[]>>({});
  const [activeDay, setActiveDay] = useState<string>("0");
  const [customSlot, setCustomSlot] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await api.doctorGetAvailability();
        setIsAvailable(d.is_available);
        setMode((d.consultation_mode || "both") as Mode);
        setSlotDuration(d.slot_duration_min || 30);
        setNotes(d.notes || "");
        setSchedule(d.weekly_schedule || {});
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Could not load availability");
      } finally { setLoading(false); }
    })();
  }, []);

  const daySlots = useMemo(() => schedule[activeDay] || [], [schedule, activeDay]);

  function toggleSlot(day: string, slot: string) {
    setSchedule((s) => {
      const arr = s[day] ? [...s[day]] : [];
      const idx = arr.indexOf(slot);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(slot);
      arr.sort();
      return { ...s, [day]: arr };
    });
  }

  function clearDay(day: string) {
    setSchedule((s) => ({ ...s, [day]: [] }));
  }

  function copyMondayToWeekdays() {
    const monSlots = schedule["0"] || [];
    setSchedule((s) => ({
      ...s,
      "1": [...monSlots], "2": [...monSlots], "3": [...monSlots], "4": [...monSlots],
    }));
    Alert.alert("Copied", "Monday's slots copied to Tue–Fri");
  }

  function addCustom() {
    const v = customSlot.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(v)) {
      Alert.alert("Invalid time", "Enter time in HH:MM 24-hour format (e.g., 07:15)");
      return;
    }
    toggleSlot(activeDay, v);
    setCustomSlot("");
  }

  async function save() {
    setSaving(true);
    try {
      await api.doctorSetAvailability({
        is_available: isAvailable,
        consultation_mode: mode,
        weekly_schedule: schedule,
        slot_duration_min: slotDuration,
        notes,
      });
      Alert.alert("Saved", "Availability updated");
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save");
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </SafeAreaView>
    );
  }

  const totalSlots = Object.values(schedule).reduce((a, b) => a + (b?.length || 0), 0);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="av-back">
          <Feather name="chevron-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>My Availability</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Master toggle */}
        <View style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Accepting patients</Text>
            <Text style={styles.cardSub}>
              {isAvailable
                ? "You’re live. Patients can book you now."
                : "You’re offline. New bookings are paused."}
            </Text>
          </View>
          <Switch
            value={isAvailable}
            onValueChange={setIsAvailable}
            trackColor={{ true: COLORS.brand, false: COLORS.border }}
            thumbColor={COLORS.surface}
            testID="av-toggle-available"
          />
        </View>

        {/* Consultation mode */}
        <Text style={styles.sectionLabel}>Consultation mode</Text>
        <View style={styles.modeRow}>
          {(["online", "offline", "both"] as Mode[]).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              style={[styles.modeChip, mode === m && styles.modeChipActive]}
              testID={`av-mode-${m}`}
            >
              <Feather
                name={m === "online" ? "video" : m === "offline" ? "map-pin" : "globe"}
                size={13}
                color={mode === m ? COLORS.surface : COLORS.brand}
              />
              <Text style={[styles.modeText, mode === m && { color: COLORS.surface }]}>
                {m === "both" ? "Video + Clinic" : m === "online" ? "Video only" : "Clinic only"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Slot duration */}
        <Text style={styles.sectionLabel}>Slot duration</Text>
        <View style={styles.modeRow}>
          {[15, 20, 30, 45, 60].map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => setSlotDuration(d)}
              style={[styles.chip, slotDuration === d && styles.chipActive]}
              testID={`av-dur-${d}`}
            >
              <Text style={[styles.chipText, slotDuration === d && { color: COLORS.surface }]}>
                {d} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Weekly schedule */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>Weekly schedule</Text>
          <TouchableOpacity onPress={copyMondayToWeekdays} style={styles.copyBtn} testID="av-copy-mon">
            <Feather name="copy" size={12} color={COLORS.brand} />
            <Text style={styles.copyText}>Copy Mon → Weekdays</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: SPACING.lg }}>
          {DAYS.map((d) => {
            const count = (schedule[d.key] || []).length;
            const active = d.key === activeDay;
            return (
              <TouchableOpacity
                key={d.key}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => setActiveDay(d.key)}
                testID={`av-day-${d.key}`}
              >
                <Text style={[styles.dayShort, active && { color: COLORS.surface }]}>{d.short}</Text>
                <Text style={[styles.dayCount, active && { color: COLORS.accentSoft }]}>
                  {count} {count === 1 ? "slot" : "slots"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Selected day header */}
        <View style={styles.dayHead}>
          <Text style={styles.dayHeadTitle}>
            {DAYS.find((d) => d.key === activeDay)?.label}
          </Text>
          {daySlots.length > 0 && (
            <TouchableOpacity onPress={() => clearDay(activeDay)} testID="av-clear-day">
              <Text style={styles.clearText}>Clear day</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Slot preset grid */}
        <View style={styles.slotGrid}>
          {SLOT_PRESETS.map((s) => {
            const selected = daySlots.includes(s);
            return (
              <TouchableOpacity
                key={s}
                onPress={() => toggleSlot(activeDay, s)}
                style={[styles.slot, selected && styles.slotActive]}
                testID={`av-slot-${activeDay}-${s}`}
              >
                <Text style={[styles.slotText, selected && { color: COLORS.surface }]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom slot input */}
        <View style={styles.customRow}>
          <TextInput
            value={customSlot}
            onChangeText={setCustomSlot}
            placeholder="Custom HH:MM"
            placeholderTextColor={COLORS.textMuted}
            style={styles.customInput}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            testID="av-custom"
          />
          <TouchableOpacity style={styles.addBtn} onPress={addCustom} testID="av-add-custom">
            <Feather name="plus" size={14} color={COLORS.surface} />
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        </View>

        {/* Notes */}
        <Text style={styles.sectionLabel}>Notes for patients (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="e.g. Weekday evenings on video only. Sunday reserved for follow-ups."
          placeholderTextColor={COLORS.textMuted}
          style={styles.notesInput}
          maxLength={300}
          testID="av-notes"
        />

        <View style={styles.summary}>
          <Feather name="calendar" size={14} color={COLORS.brand} />
          <Text style={styles.summaryText}>
            {totalSlots} total weekly {totalSlots === 1 ? "slot" : "slots"} · {slotDuration} min each
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          disabled={saving}
          onPress={save}
          testID="av-save"
        >
          {saving ? (
            <ActivityIndicator color={COLORS.surface} />
          ) : (
            <>
              <Feather name="check" size={16} color={COLORS.surface} />
              <Text style={styles.saveText}>Save availability</Text>
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
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary },
  card: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    margin: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  cardSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  sectionLabel: {
    paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  sectionHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, marginTop: SPACING.md,
  },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
  },
  copyText: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: SPACING.lg },
  modeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  modeChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  modeText: { color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 12 },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    marginRight: 8, alignItems: "center", minWidth: 68,
  },
  dayChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  dayShort: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 13 },
  dayCount: { color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  dayHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm,
  },
  dayHeadTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  clearText: { color: COLORS.error, fontSize: 12, fontWeight: "700" },
  slotGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    paddingHorizontal: SPACING.lg,
  },
  slot: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    minWidth: 68, alignItems: "center",
  },
  slotActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  slotText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 12 },
  customRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: SPACING.lg,
    marginTop: SPACING.md,
  },
  customInput: {
    flex: 1, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, color: COLORS.textPrimary,
  },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, borderRadius: RADIUS.md, backgroundColor: COLORS.accent,
  },
  addText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  notesInput: {
    marginHorizontal: SPACING.lg,
    minHeight: 80,
    padding: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, color: COLORS.textPrimary,
    textAlignVertical: "top",
  },
  summary: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
    padding: SPACING.md, backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  summaryText: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: SPACING.lg, backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill,
  },
  saveText: { color: COLORS.surface, fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
});
