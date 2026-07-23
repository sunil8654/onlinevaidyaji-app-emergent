// Family Health — multiple profiles with vaccination + growth tracking
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const RELATIONS = ["Spouse", "Child", "Parent", "Sibling", "Grandparent", "Other"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", "Unknown"];

export default function Family() {
  const router = useRouter();
  const [members, setMembers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listFamilyMembers();
      setMembers(res.items || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const ageOf = (dob?: string) => {
    if (!dob) return "";
    try {
      const d = new Date(dob);
      const ms = Date.now() - d.getTime();
      const years = Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
      if (years >= 2) return `${years} yrs`;
      const months = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44)));
      return `${months} mo`;
    } catch { return ""; }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="family-back">
            <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Family Health</Text>
            <Text style={styles.title}>Loved ones</Text>
          </View>
          <TouchableOpacity style={styles.addPill} onPress={() => setModal(true)} testID="family-add">
            <Feather name="user-plus" size={14} color={COLORS.surface} />
            <Text style={styles.addPillText}>Add</Text>
          </TouchableOpacity>
        </View>

        {members.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="users" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No family members yet</Text>
            <Text style={styles.emptyBody}>
              Add a family member to track their vaccinations, growth (children), and health records in one place.
            </Text>
            <TouchableOpacity style={styles.cta} onPress={() => setModal(true)}>
              <Feather name="plus" size={16} color={COLORS.surface} />
              <Text style={styles.ctaText}>Add first member</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.list}>
            {members.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: "/family/[id]", params: { id: m.id } })}
                testID={`family-member-${m.id}`}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(m.name || "?").slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{m.name}</Text>
                  <Text style={styles.meta}>
                    {m.relation}{m.dob ? ` · ${ageOf(m.dob)}` : ""}{m.blood_group ? ` · ${m.blood_group}` : ""}
                  </Text>
                  {(m.conditions?.length > 0 || m.allergies?.length > 0) && (
                    <Text style={styles.tags} numberOfLines={1}>
                      {[...(m.conditions || []), ...(m.allergies || [])].join(" · ")}
                    </Text>
                  )}
                </View>
                <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.footTip}>
          🌿 Growth tracking and vaccination reminders help you keep the whole household in balance.
        </Text>
      </ScrollView>

      {modal && (
        <AddMemberModal onClose={() => setModal(false)} onSaved={async () => { setModal(false); await load(); }} />
      )}
    </SafeAreaView>
  );
}

// ---------------- Add Member Modal ----------------
function AddMemberModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<string>("Child");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<string>("");
  const [bloodGroup, setBloodGroup] = useState<string>("");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Please enter a name"); return; }
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      Alert.alert("Enter DOB as YYYY-MM-DD (e.g. 2020-05-14)");
      return;
    }
    setBusy(true);
    try {
      await api.addFamilyMember({
        name: name.trim(),
        relation,
        dob: dob || undefined,
        gender: gender || undefined,
        blood_group: bloodGroup || undefined,
        conditions: conditions ? conditions.split(",").map((s) => s.trim()).filter(Boolean) : [],
      });
      onSaved();
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <ScrollView contentContainerStyle={styles.modalSheet} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Add family member</Text>
            <TouchableOpacity onPress={onClose} testID="family-modal-close">
              <Feather name="x" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <MiniLabel>Name *</MiniLabel>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Aarav Kumar" placeholderTextColor={COLORS.textMuted} testID="fm-name" />

          <MiniLabel>Relation</MiniLabel>
          <View style={styles.chipsRow}>
            {RELATIONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.chip, relation === r && styles.chipActive]}
                onPress={() => setRelation(r)}
              >
                <Text style={[styles.chipText, relation === r && styles.chipTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <MiniLabel>Date of Birth (YYYY-MM-DD)</MiniLabel>
          <TextInput style={styles.input} value={dob} onChangeText={setDob} placeholder="2020-05-14" placeholderTextColor={COLORS.textMuted} testID="fm-dob" />

          <MiniLabel>Gender</MiniLabel>
          <View style={styles.chipsRow}>
            {["Male", "Female", "Other"].map((g) => (
              <TouchableOpacity key={g} style={[styles.chip, gender === g && styles.chipActive]} onPress={() => setGender(g)}>
                <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <MiniLabel>Blood Group</MiniLabel>
          <View style={styles.chipsRow}>
            {BLOOD_GROUPS.map((b) => (
              <TouchableOpacity key={b} style={[styles.chip, bloodGroup === b && styles.chipActive]} onPress={() => setBloodGroup(b)}>
                <Text style={[styles.chipText, bloodGroup === b && styles.chipTextActive]}>{b}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <MiniLabel>Known conditions (comma-separated)</MiniLabel>
          <TextInput style={styles.input} value={conditions} onChangeText={setConditions} placeholder="Asthma, Peanut allergy" placeholderTextColor={COLORS.textMuted} testID="fm-conditions" />

          <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} testID="fm-save">
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save member"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MiniLabel({ children }: { children: string }) {
  return <Text style={styles.miniLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingBottom: SPACING.xl },
  head: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  addPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  addPillText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  empty: {
    marginTop: SPACING.xl * 2,
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
  },
  emptyTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: SPACING.md },
  emptyBody: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  cta: {
    marginTop: SPACING.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.brand,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 15 },
  list: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.brand },
  name: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  tags: { color: COLORS.accent, fontSize: 11, marginTop: 4, fontWeight: "600" },
  footTip: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    fontStyle: "italic",
  },
  // Modal
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  modalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.md,
  },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  miniLabel: {
    color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 2,
    marginTop: SPACING.sm, marginBottom: 6, fontWeight: "700",
  },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textSecondary, fontSize: 13 },
  chipTextActive: { color: COLORS.surface, fontWeight: "700" },
  saveBtn: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.brand,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    alignItems: "center",
  },
  saveText: { color: COLORS.surface, fontSize: 15, fontWeight: "700" },
});
