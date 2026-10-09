import { timeAgo } from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { Icon, type IconName } from '@/components/icon';
import { Card, Empty, ErrorBox, Header, Loading, Row, Screen, T } from '@/components/ui';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Notif { id: string; type: string; title: string; body: string | null; payload: Record<string, string>; read_at: string | null; created_at: string }
const ICON: Record<string, IconName> = { post: 'news', mention: 'at', task: 'calendar', approved: 'check', message: 'chat' };

export default function Notifications() {
  const { c } = useTheme();
  const q = useLoad(async () => must(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60)) as Promise<Notif[]>);
  useFocusEffect(useCallback(() => {
    // تعليم الكل كمقروء عند الخروج
    return () => {
      supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).then(() => {});
    };
  }, []));

  const open = (n: Notif) => {
    const p = n.payload ?? {};
    if (p.conversation_id) router.push(`/chat/${p.conversation_id}`);
    else if (p.post_id) router.push(`/news/${p.post_id}`);
    else if (p.task_id) router.push('/planner');
  };

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header title="الإشعارات" />
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <Empty icon="bell" title="لا توجد إشعارات" />
      ) : q.data.map((n) => (
        <Card key={n.id} onPress={() => open(n)} tone={n.read_at ? 'card' : 'soft'} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: n.read_at ? c.soft : c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={ICON[n.type] ?? 'bell'} size={20} color={c.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="bold" lines={2}>{n.title}</T>
            {n.body ? <T dim size={13} lines={2}>{n.body}</T> : null}
            <Row gap={6}>
              {!n.read_at ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} /> : null}
              <T dim size={11}>{n.read_at ? '' : 'جديد · '}{timeAgo(new Date(n.created_at))}</T>
            </Row>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
