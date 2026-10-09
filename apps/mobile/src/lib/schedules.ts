import {
  parseScheduleSettings, type Schedule, type ScheduleItem, type ScheduleSettings, type Subject,
} from '@saey/shared';
import { useSettings } from './settings';
import { must, supabase } from './supabase';

/** إعدادات الجدول الذكي من app_settings (أيام الدوام وساعة التحويل) */
export function useScheduleSettings(): ScheduleSettings {
  const s = useSettings();
  return parseScheduleSettings(s.schedule);
}

export const byOrder = (a: ScheduleItem, b: ScheduleItem) =>
  (a.on_date ?? '').localeCompare(b.on_date ?? '') || (a.day ?? 0) - (b.day ?? 0) || a.sort - b.sort
  || (a.start_time ?? '').localeCompare(b.start_time ?? '');

export interface ScheduleListData {
  schedules: Schedule[];
  items: ScheduleItem[];
  subjects: Subject[];
}

/** الجداول المنشورة (RLS يرجع شعبة الطالب والعامة فقط) مع عناصرها دفعة واحدة */
export async function loadSchedules(): Promise<ScheduleListData> {
  const [schedules, items, subjects] = await Promise.all([
    must(supabase.from('schedules').select('*').eq('is_published', true).order('sort').order('created_at')),
    must(supabase.from('schedule_items').select('*')),
    must(supabase.from('subjects').select('*').order('sort')),
  ]);
  return { schedules: schedules as Schedule[], items: (items as ScheduleItem[]).sort(byOrder), subjects: subjects as Subject[] };
}

export async function loadSchedule(id: string): Promise<{ schedule: Schedule; items: ScheduleItem[]; subjects: Subject[] }> {
  const [schedule, items, subjects] = await Promise.all([
    must(supabase.from('schedules').select('*').eq('id', id).single()),
    must(supabase.from('schedule_items').select('*').eq('schedule_id', id)),
    must(supabase.from('subjects').select('*').order('sort')),
  ]);
  return { schedule: schedule as Schedule, items: (items as ScheduleItem[]).sort(byOrder), subjects: subjects as Subject[] };
}

/** اسم الحصة/الامتحان: المادة إن وُجدت وإلا العنوان الحر */
export function itemName(it: ScheduleItem, subjects: Subject[]): string {
  const s = it.subject_id ? subjects.find((x) => x.id === it.subject_id)?.name : null;
  return it.title?.trim() || s || 'حصة';
}

/** 08:05 ← 8:05 */
export const fmtTime = (t: string | null) => (t ? t.replace(/^0/, '') : '');
