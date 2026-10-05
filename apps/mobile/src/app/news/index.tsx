import { POST_KIND_LABELS, timeAgo, type Post } from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/icon';
import { Card, Empty, ErrorBox, Header, IconButton, Loading, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';
import { KIND_COLOR } from '@/lib/labels';

export default function News() {
  const { c } = useTheme();
  const { isStaff } = useAuth();
  const q = useLoad(async () =>
    must(supabase.from('posts').select('*').order('is_pinned', { ascending: false }).order('published_at', { ascending: false }).limit(50)) as Promise<Post[]>);
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header title="أخبار المدرسة" right={isStaff ? <IconButton name="plus" label="خبر جديد" filled onPress={() => router.push('/news/new')} /> : undefined} />
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <Empty icon="news" title="لا توجد أخبار بعد" />
      ) : q.data.map((p) => (
        <Card key={p.id} onPress={() => router.push(`/news/${p.id}`)} style={{ gap: 6 }}>
          <Row gap={8}>
            {p.is_pinned ? <Icon name="pin" size={14} color={c.accent} /> : null}
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: KIND_COLOR[p.kind] }} />
            <T size={12} weight="bold" color={KIND_COLOR[p.kind]}>{POST_KIND_LABELS[p.kind]}</T>
            <T dim size={12}>· {timeAgo(new Date(p.published_at))}</T>
          </Row>
          <T weight="bold" size={18}>{p.title}</T>
          {p.body ? <T dim size={14} lines={3}>{p.body}</T> : null}
        </Card>
      ))}
    </Screen>
  );
}
