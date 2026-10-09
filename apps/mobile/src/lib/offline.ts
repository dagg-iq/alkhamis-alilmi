import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { clearOfflineEntries, createCachingFetch, type KV } from './offline-fetch';

const store: KV = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (ks) => AsyncStorage.multiRemove(ks),
};

let offline = false;
const listeners = new Set<() => void>();

export const makeOfflineFetch = (anonKey: string) => createCachingFetch({
  base: (input, init) => fetch(input, init),
  store,
  anonKey,
  onState: (v) => { offline = v; listeners.forEach((l) => l()); },
});

/** هل آخر طلب فشل بسبب انقطاع الإنترنت؟ (فنعرض المحفوظ) */
export function useOffline(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => offline);
}

export const clearOfflineCache = () => clearOfflineEntries(store);
