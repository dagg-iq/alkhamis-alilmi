import type { Message } from '@saey/shared';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { tap } from './motion';
import { Avatar, T } from './ui';

interface Banner { id: string; conversationId: string; name: string; avatar: string | null; body: string }

/**
 * إشعار داخل التطبيق: عندما تصل رسالة جديدة وأنت في شاشة أخرى، تنزل بطاقة من الأعلى.
 * (إشعارات الهاتف والتطبيق مغلق تحتاج Firebase — انظر دليل الإعداد)
 */
export function MessageBanner({ myId }: { myId: string | null }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;
  const [banner, setBanner] = useState<Banner | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel('message-banner')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const m = payload.new as Message;
        if (m.sender_id === myId || path.current === `/chat/${m.conversation_id}`) return;
        // نتحقق أن المحادثة غير مكتومة
        const { data: member } = await supabase.from('conversation_members').select('muted')
          .eq('conversation_id', m.conversation_id).eq('user_id', myId).maybeSingle();
        if (!member || (member as { muted?: boolean }).muted) return;
        const { data: p } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', m.sender_id).maybeSingle();
        const sender = p as { full_name: string; avatar_url: string | null } | null;
        tap('light');
        setBanner({
          id: m.id,
          conversationId: m.conversation_id,
          name: sender?.full_name ?? 'رسالة جديدة',
          avatar: sender?.avatar_url ?? null,
          body: m.body ?? (m.attachment ? 'مرفق' : ''),
        });
        if (hide.current) clearTimeout(hide.current);
        hide.current = setTimeout(() => setBanner(null), 4500);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (hide.current) clearTimeout(hide.current);
    };
  }, [myId]);

  if (!banner) return null;
  return (
    <Animated.View key={banner.id} entering={SlideInUp.springify().damping(18).stiffness(220)} exiting={SlideOutUp.duration(200)}
      style={{ position: 'absolute', top: insets.top + 6, left: 12, right: 12, zIndex: 50 }}>
      <Pressable
        onPress={() => { setBanner(null); router.push(`/chat/${banner.conversationId}`); }}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22,
          backgroundColor: c.card, borderWidth: 1, borderColor: c.line,
          shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
        }}>
        <Avatar name={banner.name} url={banner.avatar} size={40} />
        <View style={{ flex: 1 }}>
          <T weight="bold" size={14} lines={1}>{banner.name}</T>
          <T dim size={13} lines={1}>{banner.body}</T>
        </View>
      </Pressable>
    </Animated.View>
  );
}
