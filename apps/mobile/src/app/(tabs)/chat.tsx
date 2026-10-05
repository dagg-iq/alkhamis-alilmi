import { arDigits, formatTime, timeAgo } from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/icon';
import { Avatar, Empty, ErrorBox, Header, IconButton, Loading, NameLine, Row, Screen, T } from '@/components/ui';
import { useSettings } from '@/lib/settings';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { useLoad } from '@/lib/use-load';
import { conversationTitle, type ConversationRow } from '@/lib/chat';

export default function ChatList() {
  const { c } = useTheme();
  const { isStaff } = useAuth();
  const settings = useSettings();
  const dmEnabled = (settings.chat as { direct_messages?: boolean } | undefined)?.direct_messages !== false;
  const q = useLoad(async () => must(supabase.rpc('my_conversations')) as Promise<ConversationRow[]>);

  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  useEffect(() => {
    const ch = supabase.channel('chat-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => q.reload())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header back={false} title="الدردشة"
        right={dmEnabled || isStaff ? <IconButton name="edit" label="رسالة جديدة" onPress={() => router.push('/chat/new')} /> : undefined} />
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <Empty icon="chat" title="لا توجد محادثات بعد" />
      ) : (
        <View>
          {q.data.map((conv) => {
            const when = conv.last_message_at ? new Date(conv.last_message_at) : null;
            const isToday = when && when.toDateString() === new Date().toDateString();
            return (
              <Pressable key={conv.id} onPress={() => router.push(`/chat/${conv.id}`)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
                {conv.type === 'direct' ? (
                  <Avatar name={conv.peer_name ?? '؟'} url={conv.peer_avatar} size={52} verified={!!conv.peer_verified} />
                ) : (
                  <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: conv.type === 'school' ? c.heroBg : c.soft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={conv.type === 'school' ? 'home' : 'users'} size={24} color={conv.type === 'school' ? '#FFFFFF' : c.accent} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <NameLine name={conversationTitle(conv)} verified={conv.type === 'direct' && !!conv.peer_verified} size={16} />
                    </View>
                    {when ? <T dim size={12} color={conv.unread ? c.accent : undefined}>{isToday ? formatTime(when) : timeAgo(when)}</T> : null}
                  </Row>
                  <Row>
                    <T dim size={14} lines={1} style={{ flex: 1 }}>
                      {conv.last_body ? `${conv.type !== 'direct' && conv.last_sender ? `${conv.last_sender.split(' ')[0]}: ` : ''}${conv.last_body}` : 'لا توجد رسائل بعد'}
                    </T>
                    {conv.unread > 0 ? (
                      <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: conv.muted ? c.ink3 : c.accent, alignItems: 'center', justifyContent: 'center' }}>
                        <T size={12} weight="bold" color="#FFFFFF" style={{ lineHeight: 16 }}>{arDigits(conv.unread)}</T>
                      </View>
                    ) : null}
                  </Row>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
