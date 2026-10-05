import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING } from "@/src/theme";
import Feather from "@react-native-vector-icons/feather";
import { useAuth, type AuthUser } from "@/src/auth";
import { api } from "@/src/api";

/** The server issues a 6-digit code (`f"{secrets.randbelow(1_000_000):06d}"`). */
const CELLS = 6;
const RESEND_SECONDS = 30;

/**
 * Same rule the backend enforces in `_clean_indian_phone`: strip formatting,
 * drop a leading 91, then require 10 digits starting 6-9. Mirrored here so the
 * patient gets an instant answer instead of a round-trip 400.
 */
function normalisePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  return d.length === 10 && "6789".includes(d[0]) ? d : null;
}

/**
 * Real mobile-OTP sign-in.
 *
 * The previous version accepted any 4 digits after a 500 ms sleep and pushed a
 * "logged in" user with no token and no server session - it was a fake login
 * screen. This one talks to POST /auth/phone/send-otp and
 * POST /auth/phone/verify-otp and persists the returned JWT, so the account is
 * real and survives an app restart.
 */
export default function Otp() {
  const router = useRouter();
  const { phone, name: initialName } = useLocalSearchParams<{
    phone?: string;
    name?: string;
  }>();
  const { applySession } = useAuth();

  const [digits, setDigits] = useState<string[]>(Array(CELLS).fill(""));
  const [name, setName] = useState(initialName ?? "");
  const [needName, setNeedName] = useState(!initialName);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const refs = useRef<(TextInput | null)[]>([]);

  /**
   * Sign-in arrives here with no `phone` param, so the screen first collects
   * the number. Signup arrives with one, and there the code has already been
   * sent - hence `sent` starts true only in that case.
   */
  const [enteredPhone, setEnteredPhone] = useState(phone ?? "");
  const [sent, setSent] = useState(!!phone);
  const activePhone = normalisePhone(phone || enteredPhone) ?? "";

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  /** Ask the backend to (re)send. Only dev builds ever get a `dev_hint` back. */
  const send = useCallback(
    async (isResend = false) => {
      const clean = normalisePhone(phone || enteredPhone);
      if (!clean) {
        setErr("Enter a valid 10-digit Indian mobile number.");
        return;
      }
      setSending(true);
      setErr("");
      try {
        const res = await api.sendPhoneOtp(clean);
        // Tell the user where to look for the code: the backend prefers WhatsApp
        // and only falls back to SMS when the number isn't reachable there.
        const via =
          res.channel === "whatsapp"
            ? "OTP sent on WhatsApp."
            : res.channel === "sms"
              ? "OTP sent as an SMS."
              : res.message || "OTP sent.";
        setNotice(via);
        if (res.dev_hint) {
          // Non-production + mock provider only. Labelled so it can never be
          // mistaken for a real SMS in a screenshot.
          setNotice(`${res.dev_hint}`);
        }
        setSent(true);
        setEnteredPhone(clean);
        if (isResend) setDigits(Array(CELLS).fill(""));
      } catch (e: any) {
        setErr(e?.message || "Could not send the OTP. Please try again.");
      } finally {
        setSending(false);
        setSeconds(RESEND_SECONDS);
      }
    },
    [phone, enteredPhone]
  );

  const onChange = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    // Pasting the whole code into any cell should just fill it in.
    if (clean.length > 1) {
      const next = Array(CELLS).fill("");
      clean.slice(0, CELLS).split("").forEach((c, k) => (next[k] = c));
      setDigits(next);
      refs.current[Math.min(clean.length, CELLS - 1)]?.focus();
      return;
    }
    setDigits((prev) => {
      const next = [...prev];
      next[i] = clean;
      return next;
    });
    if (clean && i < CELLS - 1) refs.current[i + 1]?.focus();
  };

  const verify = async () => {
    setErr("");
    setNotice("");
    const code = digits.join("");
    if (code.length !== CELLS) {
      setErr(`Enter the ${CELLS}-digit code from your SMS.`);
      return;
    }
    setBusy(true);
    try {
    const res = await api.verifyPhoneOtp({
      phone: activePhone,
      otp: code,
      name: name.trim() || undefined,
      role: "patient",
    });
      await applySession(res.token, res.user as AuthUser);
      if (res.user?.role === "doctor") router.replace("/(tabs)/home");
      else if (res.user?.is_admin) router.replace("/admin/dashboard");
      else if (res.is_new) router.replace("/signup/language");
      else router.replace("/(tabs)/home");
    } catch (e: any) {
      const msg = e?.message || "Verification failed.";
      setErr(msg);
      // A brand-new phone number needs a name to register with; reveal the
      // field rather than silently failing on an opaque error.
      if (/name is required/i.test(msg)) setNeedName(true);
      else setDigits(Array(CELLS).fill(""));
    } finally {
      setBusy(false);
    }
  };

  const masked = activePhone
    ? activePhone.length > 4
      ? `XXXXXX ${activePhone.slice(-4)}`
      : activePhone
    : "your number";

  const heading = sent
    ? "Verify your\nmobile number"
    : "Sign in with\nmobile number";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="otp-back"
        >
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>

        <View style={styles.body}>
          <Text style={styles.eyebrow}>One-time password</Text>
          <Text style={styles.title}>{heading}</Text>
          <Text style={styles.sub}>
            {sent
              ? `We sent a ${CELLS}-digit code by SMS to ${masked}.`
              : "Enter your mobile number and we’ll text you a " +
                CELLS +
                "-digit code. No password needed."}
          </Text>

          {notice ? (
            <View style={styles.notice} testID="otp-notice">
              <Feather
                name={notice.includes("DO NOT enable") ? "alert-triangle" : "info"}
                size={14}
                color={COLORS.accent}
              />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          {!sent ? (
            <View style={styles.phoneBlock}>
              <Text style={styles.label}>Mobile number</Text>
              <View style={styles.phoneRow}>
                <Text style={styles.prefix}>+91</Text>
                <TextInput
                  style={styles.phoneInput}
                  value={enteredPhone}
                  onChangeText={(v) => {
                    setEnteredPhone(v);
                    if (err) setErr("");
                  }}
                  placeholder="98765 43210"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  maxLength={14}
                  testID="otp-phone"
                />
              </View>
              {err ? (
                <Text style={styles.err} testID="otp-error">
                  {err}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.cta, sending && { opacity: 0.6 }]}
                onPress={() => send(false)}
                disabled={sending}
                testID="otp-send-code"
              >
                {sending ? (
                  <ActivityIndicator color={COLORS.surface} />
                ) : (
                  <>
                    <Text style={styles.ctaText}>Send code</Text>
                    <Feather name="arrow-right" size={18} color={COLORS.surface} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {sent && needName ? (
            <View style={styles.nameBlock}>
              <Text style={styles.label}>Your name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="First & last name"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
                testID="otp-name"
              />
              <Text style={styles.hint}>
                New number — we need a name to create your account.
              </Text>
            </View>
          ) : null}

          {sent ? (
            <>
              <View style={styles.cells}>
                {digits.map((d, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => {
                      refs.current[i] = r;
                    }}
                    style={[styles.cell, d && styles.cellFilled]}
                    keyboardType="number-pad"
                    maxLength={CELLS}
                    value={d}
                    onChangeText={(v) => onChange(i, v)}
                    testID={`otp-cell-${i}`}
                  />
                ))}
              </View>

              {err ? (
                <Text style={styles.err} testID="otp-error">
                  {err}
                </Text>
              ) : null}

              <TouchableOpacity
                style={[styles.cta, (busy || sending) && { opacity: 0.6 }]}
                onPress={verify}
                disabled={busy || sending}
                testID="otp-verify"
              >
                {busy ? (
                  <ActivityIndicator color={COLORS.surface} />
                ) : (
                  <>
                    <Text style={styles.ctaText}>Verify &amp; continue</Text>
                    <Feather name="arrow-right" size={18} color={COLORS.surface} />
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : null}

          {sent ? (
            <TouchableOpacity
              onPress={() => send(true)}
              disabled={seconds > 0 || sending}
              style={styles.resend}
              testID="otp-resend"
            >
              <Text
                style={{
                  color: seconds > 0 || sending ? COLORS.textMuted : COLORS.brand,
                  fontWeight: "600",
                }}
              >
                {sending
                  ? "Sending…"
                  : seconds > 0
                    ? `Resend code in ${seconds}s`
                    : "Didn’t get it? Resend code"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  back: { margin: SPACING.md, width: 40 },
  body: { flex: 1, paddingHorizontal: SPACING.lg },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 3,
    fontSize: 11,
    color: COLORS.accent,
    fontWeight: "700",
  },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 38,
    color: COLORS.textPrimary,
    marginTop: 6,
    lineHeight: 42,
    letterSpacing: -1,
  },
  sub: { color: COLORS.textSecondary, marginTop: 8, fontSize: 14, lineHeight: 20 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: SPACING.md,
    padding: 10,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noticeText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  nameBlock: { marginTop: SPACING.md },
  phoneBlock: { marginTop: SPACING.md },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  prefix: {
    fontFamily: FONTS.money,
    fontSize: 15,
    color: COLORS.textSecondary,
    paddingRight: SPACING.sm,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  phoneInput: {
    flex: 1,
    paddingVertical: 12,
    paddingLeft: SPACING.sm,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 6,
    fontWeight: "700",
  },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  hint: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  cells: {
    flexDirection: "row",
    gap: 8,
    marginTop: SPACING.lg,
    justifyContent: "center",
  },
  cell: {
    width: 48,
    height: 60,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    textAlign: "center",
    fontSize: 22,
    fontFamily: FONTS.money,
    color: COLORS.textPrimary,
  },
  cellFilled: { borderColor: COLORS.brand, backgroundColor: COLORS.surfaceAlt },
  err: { color: COLORS.error, marginTop: SPACING.md, textAlign: "center" },
  cta: {
    marginTop: SPACING.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brand,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    gap: 8,
  },
  ctaText: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
  resend: { alignSelf: "center", marginTop: SPACING.md },
});
