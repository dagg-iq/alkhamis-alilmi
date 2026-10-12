import { useCallback, useEffect, useRef, useState } from 'react';
import { onOnline, readSnapshot, writeSnapshot } from './offline';

export interface LoadOptions {
  /**
   * مفتاح لقطة الشاشة: آخر بيانات ناجحة تُحفظ وتظهر فوراً عند الفتح التالي (قبل رد الخادم وبلا إنترنت)،
   * ثم تُحدَّث بصمت. يجب أن يميز المعطيات (مثلاً `subject:${id}`)؛ المحفوظ لكل طالب على حدة.
   */
  key?: string;
}

/** تحميل بيانات مع إعادة تحميل وسحب للتحديث، ويعمل بلا إنترنت */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: LoadOptions = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(opts.key);
  keyRef.current = opts.key;
  const alive = useRef(true);
  // هل يوجد ما يُعرض؟ (فشل التحديث لا يمحو بيانات ظاهرة)
  const hasData = useRef(false);
  const gen = useRef(0);

  const run = useCallback(async (mode: 'load' | 'refresh' | 'silent') => {
    const g = gen.current;
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'load' && !hasData.current) setLoading(true);
    try {
      const result = await fnRef.current();
      if (alive.current && g === gen.current) {
        hasData.current = true;
        setData(result);
        setError(null);
        if (keyRef.current) writeSnapshot(keyRef.current, result);
      }
    } catch (e) {
      // البيانات الظاهرة تبقى (شريط «بدون إنترنت» يوضح الحال)؛ الخطأ يظهر فقط إن لم يكن شيء نعرضه
      if (alive.current && g === gen.current && !hasData.current) setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      if (alive.current && g === gen.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    gen.current += 1;
    const g = gen.current;
    hasData.current = false;
    setError(null);
    const key = keyRef.current;
    if (key) {
      // اللقطة أولاً (فورية)، ثم الخادم
      readSnapshot<T>(key).then((snap) => {
        if (!alive.current || g !== gen.current || snap === undefined || hasData.current) return;
        hasData.current = true;
        setData(snap);
        setLoading(false);
      }).finally(() => { if (alive.current && g === gen.current) run('load'); });
    } else {
      run('load');
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // عاد الإنترنت: تحديث صامت لما يظهر
  useEffect(() => onOnline(() => { if (alive.current) run('silent'); }), [run]);

  return {
    data,
    setData,
    error,
    loading,
    refreshing,
    reload: () => run('silent'),
    refresh: () => run('refresh'),
  };
}
