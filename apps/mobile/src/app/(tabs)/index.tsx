import {
  GOAL_TITLES, analyzeGrades, arDigits, formatDayDate, formatScore, POST_KIND_LABELS, relativeDays, TASK_TYPE_LABELS,
  targetLabel, targetSchoolDay, type Post, type Subject, type Task,
} from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/icon';
import { CountUp } from '@/components/motion';
import { Avatar, Card, IconButton, ProgressBar, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { itemName, loadSchedules, useScheduleSettings } from '@/lib/schedules';
import { loadMyGrades, loadSubjectProgress, loadSubjects, shortSubject } from '@/lib/queries';
import { useGoal } from '@/lib/goal';
import { useGradingRules } from '@/lib/settings';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

/** تحية بحسب ساعة الهاتف: الصباح يبدأ ٤ فجراً (قبلها ما زال ليلاً)، والعصر حتى المغرب */
function greeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 4 && h < 12) return 'صباح الخير';
  if (h >= 12 && h < 17) return 'مساء النور';
  return 'مساء الخير';
}

export default function Home() {
  const { c } = useTheme();
  const me = useMe();
  const rules = useGradingRules();
  const schedSettings = useScheduleSettings();

  // الساعة: تتحدث كل دقيقة حتى تتغير التحية والتاريخ والتطبيق مفتوح
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 60_000); return () => clearInterval(t); }, []);

  const q = useLoad(async () => {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    // فلاتر الوقت ثابتة طوال اليوم (بداية اليوم) حتى يطابق الاستعلام المحفوظ بلا إنترنت، ثم نفلتر بالساعة هنا
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    // جزء واحد يفشل بلا إنترنت (لم يُحفظ بعد) لا يُفرغ الرئيسية كلها
    const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const [subjects, progress, grades, exams, tasks, done, posts, unreadNotifs, sched] = await Promise.all([
      loadSubjects(),
      loadSubjectProgress(me.id),
      loadMyGrades(me.id),
      soft(must(supabase.from('tasks').select('*').eq('type', 'exam').gte('due_at', startOfToday.toISOString()).order('due_at').limit(10)), [] as Task[]),
      soft(must(supabase.from('tasks').select('*').neq('type', 'exam').lte('due_at', endOfToday.toISOString()).order('due_at').limit(20)), [] as Task[]),
      soft(must(supabase.from('task_status').select('task_id').eq('user_id', me.id)), [] as { task_id: string }[]),
      soft(must(supabase.from('posts').select('*').order('is_pinned', { ascending: false }).order('published_at', { ascending: false }).limit(1)), [] as Post[]),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).then((r) => r, () => ({ count: 0 })),
      loadSchedules().catch(() => null),
    ]);
    const doneIds = new Set((done as { task_id: string }[]).map((d) => d.task_id));
    return {
      subjects,
      progress,
      grades,
      nextExam: (exams as Task[]).find((t) => t.due_at && new Date(t.due_at) >= now) ?? null,
      todayTasks: (tasks as Task[]).filter((t) => !doneIds.has(t.id)).slice(0, 4),
      post: (posts as Post[])[0] ?? null,
      unreadNotifs: unreadNotifs.count ?? 0,
      sched,
    };
  }, [me.id]);

  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const d = q.data;
  const subjects: Subject[] = d?.subjects ?? [];
  const nameOf = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? '';
  const goal = useGoal();
  const sum = d ? analyzeGrades(subjects, d.grades, goal ?? 'general', rules, shortSubject) : null;
  const target = goal === 'pass' ? rules.pass : goal === 'individual' ? rules.individualExempt : rules.generalAvg;
  const firstName = me.full_name.split(' ')[0];

  const toggleTask = async (t: Task) => {
    await supabase.from('task_status').insert({ task_id: t.id, user_id: me.id });
    q.reload();
  };

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T dim size={14}>{formatDayDate(clock)}</T>
          <Pressable onPress={() => router.push(`/profile/${me.id}`)} accessibilityRole="button" accessibilityLabel="ملفي الشخصي" hitSlop={6}>
            <T weight="bold" size={24} lines={1}>{greeting(clock)}، <T weight="bold" size={24} color={c.accent}>{firstName}</T></T>
          </Pressable>
        </View>
        <Row gap={8}>
          <IconButton name="bell" label="الإشعارات" onPress={() => router.push('/notifications')} badge={d?.unreadNotifs} />
          <Pressable onPress={() => router.push(`/profile/${me.id}`)} accessibilityLabel="ملفي الشخصي">
            <Avatar name={me.full_name} url={me.avatar_url} verified={me.is_verified} />
          </Pressable>
        </Row>
      </Row>

      {/* هدفي: جملة واحدة واضحة من صفحة الدرجات */}
      <Card tone="hero" onPress={() => router.push('/grades')} style={{ padding: 22, gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={6}>
            <Icon name="target" size={15} color={c.heroInk2} />
            <T size={14} weight="medium" color={c.heroInk2}>هدفي: {GOAL_TITLES[goal ?? 'general']}</T>
          </Row>
          {sum && sum.state !== 'empty' ? (
            <T size={12} color={c.heroInk2}>{arDigits(sum.onTrack)} من {arDigits(sum.total)} على الطريق</T>
          ) : null}
        </Row>
        {sum && sum.average !== null ? (
          <>
            <T display size={26} color={c.heroInk}>{sum.headline}</T>
            <Row gap={10} style={{ alignItems: 'baseline' }}>
              <CountUp value={sum.average}>{(v) => <T display size={52} color={c.heroInk}>{formatScore(v)}</T>}</CountUp>
              <T size={14} color={c.heroInk2}>معدلك{sum.perExam && sum.state === 'possible' ? ` · تحتاج ${formatScore(sum.perExam)} في كل امتحان` : ''}</T>
            </Row>
            <ProgressBar value={sum.average / 100} track={c.track} color="#FFFFFF" marker={target / 100} height={8} />
          </>
        ) : (
          <View style={{ gap: 6 }}>
            <T display size={30} color={c.heroInk}>أضف أول درجة</T>
            <T size={14} color={c.heroInk2}>سجّل درجاتك وسعي يحسب لك الإعفاء وكم تحتاج في كل امتحان.</T>
          </View>
        )}
      </Card>

      {/* جدول الحصص: اليوم أو يوم الدوام القادم حسب الوقت */}
      {(() => {
        const weekly = d?.sched?.schedules.find((x) => x.kind === 'weekly');
        if (!d?.sched || !weekly) return null;
        const tg = targetSchoolDay(new Date(), schedSettings);
        const lessons = d.sched.items.filter((i) => i.schedule_id === weekly.id && i.day === tg.day);
        return (
          <Card onPress={() => router.push(`/schedules/${weekly.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderColor: c.accent }}>
            <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" size={24} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T dim size={13}>{tg.relation === 'today' ? 'جدول الحصص اليوم' : 'جدول الحصص القادم'}</T>
              <T weight="bold" size={16} lines={1}>{targetLabel(tg)}</T>
              <T dim size={12} lines={1}>{lessons.length ? lessons.map((l) => shortSubject(itemName(l, d.sched!.subjects))).join(' · ') : 'لا توجد حصص مسجلة'}</T>
            </View>
            <Icon name="forward" size={18} color={c.ink3} />
          </Card>
        );
      })()}

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
