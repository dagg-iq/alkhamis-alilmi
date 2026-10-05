import { DEFAULT_RULES, parseRules, type GradingRules } from '@saey/shared';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

let cache: Record<string, unknown> | null = null;

export async function loadSettings(force = false): Promise<Record<string, unknown>> {
  if (cache && !force) return cache;
  const { data } = await supabase.from('app_settings').select('key, value');
  const next: Record<string, unknown> = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  cache = next;
  return next;
}

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, unknown>>(cache ?? {});
  useEffect(() => {
    loadSettings(true).then(setSettings).catch(() => {});
  }, []);
  return settings;
}

export function useGradingRules(): GradingRules {
  const s = useSettings();
  return s.grading ? parseRules(s.grading) : DEFAULT_RULES;
}
