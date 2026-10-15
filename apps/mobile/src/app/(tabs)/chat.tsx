import { arDigits, formatTime, timeAgo, typingLabel } from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/icon';
import { AssistantMark, ConversationMark } from '@/components/group-mark';
import { Ticks } from '@/components/receipt';
import { Avatar, Empty, ErrorBox, Header, IconButton, Loading, NameLine, Row, Screen, T } from '@/components/ui';
import { useSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useAuth, useMe } from '@/lib/auth';
import { useLoad } from '@/lib/use-load';
import { conversationTitle, fetchConversations, type ConversationRow } from '@/lib/chat';
import { subscribeTyping, type Typist } from '@/lib/typing';

/** «يكتب…» في القائمة: المحادثات الخاصة والمجموعات الأحدث فقط (المدرسة والشعب كبيرة) */
const TYPING_WATCH = 20;

export default function ChatList() {
  const { c } = useTheme();
  const me = useMe();
  const { isStaff } = useAuth();
  const settings = useSettings();
  const chat = settings.chat as { direct_messages?: boolean; student_groups?: boolean } | undefined;
  const dmEnabled = chat?.direct_messages !== false;
  const groupsEnabled = chat?.student_groups !== false;
  const q = useLoad(fetchConversations, [], { key: 'chats' });
  const [typing, setTyping] = useState<Record<string, Typist[]>>({});

  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  useEffect(() => {
    const ch = supabase.channel('chat-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => q.reload())
      // أُضفت لمجموعة أو أُزلت منها، أو قرأتُ من هاتف آخر (علامات قراءة الآخرين تتحدث مع الرسائل وعند العودة للقائمة)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${me.id}` }, () => q.reload())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watched = (q.data ?? []).filter((x) => x.type === 'direct' || x.type === 'group').slice(0, TYPING_WATCH).map((x) => x.id);
  const watchKey = watched.join(',');
  useEffect(() => {
    if (!watchKey) return;
    const offs = watchKey.split(',').map((id) => subscribeTyping(id, (list) => setTyping((t) => ({ ...t, [id]: list.filter((x) => x.user_id !== me.id) }))));
    return () => offs.forEach((off) => off());
  }, [watchKey, me.id]);

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header back={false} title="الدردشة"
        right={(
          <>
            {groupsEnabled || isStaff ? <IconButton name="users" label="مجموعة جديدة" onPress={() => router.push('/chat/new-group')} /> : null}
            {dmEnabled || isStaff ? <IconButton name="edit" label="رسالة جديدة" onPress={() => router.push('/chat/new')} /> : null}
          </>
        )} />
      {/* مساعد سعي دائماً في الأعلى: أسرع طريق لسؤال عن الدروس */}
      <Pressable onPress={() => router.push('/ai')} accessibilityRole="button" accessibilityLabel="مساعد سعي"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22, backgroundColor: c.soft, opacity: pressed ? 0.7 : 1 })}>
        <AssistantMark size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={6}>
            <T weight="bold" size={16} color={c.softInk}>مساعد سعي</T>
            <View style={{ paddingHorizontal: 8, borderRadius: 999, backgroundColor: c.accent }}>
              <T size={11} weight="bold" color={c.accentInk}>ذكاء اصطناعي</T>
            </View>
          </Row>
          <T size={14} color={c.softInk} lines={1}>اسأل عن أي درس — يجيب من ملازمكم</T>
        </View>
        <Icon name="forward" size={18} color={c.softInk} />
      </Pressable>

      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <Empty icon="chat" title="لا توجد محادثات بعد" />
      ) : (
        <View>
          {q.data.map((conv) => (
            <ConversationItem key={conv.id} conv={conv} myId={me.id} typing={typingLabel((typing[conv.id] ?? []).map((x) => x.name), conv.type !== 'direct')} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function ConversationItem({ conv, myId, typing }: { conv: ConversationRow; myId: string; typing: string | null }) {
  const { c } = useTheme();
  const when = conv.last_message_at ? new Date(conv.last_message_at) : null;
  const isToday = when && when.toDateString() === new Date().toDateString();
  const mine = conv.last_sender_id === myId && conv.last_kind !== 'system';
  const prefix = conv.type !== 'direct' && conv.last_kind !== 'system' && conv.last_sender
    ? `${mine ? 'أنت' : conv.last_sender.split(' ')[0]}: ` : '';
  return (
    <Pressable onPress={() => router.push(`/chat/${conv.id}`)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
      {conv.type === 'direct' ? (
        <Avatar name={conv.peer_name ?? '؟'} url={conv.peer_avatar} size={52} verified={!!conv.peer_verified} />
      ) : (
        <ConversationMark type={conv.type} title={conversationTitle(conv)} size={52} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={6} style={{ flex: 1 }}>
            <View style={{ flexShrink: 1 }}>
              <NameLine name={conversationTitle(conv)} verified={conv.type === 'direct' && !!conv.peer_verified} size={16} />
            </View>
            {conv.muted ? <Icon name="bell-off" size={14} color={c.ink3} /> : null}
          </Row>
          {when ? <T dim size={12} color={conv.unread ? c.accent : undefined}>{isToday ? formatTime(when) : timeAgo(when)}</T> : null}
        </Row>
        <Row gap={4}>
          {!typing && mine && conv.last_status ? <Ticks status={conv.last_status} color={c.ink3} readColor={c.accent} size={15} /> : null}
          {typing ? (
            <T size={14} lines={1} weight="bold" color={c.accent} style={{ flex: 1 }}>{typing}</T>
          ) : (
            <T dim size={14} lines={1} style={{ flex: 1 }}>
              {conv.last_body ? `${prefix}${conv.last_body}` : 'لا توجد رسائل بعد'}
            </T>
          )}
          {conv.unread > 0 ? (
            <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: conv.muted ? c.ink3 : c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <T size={12} weight="bold" color={conv.muted ? c.bg : c.accentInk} style={{ lineHeight: 16 }}>{arDigits(conv.unread)}</T>
            </View>
          ) : null}
        </Row>
      </View>
    </Pressable>
  );
}
