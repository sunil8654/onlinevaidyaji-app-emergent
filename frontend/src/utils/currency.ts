/**
 * Indian Rupee formatting.
 *
 * The symbol is written as an explicit \u20B9 escape rather than a literal "₹"
 * so the glyph can never be corrupted by a file re-encode or a copy/paste
 * through a non-UTF8 editor.
 */
export const RUPEE = "\u20B9";

/** `formatINR(1500)` -> `"₹1,500"` · `formatINR(1500.5)` -> `"₹1,500.50"` */
export function formatINR(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
    return "";
  }
  // en-IN gives the 1,23,456 lakh/crore grouping Indians actually read.
  const hasPaise = !Number.isInteger(n) && Math.abs(n) < 100000;
  const body = n.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${RUPEE}${body}`;
}

/** Same as `formatINR` but never returns "" — for prices that must be shown. */
export function formatINROrFree(value: unknown): string {
  return formatINR(value) || "Free";
}

/** Compact form for dense cards: `₹1.5k`, `₹1.2L`. */
export function formatINRCompact(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
    return "";
  }
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${RUPEE}${(n / 10000000).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (abs >= 100000) return `${RUPEE}${(n / 100000).toFixed(1).replace(/\.0$/, "")}L`;
  if (abs >= 1000) return `${RUPEE}${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return formatINR(n);
}
