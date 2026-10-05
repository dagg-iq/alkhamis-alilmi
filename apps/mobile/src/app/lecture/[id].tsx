import { arDigits, type Lecture } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { Icon } from '@/components/icon';
import { Button, Card, ErrorBox, Header, Loading, Row, Screen, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function LectureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const me = useMe();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);

  const q = useLoad(async () => {
    const lecture = await must(supabase.from('lectures').select('*, teachers(name), chapters(number, title)').eq('id', id).single()) as
      Lecture & { teachers: { name: string } | null; chapters: { number: number; title: string } };
    const [siblings, watched] = await Promise.all([
      must(supabase.from('lectures').select('id, title, sort').eq('chapter_id', lecture.chapter_id).order('sort')),
      must(supabase.from('progress').select('item_id').eq('user_id', me.id).eq('item_type', 'lecture')),
    ]);
    return {
      lecture,
      siblings: siblings as { id: string; title: string }[],
      watched: new Set((watched as { item_id: string }[]).map((w) => w.item_id)),
    };
  }, [id, me.id]);

  const markWatched = async (value: boolean) => {
    setBusy(true);
    if (value) await supabase.from('progress').upsert({ user_id: me.id, item_type: 'lecture', item_id: id, state: 'watched', updated_at: new Date().toISOString() });
    else await supabase.from('progress').delete().match({ user_id: me.id, item_type: 'lecture', item_id: id });
    await q.reload();
    setBusy(false);
  };

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const { lecture, siblings, watched } = q.data;
  const idx = siblings.findIndex((s) => s.id === lecture.id);
  const next = siblings[idx + 1];
  const isWatched = watched.has(lecture.id);
  const playerWidth = width - 40;

  return (
    <Screen>
      <Header />
      <View style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', height: (playerWidth * 9) / 16 }}>
        <YoutubePlayer
          height={(playerWidth * 9) / 16}
          width={playerWidth}
          videoId={lecture.youtube_id}
          onChangeState={(state: string) => {
            if (state === 'ended' && !isWatched) markWatched(true);
          }}
          initialPlayerParams={{ rel: false, modestbranding: true }}
        />
      </View>
      <View style={{ gap: 4 }}>
        <T dim size={13}>الفصل {arDigits(lecture.chapters.number)}{lecture.chapters.title ? ` — ${lecture.chapters.title}` : ''}</T>
        <T display size={26}>{lecture.title}</T>
        {lecture.teachers ? <T dim>الأستاذ {lecture.teachers.name}</T> : null}
      </View>
      <Button
        title={isWatched ? 'شاهدتها ✓' : 'تمت المشاهدة'}
        variant={isWatched ? 'secondary' : 'primary'}
        icon={isWatched ? undefined : 'check'}
        loading={busy}
        onPress={() => markWatched(!isWatched)}
      />
      {next ? (
        <Card onPress={() => router.replace(`/lecture/${next.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="play" size={16} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <T dim size={12}>المحاضرة التالية</T>
            <T weight="bold" lines={1}>{next.title}</T>
          </View>
          <Icon name="forward" size={18} color={c.ink3} />
        </Card>
      ) : null}
      <T weight="bold" size={15} style={{ marginTop: 4 }}>محاضرات الفصل</T>
      {siblings.map((s, i) => (
        <Pressable key={s.id} onPress={() => s.id !== lecture.id && router.replace(`/lecture/${s.id}`)}>
          <Row style={{ paddingVertical: 6 }}>
            <T weight="bold" color={s.id === lecture.id ? c.accent : c.ink3} style={{ width: 28 }}>{arDigits(i + 1)}</T>
            <T style={{ flex: 1 }} weight={s.id === lecture.id ? 'bold' : 'regular'} lines={1}>{s.title}</T>
            {watched.has(s.id) ? <Icon name="check" size={16} color={c.accent} /> : null}
          </Row>
        </Pressable>
      ))}
    </Screen>
  );
}
