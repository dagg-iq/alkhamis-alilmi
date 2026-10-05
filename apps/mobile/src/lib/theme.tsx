import AsyncStorage from '@react-native-async-storage/async-storage';
import { palette, verdictColors, type ThemeColors, type VerdictPalette } from '@saey/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';

export const fonts = {
  regular: 'Sans',
  medium: 'SansMedium',
  bold: 'SansBold',
  black: 'SansBlack',
  display: 'DisplayBlack',
  displayBold: 'DisplayBold',
  serif: 'SerifText',
  serifBold: 'SerifTextBold',
} as const;

export const fontAssets = {
  Sans: require('../../assets/fonts/thmanyahsans-Regular.otf'),
  SansMedium: require('../../assets/fonts/thmanyahsans-Medium.otf'),
  SansBold: require('../../assets/fonts/thmanyahsans-Bold.otf'),
  SansBlack: require('../../assets/fonts/thmanyahsans-Black.otf'),
  DisplayBlack: require('../../assets/fonts/thmanyahserifdisplay-Black.otf'),
  DisplayBold: require('../../assets/fonts/thmanyahserifdisplay-Bold.otf'),
  SerifText: require('../../assets/fonts/thmanyahseriftext-Regular.otf'),
  SerifTextBold: require('../../assets/fonts/thmanyahseriftext-Bold.otf'),
};

interface ThemeValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  dark: boolean;
  c: ThemeColors;
  verdict: VerdictPalette;
}

const Ctx = createContext<ThemeValue | null>(null);
const KEY = 'saey.theme';

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
    }).catch(() => {});
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const dark = mode === 'dark' || (mode === 'system' && system === 'dark');
    return {
      mode,
      setMode: (m) => {
        setModeState(m);
        AsyncStorage.setItem(KEY, m).catch(() => {});
      },
      dark,
      c: dark ? palette.dark : palette.light,
      verdict: dark ? verdictColors.dark : verdictColors.light,
    };
  }, [mode, system]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside provider');
  return v;
}
