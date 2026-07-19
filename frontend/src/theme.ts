// Online Vaidhyaji — Organic & Earthy AYUSH theme tokens.

export const COLORS = {
  bg: "#F7F5F0",
  surface: "#FFFFFF",
  surfaceAlt: "#EBF0EC",
  border: "#E2DDD3",
  textPrimary: "#1A2421",
  textSecondary: "#5C6B64",
  textMuted: "#8A968F",
  brand: "#0F4C36", // Deep Forest Green
  brandDark: "#093626",
  accent: "#D9663D", // Terracotta
  accentSoft: "#F3D9CD",
  success: "#2E7D32",
  warning: "#F57C00",
  error: "#D32F2F",
  overlay: "rgba(15,76,54,0.75)",
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
