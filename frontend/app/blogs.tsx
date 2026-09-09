import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";

export default function Blogs() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    (async () => { try { setItems(await api.listBlogs()); } catch {} })();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="blogs-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>Read & learn</Text>
          <Text style={styles.title}>AYUSH Journal</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 60 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} testID={`blog-${item.id}`} activeOpacity={0.9}>
            <Image source={{ uri: item.image_url }} style={styles.img} />
            <View style={styles.pad}>
              <View style={styles.metaRow}>
                <Text style={styles.cat}>{item.category?.toUpperCase() || "AYUSH"}</Text>
                <Text style={styles.readMin}>{item.read_min} min read</Text>
              </View>
              <Text style={styles.bTitle}>{item.title}</Text>
              <Text style={styles.excerpt} numberOfLines={2}>{item.excerpt}</Text>
              <Text style={styles.author}>— {item.author}</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal visible={selected !== null} animationType="slide" onRequestClose={() => setSelected(null)}>
        <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
          <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
            <View style={{ position: "relative" }}>
              <Image source={{ uri: selected?.image_url }} style={styles.heroImg} />
              <TouchableOpacity onPress={() => setSelected(null)} style={styles.closeBtn} testID="blog-close">
                <Feather name="x" size={20} color={COLORS.surface} />
              </TouchableOpacity>
            </View>
            <View style={{ padding: SPACING.lg }}>
              <View style={styles.metaRow}>
                <Text style={styles.cat}>{selected?.category?.toUpperCase()}</Text>
                <Text style={styles.readMin}>{selected?.read_min} min read</Text>
              </View>
              <Text style={styles.articleTitle}>{selected?.title}</Text>
              <Text style={styles.author}>— {selected?.author}</Text>
              <Text style={styles.body}>{selected?.body}</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  img: { width: "100%", height: 160 },
  pad: { padding: SPACING.md },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cat: { color: COLORS.accent, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  readMin: { color: COLORS.textMuted, fontSize: 11 },
  bTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary, marginTop: 6, lineHeight: 26, letterSpacing: -0.3 },
  excerpt: { color: COLORS.textSecondary, marginTop: 6, fontSize: 13, lineHeight: 20 },
  author: { color: COLORS.textMuted, fontSize: 12, marginTop: 8, fontStyle: "italic" },
  heroImg: { width: "100%", height: 280 },
  closeBtn: { position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  articleTitle: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.textPrimary, marginTop: 8, letterSpacing: -0.5, lineHeight: 34 },
  body: { color: COLORS.textPrimary, fontSize: 15, marginTop: SPACING.md, lineHeight: 24 },
});
