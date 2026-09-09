// Doctor DM — one-on-one chat with polling for new messages.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Image, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import * as ImagePicker from "expo-image-picker";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const POLL_MS = 4000;

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function ChatScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [messages, setMessages] = useState<any[]>([]);
  const [meId, setMeId] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attachment, setAttachment] = useState<string>("");
  const pollingRef = useRef<any>(null);
  const listRef = useRef<FlatList>(null);

  const loadMe = useCallback(async () => {
    try {
      const me = await api.me() as any;
      setMeId(me?.id || "");
    } catch {}
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.docComDMMessages(id);
      setMessages(res.items || []);
      await api.docComDMRead(id).catch(() => {});
    } catch {}
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    loadMe();
    load();
    pollingRef.current = setInterval(load, POLL_MS);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [loadMe, load]);

  async function pickImage() {
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      let status = perm.status;
      if (status !== "granted" && perm.canAskAgain) {
        const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
        status = r.status;
      }
      if (status !== "granted") {
        Alert.alert("Photos access needed", "We need access to your photos to attach an image.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true, quality: 0.7, allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      const dataUri = `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
      if (dataUri.length > 4_500_000) {
        Alert.alert("Image too large", "Please pick a smaller photo (< 4 MB).");
        return;
      }
      setAttachment(dataUri);
    } catch (e: any) {
      Alert.alert("Could not attach", e?.message || "Try again");
    }
  }

  async function send() {
    if (!text.trim() && !attachment) return;
    if (!id || busy) return;
    setBusy(true);
    const localText = text.trim();
    const localImg = attachment;
    setText("");
    setAttachment("");
    // optimistic
    const temp = {
      id: `tmp-${Date.now()}`,
      thread_id: id,
      sender_id: meId,
      text: localText,
      image_url: localImg,
      created_at: new Date().toISOString(),
      __sending: true,
    };
    setMessages((prev) => [...prev, temp]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    try {
      const sent = await api.docComDMSend(id, { text: localText, image_url: localImg || undefined });
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? sent : m)));
    } catch (e: any) {
      Alert.alert("Failed to send", e?.message || "Please try again");
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setText(localText);
      setAttachment(localImg);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="chat-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{name || "Chat"}</Text>
        <TouchableOpacity
          onPress={() => {
            // Report the most recent message from the other side
            const target = [...messages].reverse().find((m) => m.sender_id !== meId && !m.__sending);
            if (!target) {
              Alert.alert("Nothing to report", "There's no message from the other doctor yet.");
              return;
            }
            Alert.alert(
              "Report a message?",
              "This will flag the latest message from the other doctor for admin review.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Report", style: "destructive", onPress: async () => {
                  try {
                    await api.docComReport("dm_message", target.id, "Inappropriate message");
                    Alert.alert("Reported", "A moderator will review this conversation shortly.");
                  } catch (e: any) {
                    Alert.alert("Could not report", e?.message || "Try again");
                  }
                } },
              ],
            );
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="chat-report"
        >
          <Feather name="flag" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
        style={{ flex: 1 }}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.sender_id === meId;
            return (
              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.msgImg} />
                  ) : null}
                  {item.text ? (
                    <Text style={[styles.msgText, mine ? { color: COLORS.surface } : { color: COLORS.textPrimary }]}>{item.text}</Text>
                  ) : null}
                  <Text style={[styles.msgTime, mine ? { color: "rgba(255,255,255,0.7)" } : { color: COLORS.textMuted }]}>
                    {fmtTime(item.created_at)}
                    {item.__sending ? " · sending…" : ""}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Feather name="message-circle" size={26} color={COLORS.brand} />
              <Text style={styles.emptyText}>Say hello to start the conversation.</Text>
            </View>
          )}
        />

        {attachment ? (
          <View style={styles.attachPreview}>
            <Image source={{ uri: attachment }} style={styles.attachThumb} />
            <TouchableOpacity onPress={() => setAttachment("")} style={styles.attachRemove}>
              <Feather name="x" size={14} color={COLORS.surface} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <TouchableOpacity onPress={pickImage} style={styles.iconBtn} testID="chat-attach">
            <Feather name="image" size={20} color={COLORS.brand} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={4000}
            testID="chat-input"
          />
          <TouchableOpacity
            onPress={send}
            disabled={busy || (!text.trim() && !attachment)}
            style={[styles.sendBtn, (busy || (!text.trim() && !attachment)) && { opacity: 0.4 }]}
            testID="chat-send"
          >
            {busy ? <ActivityIndicator size="small" color={COLORS.surface} /> : <Feather name="send" size={18} color={COLORS.surface} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  title: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.textPrimary, flex: 1, textAlign: "center" },
  bubbleRow: { flexDirection: "row", marginVertical: 4 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%", paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleMine: { backgroundColor: COLORS.brand, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderBottomLeftRadius: 4 },
  msgText: { fontSize: 14, lineHeight: 19 },
  msgTime: { fontSize: 10, marginTop: 4, textAlign: "right" },
  msgImg: { width: 220, height: 220, borderRadius: 10, marginBottom: 6 },
  empty: { alignItems: "center", marginTop: SPACING.xl, padding: SPACING.lg },
  emptyText: { color: COLORS.textMuted, marginTop: 8, fontSize: 13, textAlign: "center" },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  iconBtn: { padding: 8 },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 20, paddingHorizontal: SPACING.md, paddingVertical: 10,
    color: COLORS.textPrimary, fontSize: 14,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center",
  },
  attachPreview: {
    paddingHorizontal: SPACING.md, paddingTop: 6, position: "relative",
  },
  attachThumb: { width: 80, height: 80, borderRadius: RADIUS.md },
  attachRemove: {
    position: "absolute", top: 10, left: 74,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center",
  },
});
