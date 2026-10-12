import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(fn);
  ref.current = fn;
  // رقم لكل طلب: رد طلب قديم (تغيّرت المادة أو الصفحة قبل وصوله) لا يكتب فوق رد أحدث
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const result = await ref.current();
      if (mine !== seq.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload: run, setData };
}

/** تطبيع الأسماء العربية للبحث: أ/إ/آ ← ا، ة ← ه، ى ← ي، بلا تشكيل ولا مسافات زائدة */
export function normalizeArabic(s: string): string {
  return s.replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
