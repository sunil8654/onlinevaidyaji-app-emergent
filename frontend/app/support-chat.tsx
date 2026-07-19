// Support / lead-gen chat — public (works without login)
import { useEffect, useRef, useState, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { Feather } from "@expo/vector-icons";

type Msg = { id: string; role: "user" | "assistant"; text: string };

export default function SupportChat() {
  const router = useRouter();
  const { t } = useI18n();
  const session = useMemo(() => `sup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);
  const [messages, setMessages] = useState<Msg[]>([
    { id: "seed", role: "assistant", text: "Namaste! I'm Vaidhyaji Support. Ask me anything about how the app works, pricing, doctors, or leave your name & phone/email and I'll get our team to connect with you." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState(false);
  const list = useRef<FlatList>(null);

  const send = async (text?: string) => {
    const c = (text ?? input).trim();
    if (!c || busy) return;
    setInput("");
    setMessages((p) => [...p, { id: `u-${Date.now()}`, role: "user", text: c }]);
    setBusy(true);
    try {
      const res = await api.supportChat(session, c);
      setMessages((p) => [...p, { id: `a-${Date.now()}`, role: "assistant", text: res.reply }]);
      if (res.lead_captured) setLead(true);
    } catch (e: any) {
      setMessages((p) => [...p, { id: `e-${Date.now()}`, role: "assistant", text: `We're having trouble — please try again. (${e.message})` }]);
    } finally {
      setBusy(false);
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: false }), 200); }, [messages]);

  const quick = [
    "How do I book a doctor?",
    "Is the app free?",
    "Which AYUSH specialties are available?",
    "I need help — please call me",
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headBtn} testID="sc-back">
          <Feather name="arrow-left" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headMid}>
          <View style={styles.avatar}>
            <Feather name="headphones" size={16} color={COLORS.surface} />
          </View>
          <View>
            <Text style={styles.headTitle}>{t("support_chat")}</Text>
            <Text style={styles.headSub}>{lead ? "Lead captured ✓ we'll follow up" : "Typically replies instantly"}</Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <View style={[styles.rowMsg, item.role === "user" ? styles.rowUser : styles.rowAi]}>
              {item.role === "assistant" && (
                <View style={styles.avatarSm}>
                  <Feather name="headphones" size={12} color={COLORS.surface} />
                </View>
              )}
              <View style={[styles.bubble, item.role === "user" ? styles.bubbleUser : styles.bubbleAi]}>
                <Text style={[styles.bubbleText, item.role === "user" && { color: COLORS.textPrimary }]}>{item.text}</Text>
              </View>
            </View>
          )}
          ListFooterComponent={busy ? (
            <View style={[styles.rowMsg, styles.rowAi, { marginTop: 10 }]}>
              <View style={styles.avatarSm}><Feather name="headphones" size={12} color={COLORS.surface} /></View>
              <View style={[styles.bubble, styles.bubbleAi, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                <ActivityIndicator size="small" color={COLORS.brand} />
                <Text style={{ color: COLORS.textSecondary }}>Typing…</Text>
              </View>
            </View>
          ) : null}
        />

        {messages.length <= 1 && (
          <View style={styles.suggWrap}>
            {quick.map((q) => (
              <TouchableOpacity key={q} onPress={() => send(q)} style={styles.sugg} testID={`sc-sugg-${q.slice(0, 8)}`}>
                <Text style={styles.suggText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t("support_placeholder")}
            placeholderTextColor={COLORS.textMuted}
            multiline
            testID="sc-input"
          />
          <TouchableOpacity onPress={() => send()} disabled={busy || !input.trim()} style={[styles.sendBtn, (!input.trim() || busy) && { opacity: 0.5 }]} testID="sc-send">
            <Feather name="send" size={18} color={COLORS.surface} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headMid: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" },
  headTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  headSub: { color: COLORS.textSecondary, fontSize: 11 },
  rowMsg: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  rowUser: { justifyContent: "flex-end" },
  rowAi: { justifyContent: "flex-start" },
  avatarSm: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 16 },
  bubbleUser: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.brand, borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: COLORS.surfaceAlt, borderBottomLeftRadius: 4 },
  bubbleText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  suggWrap: { paddingHorizontal: SPACING.lg, paddingBottom: 6, gap: 6 },
  sugg: { padding: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md },
  suggText: { color: COLORS.textPrimary, fontSize: 13 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", padding: SPACING.md, gap: 8, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  input: { flex: 1, maxHeight: 120, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 14 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" },
});
