// Reusable Razorpay Checkout modal that works in Expo Go via WebView.
// Loads Razorpay Standard Checkout inside a WebView (hosted from our backend)
// and reports success/failure/dismiss events back to the parent.
import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export type PayPurpose = "appointment" | "diet_plan" | "medicine_order" | "lab_booking" | "custom";

export interface RazorpayCheckoutProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: (payment: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  onFailure?: (reason: string) => void;
  amount: number; // in rupees (₹)
  purpose: PayPurpose;
  reference_id?: string;
  description: string;
  title?: string;
  prefill?: { name?: string; email?: string; contact?: string };
}

export function RazorpayCheckout({
  visible,
  onClose,
  onSuccess,
  onFailure,
  amount,
  purpose,
  reference_id,
  description,
  title = "Online Vaidhyaji",
  prefill,
}: RazorpayCheckoutProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!visible) {
      setEmbedUrl(null);
      setError(null);
      setLoading(true);
      setVerifying(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const amountPaise = Math.round(amount * 100);
        if (amountPaise < 100) throw new Error("Amount must be at least ₹1");
        const order = await api.createPaymentOrder({
          amount: amountPaise,
          purpose,
          reference_id,
          description,
        });
        if (!alive) return;
        const qp = new URLSearchParams({
          amount: String(order.amount),
          name: title,
          description,
          prefill_name: prefill?.name || "",
          prefill_email: prefill?.email || "",
          prefill_contact: prefill?.contact || "",
        });
        setEmbedUrl(`${BASE}/api/payments/checkout/${order.order_id}?${qp.toString()}`);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to start checkout");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  const handleMessage = async (evt: any) => {
    try {
      const msg = JSON.parse(evt.nativeEvent.data);
      if (msg?.type === "success") {
        setVerifying(true);
        try {
          const res = await api.verifyPayment({
            razorpay_order_id: msg.razorpay_order_id,
            razorpay_payment_id: msg.razorpay_payment_id,
            razorpay_signature: msg.razorpay_signature,
            purpose,
            reference_id,
          });
          setVerifying(false);
          onSuccess?.({
            razorpay_payment_id: msg.razorpay_payment_id,
            razorpay_order_id: msg.razorpay_order_id,
            razorpay_signature: msg.razorpay_signature,
          });
          onClose();
        } catch (e: any) {
          setVerifying(false);
          Alert.alert("Verification failed", e?.message || "Please contact support with your payment ID.");
          onFailure?.(e?.message || "verification_failed");
        }
      } else if (msg?.type === "failed") {
        onFailure?.(msg.description || "payment_failed");
      } else if (msg?.type === "dismiss") {
        // Do nothing – user can retry inside the sheet or close manually
      } else if (msg?.type === "error") {
        setError(msg.message || "Payment error");
      }
    } catch {
      // Ignore malformed messages
    }
  };

  const confirmClose = () => {
    if (verifying) return;
    Alert.alert(
      "Cancel payment?",
      "Your order will be cancelled. You can try again later.",
      [
        { text: "Keep paying", style: "cancel" },
        { text: "Yes, cancel", style: "destructive", onPress: onClose },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={confirmClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.head}>
          <TouchableOpacity onPress={confirmClose} style={styles.closeBtn} testID="rzp-close">
            <Feather name="x" size={22} color={COLORS.surface} />
          </TouchableOpacity>
          <View>
            <Text style={styles.eyebrow}>Secure Checkout</Text>
            <Text style={styles.title}>₹{amount.toFixed(0)}</Text>
          </View>
          <View style={styles.rzpBadge}>
            <Text style={styles.rzpBadgeText}>Razorpay</Text>
          </View>
        </View>

        {loading && (
          <View style={styles.state}>
            <ActivityIndicator color={COLORS.accent} size="large" />
            <Text style={styles.stateText}>Preparing your order…</Text>
          </View>
        )}
        {!loading && error && (
          <View style={styles.state}>
            <Feather name="alert-circle" size={40} color={COLORS.error} />
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={onClose}>
              <Text style={styles.retryText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loading && !error && embedUrl && (
          <WebView
            source={{ uri: embedUrl }}
            style={{ flex: 1, backgroundColor: COLORS.brand }}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={["*"]}
            onMessage={handleMessage}
            mixedContentMode="always"
          />
        )}
        {verifying && (
          <View style={styles.verifying}>
            <ActivityIndicator color={COLORS.accent} />
            <Text style={styles.stateText}>Verifying payment with server…</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.brand },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: SPACING.md,
    backgroundColor: COLORS.brandDark,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: COLORS.accentSoft, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.surface, marginTop: 2 },
  rzpBadge: { backgroundColor: "rgba(255,255,255,0.1)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  rzpBadgeText: { color: COLORS.surface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.md, padding: SPACING.lg },
  stateText: { color: COLORS.surface, textAlign: "center", fontSize: 14 },
  retryBtn: {
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
  },
  retryText: { color: COLORS.surface, fontWeight: "700" },
  verifying: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: SPACING.md,
    backgroundColor: COLORS.brandDark,
  },
});
