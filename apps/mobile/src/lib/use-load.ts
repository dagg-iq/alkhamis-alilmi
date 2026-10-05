import { useCallback, useEffect, useRef, useState } from 'react';

/** تحميل بيانات مع إعادة تحميل وسحب للتحديث */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);

  const run = useCallback(async (mode: 'load' | 'refresh' | 'silent') => {
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'load') setLoading(true);
    try {
      const result = await fnRef.current();
      if (alive.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    run('load');
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

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
