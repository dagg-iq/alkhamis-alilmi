import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(fn);
  ref.current = fn;
  const run = useCallback(async () => {
    try {
      setData(await ref.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload: run, setData };
}
