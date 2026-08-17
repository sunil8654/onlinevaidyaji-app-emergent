// Admin Pre-Sales Queue — SLA indicator, status workflow, CSV export.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Modal, Linking, Alert, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const STATUSES = [
  { id: "not_contacted",  label: "Not contacted",  color: "#8a1a1a", bg: "#ffcccc" },
  { id: "contacted",       label: "Contacted",       color: "#8a6d00", bg: "#ffe082" },
  { id: "consult_booked",  label: "Consult booked",  color: "#0d47a1", bg: "#bbdefb" },
  { id: "consult_done",    label: "Consult done",    color: "#1b5e20", bg: "#c8e6c9" },
  { id: "kit_ordered",     label: "Kit ordered",     color: "#4a148c", bg: "#e1bee7" },
];

function ageFmt(secs: number) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export default function AdminPresales() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>("");
  const [editingLead, setEditingLead] = useState<any>(null);
  const [nextStatus, setNextStatus] = useState<string>("contacted");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.adminPresalesLeads(filter || undefined);
      setItems(r.items || []);
      setStats(r.stats || {});
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  function callNow(phone: string) {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => Alert.alert("Cannot call", phone));
  }

  function openEdit(lead: any) {
    setEditingLead(lead);
    setNextStatus(lead.status === "not_contacted" ? "contacted" : lead.status);
    setNote("");
  }

  async function saveStatus() {
    if (!editingLead) return;
    setBusy(true);
    try {
      await api.adminUpdateLeadStatus(editingLead.id, { status: nextStatus, note });
      setEditingLead(null);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Try again");
    } finally { setBusy(false); }
  }

  function exportCsv() {
    Linking.openURL(api.adminPresalesCsvUrl()).catch(() => Alert.alert("Cannot open", "Copy the URL manually"));
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="ap-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pre-Sales Queue</Text>
        <TouchableOpacity onPress={exportCsv} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="ap-csv">
          <Feather name="download" size={20} color={COLORS.brand} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={COLORS.brand} />}
      >
        {/* Stat tiles */}
        <View style={styles.statRow}>
          <StatTile label="Today's signups" value={stats.today_signups || 0} icon="user-plus" />
          <StatTile label="Pending calls" value={stats.pending_calls || 0} icon="phone-missed" danger={(stats.pending_calls || 0) > 0} />
          <StatTile label="Booked today" value={stats.consults_booked_today || 0} icon="check-circle" />
          <StatTile label="Docs pending" value={stats.pending_documents || 0} icon="file-text" onPress={() => router.push("/admin/documents-review")} />
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <FilterChip label="All" active={filter === ""} onPress={() => setFilter("")} />
          {STATUSES.map((s) => (
            <FilterChip key={s.id} label={s.label} active={filter === s.id} onPress={() => setFilter(s.id)} />
          ))}
        </ScrollView>

        {/* Leads list */}
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.brand} style={{ marginTop: SPACING.lg }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="inbox" size={30} color={COLORS.brand} />
            <Text style={styles.emptyText}>No leads in this bucket yet.</Text>
          </View>
        ) : (
          items.map((lead) => {
            const status = STATUSES.find((s) => s.id === lead.status) || STATUSES[0];
            return (
              <View key={lead.id} style={[styles.card, lead.sla_breached && styles.cardBreached]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.name} numberOfLines={1}>{lead.name || "—"}</Text>
                    {lead.sla_breached && (
                      <View style={styles.slaTag}>
                        <Feather name="alert-triangle" size={10} color="#8a1a1a" />
                        <Text style={styles.slaTagText}>SLA breach · {ageFmt(lead.age_seconds || 0)}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.meta}>{lead.phone || "—"}  ·  {lead.language?.toUpperCase() || "EN"}  ·  {lead.age_group || "—"}</Text>
                  <Text style={styles.meta2}>{lead.prakriti_result || "—"}  ·  {lead.recommended_kit_name || "—"}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <View style={[styles.pill, { backgroundColor: status.bg }]}>
                      <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
                    </View>
                    <View style={styles.pillMono}>
                      <Feather name={lead.call_preference === "phone" ? "phone" : "video"} size={10} color={COLORS.brand} />
                      <Text style={styles.pillTextMono}>{lead.call_preference || "not set"}</Text>
                    </View>
                    {lead.documents_uploaded > 0 && (
                      <View style={styles.pillMono}>
                        <Feather name="paperclip" size={10} color={COLORS.brand} />
                        <Text style={styles.pillTextMono}>{lead.documents_uploaded} docs</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={{ gap: 6 }}>
                  <TouchableOpacity style={styles.callBtn} onPress={() => callNow(lead.phone)} testID={`ap-call-${lead.id}`}>
                    <Feather name="phone" size={14} color={COLORS.surface} />
                    <Text style={styles.callBtnText}>Call now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(lead)} testID={`ap-edit-${lead.id}`}>
                    <Feather name="edit-2" size={12} color={COLORS.brand} />
                    <Text style={styles.editBtnText}>Update</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Status edit modal */}
      <Modal visible={!!editingLead} transparent animationType="slide" onRequestClose={() => setEditingLead(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update lead status</Text>
            <Text style={styles.modalSub}>{editingLead?.name} · {editingLead?.phone}</Text>
            <Text style={styles.label}>New status</Text>
            <View style={styles.statusList}>
              {STATUSES.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.statusItem, nextStatus === s.id && { backgroundColor: s.bg, borderColor: s.color }]}
                  onPress={() => setNextStatus(s.id)}
                  testID={`ap-status-${s.id}`}
                >
                  <Text style={[styles.statusItemText, nextStatus === s.id && { color: s.color, fontWeight: "800" }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Called at 3 PM, will call back tomorrow…"
              multiline
              maxLength={500}
              testID="ap-note"
            />
            <View style={{ flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingLead(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.5 }]} onPress={saveStatus} disabled={busy} testID="ap-save">
                {busy ? <ActivityIndicator size="small" color={COLORS.surface} /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatTile({ label, value, icon, danger, onPress }: any) {
  const Cmp: any = onPress ? TouchableOpacity : View;
  return (
    <Cmp style={[styles.stat, danger && { borderColor: "#8a1a1a" }]} onPress={onPress}>
      <Feather name={icon} size={16} color={danger ? "#8a1a1a" : COLORS.brand} />
      <Text style={[styles.statVal, danger && { color: "#8a1a1a" }]}>{value}</Text>
      <Text style={styles.statLbl} numberOfLines={2}>{label}</Text>
    </Cmp>
  );
}

function FilterChip({ label, active, onPress }: any) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && { color: COLORS.surface }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  statRow: { flexDirection: "row", flexWrap: "wrap", padding: SPACING.md, gap: 8 },
  stat: { flex: 1, minWidth: 80, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm, alignItems: "center", gap: 4 },
  statVal: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  statLbl: { color: COLORS.textMuted, fontSize: 10, fontWeight: "700", textAlign: "center" },
  chipsRow: { flexDirection: "row", gap: 6, paddingHorizontal: SPACING.md, paddingBottom: SPACING.md },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", padding: SPACING.xl, gap: 8 },
  emptyText: { color: COLORS.textMuted, fontSize: 13 },
  card: { flexDirection: "row", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginHorizontal: SPACING.md, marginBottom: SPACING.sm },
  cardBreached: { borderColor: "#8a1a1a", backgroundColor: "#fff5f5" },
  name: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 15, flexShrink: 1 },
  slaTag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#ffcccc", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  slaTagText: { color: "#8a1a1a", fontSize: 9, fontWeight: "800" },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  meta2: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pillText: { fontSize: 10, fontWeight: "800" },
  pillMono: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, backgroundColor: COLORS.surfaceAlt },
  pillTextMono: { color: COLORS.brand, fontSize: 10, fontWeight: "700" },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  callBtnText: { color: COLORS.surface, fontWeight: "800", fontSize: 11 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.brand },
  editBtnText: { color: COLORS.brand, fontWeight: "800", fontSize: 11 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, paddingBottom: 40 },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary },
  modalSub: { color: COLORS.textSecondary, fontSize: 13, marginBottom: SPACING.md },
  label: { color: COLORS.textPrimary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, marginTop: SPACING.md, marginBottom: 6 },
  statusList: { gap: 6 },
  statusItem: { paddingHorizontal: SPACING.md, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  statusItemText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  noteInput: { minHeight: 70, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, color: COLORS.textPrimary, fontSize: 13, textAlignVertical: "top" },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", backgroundColor: COLORS.surface },
  cancelBtnText: { color: COLORS.textPrimary, fontWeight: "700" },
  saveBtn: { flex: 1.5, paddingVertical: 14, borderRadius: RADIUS.pill, alignItems: "center", backgroundColor: COLORS.brand },
  saveBtnText: { color: COLORS.surface, fontWeight: "800", fontSize: 14 },
});
