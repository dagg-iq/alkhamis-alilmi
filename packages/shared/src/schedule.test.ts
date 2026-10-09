import { describe, expect, it } from 'vitest';
import { daysUntil, lessonStates, nextDatedIndex, parseScheduleSettings, targetLabel, targetSchoolDay, weekdayOf } from './schedule';

// ٢٠٢٦-١٠-١١ أحد، ١٢ اثنين، … ١٥ خميس، ١٦ جمعة، ١٧ سبت (شهر ١٠ = index 9)
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

describe('اليوم الذي يُبرز في الجدول', () => {
  it('الصباح الباكر في يوم دوام ← اليوم نفسه (الطالب في السابعة)', () => {
    const t = targetSchoolDay(at(12, 7));
    expect(t).toMatchObject({ day: 1, offset: 0, relation: 'today' });
  });
  it('قبل التاسعة بدقيقة ← اليوم، وفي التاسعة ← الغد', () => {
    expect(targetSchoolDay(at(12, 8, 59)).relation).toBe('today');
    expect(targetSchoolDay(at(12, 9, 0))).toMatchObject({ day: 2, offset: 1, relation: 'tomorrow' });
  });
  it('مساء الخميس ← الأحد القادم (يتخطى الجمعة والسبت)', () => {
    expect(targetSchoolDay(at(15, 18))).toMatchObject({ day: 0, offset: 3, relation: 'later' });
  });
  it('الجمعة والسبت ← الأحد حتى لو الساعة سابعة', () => {
    expect(targetSchoolDay(at(16, 7))).toMatchObject({ day: 0, offset: 2 });
    expect(targetSchoolDay(at(17, 7))).toMatchObject({ day: 0, offset: 1, relation: 'tomorrow' });
  });
  it('ساعة التحويل قابلة للتغيير', () => {
    const s = parseScheduleSettings({ switch_after: '13:00' });
    expect(targetSchoolDay(at(12, 12, 30), s).relation).toBe('today');
    expect(targetSchoolDay(at(12, 13, 0), s).relation).toBe('tomorrow');
  });
  it('إعدادات ناقصة أو خاطئة ترجع للافتراضي', () => {
    expect(parseScheduleSettings(null).school_days).toEqual([0, 1, 2, 3, 4]);
    expect(parseScheduleSettings({ school_days: [9, 'x'], switch_after: '99' }).switch_after).toBe('09:00');
  });
  it('نص الوصف', () => {
    expect(targetLabel(targetSchoolDay(at(12, 7)))).toBe('اليوم · الاثنين');
    expect(targetLabel(targetSchoolDay(at(12, 10)))).toBe('غداً · الثلاثاء');
    expect(targetLabel(targetSchoolDay(at(15, 10)))).toBe('يوم الأحد القادم');
  });
});

describe('حالة الحصص', () => {
  const items = [
    { start_time: '08:00', end_time: '08:45' },
    { start_time: '08:50', end_time: '09:35' },
    { start_time: '09:40', end_time: '10:25' },
  ];
  it('قبل الدوام: الأولى هي التالية', () => expect(lessonStates(items, at(12, 7, 30))).toEqual(['next', 'later', 'later']));
  it('أثناء الثانية', () => expect(lessonStates(items, at(12, 9, 0))).toEqual(['done', 'current', 'next']));
  it('بعد الدوام', () => expect(lessonStates(items, at(12, 11))).toEqual(['done', 'done', 'done']));
  it('بلا أوقات ← كلها لاحقاً', () => expect(lessonStates([{ start_time: null, end_time: null }], at(12, 9))).toEqual(['later']));
});

describe('جداول الامتحانات', () => {
  const items = [{ on_date: '2026-10-10' }, { on_date: '2026-10-14' }, { on_date: '2026-10-20' }, { on_date: null }];
  it('أقرب امتحان قادم (اليوم يُحسب)', () => {
    expect(nextDatedIndex(items, at(12, 10))).toBe(1);
    expect(nextDatedIndex(items, at(14, 10))).toBe(1);
    expect(nextDatedIndex(items, at(21, 10))).toBe(-1);
  });
  it('الأيام المتبقية ويوم الأسبوع', () => {
    expect(daysUntil('2026-10-14', at(12, 23))).toBe(2);
    expect(daysUntil('2026-10-11', at(12, 1))).toBe(-1);
    expect(weekdayOf('2026-10-14')).toBe(3);
  });
});
