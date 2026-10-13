import { POST_KIND_LABELS, formatDate, type Post } from '@saey/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Button, ErrorBox, Header, Loading, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { signedUrl } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';
import { KIND_COLOR } from '@/lib/labels';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isStaff } = useAuth();
  const q = useLoad(async () => {
    const post = await must(supabase.from('posts').select('*, profiles(full_name)').eq('id', id).single()) as Post & { profiles: { full_name: string } | null };
    const cover = post.cover_key ? await signedUrl(post.cover_key).catch(() => null) : null;
    return { post, cover };
  }, [id], { key: `news:${id}` });

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const { post, cover } = q.data;

  const remove = () => Alert.alert('حذف الخبر', 'هل أنت متأكد؟', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => {
      const { error } = await supabase.from('posts').delete().eq('id', post.id);
      if (error) Alert.alert('تعذّر الحذف', error.message);
      else router.back();
    } },
  ]);

  return (
    <Screen>
      <Header />
      <Row gap={8}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: KIND_COLOR[post.kind] }} />
        <T size={13} weight="bold" color={KIND_COLOR[post.kind]}>{POST_KIND_LABELS[post.kind]}</T>
        <T dim size={13}>· {formatDate(new Date(post.published_at))}</T>
      </Row>
      <T display size={32}>{post.title}</T>
      {cover ? <Image source={{ uri: cover }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 20 }} contentFit="cover" /> : null}
      <T serif size={17} selectable>{post.body}</T>
      {post.profiles ? <T dim size={13}>— {post.profiles.full_name}</T> : null}
      {isStaff ? <Button title="حذف الخبر" variant="danger" icon="trash" onPress={remove} /> : null}
    </Screen>
  );
}
