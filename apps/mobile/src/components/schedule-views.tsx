import {
  WEEKDAYS, arDigits, dateParts, daysUntil, lessonStates, nextDatedIndex, weekdayOf,
  type LessonState, type Schedule, type ScheduleItem, type ScheduleSettings, type Subject, type TargetDay,
} from '@saey/shared';
import { View } from 'react-native';
import { fmtTime, itemName } from '@/lib/schedules';
import { shortSubject } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { Icon } from './icon';
import { T } from './ui';

export function timeRange(it: ScheduleItem): string {
  if (it.start_time && it.end_time) return `${fmtTime(it.start_time)} – ${fmtTime(it.end_time)}`;
  return fmtTime(it.start_time ?? it.end_time);
}

/** حصص يوم واحد، والحصة الجارية/التالية تُبرز إن كان اليوم هو اليوم الحالي */
export function DayLessons({ items, subjects, isToday, now }: { items: ScheduleItem[]; subjects: Subject[]; isToday: boolean; now: Date }) {
  const { c } = useTheme();
  const states: LessonState[] = isToday ? lessonStates(items, now) : items.map(() => 'later');
  if (!items.length) {
    return (
      <View style={{ alignItems: 'center', padding: 28, gap: 8, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
        <Icon name="calendar" size={30} color={c.ink3} />
        <T dim center>لا توجد حصص مسجلة لهذا اليوم</T>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {items.map((it, i) => {
        const st = states[i];
        const current = st === 'current';
        const next = st === 'next';
        const done = st === 'done';
        return (
          <View key={it.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 20,
            backgroundColor: current ? c.accent : c.card, borderWidth: 1, borderColor: current ? c.accent : next ? c.accent : c.line,
            opacity: done ? 0.5 : 1,
          }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: current ? 'rgba(255,255,255,0.2)' : c.soft }}>
              <T display size={20} color={current ? '#FFFFFF' : c.accent}>{arDigits(it.sort || i + 1)}</T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="bold" size={17} color={current ? '#FFFFFF' : c.ink} lines={1}>{itemName(it, subjects)}</T>
              <T size={13} color={current ? 'rgba(255,255,255,0.85)' : c.ink2} lines={1}>
                {[arDigits(timeRange(it)), it.teacher, it.place].filter(Boolean).join(' · ')}
              </T>
              {it.note ? <T size={12} color={current ? 'rgba(255,255,255,0.8)' : c.ink3} lines={2}>{it.note}</T> : null}
            </View>
            {current || next ? (
              <View style={{ paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: current ? '#FFFFFF' : c.soft }}>
                <T size={12} weight="bold" color={c.accent}>{current ? 'الآن' : 'التالية'}</T>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** الأسبوع كاملاً: صفوف الحصص × أعمدة الأيام، ويوم الدوام المبرز بلون مميز */
export function WeekGrid({ items, subjects, settings, target }: { items: ScheduleItem[]; subjects: Subject[]; settings: ScheduleSettings; target: TargetDay }) {
  const { c } = useTheme();
  const days = settings.school_days;
  const rows = Math.max(1, ...items.map((i) => i.sort || 0), ...days.map((d) => items.filter((i) => i.day === d).length));
  const cell = (d: number, r: number) => {
    const list = items.filter((i) => i.day === d);
    return list.find((i) => i.sort === r + 1) ?? list[r];
  };
  return (
    <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: c.line, backgroundColor: c.card }}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 28 }} />
        {days.map((d) => (
          <View key={d} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: d === target.day ? c.accent : c.soft }}>
            <T size={12} weight="bold" color={d === target.day ? '#FFFFFF' : c.softInk}>{WEEKDAYS[d]}</T>
          </View>
        ))}
      </View>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line }}>
          <View style={{ width: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: c.soft }}>
            <T size={12} weight="bold" color={c.softInk}>{arDigits(r + 1)}</T>
          </View>
          {days.map((d) => {
            const it = cell(d, r);
            return (
              <View key={d} style={{ flex: 1, minHeight: 52, padding: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: d === target.day ? `${c.accent}14` : 'transparent', borderRightWidth: 1, borderRightColor: c.line }}>
                {it ? <T size={11} weight="bold" center lines={2}>{shortSubject(itemName(it, subjects))}</T> : <T size={11} dim>—</T>}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** جدول بتواريخ (امتحانات أو مخصص): الأقرب القادم يُبرز، وما مضى يخفت */
export function DatedList({ items, subjects, now }: { items: ScheduleItem[]; subjects: Subject[]; now: Date }) {
  const { c } = useTheme();
  const next = nextDatedIndex(items, now);
  return (
    <View style={{ gap: 10 }}>
      {items.map((it, i) => {
        const hot = i === next;
        const left = it.on_date ? daysUntil(it.on_date, now) : null;
        const past = left !== null && left < 0;
        const dp = it.on_date ? dateParts(it.on_date) : null;
        return (
          <View key={it.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 20,
            backgroundColor: hot ? c.accent : c.card, borderWidth: 1, borderColor: hot ? c.accent : c.line, opacity: past ? 0.5 : 1,
          }}>
            {it.on_date ? (
              <View style={{ minWidth: 74, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 14, alignItems: 'center', backgroundColor: hot ? 'rgba(255,255,255,0.2)' : c.soft }}>
                <T display size={24} color={hot ? '#FFFFFF' : c.accent} style={{ lineHeight: 30 }}>{arDigits(dp!.dm)}</T>
                <T size={12} weight="bold" color={hot ? 'rgba(255,255,255,0.9)' : c.softInk}>{arDigits(dp!.year)}</T>
              </View>
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.soft }}>
                <T display size={20} color={c.accent}>{arDigits(i + 1)}</T>
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="bold" size={17} color={hot ? '#FFFFFF' : c.ink} lines={2}>{itemName(it, subjects)}</T>
              <T size={13} color={hot ? 'rgba(255,255,255,0.85)' : c.ink2} lines={1}>
                {[it.on_date ? WEEKDAYS[weekdayOf(it.on_date)] : null, arDigits(timeRange(it)) || null, it.place, it.teacher].filter(Boolean).join(' · ')}
              </T>
              {it.note ? <T size={12} color={hot ? 'rgba(255,255,255,0.8)' : c.ink3} lines={2}>{it.note}</T> : null}
            </View>
            {left !== null && !past ? (
              <View style={{ paddingHorizontal: 10, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: hot ? '#FFFFFF' : c.soft }}>
                <T size={12} weight="bold" color={c.accent}>{left === 0 ? 'اليوم' : left === 1 ? 'غداً' : `بعد ${arDigits(left)} أيام`}</T>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export const kindIcon = (k: Schedule['kind']) => (k === 'weekly' ? 'calendar' : k === 'exam' ? 'quiz' : 'list') as 'calendar' | 'quiz' | 'list';
