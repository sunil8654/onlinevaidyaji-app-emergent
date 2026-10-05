// Online VaidyaJi — Fresh & Warm AYUSH theme tokens (Light Yellow / White with Green + Amber).

export const COLORS = {
  bg: "#FFFDF3",           // Cream white — main background
  surface: "#FFFFFF",       // Cards
  surfaceAlt: "#FFF6D9",   // Light yellow — soft chips / secondary cards
  border: "#EFE8C8",       // Soft tan border
  textPrimary: "#1A2421",
  textSecondary: "#5C6B64",
  textMuted: "#8A968F",
  brand: "#0F5C2A",        // Fresh green — primary
  brandDark: "#08401B",
  accent: "#E07B00",       // Amber orange — CTA / highlights
  accentSoft: "#FFE082",   // Light amber — soft badges
  success: "#2E7D32",
  warning: "#F57C00",
  error: "#D32F2F",
  overlay: "rgba(15,92,42,0.75)",
} as const;

export const FONTS = {
  // System serif for headings (Cormorant-like feel without extra font install)
  heading: "serif",
  body: "System",
  mono: "monospace",
  /**
   * Money must NEVER use the serif family.
   *
   * The rupee sign is U+20B9, added to Unicode in 2010. Several platform serif
   * faces (Noto Serif / Droid Serif on older Android, some OEM skins) predate
   * it, so a `₹` drawn in `FONTS.heading` falls back to a `.notdef` box or a
   * literal "?" - which is exactly what customers saw on fees and totals while
   * the API was returning a perfectly valid U+20B9.
   *
   * Route every currency string through the system face plus
   * `src/utils/currency.ts` (`formatINR`) and this cannot regress.
   */
  money: "System",
} as const;


export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const SPECIALTIES = [
  "All",
  "Ayurveda",
  "Homoeopathy",
  "Yoga",
  "Unani",
  "Siddha",
] as const;
