import { useEffect, useState, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";

type Msg = { id: string; role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "I have a mild sore throat since morning",
  "Suggest a diet for acidity",
  "What yoga helps with lower back pain?",
  "Home remedy for insomnia",
];

export default function Chatbot() {
  const router = useRouter();
  const session = useMemo(() => `ses-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "seed",
      role: "assistant",
      text:
        "Namaste! I'm your AI VaidyaJi — trained in Ayurveda, Yoga, Unani, Siddha & Homoeopathy. Share how you're feeling and I'll gently guide you with AYUSH wisdom. (Not a substitute for a real doctor.)",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList>(null);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", text: content };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    try {
      const res = await api.chat(session, content);
      const aiMsg: Msg = { id: `a-${Date.now()}`, role: "assistant", text: res.reply };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "assistant", text: `Sorry, I'm having trouble reaching my knowledge base right now. (${e.message})` },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  useEffect(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 200);
  }, [messages]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} testID="chatbot-back" style={styles.headBtn}>
          <Feather name="arrow-left" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headMid}>
          <View style={styles.avatar}>
            <Feather name="feather" size={16} color={COLORS.surface} />
          </View>
          <View>
            <Text style={styles.headTitle}>AI VaidyaJi</Text>
            <Text style={styles.headSub}>Powered by Claude · always online</Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <View style={[styles.row, item.role === "user" ? styles.rowUser : styles.rowAi]}>
              {item.role === "assistant" && (
                <View style={styles.avatarSm}>
                  <Feather name="feather" size={12} color={COLORS.surface} />
                </View>
              )}
              <View style={[styles.bubble, item.role === "user" ? styles.bubbleUser : styles.bubbleAi]}>
                <Text style={[styles.bubbleText, item.role === "user" && { color: COLORS.textPrimary }]}>{item.text}</Text>
              </View>
            </View>
          )}
          ListFooterComponent={busy ? (
            <View style={[styles.row, styles.rowAi, { marginTop: 10 }]}>
              <View style={styles.avatarSm}><Feather name="feather" size={12} color={COLORS.surface} /></View>
              <View style={[styles.bubble, styles.bubbleAi, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                <ActivityIndicator size="small" color={COLORS.brand} />
                <Text style={{ color: COLORS.textSecondary }}>VaidyaJi is thinking…</Text>
              </View>
            </View>
          ) : null}
        />

        {messages.length <= 1 && (
          <View style={styles.suggWrap}>
            <Text style={styles.suggKicker}>Try asking</Text>
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity key={s} onPress={() => send(s)} style={styles.sugg} testID={`chatbot-suggestion-${s.slice(0,10)}`}>
                <Text style={styles.suggText}>{s}</Text>
                <Feather name="corner-up-right" size={14} color={COLORS.brand} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Describe how you're feeling…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            testID="chatbot-input"
          />
          <TouchableOpacity onPress={() => send()} disabled={busy || !input.trim()} style={[styles.sendBtn, (!input.trim() || busy) && { opacity: 0.5 }]} testID="chatbot-send">
            <Feather name="send" size={18} color={COLORS.surface} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.bg },
  headBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headMid: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  headTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary },
  headSub: { color: COLORS.textSecondary, fontSize: 11 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  rowUser: { justifyContent: "flex-end" },
  rowAi: { justifyContent: "flex-start" },
  avatarSm: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 16 },
  bubbleUser: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.accent, borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: COLORS.surfaceAlt, borderBottomLeftRadius: 4 },
  bubbleText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  suggWrap: { paddingHorizontal: SPACING.lg, paddingBottom: 6, gap: 6 },
  suggKicker: { color: COLORS.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginBottom: 4 },
  sugg: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md },
  suggText: { color: COLORS.textPrimary, fontSize: 13, flex: 1, marginRight: 8 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", padding: SPACING.md, gap: 8, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  input: { flex: 1, maxHeight: 120, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 14 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
});
