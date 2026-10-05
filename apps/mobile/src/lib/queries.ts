import type { Period, Subject, SubjectScores } from '@saey/shared';
import { must, supabase } from './supabase';

export async function loadSubjects(): Promise<Subject[]> {
  return must(supabase.from('subjects').select('*').order('sort'));
}

export interface SubjectProgress { watched: number; total: number }

/** نسبة المحاضرات التي شاهدها الطالب في كل مادة */
export async function loadSubjectProgress(userId: string): Promise<Record<string, SubjectProgress>> {
  const [lectures, progress] = await Promise.all([
    must(supabase.from('lectures').select('id, chapters!inner(books!inner(subject_id))').eq('is_published', true)),
    must(supabase.from('progress').select('item_id').eq('user_id', userId).eq('item_type', 'lecture')),
  ]);
  const watched = new Set((progress as { item_id: string }[]).map((p) => p.item_id));
  const out: Record<string, SubjectProgress> = {};
  for (const l of lectures as unknown as { id: string; chapters: { books: { subject_id: string } } }[]) {
    const sid = l.chapters.books.subject_id;
    out[sid] ??= { watched: 0, total: 0 };
    out[sid].total++;
    if (watched.has(l.id)) out[sid].watched++;
  }
  return out;
}

/** درجات الطالب مجمعة حسب المادة */
export async function loadMyGrades(userId: string): Promise<Record<string, SubjectScores>> {
  const rows = await must(supabase.from('grades').select('subject_id, period, score').eq('user_id', userId));
  const out: Record<string, SubjectScores> = {};
  for (const r of rows as { subject_id: string; period: Period; score: number }[]) {
    out[r.subject_id] ??= {};
    out[r.subject_id][r.period] = Number(r.score);
  }
  return out;
}

/** اسم قصير للمادة (للبطاقات الصغيرة) */
export function shortSubject(name: string): string {
  return name.replace('التربية ', '').replace('اللغة ', '');
}
