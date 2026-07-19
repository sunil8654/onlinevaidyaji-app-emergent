import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { Feather } from "@expo/vector-icons";

const CATS = ["all", "immunity", "stress", "digestive", "skin", "joint", "sleep"];

export default function Shop() {
  const router = useRouter();
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [ok, setOk] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.listMedicines(cat)); } catch {}
  }, [cat]);
  useEffect(() => { load(); }, [load]);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
  const remove = (id: string) => setCart((c) => {
    const n = { ...c };
    if ((n[id] || 0) <= 1) delete n[id]; else n[id] -= 1;
    return n;
  });
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = items.reduce((s, m) => s + (cart[m.id] || 0) * m.price, 0);

  const checkout = async () => {
    const orderItems = Object.entries(cart).map(([medicine_id, qty]) => ({ medicine_id, qty }));
    try {
      await api.orderMedicines(orderItems);
      setCart({});
      setOk(true);
      setTimeout(() => { setOk(false); setCartOpen(false); }, 1500);
    } catch {}
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="shop-back" style={{ width: 40 }}>
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>AYUSH Shop</Text>
          <Text style={styles.title}>Herbal store</Text>
        </View>
        <TouchableOpacity style={styles.cartBtn} onPress={() => setCartOpen(true)} testID="shop-cart-open">
          <Feather name="shopping-bag" size={18} color={COLORS.surface} />
          {cartCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView horizontal style={styles.chipsWrap} contentContainerStyle={styles.chipsRow} showsHorizontalScrollIndicator={false}>
        {CATS.map((c) => (
          <TouchableOpacity key={c} onPress={() => setCat(c)} style={[styles.chip, cat === c && styles.chipActive]} testID={`shop-chip-${c}`}>
            <Text style={[styles.chipText, cat === c && styles.chipTextActive]}>{c[0].toUpperCase() + c.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={items}
        keyExtractor={(m) => m.id}
        numColumns={2}
        columnWrapperStyle={{ gap: SPACING.md, marginBottom: SPACING.md }}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 120 }}
        renderItem={({ item }) => (
          <View style={styles.card} testID={`med-${item.id}`}>
            <Image source={{ uri: item.image_url }} style={styles.cardImg} />
            <View style={styles.cardPad}>
              <Text style={styles.medBrand}>{item.brand}</Text>
              <Text style={styles.medName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.medUnit}>{item.unit}</Text>
              <View style={styles.priceRow}>
                <Text style={styles.price}>₹{item.price}</Text>
                {cart[item.id] ? (
                  <View style={styles.qtyBox}>
                    <TouchableOpacity onPress={() => remove(item.id)} testID={`med-minus-${item.id}`}>
                      <Feather name="minus" size={14} color={COLORS.brand} />
                    </TouchableOpacity>
                    <Text style={styles.qty}>{cart[item.id]}</Text>
                    <TouchableOpacity onPress={() => add(item.id)} testID={`med-plus-${item.id}`}>
                      <Feather name="plus" size={14} color={COLORS.brand} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.addBtn} onPress={() => add(item.id)} testID={`med-add-${item.id}`}>
                    <Feather name="plus" size={14} color={COLORS.surface} />
                    <Text style={styles.addText}>Add</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}
      />

      {cartCount > 0 && !cartOpen && (
        <TouchableOpacity style={styles.checkoutBar} onPress={() => setCartOpen(true)} testID="shop-checkout-bar">
          <View>
            <Text style={styles.cbLabel}>{cartCount} item{cartCount > 1 ? "s" : ""}</Text>
            <Text style={styles.cbTotal}>₹{total}</Text>
          </View>
          <View style={styles.cbBtn}>
            <Text style={styles.cbBtnText}>View cart</Text>
            <Feather name="arrow-right" size={16} color={COLORS.surface} />
          </View>
        </TouchableOpacity>
      )}

      <Modal visible={cartOpen} animationType="slide" transparent onRequestClose={() => setCartOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Your bag</Text>
            {cartCount === 0 ? (
              <Text style={{ color: COLORS.textSecondary, marginTop: 20, textAlign: "center" }}>Bag is empty.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 300 }}>
                {items.filter((m) => cart[m.id]).map((m) => (
                  <View key={m.id} style={styles.cartRow}>
                    <Image source={{ uri: m.image_url }} style={styles.cartImg} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartName}>{m.name}</Text>
                      <Text style={styles.cartMeta}>{m.brand} · {m.unit}</Text>
                    </View>
                    <View style={styles.qtyBoxLg}>
                      <TouchableOpacity onPress={() => remove(m.id)}><Feather name="minus" size={14} color={COLORS.brand} /></TouchableOpacity>
                      <Text style={styles.qty}>{cart[m.id]}</Text>
                      <TouchableOpacity onPress={() => add(m.id)}><Feather name="plus" size={14} color={COLORS.brand} /></TouchableOpacity>
                    </View>
                    <Text style={styles.cartPrice}>₹{cart[m.id] * m.price}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalVal}>₹{total}</Text>
            </View>
            {ok ? (
              <View style={styles.okBox}>
                <Feather name="check-circle" size={16} color={COLORS.success} />
                <Text style={{ color: COLORS.success, fontWeight: "700" }}>Order placed! (demo)</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8, marginTop: SPACING.md }}>
                <TouchableOpacity style={styles.cancel} onPress={() => setCartOpen(false)} testID="cart-close">
                  <Text style={{ color: COLORS.textPrimary, fontWeight: "700" }}>Continue shopping</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pay} onPress={checkout} disabled={cartCount === 0} testID="cart-checkout">
                  <Text style={{ color: COLORS.surface, fontWeight: "700" }}>Place order ₹{total}</Text>
                </TouchableOpacity>
              </View>
            )}
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
  cartBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  cartBadge: { position: "absolute", top: -4, right: -4, backgroundColor: COLORS.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  cartBadgeText: { color: COLORS.surface, fontSize: 10, fontWeight: "700" },
  chipsWrap: { maxHeight: 56 },
  chipsRow: { paddingHorizontal: SPACING.lg, gap: 8, alignItems: "center", height: 56 },
  chip: { flexShrink: 0, height: 36, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  card: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  cardImg: { width: "100%", height: 110 },
  cardPad: { padding: 12 },
  medBrand: { color: COLORS.accent, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  medName: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.textPrimary, marginTop: 2, lineHeight: 18 },
  medUnit: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  price: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.brand },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  addText: { color: COLORS.surface, fontSize: 11, fontWeight: "700" },
  qtyBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 8, paddingVertical: 5, borderRadius: RADIUS.pill },
  qtyBoxLg: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, marginRight: 8 },
  qty: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 13, minWidth: 14, textAlign: "center" },
  checkoutBar: { position: "absolute", left: 16, right: 16, bottom: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: COLORS.brand, padding: 12, paddingLeft: 16, borderRadius: RADIUS.lg },
  cbLabel: { color: COLORS.accentSoft, fontSize: 11, letterSpacing: 1 },
  cbTotal: { color: COLORS.surface, fontFamily: FONTS.heading, fontSize: 20 },
  cbBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill },
  cbBtnText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.bg, padding: SPACING.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  grabber: { width: 42, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: "center", marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.textPrimary },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cartImg: { width: 44, height: 44, borderRadius: 8 },
  cartName: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.textPrimary },
  cartMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  cartPrice: { fontWeight: "700", color: COLORS.brand, fontSize: 14 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  totalLabel: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  totalVal: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.brand },
  okBox: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 14, backgroundColor: "#E8F5E9", borderRadius: RADIUS.pill, marginTop: SPACING.md, marginBottom: SPACING.md },
  cancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  pay: { flex: 1.4, paddingVertical: 14, alignItems: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.brand, marginBottom: SPACING.md },
});
