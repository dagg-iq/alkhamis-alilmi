import { arDigits, type Subject } from '@saey/shared';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Button, Card, Chip, Header, Row, Screen, Segmented, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { cancelReminder, scheduleReminder } from '@/lib/push';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

const PRESETS = { focus: 25, short: 5, long: 15 } as const;
type Mode = keyof typeof PRESETS;
const DAYS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

export default function Timer() {
  const { c } = useTheme();
  const me = useMe();
  const [mode, setMode] = useState<Mode>('focus');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(PRESETS.focus * 60);
  const [now, setNow] = useState(Date.now());
  const reminder = useRef<string | null>(null);
  const subjects = useLoad(loadSubjects);
  const week = useLoad(async () => must(supabase.rpc('my_study_week')) as Promise<{ day: string; minutes: number }[]>);

  const total = PRESETS[mode] * 60;
  const remaining = endsAt ? Math.max(0, Math.round((endsAt - now) / 1000)) : left;

  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [endsAt]);

  // انتهاء الجلسة
  useEffect(() => {
    if (endsAt && remaining === 0) {
      setEndsAt(null);
      setLeft(total);
      reminder.current = null;
      if (mode === 'focus') {
        supabase.from('study_sessions').insert({ user_id: me.id, subject_id: subjectId, minutes: PRESETS.focus, started_at: new Date(Date.now() - total * 1000).toISOString() })
          .then(() => week.reload());
        setMode('short');
        setLeft(PRESETS.short * 60);
      } else {
        setMode('focus');
        setLeft(PRESETS.focus * 60);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, endsAt]);

  const start = async () => {
    const end = Date.now() + remaining * 1000;
    setEndsAt(end);
    setNow(Date.now());
    reminder.current = await scheduleReminder(mode === 'focus' ? 'انتهت جلسة التركيز 🎉' : 'انتهت الاستراحة', mode === 'focus' ? 'خذ استراحة قصيرة.' : 'هيا نكمل الدراسة!', new Date(end));
  };
  const pause = () => {
    setLeft(remaining);
    setEndsAt(null);
    if (reminder.current) cancelReminder(reminder.current);
  };
  const reset = () => {
    pause();
    setLeft(total);
  };
  const switchMode = (m: Mode) => {
    if (endsAt) return;
    setMode(m);
    setLeft(PRESETS[m] * 60);
  };

  const mm = arDigits(String(Math.floor(remaining / 60)).padStart(2, '0'));
  const ss = arDigits(String(remaining % 60).padStart(2, '0'));
  const size = 260;
  const r = 118;
  const circ = 2 * Math.PI * r;
  const frac = remaining / total;
  const data = week.data ?? [];
  const maxMin = Math.max(60, ...data.map((d) => d.minutes));
  const weekTotal = data.reduce((a, d) => a + d.minutes, 0);

  return (
    <Screen>
      <Header title="مؤقت الدراسة" />
      <Segmented options={[{ key: 'focus', label: 'تركيز ٢٥' }, { key: 'short', label: 'استراحة ٥' }, { key: 'long', label: 'استراحة ١٥' }]} value={mode} onChange={switchMode} />
      <View style={{ alignItems: 'center', justifyContent: 'center', marginVertical: 8 }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.line} strokeWidth={10} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={mode === 'focus' ? c.accent : '#12805C'} strokeWidth={10} fill="none"
            strokeDasharray={`${circ} ${circ}`} strokeDashoffset={circ * (1 - frac)} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </Svg>
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <T display size={60}>{mm}:{ss}</T>
          <T dim>{mode === 'focus' ? 'وقت التركيز' : 'استراحة'}</T>
        </View>
      </View>
      {mode === 'focus' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip small label="بدون مادة" active={!subjectId} onPress={() => setSubjectId(null)} />
          {(subjects.data ?? []).map((s: Subject) => <Chip small key={s.id} label={shortSubject(s.name)} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
        </ScrollView>
      ) : null}
      <Row gap={10}>
        <Button style={{ flex: 1 }} title={endsAt ? 'إيقاف مؤقت' : 'ابدأ'} onPress={endsAt ? pause : start} variant={endsAt ? 'secondary' : 'primary'} />
        <Button title="إعادة" variant="ghost" onPress={reset} />
      </Row>

      <Card style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T weight="bold">هذا الأسبوع</T>
          <T dim>{arDigits(Math.floor(weekTotal / 60))} س {arDigits(weekTotal % 60)} د</T>
        </Row>
        <Row style={{ alignItems: 'flex-end', height: 110, justifyContent: 'space-between' }} gap={6}>
          {data.map((d) => (
            <View key={d.day} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <View style={{ width: '70%', height: Math.max(6, (d.minutes / maxMin) * 80), borderRadius: 8, backgroundColor: d.minutes ? c.ink : c.line }} />
              <T dim size={11}>{DAYS[new Date(d.day).getDay()]}</T>
            </View>
          ))}
        </Row>
      </Card>
    </Screen>
  );
}
