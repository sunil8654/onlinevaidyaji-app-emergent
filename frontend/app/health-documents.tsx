// Health Documents — upload, list, delete (Phase 1b).
// Files stored in Emergent Object Storage · Downloaded via short-lived token URLs.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, Alert, RefreshControl, Modal, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const COPY = {
  title: { en: "Health Documents", hi: "स्वास्थ्य दस्तावेज़" },
  privacy: {
    en: "Your documents are 100% private — visible only to your care team.",
    hi: "Aapke documents 100% private hain — sirf aapki care team dekh sakti hai.",
  },
  addBtn: { en: "Upload document", hi: "Document Upload karein" },
  pickPhoto: { en: "Photo from gallery", hi: "Gallery se photo" },
  pickCamera: { en: "Take photo", hi: "Photo lein" },
  pickPdf: { en: "PDF file", hi: "PDF file" },
  cancel: { en: "Cancel", hi: "Cancel" },
  empty: {
    en: "No documents yet. Upload your prescriptions, blood test reports, or scans and our team will forward them to your AYUSH doctor.",
    hi: "Abhi tak koi document nahi. Apni prescription, blood test report ya scan upload karein — hamari team aapke AYUSH doctor ko bhej degi.",
  },
  chipPending: { en: "Team review pending", hi: "Team check kar rahi hai" },
  chipSent: { en: "Sent to doctor", hi: "Doctor ko bhej diya gaya" },
  chipReupload: { en: "Please re-upload", hi: "Dobara upload karein" },
  docType: { en: "Document type", hi: "Document ka type" },
  noteLabel: { en: "Anything to tell us about this report? (optional)", hi: "Kuch batana chahein is report ke baare mein? (optional)" },
  upload: { en: "Upload", hi: "Upload" },
  uploading: { en: "Uploading…", hi: "Upload ho raha hai…" },
  deleteConfirm: {
    en: "Delete this document?",
    hi: "Yeh document delete karein?",
  },
};

const DOC_TYPES = [
  { id: "blood_test",  en: "Blood Test Report", hi: "Blood Test Report" },
  { id: "prescription", en: "Doctor Prescription", hi: "Doctor Prescription" },
  { id: "xray_scan",   en: "X-Ray / Scan", hi: "X-Ray / Scan" },
  { id: "other",       en: "Other", hi: "Other" },
];

function StatusChip({ status, lang }: any) {
  const map: any = {
    pending_review: { icon: "clock", bg: "#ffe082", fg: "#8a6d00", label: COPY.chipPending[lang] },
    sent_to_doctor: { icon: "send", bg: "#c8e6c9", fg: "#1b5e20", label: COPY.chipSent[lang] },
    reupload_requested: { icon: "alert-circle", bg: "#ffcccc", fg: "#8a1a1a", label: COPY.chipReupload[lang] },
  };
  const c = map[status] || map.pending_review;
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Feather name={c.icon} size={11} color={c.fg} />
      <Text style={[styles.chipText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

export default function HealthDocuments() {
  const router = useRouter();
  const { lang: appLang } = useI18n();
  const { user } = useAuth();
  const lang = (user?.preferred_language as "en" | "hi") || appLang || "en";

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pickedFile, setPickedFile] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [docType, setDocType] = useState<string>("blood_test");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.listMyDocuments();
      setItems((r.items || []).filter((d: any) => !d.deleted));
    } catch (e: any) {
      // ignore
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function pickImage(fromCamera: boolean) {
    setPickerOpen(false);
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert(lang === "hi" ? "Permission chahiye" : "Permission needed", lang === "hi" ? "Kripya photos access dein." : "Please allow access to your photos.");
        return;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPickedFile({ uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, mimeType: a.mimeType || "image/jpeg" });
      setUploadModalOpen(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    }
  }

  async function pickPdf() {
    setPickerOpen(false);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPickedFile({ uri: a.uri, name: a.name, mimeType: a.mimeType || "application/pdf" });
      setUploadModalOpen(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    }
  }

  async function submitUpload() {
    if (!pickedFile) return;
    setUploading(true);
    try {
      await api.uploadDocument(pickedFile, docType, note || undefined);
      setUploadModalOpen(false);
      setPickedFile(null);
      setNote("");
      setDocType("blood_test");
      await load();
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message || "Try again");
    } finally { setUploading(false); }
  }

  async function del(doc: any) {
    Alert.alert(COPY.deleteConfirm[lang], doc.original_name, [
      { text: COPY.cancel[lang], style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.deleteDocument(doc.id); await load(); }
        catch (e: any) { Alert.alert("Error", e?.message || "Try again"); }
      } },
    ]);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="hd-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{COPY.title[lang]}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />
        }
      >
        <View style={styles.privacyCard}>
          <Feather name="lock" size={16} color={COLORS.brand} />
          <Text style={styles.privacyText}>{COPY.privacy[lang]}</Text>
        </View>

        <TouchableOpacity style={styles.addBtn} onPress={() => setPickerOpen(true)} testID="hd-add">
          <Feather name="upload-cloud" size={18} color={COLORS.surface} />
          <Text style={styles.addBtnText}>{COPY.addBtn[lang]}</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={COLORS.brand} style={{ marginTop: SPACING.lg }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="file-plus" size={30} color={COLORS.brand} />
            <Text style={styles.emptyText}>{COPY.empty[lang]}</Text>
          </View>
        ) : (
          items.map((d) => (
            <View key={d.id} style={styles.docCard}>
              {d.content_type?.startsWith("image/") ? (
                <Image
                  source={{ uri: api.documentDownloadUrl(d.id, d.download_token) }}
                  style={styles.thumb}
                />
              ) : (
                <View style={[styles.thumb, styles.pdfThumb]}>
                  <Feather name="file-text" size={28} color={COLORS.brand} />
                  <Text style={styles.pdfLabel}>PDF</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.docName} numberOfLines={1}>{d.original_name}</Text>
                <Text style={styles.docMeta}>
                  {(DOC_TYPES.find((t) => t.id === d.doc_type) as any)?.[lang] || d.doc_type}  ·  {(d.size_bytes / 1024).toFixed(0)} KB
                </Text>
                <StatusChip status={d.status} lang={lang} />
                {d.review_note ? <Text style={styles.reviewNote}>{d.review_note}</Text> : null}
              </View>
              {d.status === "pending_review" && (
                <TouchableOpacity onPress={() => del(d)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID={`hd-del-${d.id}`}>
                  <Feather name="trash-2" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* Source picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <TouchableOpacity style={styles.sheetOpt} onPress={() => pickImage(true)} testID="hd-pick-camera">
              <Feather name="camera" size={20} color={COLORS.brand} />
              <Text style={styles.sheetText}>{COPY.pickCamera[lang]}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetOpt} onPress={() => pickImage(false)} testID="hd-pick-photo">
              <Feather name="image" size={20} color={COLORS.brand} />
              <Text style={styles.sheetText}>{COPY.pickPhoto[lang]}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetOpt} onPress={pickPdf} testID="hd-pick-pdf">
              <Feather name="file-text" size={20} color={COLORS.brand} />
              <Text style={styles.sheetText}>{COPY.pickPdf[lang]}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sheetOpt, { borderTopWidth: 1, borderTopColor: COLORS.border }]} onPress={() => setPickerOpen(false)}>
              <Text style={[styles.sheetText, { color: COLORS.textMuted }]}>{COPY.cancel[lang]}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Upload metadata modal */}
      <Modal visible={uploadModalOpen} transparent animationType="slide" onRequestClose={() => setUploadModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.uploadCard}>
            <Text style={styles.uploadTitle}>{pickedFile?.name}</Text>
            <Text style={styles.label}>{COPY.docType[lang]}</Text>
            <View style={styles.typeRow}>
              {DOC_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.typePill, docType === t.id && styles.typePillActive]}
                  onPress={() => setDocType(t.id)}
                  testID={`hd-type-${t.id}`}
                >
                  <Text style={[styles.typeText, docType === t.id && { color: COLORS.surface }]}>{(t as any)[lang]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>{COPY.noteLabel[lang]}</Text>
            <TextInput
              style={styles.textArea}
              value={note}
              onChangeText={setNote}
              placeholder=""
              multiline
              maxLength={500}
              testID="hd-note"
            />
            <View style={{ flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setUploadModalOpen(false); setPickedFile(null); setNote(""); }}>
                <Text style={styles.cancelBtnText}>{COPY.cancel[lang]}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.uploadBtn, uploading && { opacity: 0.5 }]} onPress={submitUpload} disabled={uploading} testID="hd-upload-submit">
                {uploading ? <ActivityIndicator size="small" color={COLORS.surface} /> : (
                  <>
                    <Feather name="upload" size={14} color={COLORS.surface} />
                    <Text style={styles.uploadBtnText}>{uploading ? COPY.uploading[lang] : COPY.upload[lang]}</Text>
                  </>
                )}
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
  privacyCard: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#e8f5e9", borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  privacyText: { flex: 1, color: COLORS.brand, fontSize: 12, fontWeight: "600", lineHeight: 18 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.pill, marginBottom: SPACING.lg, minHeight: 52 },
  addBtnText: { color: COLORS.surface, fontWeight: "800", fontSize: 14 },
  emptyBox: { alignItems: "center", padding: SPACING.lg, gap: 8 },
  emptyText: { color: COLORS.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  docCard: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm, marginBottom: SPACING.sm },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceAlt },
  pdfThumb: { alignItems: "center", justifyContent: "center", backgroundColor: "#ffe082" },
  pdfLabel: { fontSize: 9, color: COLORS.brand, fontWeight: "800", marginTop: 2 },
  docName: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 13 },
  docMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2, marginBottom: 4 },
  chip: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipText: { fontSize: 10, fontWeight: "700" },
  reviewNote: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingBottom: 40 },
  sheetOpt: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, minHeight: 56 },
  sheetText: { color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" },
  uploadCard: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, paddingBottom: 40 },
  uploadTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, marginBottom: SPACING.md },
  label: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, marginTop: SPACING.sm, marginBottom: 8 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typePill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  typePillActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  typeText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700" },
  textArea: { minHeight: 70, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, color: COLORS.textPrimary, fontSize: 13, textAlignVertical: "top" },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", backgroundColor: COLORS.surface },
  cancelBtnText: { color: COLORS.textPrimary, fontWeight: "700" },
  uploadBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
  uploadBtnText: { color: COLORS.surface, fontWeight: "800", fontSize: 14 },
});
