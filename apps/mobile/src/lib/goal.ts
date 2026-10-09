import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Goal } from '@saey/shared';
import { useEffect, useState } from 'react';
import { onPrefApplied, savePref } from './prefs';

/**
 * هدف الطالب (النجاح / إعفاء المواد / الإعفاء العام) — محفوظ على حسابه (وعلى الهاتف للسرعة).
 * undefined = لم يُقرأ بعد، null = لم يختر بعد.
 */
const KEY = 'saey.goal';
let current: Goal | null | undefined;
const listeners = new Set<(g: Goal | null) => void>();

export async function loadGoal(): Promise<Goal | null> {
  if (current !== undefined) return current;
  try {
    const v = await AsyncStorage.getItem(KEY);
    current = v === 'pass' || v === 'individual' || v === 'general' ? v : null;
  } catch {
    current = null;
  }
  return current;
}

export function setGoal(g: Goal) {
  current = g;
  AsyncStorage.setItem(KEY, g).catch(() => {});
  savePref('goal', g);
  listeners.forEach((l) => l(g));
}

// الهدف القادم من الحساب (عند الدخول) أو المُمسح (عند الخروج)
onPrefApplied((k, v) => {
  if (k !== 'goal') return;
  current = v === 'pass' || v === 'individual' || v === 'general' ? v : null;
  listeners.forEach((l) => l(current as Goal | null));
});

export function useGoal(): Goal | null | undefined {
  const [g, setG] = useState<Goal | null | undefined>(current);
  useEffect(() => {
    listeners.add(setG);
    loadGoal().then(setG);
    return () => {
      listeners.delete(setG);
    };
  }, []);
  return g;
}

/** للاستماع لتغيّر الهدف خارج المكونات (الويدجتات تعيد الحساب) */
export function onGoalChange(cb: (g: Goal | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
