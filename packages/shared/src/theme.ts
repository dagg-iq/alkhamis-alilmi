/** ألوان هوية «سعي» — المصدر: system/05-brand.md */
export const palette = {
  light: {
    bg: '#F5F5F2',
    card: '#FFFFFF',
    ink: '#111111',
    ink2: '#5C5C5C',
    ink3: '#8A8A85',
    line: '#E2E2DC',
    accent: '#2346F5',
    accentInk: '#FFFFFF',
    soft: '#EEF1FF',
    softInk: '#1A1F3D',
    heroBg: '#111111',
    heroInk: '#FFFFFF',
    heroInk2: '#B4B4B4',
    track: '#333333',
    bubbleMine: '#2346F5',
    bubbleMineInk: '#FFFFFF',
    bubbleOther: '#FFFFFF',
    highlight: '#FFE58A', // قلم التحديد في إجابات المساعد
  },
  dark: {
    bg: '#0E0E0F',
    card: '#18181A',
    ink: '#F2F2F0',
    ink2: '#9E9E9E',
    ink3: '#6E6E6E',
    line: '#2A2A2D',
    accent: '#7B92FF',
    accentInk: '#0E0E0F',
    soft: '#1F2340',
    softInk: '#D3DAFF',
    heroBg: '#2346F5',
    heroInk: '#FFFFFF',
    heroInk2: '#D3DAFF',
    track: '#4A65FF',
    bubbleMine: '#2346F5',
    bubbleMineInk: '#FFFFFF',
    bubbleOther: '#18181A',
    highlight: '#5E4B00',
  },
} as const;

export type ThemeColors = { [K in keyof typeof palette.light]: string };

/** ألوان الدرجات فقط */
export const verdictColors = {
  light: {
    exempt: { bg: '#E5F3EC', ink: '#0B6B4B' },
    near: { bg: '#FBEFDF', ink: '#8A4700' },
    safe: { bg: '#EFEFEA', ink: '#3A3A3A' },
    risk: { bg: '#FBE6E4', ink: '#A82620' },
    empty: { bg: '#EFEFEA', ink: '#8A8A85' },
  },
  dark: {
    exempt: { bg: '#123327', ink: '#6FD3A8' },
    near: { bg: '#3A2A12', ink: '#F2B66B' },
    safe: { bg: '#232326', ink: '#C8C8C8' },
    risk: { bg: '#3A1715', ink: '#F59A93' },
    empty: { bg: '#232326', ink: '#8A8A8A' },
  },
} as const;

export type VerdictPalette = Record<'exempt' | 'near' | 'safe' | 'risk' | 'empty', { bg: string; ink: string }>;

export const radius = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
