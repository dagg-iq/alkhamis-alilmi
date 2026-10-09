import { TASK_TYPE_LABELS, formatTime, relativeDays, type Subject, type Task } from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Icon } from '@/components/icon';
import { Card, Empty, ErrorBox, Fab, Header, Loading, Row, Screen, Segmented, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type View_ = 'upcoming' | 'all' | 'done';

export default function Planner() {
  const { c } = useTheme();
  const me = useMe();
  const { isStaff } = useAuth();
  const [view, setView] = useState<View_>('upcoming');
  const q = useLoad(async () => {
    const [tasks, status, subjects] = await Promise.all([
      must(supabase.from('tasks').select('*').order('due_at', { ascending: true, nullsFirst: false })),
      must(supabase.from('task_status').select('task_id').eq('user_id', me.id)),
      loadSubjects(),
    ]);
    return { tasks: tasks as Task[], done: new Set((status as { task_id: string }[]).map((s) => s.task_id)), subjects: subjects as Subject[] };
  }, [me.id]);
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const toggle = async (t: Task) => {
    if (q.data!.done.has(t.id)) await supabase.from('task_status').delete().match({ task_id: t.id, user_id: me.id });
    else await supabase.from('task_status').insert({ task_id: t.id, user_id: me.id });
    q.reload();
  };

  const remove = (t: Task) => Alert.alert('حذف المهمة', t.title, [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => {
      const { error } = await supabase.from('tasks').delete().eq('id', t.id);
      if (error) Alert.alert('تعذّر الحذف', error.message);
      q.reload();
    } },
  ]);

  const subjectName = (id: string | null) => shortSubject(q.data?.subjects.find((s) => s.id === id)?.name ?? '');
  const list = (q.data?.tasks ?? []).filter((t) => {
    const done = q.data!.done.has(t.id);
    if (view === 'done') return done;
    if (done) return false;
    if (view === 'upcoming') return !t.due_at || new Date(t.due_at).getTime() > Date.now() - 7 * 86400000;
    return true;
  });

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing} footer={<Fab title="مهمة جديدة" onPress={() => router.push('/planner/new')} />}>
      <Header title="المنظِّم" subtitle="واجباتك وتحضيراتك وامتحاناتك" />
      <Segmented options={[{ key: 'upcoming', label: 'القادمة' }, { key: 'all', label: 'كل غير المنجز' }, { key: 'done', label: 'المنجزة' }]} value={view} onChange={setView} />
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : list.length === 0 ? (
        <Empty icon="calendar" title={view === 'done' ? 'لم تنجز شيئاً بعد' : 'لا توجد مهام'} body="أضف واجباً أو تحضيراً أو موعد امتحان ليذكّرك سعي به." />
      ) : list.map((t) => {
        const done = q.data!.done.has(t.id);
        const due = t.due_at ? new Date(t.due_at) : null;
        const late = due && due.getTime() < Date.now() && !done;
        const isExam = t.type === 'exam';
        return (
          <Pressable key={t.id} onLongPress={t.owner_id === me.id || isStaff ? () => remove(t) : undefined} delayLongPress={350}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: isExam ? c.accent : c.line }}>
            <Pressable onPress={() => toggle(t)} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: done }}
              style={{ width: 28, height: 28, borderRadius: 14, borderWidth: done ? 0 : 1.5, borderColor: c.ink3, backgroundColor: done ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {done ? <Icon name="check" size={16} color={c.accentInk} strokeWidth={3} /> : null}
            </Pressable>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="bold" size={16} style={done ? { textDecorationLine: 'line-through', opacity: 0.5 } : undefined}>{t.title}</T>
              <T dim size={12}>
                {TASK_TYPE_LABELS[t.type]}{t.subject_id ? ` · ${subjectName(t.subject_id)}` : ''}
                {t.scope !== 'personal' ? ' · من الإدارة' : ''}
              </T>
            </View>
            {due ? (
              <View style={{ alignItems: 'flex-end' }}>
                <T size={13} weight="bold" color={late ? '#C8312B' : isExam ? c.accent : c.ink}>{relativeDays(due)}</T>
                <T dim size={11}>{formatTime(due)}</T>
              </View>
            ) : null}
          </Card>
          </Pressable>
        );
      })}
      {list.length ? <T dim size={12} center>اضغط مطولاً على مهمتك لحذفها</T> : null}
      <View style={{ height: 70 }} />
    </Screen>
  );
}
