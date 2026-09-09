// Admin Documents Review — approve & forward to doctor, or ask for re-upload.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, RefreshControl, Modal, Alert, TextInput, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const DOC_TYPE_LABEL: any = {
  blood_test: "Blood Test",
  prescription: "Prescription",
  xray_scan: "X-Ray / Scan",
  other: "Other",
};
const STATUS_FILTERS = [
  { id: "pending_review", label: "Pending review" },
  { id: "sent_to_doctor", label: "Sent to doctor" },
  { id: "reupload_requested", label: "Reupload asked" },
];

export default function AdminDocumentsReview() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("pending_review");
  const [editing, setEditing] = useState<any>(null);
  const [decision, setDecision] = useState<"approve" | "reupload">("approve");
  const [assignedDoctor, setAssignedDoctor] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [d, docs] = await Promise.all([
        api.adminPendingDocuments(filter),
        api.adminDoctors("verified").catch(() => []) as Promise<any[]>,
      ]);
      setItems(d.items || []);
      setDoctors(Array.isArray(docs) ? docs : []);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  function openReview(doc: any) {
    setEditing(doc);
    setDecision("approve");
    setAssignedDoctor("");
    setNote("");
  }

  async function submitReview() {
    if (!editing) return;
    if (decision === "approve" && !assignedDoctor) {
      Alert.alert("Assign a doctor", "Please pick a verified doctor to forward this to.");
      return;
    }
    setBusy(true);
    try {
      await api.adminReviewDocument(editing.id, {
        decision,
        assigned_doctor_id: decision === "approve" ? assignedDoctor : undefined,
        review_note: note || undefined,
      });
      setEditing(null);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="adr-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Document Review</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {STATUS_FILTERS.map((s) => (
          <TouchableOpacity key={s.id} style={[styles.chip, filter === s.id && styles.chipActive]} onPress={() => setFilter(s.id)}>
            <Text style={[styles.chipText, filter === s.id && { color: COLORS.surface }]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.brand} style={{ marginTop: SPACING.lg }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="check-square" size={30} color={COLORS.brand} />
            <Text style={styles.emptyText}>No documents in this bucket.</Text>
          </View>
        ) : (
          items.map((d) => (
            <View key={d.id} style={styles.card}>
              <TouchableOpacity onPress={() => setPreviewOpen(d)} testID={`adr-preview-${d.id}`}>
                {d.content_type?.startsWith("image/") ? (
                  <Image source={{ uri: api.documentDownloadUrl(d.id, d.download_token) }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.pdfThumb]}>
                    <Feather name="file-text" size={28} color={COLORS.brand} />
                    <Text style={styles.pdfLabel}>PDF</Text>
                  </View>
                )}
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.userLine} numberOfLines={1}>{d.user?.name || "—"}  ·  {d.user?.phone || "—"}</Text>
                <Text style={styles.docLine} numberOfLines={1}>{DOC_TYPE_LABEL[d.doc_type] || d.doc_type}  ·  {(d.size_bytes / 1024).toFixed(0)} KB</Text>
                {d.user_note ? <Text style={styles.noteLine} numberOfLines={2}>💬 {d.user_note}</Text> : null}
                {d.review_note ? <Text style={styles.reviewLine} numberOfLines={2}>Admin: {d.review_note}</Text> : null}
              </View>
              {d.status === "pending_review" ? (
                <TouchableOpacity style={styles.reviewBtn} onPress={() => openReview(d)} testID={`adr-review-${d.id}`}>
                  <Text style={styles.reviewBtnText}>Review</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.statusDone}>{d.status === "sent_to_doctor" ? "✓ Sent" : "↻ Reupload"}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* Preview modal */}
      <Modal visible={!!previewOpen} transparent animationType="fade" onRequestClose={() => setPreviewOpen(null)}>
        <TouchableOpacity style={styles.previewOverlay} activeOpacity={1} onPress={() => setPreviewOpen(null)}>
          {previewOpen?.content_type?.startsWith("image/") ? (
            <Image source={{ uri: api.documentDownloadUrl(previewOpen.id, previewOpen.download_token) }} style={styles.previewImg} resizeMode="contain" />
          ) : (
            <View style={styles.pdfPreviewCard}>
              <Feather name="file-text" size={60} color={COLORS.surface} />
              <Text style={styles.pdfPreviewText}>{previewOpen?.original_name}</Text>
              <TouchableOpacity style={styles.pdfOpenBtn} onPress={() => Linking.openURL(api.documentDownloadUrl(previewOpen.id, previewOpen.download_token))}>
                <Text style={styles.pdfOpenText}>Open PDF</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </Modal>

      {/* Review modal */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Review document</Text>
            <Text style={styles.modalSub}>{editing?.user?.name} · {editing?.user?.phone}</Text>
            <Text style={styles.label}>Decision</Text>
            <View style={styles.decisionRow}>
              <TouchableOpacity style={[styles.decisionBtn, decision === "approve" && styles.decisionApprove]} onPress={() => setDecision("approve")} testID="adr-approve">
                <Feather name="check" size={14} color={decision === "approve" ? COLORS.surface : COLORS.brand} />
                <Text style={[styles.decisionText, decision === "approve" && { color: COLORS.surface }]}>Approve & Forward</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.decisionBtn, decision === "reupload" && styles.decisionReupload]} onPress={() => setDecision("reupload")} testID="adr-reupload">
                <Feather name="refresh-cw" size={14} color={decision === "reupload" ? COLORS.surface : "#8a6d00"} />
                <Text style={[styles.decisionText, decision === "reupload" && { color: COLORS.surface }]}>Ask re-upload</Text>
              </TouchableOpacity>
            </View>

            {decision === "approve" && (
              <>
                <Text style={styles.label}>Assign to doctor</Text>
                <ScrollView style={{ maxHeight: 180 }}>
                  {doctors.map((doc: any) => (
                    <TouchableOpacity
                      key={doc.user_id || doc.id}
                      style={[styles.doctorItem, assignedDoctor === (doc.user_id || doc.id) && styles.doctorItemActive]}
                      onPress={() => setAssignedDoctor(doc.user_id || doc.id)}
                      testID={`adr-doctor-${doc.user_id || doc.id}`}
                    >
                      <Text style={styles.doctorName}>{doc.name}</Text>
                      <Text style={styles.doctorSpec}>{doc.specialty}  ·  ₹{doc.consultation_fee}</Text>
                    </TouchableOpacity>
                  ))}
                  {doctors.length === 0 && <Text style={{ color: COLORS.textMuted, padding: SPACING.sm }}>No verified doctors yet.</Text>}
                </ScrollView>
              </>
            )}

            <Text style={styles.label}>{decision === "approve" ? "Note to doctor (optional)" : "Reason for re-upload"}</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder={decision === "approve" ? "Latest blood test — please review" : "Photo is blurry, please re-scan"}
              multiline
              maxLength={500}
              testID="adr-note"
            />

            <View style={{ flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.5 }]} onPress={submitReview} disabled={busy} testID="adr-save">
                {busy ? <ActivityIndicator size="small" color={COLORS.surface} /> : <Text style={styles.saveBtnText}>Confirm</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  chipsRow: { flexDirection: "row", gap: 6, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", padding: SPACING.xl, gap: 8 },
  emptyText: { color: COLORS.textMuted, fontSize: 13 },
  card: { flexDirection: "row", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm, marginBottom: SPACING.sm },
  thumb: { width: 64, height: 64, borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceAlt },
  pdfThumb: { alignItems: "center", justifyContent: "center", backgroundColor: "#ffe082" },
  pdfLabel: { fontSize: 9, color: COLORS.brand, fontWeight: "800", marginTop: 2 },
  userLine: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 13 },
  docLine: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  noteLine: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  reviewLine: { color: "#8a6d00", fontSize: 11, marginTop: 2 },
  reviewBtn: { alignSelf: "flex-start", backgroundColor: COLORS.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill },
  reviewBtnText: { color: COLORS.surface, fontWeight: "800", fontSize: 11 },
  statusDone: { alignSelf: "center", color: COLORS.textMuted, fontSize: 11, fontWeight: "700" },
  previewOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center" },
  previewImg: { width: "100%", height: "100%" },
  pdfPreviewCard: { alignItems: "center", gap: 12, padding: SPACING.lg },
  pdfPreviewText: { color: COLORS.surface, fontSize: 14, fontWeight: "700" },
  pdfOpenBtn: { backgroundColor: COLORS.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: RADIUS.pill, marginTop: 8 },
  pdfOpenText: { color: COLORS.surface, fontWeight: "800" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, paddingBottom: 40, maxHeight: "88%" },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  modalSub: { color: COLORS.textSecondary, fontSize: 13, marginBottom: SPACING.md },
  label: { color: COLORS.textPrimary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, marginTop: SPACING.md, marginBottom: 6 },
  decisionRow: { flexDirection: "row", gap: 8 },
  decisionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.pill, paddingVertical: 12, backgroundColor: COLORS.surface },
  decisionApprove: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  decisionReupload: { backgroundColor: "#e07b00", borderColor: "#e07b00" },
  decisionText: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 12 },
  doctorItem: { padding: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: 6 },
  doctorItemActive: { borderColor: COLORS.brand, backgroundColor: "#ffe082" },
  doctorName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "700" },
  doctorSpec: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  noteInput: { minHeight: 60, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, color: COLORS.textPrimary, fontSize: 13, textAlignVertical: "top" },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", backgroundColor: COLORS.surface },
  cancelBtnText: { color: COLORS.textPrimary, fontWeight: "700" },
  saveBtn: { flex: 1.5, paddingVertical: 14, borderRadius: RADIUS.pill, alignItems: "center", backgroundColor: COLORS.brand },
  saveBtnText: { color: COLORS.surface, fontWeight: "800", fontSize: 14 },
});
