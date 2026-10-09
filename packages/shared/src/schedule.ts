/**
 * الجداول: الأسبوعي (حصص)، الامتحانات، وأي جدول مخصص.
 * المنطق الذكي: أي يوم دوام نعرض؟ الدوام يبدأ ٨ وينتهي ~١٢، فمن الصباح الباكر نعرض جدول اليوم،
 * وبعد ساعة التحويل (٩ افتراضياً) نعرض جدول يوم الدوام التالي.
 */
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;

export type ScheduleKind = 'weekly' | 'exam' | 'custom';
export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  weekly: 'جدول الحصص الأسبوعي',
  exam: 'جدول امتحانات',
  custom: 'جدول مخصص',
};

export interface Schedule {
  id: string;
  title: string;
  subtitle: string | null;
  kind: ScheduleKind;
  /** null = لكل الشعب */
  section_id: string | null;
  is_published: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleItem {
  id: string;
  schedule_id: string;
  /** ٠ الأحد … ٦ السبت (الأسبوعي) */
  day: number | null;
  /** YYYY-MM-DD (الامتحانات والمخصص) */
  on_date: string | null;
  sort: number;
  start_time: string | null;
  end_time: string | null;
  subject_id: string | null;
  title: string | null;
  teacher: string | null;
  place: string | null;
  note: string | null;
}

export interface ScheduleSettings {
  /** أيام الدوام (٠ الأحد … ٦ السبت) */
  school_days: number[];
  start: string;
  end: string;
  /** بعد هذه الساعة يُعرض يوم الدوام التالي */
  switch_after: string;
}

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = { school_days: [0, 1, 2, 3, 4], start: '08:00', end: '12:00', switch_after: '09:00' };

export function parseScheduleSettings(raw: unknown): ScheduleSettings {
  const r = (raw ?? {}) as Partial<ScheduleSettings>;
  const days = Array.isArray(r.school_days) ? r.school_days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  const t = (v: unknown, d: string) => (typeof v === 'string' && /^[0-2]\d:[0-5]\d$/.test(v) ? v : d);
  return {
    school_days: days.length ? [...new Set(days)].sort() : DEFAULT_SCHEDULE_SETTINGS.school_days,
    start: t(r.start, DEFAULT_SCHEDULE_SETTINGS.start),
    end: t(r.end, DEFAULT_SCHEDULE_SETTINGS.end),
    switch_after: t(r.switch_after, DEFAULT_SCHEDULE_SETTINGS.switch_after),
  };
}

/** 'HH:MM' ← دقائق منذ منتصف الليل */
export function minutesOf(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export type DayRelation = 'today' | 'tomorrow' | 'later';
export interface TargetDay {
  /** ٠ الأحد … ٦ السبت */
  day: number;
  /** كم يوماً من اليوم (٠ = اليوم) */
  offset: number;
  relation: DayRelation;
}

/** يوم الدوام الذي يجب إبرازه الآن */
export function targetSchoolDay(now: Date, settings: ScheduleSettings = DEFAULT_SCHEDULE_SETTINGS): TargetDay {
  const today = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const cut = minutesOf(settings.switch_after) ?? 9 * 60;
  const isSchool = (d: number) => settings.school_days.includes(d);
  let offset = 0;
  if (!(isSchool(today) && mins < cut)) {
    offset = 1;
    while (offset <= 7 && !isSchool((today + offset) % 7)) offset++;
    if (offset > 7) offset = 0; // لا أيام دوام معرّفة: نبقى على اليوم
  }
  return { day: (today + offset) % 7, offset, relation: offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : 'later' };
}

/** نص مثل: «جدول اليوم» / «جدول الغد (الأحد)» / «جدول يوم الأحد» */
export function targetLabel(t: TargetDay): string {
  if (t.relation === 'today') return `اليوم · ${WEEKDAYS[t.day]}`;
  if (t.relation === 'tomorrow') return `غداً · ${WEEKDAYS[t.day]}`;
  return `يوم ${WEEKDAYS[t.day]} القادم`;
}

export type LessonState = 'done' | 'current' | 'next' | 'later';

/** حالة كل حصة في يوم الدوام الحالي (تُستعمل فقط إذا كان الهدف هو اليوم نفسه) */
export function lessonStates(items: Pick<ScheduleItem, 'start_time' | 'end_time'>[], now: Date): LessonState[] {
  const mins = now.getHours() * 60 + now.getMinutes();
  let nextMarked = false;
  return items.map((it) => {
    const s = minutesOf(it.start_time);
    const e = minutesOf(it.end_time) ?? (s !== null ? s + 45 : null);
    if (s === null || e === null) return 'later';
    if (mins >= e) return 'done';
    if (mins >= s) return 'current';
    if (!nextMarked) { nextMarked = true; return 'next'; }
    return 'later';
  });
}

/** أقرب موعد قادم في جدول امتحانات/مخصص: فهرس العنصر أو -1 (التاريخ اليوم أو بعده) */
export function nextDatedIndex(items: Pick<ScheduleItem, 'on_date'>[], now: Date): number {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let best = -1;
  items.forEach((it, i) => {
    if (!it.on_date || it.on_date < today) return;
    if (best < 0 || it.on_date < (items[best].on_date as string)) best = i;
  });
  return best;
}

/** كم يوماً حتى تاريخ YYYY-MM-DD (٠ اليوم، سالب = مضى) */
export function daysUntil(date: string, now: Date): number {
  const [y, m, d] = date.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

/** يوم الأسبوع (٠–٦) لتاريخ YYYY-MM-DD */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
