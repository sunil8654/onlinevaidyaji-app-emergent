// Patient <-> doctor consultation chat — realtime over Socket.IO, the same
// protocol the website uses. Falls back to REST if the socket isn't connected.
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
import { useSocket } from "@/src/socket";

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ConsultationChat() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    roomId?: string;
    appt_id?: string;
    partner_name?: string;
  }>();
  const { socket } = useSocket();

  const [roomId, setRoomId] = useState<string>(params.roomId ? String(params.roomId) : "");
  const [partnerName] = useState<string>(
    params.partner_name ? String(params.partner_name) : "Consultation"
  );
  const [messages, setMessages] = useState<any[]>([]);
  const [meId, setMeId] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [attachment, setAttachment] = useState<string>("");
  const typingTimer = useRef<any>(null);
  const listRef = useRef<FlatList>(null);

  // Resolve a room id when opened from an appointment ("Chat" button).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!roomId && params.appt_id) {
          const room = await api.consultationRoomForAppointment(String(params.appt_id));
          if (alive && room?.room_id) setRoomId(String(room.room_id));
        }
      } catch (e: any) {
        if (alive) Alert.alert("Chat unavailable", e?.message || "Please try again later.");
      }
    })();
    return () => { alive = false; };
  }, [roomId, params.appt_id]);

  useEffect(() => {
    api.me().then((me: any) => setMeId(String(me?.id ?? ""))).catch(() => {});
  }, []);

  const scrollDown = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, []);

  const load = useCallback(async () => {
    if (!roomId) return;
    try {
      const items = await api.consultationMessages(roomId);
      setMessages(items || []);
      api.markConsultationRead(roomId).catch(() => {});
    } catch (e: any) {
      Alert.alert("Could not load messages", e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
    scrollDown();
  }, [roomId, scrollDown]);

  useEffect(() => { load(); }, [load]);

  // Realtime wiring
  useEffect(() => {
    if (!socket || !roomId) return;
    socket.emit("chat:join", { roomId });

    const onMessage = (msg: any) => {
      setMessages((prev) => {
        const filtered = prev.filter(
          (m) => !m.__sending || String(m.content) !== String(msg.content) || String(m.sender_id) !== String(msg.sender_id)
        );
        return [...filtered, msg];
      });
      scrollDown();
      if (String(msg.sender_id) !== String(meId)) {
        api.markConsultationRead(roomId).catch(() => {});
        socket.emit("chat:markRead", { roomId });
      }
    };
    const onTyping = (d: any) => {
      if (String(d?.userId) !== String(meId)) setPartnerTyping(!!d?.isTyping);
    };
    const onRead = () => {
      setMessages((prev) => prev.map((m) => (m.__sending ? m : { ...m, is_read: true })));
    };

    socket.on("chat:message", onMessage);
    socket.on("chat:typing", onTyping);
    socket.on("chat:read", onRead);
    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:typing", onTyping);
      socket.off("chat:read", onRead);
    };
  }, [socket, roomId, meId, scrollDown]);

  const onType = () => {
    if (!socket || !roomId) return;
    socket.emit("chat:typing", { roomId, isTyping: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit("chat:typing", { roomId, isTyping: false });
    }, 1500);
  };

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
        base64: true,
        quality: 0.6,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      const dataUri = `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
      if (dataUri.length > 3_500_000) {
        Alert.alert("Image too large", "Please pick a smaller photo.");
        return;
      }
      setAttachment(dataUri);
    } catch (e: any) {
      Alert.alert("Could not attach", e?.message || "Try again");
    }
  }

  async function send() {
    if ((!text.trim() && !attachment) || !roomId || busy) return;
    const content = text.trim();
    const fileUrl = attachment;
    const isImage = !!fileUrl;
    setBusy(true);
    setText("");
    setAttachment("");

    const tempId = `tmp-${Date.now()}`;
    const temp = {
      id: tempId,
      room_id: roomId,
      sender_id: meId,
      content,
      message_type: isImage ? "image" : "text",
      file_url: fileUrl || null,
      created_at: new Date().toISOString(),
      is_read: false,
      __sending: true,
    };
    setMessages((prev) => [...prev, temp]);
    scrollDown();

    const payload = {
      roomId,
      content: content || (isImage ? "📷 Photo" : ""),
      messageType: isImage ? "image" : "text",
      fileUrl: fileUrl || undefined,
    };

    const done = (ok: boolean, msg?: any) => {
      setBusy(false);
      setMessages((prev) => {
        if (!ok) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? { ...(msg || temp), id: msg?.id ?? tempId, __sending: false } : m));
      });
      if (!ok) {
        setText(content);
        setAttachment(fileUrl);
        Alert.alert("Failed to send", "Please try again.");
      }
    };

    if (socket) {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; restSend(); }
      }, 6000);
      socket.emit("chat:message", payload, (res: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (res?.success) done(true, res.message);
        else restSend();
      });
      const restSend = () => {
        api
          .sendConsultationMessage(roomId, {
            content: payload.content,
            message_type: payload.messageType,
            file_url: fileUrl || undefined,
          })
          .then(() => done(true))
          .catch(() => done(false));
      };
    } else {
      api
        .sendConsultationMessage(roomId, {
          content: payload.content,
          message_type: payload.messageType,
          file_url: fileUrl || undefined,
        })
        .then(() => done(true))
        .catch(() => done(false));
    }
  }

  const openVideo = () => {
    router.push({
      pathname: "/video-call",
      params: { room_id: roomId, doctor_name: partnerName },
    });
  };

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
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="consult-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.sm }}>
          <Text style={styles.title} numberOfLines={1}>{partnerName}</Text>
          <Text style={styles.subtitle}>{partnerTyping ? "typing..." : "Online"}</Text>
        </View>
        <TouchableOpacity onPress={openVideo} style={styles.videoBtn} testID="consult-video">
          <Feather name="video" size={18} color={COLORS.surface} />
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
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = String(item.sender_id) === String(meId);
            return (
              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                  {item.message_type === "image" && item.file_url ? (
                    <Image source={{ uri: item.file_url }} style={styles.msgImg} />
                  ) : null}
                  {item.content ? (
                    <Text style={[styles.msgText, mine ? { color: COLORS.surface } : { color: COLORS.textPrimary }]}>
                      {item.content}
                    </Text>
                  ) : null}
                  <Text style={[styles.msgTime, mine ? { color: "rgba(255,255,255,0.7)" } : { color: COLORS.textMuted }]}>
                    {fmtTime(item.created_at)}
                    {mine && !item.__sending ? (item.is_read ? "  ✓✓" : "  ✓") : ""}
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
          <TouchableOpacity onPress={pickImage} style={styles.iconBtn} testID="consult-attach">
            <Feather name="image" size={20} color={COLORS.brand} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(v) => { setText(v); onType(); }}
            placeholder="Type a message"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={4000}
            testID="consult-input"
          />
          <TouchableOpacity
            onPress={send}
            disabled={busy || (!text.trim() && !attachment)}
            style={[styles.sendBtn, (busy || (!text.trim() && !attachment)) && { opacity: 0.4 }]}
            testID="consult-send"
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
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  title: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.textPrimary },
  subtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  videoBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center",
  },
  bubbleRow: { flexDirection: "row", marginVertical: 4 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowOther: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
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
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center",
  },
  attachPreview: { paddingHorizontal: SPACING.md, paddingTop: 6, position: "relative" },
  attachThumb: { width: 80, height: 80, borderRadius: RADIUS.md },
  attachRemove: {
    position: "absolute", top: 10, left: 74,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center",
  },
});
