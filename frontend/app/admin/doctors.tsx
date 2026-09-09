import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING, SPECIALTIES } from "@/src/theme";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import Feather from "@react-native-vector-icons/feather";

type Filter = "all" | "pending" | "verified";

export default function AdminDoctors() {
  const router = useRouter();
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", email: "", specialty: "Ayurveda", qualification: "", experience_years: "0", consultation_fee: "499", bio: "", verified: true });

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? undefined : filter;
      const d = await api.adminDoctors(q);
      setItems(d || []);
    } catch {}
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => { setBusy(id); await api.adminApproveDoctor(id).catch(() => {}); setBusy(""); load(); };
  const reject = async (id: string) => { setBusy(id); await api.adminRejectDoctor(id).catch(() => {}); setBusy(""); load(); };
  const remove = async (id: string) => { setBusy(id); await api.adminDeleteDoctor(id).catch(() => {}); setBusy(""); load(); };

  const saveNew = async () => {
    const body = {
      ...form,
      experience_years: parseInt(form.experience_years || "0", 10),
      consultation_fee: parseInt(form.consultation_fee || "499", 10),
      languages: ["Hindi", "English"],
    };
    setBusy("new");
    try {
      await api.adminAddDoctor(body);
      setAddOpen(false);
      setForm({ name: "", email: "", specialty: "Ayurveda", qualification: "", experience_years: "0", consultation_fee: "499", bio: "", verified: true });
      load();
    } catch {}
    setBusy("");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="ad-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{t("admin_dashboard")}</Text>
          <Text style={styles.title}>{t("doctors")}</Text>
        </View>
        <TouchableOpacity style={styles.add} onPress={() => setAddOpen(true)} testID="ad-add">
          <Feather name="plus" size={20} color={COLORS.surface} />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal style={styles.chipsWrap} contentContainerStyle={styles.chipsRow} showsHorizontalScrollIndicator={false}>
        {([
          { k: "all", label: t("all") },
          { k: "pending", label: t("pending_approval") },
          { k: "verified", label: "Verified" },
        ] as { k: Filter; label: string }[]).map((c) => (
          <TouchableOpacity key={c.k} style={[styles.chip, filter === c.k && styles.chipActive]} onPress={() => setFilter(c.k)} testID={`ad-filter-${c.k}`}>
            <Text style={[styles.chipText, filter === c.k && styles.chipTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListEmptyComponent={<Text style={styles.empty}>No entries.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: "/admin/doctor/[id]", params: { id: item.id } })}
            testID={`ad-doc-${item.id}`}
          >
            <View style={{ flexDirection: "row", gap: SPACING.md }}>
              <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
              <View style={{ flex: 1 }}>
                <Text style={styles.docName}>{item.name}</Text>
                <Text style={styles.docSub}>{item.specialty} · {item.qualification}</Text>
                <Text style={styles.docMeta}>{item.experience_years} yrs · ₹{item.consultation_fee}</Text>
                {item.registration_number ? <Text style={styles.reg}>Reg: {item.registration_number}</Text> : null}
              </View>
              <View style={[styles.badge, { backgroundColor: item.verified ? COLORS.success : COLORS.warning }]}>
                <Text style={styles.badgeText}>{item.verified ? "VERIFIED" : "PENDING"}</Text>
              </View>
            </View>
            <View style={styles.actionRow}>
              {!item.verified && (
                <TouchableOpacity
                  style={[styles.actBtn, { backgroundColor: COLORS.success }]}
                  onPress={() => approve(item.id)}
                  disabled={busy === item.id}
                  testID={`ad-approve-${item.id}`}
                >
                  <Feather name="check" size={14} color={COLORS.surface} />
                  <Text style={styles.actText}>{t("approve")}</Text>
                </TouchableOpacity>
              )}
              {item.verified && (
                <TouchableOpacity
                  style={[styles.actBtn, { backgroundColor: COLORS.warning }]}
                  onPress={() => reject(item.id)}
                  disabled={busy === item.id}
                  testID={`ad-reject-${item.id}`}
                >
                  <Feather name="alert-circle" size={14} color={COLORS.surface} />
                  <Text style={styles.actText}>{t("reject")}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actBtn, { backgroundColor: COLORS.error }]}
                onPress={() => remove(item.id)}
                disabled={busy === item.id}
                testID={`ad-remove-${item.id}`}
              >
                <Feather name="trash-2" size={14} color={COLORS.surface} />
                <Text style={styles.actText}>{t("remove")}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Add doctor modal */}
      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{t("add_doctor")}</Text>

              <Field label={t("full_name")} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="ad-add-name" />
              <Field label={t("email")} value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} testID="ad-add-email" />
              <Text style={styles.fLabel}>Specialty</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {SPECIALTIES.filter((s) => s !== "All").map((s) => (
                  <TouchableOpacity key={s} onPress={() => setForm({ ...form, specialty: s })} style={[styles.specChip, form.specialty === s && styles.specChipActive]} testID={`ad-add-spec-${s}`}>
                    <Text style={[styles.specText, form.specialty === s && { color: COLORS.surface }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Field label="Qualification" value={form.qualification} onChangeText={(v) => setForm({ ...form, qualification: v })} testID="ad-add-qual" />
              <Field label="Experience (yrs)" value={form.experience_years} onChangeText={(v) => setForm({ ...form, experience_years: v })} keyboardType="numeric" testID="ad-add-exp" />
              <Field label="Fee (₹)" value={form.consultation_fee} onChangeText={(v) => setForm({ ...form, consultation_fee: v })} keyboardType="numeric" testID="ad-add-fee" />
              <Field label="Bio" value={form.bio} onChangeText={(v) => setForm({ ...form, bio: v })} multiline testID="ad-add-bio" />

              <View style={{ flexDirection: "row", gap: 8, marginTop: SPACING.md, marginBottom: SPACING.md }}>
                <TouchableOpacity style={styles.cancel} onPress={() => setAddOpen(false)} testID="ad-add-cancel">
                  <Text style={{ color: COLORS.textPrimary, fontWeight: "700" }}>{t("cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.save, busy === "new" && { opacity: 0.6 }]} onPress={saveNew} disabled={busy === "new"} testID="ad-add-save">
                  <Text style={{ color: COLORS.surface, fontWeight: "700" }}>{busy === "new" ? t("saving") : t("save")}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, testID, keyboardType, multiline }: any) {
  return (
    <>
      <Text style={styles.fLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 60 }]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholderTextColor={COLORS.textMuted}
        testID={testID}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  add: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  chipsWrap: { maxHeight: 56 },
  chipsRow: { paddingHorizontal: SPACING.lg, gap: 8, alignItems: "center", height: 56 },
  chip: { flexShrink: 0, height: 36, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.surfaceAlt },
  docName: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  docSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  docMeta: { color: COLORS.accent, fontSize: 11, marginTop: 4, fontWeight: "700" },
  reg: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, alignSelf: "flex-start" },
  badgeText: { color: COLORS.surface, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: SPACING.md },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: RADIUS.pill },
  actText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  fLabel: { color: COLORS.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginTop: 12, marginBottom: 6, fontWeight: "700" },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 15 },
  specChip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  specChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  specText: { color: COLORS.textPrimary, fontWeight: "600", fontSize: 13 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  save: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
});
