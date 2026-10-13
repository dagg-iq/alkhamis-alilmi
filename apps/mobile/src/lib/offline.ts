import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { clearOfflineEntries, createCachingFetch, type KV } from './offline-fetch';

const store: KV = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (ks) => AsyncStorage.multiRemove(ks),
  keys: () => AsyncStorage.getAllKeys(),
};

// صاحب الجلسة الحالية (تضبطه شاشة الدخول): المحفوظ لكل طالب على حدة
let cacheUser: string | null = null;
export const setCacheUser = (id: string | null) => { cacheUser = id; };

let offline = false;
const listeners = new Set<() => void>();
const onlineListeners = new Set<() => void>();
const offlineListeners = new Set<() => void>();

function setState(v: boolean) {
  if (v === offline) return;
  offline = v;
  listeners.forEach((l) => l());
  (v ? offlineListeners : onlineListeners).forEach((l) => { try { l(); } catch { /* مستمع فاشل لا يوقف البقية */ } });
  if (v) startProbe(); else stopProbe();
}

// فحص عودة الإنترنت: بلا إنترنت لا يُرسل التطبيق طلبات فلا يعرف متى عاد الاتصال؛ نسأل الخادم كل بضع ثوانٍ
let probeUrl = '';
let probeKey = '';
let probe: ReturnType<typeof setInterval> | null = null;
async function ping() {
  if (!probeUrl) return;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    await fetch(`${probeUrl}/auth/v1/health`, { headers: { apikey: probeKey }, signal: ctl.signal });
    clearTimeout(t);
    setState(false);
  } catch {
    // ما زال بلا إنترنت
  }
}
function startProbe() {
  if (probe) return;
  probe = setInterval(() => { if (AppState.currentState === 'active') ping(); }, 6000);
}
function stopProbe() {
  if (probe) clearInterval(probe);
  probe = null;
}
// عند العودة للتطبيق وهو يظن أنه بلا إنترنت: نفحص فوراً
AppState.addEventListener('change', (s) => { if (s === 'active' && offline) ping(); });

export const makeOfflineFetch = (anonKey: string, url: string) => {
  probeUrl = url;
  probeKey = anonKey;
  return createCachingFetch({
    base: (input, init) => fetch(input, init),
    store,
    anonKey,
    userId: () => cacheUser,
    onState: setState,
  });
};

/** هل آخر طلب فشل بسبب انقطاع الإنترنت؟ (فنعرض المحفوظ) */
export function useOffline(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => offline);
}

export const isOffline = () => offline;

/** يُستدعى عند عودة الإنترنت (لتحديث الشاشات وإرسال الرسائل المنتظرة) */
export function onOnline(cb: () => void): () => void {
  onlineListeners.add(cb);
  return () => { onlineListeners.delete(cb); };
}

/** يُستدعى لحظة انقطاع الإنترنت */
export function onOffline(cb: () => void): () => void {
  offlineListeners.add(cb);
  return () => { offlineListeners.delete(cb); };
}

/**
 * لقطات الشاشات: آخر بيانات ظهرت في كل شاشة تُحفظ، فتظهر فوراً عند فتحها (قبل رد الخادم) وبلا إنترنت.
 * لكل طالب على حدة، وتُمسح عند الخروج مع المحفوظ (نفس البادئة). عددها محدود: الأقدم يُحذف.
 */
const SNAP = 'saey.c1.snap.';
const SNAP_INDEX = 'saey.c1.snapindex';
const SNAP_MAX = 80;
const snapKey = (key: string) => (cacheUser ? `${SNAP}${cacheUser}.${key}` : null);
const memo = new Map<string, unknown>();

export async function readSnapshot<T>(key: string): Promise<T | undefined> {
  const k = snapKey(key);
  if (!k) return undefined;
  if (memo.has(k)) return memo.get(k) as T;
  try {
    const raw = await AsyncStorage.getItem(k);
    if (raw == null) return undefined;
    const v = JSON.parse(raw) as T;
    memo.set(k, v);
    return v;
  } catch {
    return undefined;
  }
}

let snapChain: Promise<void> = Promise.resolve();
export function writeSnapshot(key: string, value: unknown): void {
  const k = snapKey(key);
  if (!k) return;
  memo.set(k, value);
  snapChain = snapChain.then(async () => {
    const raw = JSON.stringify(value);
    if (raw === undefined || raw.length > 400_000) return;
    await AsyncStorage.setItem(k, raw);
    let idx: string[] = [];
    try { idx = JSON.parse((await AsyncStorage.getItem(SNAP_INDEX)) ?? '[]') as string[]; } catch { /* فهرس تالف */ }
    idx = [...idx.filter((x) => x !== k), k];
    const drop = idx.length > SNAP_MAX ? idx.splice(0, idx.length - SNAP_MAX) : [];
    if (drop.length) { await AsyncStorage.multiRemove(drop); drop.forEach((d) => memo.delete(d)); }
    await AsyncStorage.setItem(SNAP_INDEX, JSON.stringify(idx));
  }).catch(() => {});
}

export const clearOfflineCache = async () => {
  memo.clear();
  await clearOfflineEntries(store);
};
