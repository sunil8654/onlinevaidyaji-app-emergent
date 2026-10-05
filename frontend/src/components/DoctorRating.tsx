import { View, Text, StyleSheet } from "react-native";
import Feather from "@react-native-vector-icons/feather";

import { COLORS, FONTS } from "../theme";

/**
 * A doctor's rating, shown only when it is real.
 *
 * There is no default/fallback score anywhere in this app: a doctor with no
 * reviews yet must read "No ratings" rather than an invented 4.6, which is
 * indistinguishable from a genuine score to the patient.
 *
 * `rating` counts as real only when it is a finite number > 0. `reviewCount`,
 * when supplied and 0, also suppresses the score - a stored average with no
 * underlying reviews is still a fabricated number.
 */
export function realRating(
  rating: unknown,
  reviewCount?: unknown
): number | null {
  const n = typeof rating === "number" ? rating : Number(rating);
  if (rating === null || rating === undefined || rating === "" || !Number.isFinite(n)) {
    return null;
  }
  if (n <= 0) return null;
  if (typeof reviewCount === "number" && reviewCount <= 0) return null;
  return n;
}

type Props = {
  rating: unknown;
  reviewCount?: unknown;
  /** Chip (default) for cards, plain text for dense rows. */
  variant?: "chip" | "text";
  size?: number;
  color?: string;
  label?: string;
};

export default function DoctorRating({
  rating,
  reviewCount,
  variant = "chip",
  size = 11,
  color = COLORS.accent,
  label,
}: Props) {
  const score = realRating(rating, reviewCount);

  if (variant === "text") {
    return (
      <Text style={[styles.text, { color, fontSize: size }]}>
        {score === null ? label ?? "No ratings yet" : `${score.toFixed(1)}/5`}
      </Text>
    );
  }

  return (
    <View style={styles.chip}>
      <Feather
        name={score === null ? "minus-circle" : "star"}
        size={size}
        color={score === null ? COLORS.textMuted : color}
      />
      <Text
        style={[styles.chipText, { color: score === null ? COLORS.textMuted : color }]}
      >
        {score === null ? "No ratings" : score.toFixed(1)}
        {score !== null && typeof reviewCount === "number" && reviewCount > 0
          ? ` (${reviewCount})`
          : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  text: {
    fontFamily: FONTS.money,
    fontWeight: "600",
  },
});
