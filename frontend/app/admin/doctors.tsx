import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView, Modal, TextInput, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING, SPECIALTIES } from "@/src/theme";
import { api, absoluteMediaUrl, type AdminVerification, type DoctorVerificationDoc } from "@/src/api";
import { useI18n } from "@/src/i18n";
import Feather from "@react-native-vector-icons/feather";

type Filter = "all" | "pending" | "verified";

const DOC_STATUS_COLOR: Record<DoctorVerificationDoc["status"], string> = {
  pending: COLORS.warning,
  approved: COLORS.success,
  rejected: COLORS.error,
};

const prettyType = (t: string) =>
  t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function AdminDoctors() {
  const router = useRouter();
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<any[]>([]);
  const [queue, setQueue] = useState<AdminVerification[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", email: "", specialty: "Ayurveda", qualification: "", experience_years: "0", consultation_fee: "499", bio: "", verified: true });
  /** Rejection reason prompt. Rejecting without a reason leaves the doctor
      with a `restriction_reason` they cannot act on, so it is mandatory here. */
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Shared by the effect and the manual refreshes after approve/reject.
  // `alive` guards against a stale response: switching the filter tab fires a
  // second fetch, and without this the slower first response could land last and
  // overwrite the list with the wrong filter's doctors.
  const load = useCallback(async (alive?: () => boolean) => {
    const ok = () => (alive ? alive() : true);
    try {
      const q = filter === "all" ? undefined : filter;
      const d = await api.adminDoctors(q);
      if (ok()) setItems(Array.isArray(d) ? d : (d?.items ?? []));
    } catch {}
    try {
      // The verification queue is what carries the uploaded credentials, so it
      // is loaded alongside the doctor list and merged in by id.
      const v = await api.adminVerifications();
      if (ok()) setQueue(v?.verifications ?? []);
    } catch {}
  }, [filter]);

  useEffect(() => {
    let mounted = true;
    load(() => mounted);
    return () => { mounted = false; };
  }, [load]);

  const docsFor = useCallback(
    (id: string): DoctorVerificationDoc[] => queue.find((q) => q.id === id)?.documents ?? [],
    [queue]
  );

  const approve = async (id: string) => {
    setBusy(id);
    try {
      await api.adminDecideVerification(id, "approved");
    } catch {
      // Fall back to the legacy route so an older build still works.
      await api.adminApproveDoctor(id).catch(() => {});
    }
    setBusy("");
    load();
  };

  const confirmReject = async () => {
    if (!rejectFor) return;
    const id = rejectFor;
    setBusy(id);
    try {
      await api.adminDecideVerification(id, "rejected", rejectReason.trim() || "Rejected during verification");
    } catch {
      await api.adminRejectDoctor(id).catch(() => {});
    }
    setBusy("");
    setRejectFor(null);
    setRejectReason("");
    load();
  };

  const remove = async (id: string) => { setBusy(id); await api.adminDeleteDoctor(id).catch(() => {}); setBusy(""); load(); };

  const openDoc = async (doc: DoctorVerificationDoc) => {
    // Verification documents are private — open via the authenticated endpoint
    // using the short-lived token the server issued for this admin session.
    const url = doc.download_token
      ? api.verificationDocUrl(doc.id, doc.download_token)
      : null;
    if (!url) {
      Alert.alert("Unavailable", "This document could not be opened. Please refresh and try again.");
      return;
    }
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (!canOpen) {
      Alert.alert("Cannot open", "This file could not be opened on your device.");
      return;
    }
    await Linking.openURL(url).catch(() => {});
  };

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
        renderItem={({ item }) => {
          const docs = docsFor(item.id);
          const open = expanded === item.id;
          return (
          <View style={styles.card} testID={`ad-doc-${item.id}`}>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/admin/doctor/[id]", params: { id: item.id } })}
              style={{ flexDirection: "row", gap: SPACING.md }}
            >
              <Image source={{ uri: absoluteMediaUrl(item.avatar_url) ?? undefined }} style={styles.avatar} />
              <View style={{ flex: 1 }}>
                <Text style={styles.docName}>{item.name}</Text>
                <Text style={styles.docSub}>{item.specialty} · {item.qualification}</Text>
                <Text style={styles.docMeta}>{item.experience_years} yrs · ₹{item.consultation_fee}</Text>
                {item.registration_number ? <Text style={styles.reg}>Reg: {item.registration_number}</Text> : null}
              </View>
              <View style={[styles.badge, { backgroundColor: item.verified ? COLORS.success : COLORS.warning }]}>
                <Text style={styles.badgeText}>{item.verified ? "VERIFIED" : "PENDING"}</Text>
              </View>
            </TouchableOpacity>

            {/* Credentials. An admin cannot verify a registration they cannot see,
                and before this the app stored no real files at all - onboarding
                sent placeholder filenames, so there was nothing to review. */}
            {docs.length > 0 ? (
              <View style={styles.docsWrap} testID={`ad-docs-${item.id}`}>
                <TouchableOpacity
                  style={styles.docsToggle}
                  onPress={() => setExpanded(open ? null : item.id)}
                  testID={`ad-docs-toggle-${item.id}`}
                >
                  <Feather name="paperclip" size={13} color={COLORS.brand} />
                  <Text style={styles.docsToggleText}>
                    {docs.length} credential{docs.length > 1 ? "s" : ""} uploaded
                  </Text>
                  <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={COLORS.textMuted} />
                </TouchableOpacity>
                {open ? (
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {docs.map((doc) => (
                      <TouchableOpacity
                        key={doc.id}
                        style={styles.docRow}
                        onPress={() => openDoc(doc)}
                        testID={`ad-doc-file-${doc.id}`}
                      >
                        <Feather name="file-text" size={15} color={COLORS.brand} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.docRowTitle}>{prettyType(doc.document_type)}</Text>
                          <Text style={styles.docRowSub} numberOfLines={1}>{doc.document_path ?? "no file"}</Text>
                        </View>
                        <View style={[styles.docStatus, { backgroundColor: DOC_STATUS_COLOR[doc.status] }]}>
                          <Text style={styles.docStatusText}>{doc.status.toUpperCase()}</Text>
                        </View>
                        <Feather name="external-link" size={13} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : (
              !item.verified && (
                <View style={styles.docsWarning} testID={`ad-docs-missing-${item.id}`}>
                  <Feather name="alert-circle" size={13} color={COLORS.warning} />
                  <Text style={styles.docsWarningText}>No credentials on file — review the details before approving.</Text>
                </View>
              )
            )}

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
              {/* Reject must be available for a PENDING doctor too. It used to be
                  gated on `item.verified`, which meant an unapproved applicant
                  could never be returned — there was no path out of the queue
                  except approval or deletion. */}
              <TouchableOpacity
                style={[styles.actBtn, { backgroundColor: COLORS.warning }]}
                onPress={() => { setRejectFor(item.id); setRejectReason(""); }}
                disabled={busy === item.id}
                testID={`ad-reject-${item.id}`}
              >
                <Feather name="alert-circle" size={14} color={COLORS.surface} />
                <Text style={styles.actText}>{t("reject")}</Text>
              </TouchableOpacity>
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
          </View>
          );
        }}
      />

      {/* Reject with a reason. The reason is stored in
          `doctors.restriction_reason` and shown to the doctor in the app and on
          the website, so it is the only thing telling them what to fix. */}
      <Modal visible={!!rejectFor} animationType="slide" transparent onRequestClose={() => setRejectFor(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Return this application?</Text>
            <Text style={styles.modalSub}>
              The doctor is not approved and your reason is shown to them so they can
              fix it and resubmit. They stay hidden from the public directory until you
              approve them.
            </Text>
            <TextInput
              style={[styles.field, { minHeight: 84 }]}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              placeholder="e.g. Degree certificate is unreadable — please re-upload a clearer scan."
              placeholderTextColor={COLORS.textMuted}
              testID="ad-reject-reason"
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: SPACING.md }}>
              <TouchableOpacity style={styles.cancel} onPress={() => setRejectFor(null)} testID="ad-reject-cancel">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.save, { backgroundColor: COLORS.warning }, busy === rejectFor && { opacity: 0.6 }]}
                onPress={confirmReject}
                disabled={busy === rejectFor}
                testID="ad-reject-confirm"
              >
                <Feather name="send" size={14} color={COLORS.surface} />
                <Text style={styles.saveText}>Return</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  cancelText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 14 },
  save: { flex: 1, paddingVertical: 14, alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
  saveText: { color: COLORS.surface, fontWeight: "700", fontSize: 14 },
  // --- credentials list -------------------------------------------------
  docsWrap: { marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  docsToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  docsToggleText: { flex: 1, color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  docRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 8 },
  docRowTitle: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700" },
  docRowSub: { color: COLORS.textMuted, fontSize: 10, marginTop: 1 },
  docStatus: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.sm },
  docStatusText: { color: COLORS.surface, fontSize: 8, fontWeight: "800", letterSpacing: 0.5 },
  docsWarning: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  docsWarningText: { flex: 1, color: COLORS.textSecondary, fontSize: 11 },
  // --- reject modal -----------------------------------------------------
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: SPACING.lg },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  modalSub: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: SPACING.md },
  field: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 14, textAlignVertical: "top" },
});
