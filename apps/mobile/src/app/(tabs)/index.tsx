import {
  arDigits, formatDayDate, formatScore, generalExemption, POST_KIND_LABELS, relativeDays, TASK_TYPE_LABELS,
  type Post, type Subject, type Task,
} from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/icon';
import { CountUp } from '@/components/motion';
import { Avatar, Card, IconButton, ProgressBar, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { loadMyGrades, loadSubjectProgress, loadSubjects, shortSubject } from '@/lib/queries';
import { useGradingRules } from '@/lib/settings';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'مساء النور';
  return 'مساء الخير';
}

export default function Home() {
  const { c } = useTheme();
  const me = useMe();
  const rules = useGradingRules();

  const q = useLoad(async () => {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const [subjects, progress, grades, exams, tasks, done, posts, unreadNotifs] = await Promise.all([
      loadSubjects(),
      loadSubjectProgress(me.id),
      loadMyGrades(me.id),
      must(supabase.from('tasks').select('*').eq('type', 'exam').gte('due_at', now.toISOString()).order('due_at').limit(1)),
      must(supabase.from('tasks').select('*').neq('type', 'exam').lte('due_at', endOfToday.toISOString()).order('due_at').limit(20)),
      must(supabase.from('task_status').select('task_id').eq('user_id', me.id)),
      must(supabase.from('posts').select('*').order('is_pinned', { ascending: false }).order('published_at', { ascending: false }).limit(1)),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);
    const doneIds = new Set((done as { task_id: string }[]).map((d) => d.task_id));
    return {
      subjects,
      progress,
      grades,
      nextExam: (exams as Task[])[0] ?? null,
      todayTasks: (tasks as Task[]).filter((t) => !doneIds.has(t.id)).slice(0, 4),
      post: (posts as Post[])[0] ?? null,
      unreadNotifs: unreadNotifs.count ?? 0,
    };
  }, [me.id]);

  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const d = q.data;
  const subjects: Subject[] = d?.subjects ?? [];
  const nameOf = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? '';
  const general = d ? generalExemption(Object.fromEntries(subjects.map((s) => [s.id, d.grades[s.id] ?? {}])), rules) : null;
  const firstName = me.full_name.split(' ')[0];

  const toggleTask = async (t: Task) => {
    await supabase.from('task_status').insert({ task_id: t.id, user_id: me.id });
    q.reload();
  };

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T dim size={14}>{formatDayDate(new Date())}</T>
          <T weight="bold" size={24} lines={1}>{greeting()}، {firstName}</T>
        </View>
        <Row gap={8}>
          <IconButton name="bell" label="الإشعارات" onPress={() => router.push('/notifications')} badge={d?.unreadNotifs} />
          <Pressable onPress={() => router.push(`/profile/${me.id}`)} accessibilityLabel="ملفي الشخصي">
            <Avatar name={me.full_name} url={me.avatar_url} verified={me.is_verified} />
          </Pressable>
        </Row>
      </Row>

      {/* طريق الإعفاء */}
      <Card tone="hero" onPress={() => router.push('/grades')} style={{ padding: 22, gap: 14 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T size={15} weight="medium" color={c.heroInk2}>طريقك إلى الإعفاء العام</T>
          {general?.average != null ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: general.exempt ? c.accent : '#C8312B' }}>
              <T size={12} weight="bold" color="#FFFFFF">{general.exempt ? (general.final ? 'معفى' : 'على الطريق') : 'تحتاج جهداً'}</T>
            </View>
          ) : null}
        </Row>
        {general?.average != null ? (
          <>
            <Row gap={10} style={{ alignItems: 'baseline' }}>
              <CountUp value={general.average}>{(v) => <T display size={60} color={c.heroInk}>{formatScore(v)}</T>}</CountUp>
              <T size={14} color={c.heroInk2}>معدلك الحالي · الهدف {formatScore(rules.generalAvg, 0)}</T>
            </Row>
            <ProgressBar value={general.average / 100} track={c.track} marker={rules.generalAvg / 100} height={8} />
            <T size={13} color={c.heroInk2}>
              أقل مادة: {shortSubject(nameOf(general.minSubjectId))} {formatScore(general.min)} — الحد الأدنى {formatScore(rules.generalMin, 0)} {general.meetsMin ? '✓' : '✗'}
            </T>
          </>
        ) : (
          <View style={{ gap: 6 }}>
            <T display size={30} color={c.heroInk}>أضف أول درجة</T>
            <T size={14} color={c.heroInk2}>سجّل درجاتك وسعي يحسب لك الإعفاء وكم تحتاج في كل امتحان.</T>
          </View>
        )}
      </Card>

      {/* الامتحان القادم */}
      {d?.nextExam ? (
        <Card onPress={() => router.push('/planner')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="calendar" size={24} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <T dim size={13}>الامتحان القادم · {relativeDays(new Date(d.nextExam.due_at!))}</T>
            <T weight="bold" size={16} lines={1}>{d.nextExam.title}</T>
          </View>
          <Icon name="forward" size={18} color={c.ink3} />
        </Card>
      ) : null}

      {/* مهام اليوم */}
      {d?.todayTasks.length ? (
        <>
          <SectionTitle title="مهام اليوم" action="المنظِّم" onAction={() => router.push('/planner')} />
          <Card style={{ gap: 4, paddingVertical: 6 }}>
            {d.todayTasks.map((t) => (
              <Row key={t.id} style={{ paddingVertical: 8 }}>
                <Pressable onPress={() => toggleTask(t)} accessibilityRole="checkbox" accessibilityLabel={`إنجاز ${t.title}`} hitSlop={8}
                  style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: c.ink3 }} />
                <View style={{ flex: 1 }}>
                  <T weight="bold" lines={1}>{t.title}</T>
                  <T dim size={12}>{TASK_TYPE_LABELS[t.type]}{t.subject_id ? ` · ${nameOf(t.subject_id)}` : ''}{t.due_at && new Date(t.due_at) < new Date() ? ' · متأخر' : ''}</T>
                </View>
              </Row>
            ))}
          </Card>
        </>
      ) : null}

      {/* آخر خبر */}
      {d?.post ? (
        <Card tone="soft" onPress={() => router.push(`/news/${d.post!.id}`)} style={{ gap: 4 }}>
          <Row gap={8}>
            <Icon name={d.post.is_pinned ? 'pin' : 'news'} size={16} color={c.accent} />
            <T size={13} weight="bold" color={c.accent}>{POST_KIND_LABELS[d.post.kind]}</T>
          </Row>
          <T weight="bold" size={17} color={c.softInk}>{d.post.title}</T>
          {d.post.body ? <T size={14} color={c.softInk} lines={2}>{d.post.body}</T> : null}
        </Card>
      ) : null}

      {/* المواد */}
      <SectionTitle title="موادك" action="الكل" onAction={() => router.push('/subjects')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
        {subjects.map((s) => {
          const p = d?.progress[s.id];
          return (
            <Card key={s.id} onPress={() => router.push(`/subject/${s.id}`)}
              style={{ width: '48.5%', gap: 12, paddingVertical: 14 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T weight="bold" size={16} lines={1} style={{ flexShrink: 1 }}>{shortSubject(s.name)}</T>
                {p ? <T dim size={12}>{arDigits(`${p.watched}/${p.total}`)}</T> : null}
              </Row>
              <ProgressBar value={p && p.total ? p.watched / p.total : 0} color={c.ink} height={4} />
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
