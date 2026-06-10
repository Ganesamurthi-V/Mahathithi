// MahaAthithi Theme — Maharashtra Tourism Color Palette
export const colors = {
  // Primary palette — Saffron/Orange (Maharashtra flag)
  primary: '#FF6B35',
  primaryLight: '#FF8F5E',
  primaryDark: '#E55A2B',
  primaryBg: 'rgba(255, 107, 53, 0.1)',

  // Secondary — Deep Blue
  secondary: '#1A365D',
  secondaryLight: '#2D4A7A',

  // Accent — Gold
  accent: '#F4A940',
  accentLight: '#FFD166',

  // Backgrounds (Dark Mode)
  bgPrimary: '#0B0F1A',
  bgSecondary: '#111827',
  bgCard: '#1A2035',
  bgCardElevated: '#1F2847',
  bgInput: '#0D1320',

  // Text
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textInverse: '#0F172A',

  // Borders
  border: '#1E293B',
  borderLight: '#334155',

  // Status
  statusPending: '#64748B',
  statusInProgress: '#3B82F6',
  statusInReview: '#F59E0B',
  statusCompleted: '#10B981',

  // Semantic
  success: '#10B981',
  successBg: 'rgba(16, 185, 129, 0.1)',
  warning: '#F59E0B',
  warningBg: 'rgba(245, 158, 11, 0.1)',
  error: '#EF4444',
  errorBg: 'rgba(239, 68, 68, 0.1)',
  info: '#3B82F6',
  infoBg: 'rgba(59, 130, 246, 0.1)',

  // Surface
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(0, 0, 0, 0.6)',

  // Gradients (as arrays for LinearGradient)
  gradientPrimary: ['#FF6B35', '#F4A940'],
  gradientDark: ['#0B0F1A', '#111827'],
  gradientCard: ['#1A2035', '#1F2847'],
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  full: 100,
};

export const typography = {
  h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  button: { fontSize: 15, fontWeight: '700' as const },
  stat: { fontSize: 32, fontWeight: '800' as const },
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
};
