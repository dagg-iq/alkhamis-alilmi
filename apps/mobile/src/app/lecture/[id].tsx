import { arDigits, type Lecture } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Icon } from '@/components/icon';
import { clock } from '@/components/rich-text';
import { VideoPlayer } from '@/components/video-player';
import { Button, Card, ErrorBox, Header, Loading, MAX_WIDTH, Row, Screen, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function LectureScreen() {
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const [seek, setSeek] = useState<{ sec: number; n: number } | null>(null);
  const { c } = useTheme();
  const me = useMe();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);

  const q = useLoad(async () => {
    const lecture = await must(supabase.from('lectures').select('*, teachers(name), chapters(number, title)').eq('id', id).single()) as
      Lecture & { teachers: { name: string } | null; chapters: { number: number; title: string } };
    const [siblings, watched, topics] = await Promise.all([
      must(supabase.from('lectures').select('id, title, sort').eq('chapter_id', lecture.chapter_id).order('sort')),
      must(supabase.from('progress').select('item_id').eq('user_id', me.id).eq('item_type', 'lecture')),
      // مواضيع المحاضرة بالدقيقة (إن فُهرست) — الجدول قد لا يكون موجوداً بعد
      supabase.from('lecture_topics').select('id, start_sec, title, summary').eq('lecture_id', id).order('start_sec')
        .then(({ data }) => (data ?? []) as { id: string; start_sec: number; title: string; summary: string | null }[]),
    ]);
    return {
      lecture,
      topics,
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
  const { lecture, siblings, watched, topics } = q.data;
  const start = t ? Number(t) : undefined;
  const idx = siblings.findIndex((s) => s.id === lecture.id);
  const next = siblings[idx + 1];
  const isWatched = watched.has(lecture.id);
  const playerWidth = Math.min(width, MAX_WIDTH) - 40;

  return (
    <Screen>
      <Header />
      <View style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', height: (playerWidth * 9) / 16 }}>
        <VideoPlayer
          videoId={lecture.youtube_id}
          width={playerWidth}
          height={(playerWidth * 9) / 16}
          start={start}
          seek={seek}
          onEnded={() => !isWatched && markWatched(true)}
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
      {topics.length ? (
        <Card style={{ gap: 4, paddingVertical: 10 }}>
          <T weight="bold" size={15}>مواضيع المحاضرة</T>
          {topics.map((tp) => (
            <Pressable key={tp.id} onPress={() => setSeek({ sec: tp.start_sec, n: Date.now() })} accessibilityRole="button" accessibilityLabel={`انتقل إلى ${tp.title}`}
              style={({ pressed }) => ({ flexDirection: 'row', gap: 10, paddingVertical: 8, opacity: pressed ? 0.6 : 1, alignItems: 'flex-start' })}>
              <View style={{ minWidth: 54, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.soft, alignItems: 'center' }}>
                <T size={13} weight="bold" color={c.softInk}>{arDigits(clock(tp.start_sec))}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T weight="bold" size={14}>{tp.title}</T>
                {tp.summary ? <T dim size={13}>{tp.summary}</T> : null}
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}
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
