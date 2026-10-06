import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_RULES, generalExemption, isIndividuallyExempt, effortStatus, parseRules, type Post, type Task } from '@saey/shared';
import { loadMyGrades, loadSubjects, shortSubject } from '@/lib/queries';
import { loadSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';

/** ما تعرضه الويدجتات: نسخة صغيرة من بيانات الطالب تُحفظ على الجهاز */
export interface WidgetSnapshot {
  updatedAt: string;
  signedIn: boolean;
  firstName: string;
  average: number | null;
  target: number;
  minTarget: number;
  min: number | null;
  minSubject: string | null;
  exempt: boolean;
  final: boolean;
  individual: number;
  subjectsWithGrades: number;
  exams: Pick<Task, 'id' | 'title' | 'due_at' | 'type'>[];
  tasks: Pick<Task, 'id' | 'title' | 'due_at' | 'type'>[];
  unreadMessages: number;
  unreadNotifs: number;
  post: Pick<Post, 'id' | 'title' | 'kind' | 'published_at'> | null;
}

const KEY = 'saey.widgets.v1';

export const EMPTY_SNAPSHOT: WidgetSnapshot = {
  updatedAt: new Date(0).toISOString(),
  signedIn: false,
  firstName: '',
  average: null,
  target: DEFAULT_RULES.generalAvg,
  minTarget: DEFAULT_RULES.generalMin,
  min: null,
  minSubject: null,
  exempt: false,
  final: false,
  individual: 0,
  subjectsWithGrades: 0,
  exams: [],
  tasks: [],
  unreadMessages: 0,
  unreadNotifs: 0,
  post: null,
};

export async function readSnapshot(): Promise<WidgetSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...EMPTY_SNAPSHOT, ...(JSON.parse(raw) as Partial<WidgetSnapshot>) } : EMPTY_SNAPSHOT;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export async function writeSnapshot(s: WidgetSnapshot) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // لا شيء: الويدجت يعرض آخر نسخة
  }
}

/** يجلب أحدث البيانات من الخادم (يعمل داخل التطبيق وفي الخلفية للويدجت) */
export async function fetchSnapshot(): Promise<WidgetSnapshot> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ...EMPTY_SNAPSHOT, updatedAt: new Date().toISOString() };
  const uid = session.user.id;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const now = new Date();

  const [profile, settings, subjects, grades, exams, tasks, done, posts, notifs, convs] = await Promise.all([
    supabase.from('profiles').select('full_name, status').eq('id', uid).maybeSingle(),
    loadSettings(true).catch(() => ({} as Record<string, unknown>)),
    loadSubjects(),
    loadMyGrades(uid),
    supabase.from('tasks').select('id, title, due_at, type').eq('type', 'exam').gte('due_at', now.toISOString()).order('due_at').limit(3),
    supabase.from('tasks').select('id, title, due_at, type').neq('type', 'exam').gte('due_at', startOfToday.toISOString()).order('due_at').limit(12),
    supabase.from('task_status').select('task_id').eq('user_id', uid),
    supabase.from('posts').select('id, title, kind, published_at').order('is_pinned', { ascending: false }).order('published_at', { ascending: false }).limit(1),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    supabase.rpc('my_conversations'),
  ]);

  const rules = settings.grading ? parseRules(settings.grading) : DEFAULT_RULES;
  const scores = Object.fromEntries(subjects.map((s) => [s.id, grades[s.id] ?? {}]));
  const general = generalExemption(scores, rules);
  let individual = 0;
  let withGrades = 0;
  for (const s of subjects) {
    const st = effortStatus(grades[s.id] ?? {});
    if ((st.annual ?? st.current) !== null) withGrades += 1;
    if (isIndividuallyExempt(st.annual, rules)) individual += 1;
  }
  const doneIds = new Set(((done.data ?? []) as { task_id: string }[]).map((d) => d.task_id));
  const nameOf = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? null;
  const p = profile.data as { full_name: string; status: string } | null;

  return {
    updatedAt: new Date().toISOString(),
    signedIn: p?.status === 'approved',
    firstName: (p?.full_name ?? '').split(' ')[0] ?? '',
    average: general.average,
    target: rules.generalAvg,
    minTarget: rules.generalMin,
    min: general.min,
    minSubject: general.minSubjectId ? shortSubject(nameOf(general.minSubjectId) ?? '') : null,
    exempt: general.exempt,
    final: general.final,
    individual,
    subjectsWithGrades: withGrades,
    exams: (exams.data ?? []) as WidgetSnapshot['exams'],
    tasks: ((tasks.data ?? []) as WidgetSnapshot['tasks']).filter((t) => !doneIds.has(t.id)).slice(0, 5),
    unreadMessages: ((convs.data ?? []) as { unread: number; muted: boolean }[]).reduce((a, r) => a + (r.muted ? 0 : r.unread), 0),
    unreadNotifs: notifs.count ?? 0,
    post: ((posts.data ?? []) as WidgetSnapshot['post'][])[0] ?? null,
  };
}
