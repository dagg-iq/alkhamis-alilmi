import { useEffect, useRef, useState } from 'react';
import { fetchConversations } from './chat';
import { supabase } from './supabase';

/**
 * مجموع الرسائل غير المقروءة — يتحدث لحظياً.
 * وكل تحميل يسجّل «وصلت» للرسائل الجديدة (التطبيق مفتوح = وصلت الرسالة للهاتف).
 */
export function useUnreadCount(enabled: boolean, userId?: string) {
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const load = async () => {
      await supabase.rpc('mark_delivered').then(() => {}, () => {});
      const rows = await fetchConversations().catch(() => null);
      if (rows) setCount(rows.reduce((a, r) => a + (r.muted ? 0 : r.unread), 0));
    };
    const debounced = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 600);
    };
    load();
    const channel = supabase
      .channel('unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, debounced)
      // عضويتي فقط (القراءة من هاتف آخر، الإضافة لمجموعة) — لا قراءات الآخرين في كل المحادثات
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', ...(userId ? { filter: `user_id=eq.${userId}` } : {}) }, debounced)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, userId]);

  return count;
}
