import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { Feather } from "@expo/vector-icons";

export default function Appointments() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try { setItems(await api.listAppointments()); } catch {}
    })();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="appts-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>My appointments</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        ListEmptyComponent={<Text style={styles.empty}>No appointments yet.</Text>}
        renderItem={({ item }) => {
          const dt = new Date(item.slot);
          return (
            <View style={styles.card} testID={`appt-${item.id}`}>
              <View style={styles.dateBox}>
                <Text style={styles.dateNum}>{dt.getDate()}</Text>
                <Text style={styles.dateMo}>{dt.toLocaleString([], { month: "short" })}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.docName}>{item.doctor_name}</Text>
                <Text style={styles.docSpec}>{item.doctor_specialty}</Text>
                <Text style={styles.docTime}>{dt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
              </View>
              <TouchableOpacity style={styles.joinBtn} testID={`appt-join-${item.id}`}>
                <Feather name="video" size={16} color={COLORS.surface} />
                <Text style={styles.joinText}>Join</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { flexDirection: "row", alignItems: "center", gap: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
  dateBox: { width: 56, alignItems: "center", padding: 8, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md },
  dateNum: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.brand },
  dateMo: { color: COLORS.brand, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  docName: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  docSpec: { color: COLORS.accent, fontSize: 11, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginTop: 2 },
  docTime: { color: COLORS.textSecondary, marginTop: 4, fontSize: 12 },
  joinBtn: { flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: COLORS.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill },
  joinText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: 40 },
});
