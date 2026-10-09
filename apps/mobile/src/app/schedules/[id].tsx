import { WEEKDAYS, arDigits, nextDatedIndex, targetLabel, targetSchoolDay } from '@saey/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/icon';
import { PressScale } from '@/components/motion';
import { DatedList, DayLessons, WeekGrid, kindIcon } from '@/components/schedule-views';
import { Card, ErrorBox, Header, Loading, Screen, Segmented, T } from '@/components/ui';
import { loadSchedule, useScheduleSettings } from '@/lib/schedules';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

/** الوقت الحالي يتجدد كل دقيقة ليتبدل اليوم المبرز والحصة الجارية وحدهما */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function ScheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const settings = useScheduleSettings();
  const now = useNow();
  const q = useLoad(() => loadSchedule(id), [id]);
  const [picked, setPicked] = useState<number | null>(null);
  const [view, setView] = useState<'day' | 'week'>('day');

  const target = useMemo(() => targetSchoolDay(now, settings), [now, settings]);

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? 'الجدول غير متاح'} onRetry={q.reload} /></Screen>;
  const { schedule, items, subjects } = q.data;
  const weekly = schedule.kind === 'weekly';
  const day = picked ?? target.day;
  const hot = !weekly ? nextDatedIndex(items, now) : -1;

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header title={schedule.title} subtitle={schedule.subtitle ?? undefined} />

      {weekly ? (
        <>
          {/* اليوم الذكي: اليوم إن كان الصباح الباكر، وإلا يوم الدوام التالي */}
          <Card tone="hero" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" size={26} color={c.heroInk} />
            </View>
            <View style={{ flex: 1 }}>
              <T size={13} color={c.heroInk2}>{target.relation === 'today' ? 'الدوام اليوم' : 'الدوام القادم'}</T>
              <T display size={26} color={c.heroInk}>{targetLabel(target)}</T>
              <T size={13} color={c.heroInk2}>{arDigits(items.filter((i) => i.day === target.day).length)} حصص</T>
            </View>
          </Card>

          <Segmented options={[{ key: 'day', label: 'حسب اليوم' }, { key: 'week', label: 'الأسبوع كاملاً' }]} value={view} onChange={setView} />

          {view === 'week' ? (
            <WeekGrid items={items} subjects={subjects} settings={settings} target={target} />
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {settings.school_days.map((d) => {
                  const isTarget = d === target.day;
                  const selected = d === day;
                  return (
                    <PressScale key={d} onPress={() => setPicked(d)} scaleTo={0.94} accessibilityRole="button" accessibilityLabel={WEEKDAYS[d]}
                      style={{
                        flex: 1, minHeight: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 2,
                        backgroundColor: isTarget ? c.accent : c.card, borderWidth: selected && !isTarget ? 2 : 1,
                        borderColor: isTarget ? c.accent : selected ? c.accent : c.line,
                      }}>
                      <T size={13} weight="bold" color={isTarget ? '#FFFFFF' : selected ? c.accent : c.ink}>{WEEKDAYS[d]}</T>
                      <T size={11} color={isTarget ? 'rgba(255,255,255,0.9)' : c.ink3}>
                        {isTarget ? (target.relation === 'today' ? 'اليوم' : target.relation === 'tomorrow' ? 'غداً' : 'القادم') : `${arDigits(items.filter((i) => i.day === d).length)} حصص`}
                      </T>
                    </PressScale>
                  );
                })}
              </View>
              <DayLessons items={items.filter((i) => i.day === day)} subjects={subjects} isToday={day === target.day && target.relation === 'today'} now={now} />
            </>
          )}
        </>
      ) : (
        <>
          {hot >= 0 ? (
            <Card tone="hero" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 }}>
              <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={kindIcon(schedule.kind)} size={26} color={c.heroInk} />
              </View>
              <View style={{ flex: 1 }}>
                <T size={13} color={c.heroInk2}>الأقرب</T>
                <T display size={22} color={c.heroInk} lines={1}>{items[hot].title || subjects.find((s) => s.id === items[hot].subject_id)?.name || 'موعد'}</T>
              </View>
            </Card>
          ) : null}
          {items.length ? <DatedList items={items} subjects={subjects} now={now} /> : <T dim center>لا توجد مواعيد في هذا الجدول بعد</T>}
        </>
      )}
    </Screen>
  );
}
