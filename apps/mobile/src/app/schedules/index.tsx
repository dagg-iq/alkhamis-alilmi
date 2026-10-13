import {
  SCHEDULE_KIND_LABELS, WEEKDAYS, arDigits, daysUntil, nextDatedIndex, targetLabel, targetSchoolDay,
  type Schedule, type ScheduleKind,
} from '@saey/shared';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Icon } from '@/components/icon';
import { kindIcon } from '@/components/schedule-views';
import { Card, Empty, ErrorBox, Header, Loading, Screen, SectionTitle, T } from '@/components/ui';
import { loadSchedules, useScheduleSettings } from '@/lib/schedules';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

const GROUPS: { kind: ScheduleKind; title: string }[] = [
  { kind: 'weekly', title: 'جداول الحصص' },
  { kind: 'exam', title: 'جداول الامتحانات' },
  { kind: 'custom', title: 'جداول أخرى' },
];

export default function Schedules() {
  const { c } = useTheme();
  const settings = useScheduleSettings();
  const q = useLoad(loadSchedules, [], { key: 'schedules' });
  const now = new Date();
  const target = targetSchoolDay(now, settings);

  if (q.loading) return <Screen><Header title="الجداول" /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header title="الجداول" /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const { schedules, items } = q.data;

  const meta = (s: Schedule): string => {
    const mine = items.filter((i) => i.schedule_id === s.id);
    if (s.kind === 'weekly') {
      const lessons = mine.filter((i) => i.day === target.day).length;
      return `${targetLabel(target)} · ${arDigits(lessons)} حصص`;
    }
    const dated = mine.filter((i) => i.on_date);
    const n = nextDatedIndex(dated, now);
    if (n >= 0) {
      const left = daysUntil(dated[n].on_date as string, now);
      return `${arDigits(mine.length)} موعد · القادم ${left === 0 ? 'اليوم' : left === 1 ? 'غداً' : `بعد ${arDigits(left)} أيام`}`;
    }
    return `${arDigits(mine.length)} موعد`;
  };

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header title="الجداول" subtitle="الحصص والامتحانات وكل ما تنشره الإدارة" />
      {!schedules.length ? <Empty icon="calendar" title="لا توجد جداول بعد" body="ستظهر هنا جداول الحصص والامتحانات عندما تنشرها الإدارة." /> : null}
      {GROUPS.map((g) => {
        const list = schedules.filter((s) => s.kind === g.kind);
        if (!list.length) return null;
        return (
          <View key={g.kind} style={{ gap: 10 }}>
            <SectionTitle title={g.title} />
            {list.map((s, i) => (
              <Card key={s.id} onPress={() => router.push(`/schedules/${s.id}`)}
                tone={g.kind === 'weekly' && i === 0 ? 'hero' : 'card'} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {(() => {
                  const hero = g.kind === 'weekly' && i === 0;
                  return (
                    <>
                      <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: hero ? 'rgba(255,255,255,0.16)' : c.soft }}>
                        <Icon name={kindIcon(s.kind)} size={24} color={hero ? c.heroInk : c.accent} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T weight="bold" size={17} lines={1} color={hero ? c.heroInk : c.ink}>{s.title}</T>
                        <T size={13} lines={1} color={hero ? c.heroInk2 : c.ink2}>{s.subtitle || SCHEDULE_KIND_LABELS[s.kind]}</T>
                        <T size={12} weight="bold" lines={1} color={hero ? c.heroInk : c.accent}>{meta(s)}</T>
                      </View>
                      <Icon name="forward" size={18} color={hero ? c.heroInk2 : c.ink3} />
                    </>
                  );
                })()}
              </Card>
            ))}
          </View>
        );
      })}
      <T dim size={12} center>أيام الدوام: {settings.school_days.map((d) => WEEKDAYS[d]).join('، ')}</T>
    </Screen>
  );
}
