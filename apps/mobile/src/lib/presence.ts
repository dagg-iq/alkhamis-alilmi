import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * متصل الآن / آخر ظهور: نبضة كل ٤٥ ثانية والتطبيق مفتوح (جدول user_presence خارج Realtime)،
 * وعند الخروج للخلفية «غير متصل». الخادم يعدّ المستخدم متصلاً إن جاءت نبضته خلال ٧٥ ثانية.
 */
export function startPresence(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const beat = (online: boolean) => { supabase.rpc('touch_presence', { p_online: online }).then(() => {}, () => {}); };
  const start = () => {
    beat(true);
    if (timer) clearInterval(timer);
    timer = setInterval(() => beat(true), 45000);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    beat(false);
  };
  if (Platform.OS === 'web' || AppState.currentState === 'active') start();
  const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
  return () => {
    sub.remove();
    stop();
  };
}

export interface PresenceInfo { online: boolean; last_seen_at: string | null }

/** حالة الظهور لمجموعة أشخاص، تتحدث كل ٣٠ ثانية (من أخفى ظهوره لا يُرجعه الخادم) */
export function usePresence(userIds: string[]): Record<string, PresenceInfo> {
  const [map, setMap] = useState<Record<string, PresenceInfo>>({});
  const key = [...userIds].sort().join(',');
  const ids = useRef(userIds);
  ids.current = userIds;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('presence_of', { p_users: ids.current.slice(0, 300) });
      if (!alive || error) return;
      const next: Record<string, PresenceInfo> = {};
      for (const r of (data ?? []) as ({ user_id: string } & PresenceInfo)[]) next[r.user_id] = { online: r.online, last_seen_at: r.last_seen_at };
      setMap(next);
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [key]);
  return map;
}
