// Online Vaidhyaji — Fresh & Warm AYUSH theme tokens (Light Yellow / White with Green + Amber).

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
