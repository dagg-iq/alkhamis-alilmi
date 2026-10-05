import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/** مجموع الرسائل غير المقروءة — يتحدث لحظياً */
export function useUnreadCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const load = async () => {
      const { data } = await supabase.rpc('my_conversations');
      setCount(((data ?? []) as { unread: number; muted: boolean }[]).reduce((a, r) => a + (r.muted ? 0 : r.unread), 0));
    };
    const debounced = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 600);
    };
    load();
    const channel = supabase
      .channel('unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, debounced)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, debounced)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled]);

  return count;
}
