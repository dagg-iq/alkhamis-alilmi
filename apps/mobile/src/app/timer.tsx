import { arDigits, type Subject } from '@saey/shared';
import { useKeepAwake } from 'expo-keep-awake';
import * as IntentLauncher from 'expo-intent-launcher';
import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, ScrollView, StatusBar, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Icon, type IconName } from '@/components/icon';
import { PressScale, tap } from '@/components/motion';
import { Sheet } from '@/components/sheet';
import { Card, Chip, Header, IconButton, ProgressBar, Row, Screen, Segmented, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { hideLiveTimer, showLiveTimer } from '@/lib/live-timer';
import { cancelReminder, notificationsAllowed, scheduleAlarm } from '@/lib/push';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import {
  DEFAULT_SETTINGS, dayKey, freshState, loadTimer, nextMode, saveTimer, saveTimerSettings, streakOf,
  type TimerMode, type TimerSettings, type TimerState,
} from '@/lib/timer';
import { useLoad } from '@/lib/use-load';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const DAYS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
const FOCUS_CHOICES = [25, 45, 50, 60, 90];
const BREAK_GREEN = '#12805C';
const MIN_PARTIAL = 5; // أقل مدة (دقائق) تُسجَّل عند إنهاء جلسة تركيز مبكراً
const LABELS: Record<TimerMode, string> = { focus: 'تركيز', short: 'استراحة قصيرة', long: 'استراحة طويلة' };
const LIVE: Record<TimerMode, string> = { focus: 'جلسة تركيز', short: 'استراحة قصيرة', long: 'استراحة طويلة' };
const ALARM: Record<TimerMode, [string, string]> = {
  focus: ['انتهت جلسة التركيز', 'أحسنت! خذ استراحة الآن.'],
  short: ['انتهت الاستراحة', 'هيا نرجع للدراسة.'],
  long: ['انتهت الاستراحة الطويلة', 'جاهز لدورة جديدة؟'],
};

type Session = { started_at: string; minutes: number; subject_id: string | null };

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${arDigits(String(m).padStart(2, '0'))}:${arDigits(String(s).padStart(2, '0'))}`;
}
function hm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${arDigits(m)} د`;
  return m ? `${arDigits(h)} س ${arDigits(m)} د` : `${arDigits(h)} س`;
}

export default function Timer() {
  const { c } = useTheme();
  const me = useMe();
  const { width } = useWindowDimensions();
  const [settings, setSettings] = useState<TimerSettings>(DEFAULT_SETTINGS);
  const [st, setSt] = useState<TimerState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [full, setFull] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const stRef = useRef<TimerState | null>(null);
  const subjects = useLoad(loadSubjects);
  const sessions = useLoad(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 60);
    since.setHours(0, 0, 0, 0); // ثابت طوال اليوم (يطابق المحفوظ بلا إنترنت)
    return must(supabase.from('study_sessions').select('started_at, minutes, subject_id')
      .gte('started_at', since.toISOString()).order('started_at', { ascending: false })) as Promise<Session[]>;
  });

  const subjectLabel = (id: string | null) => {
    const sub = (subjects.data ?? []).find((x: Subject) => x.id === id);
    return sub ? `${shortSubject(sub.name)} · سعي` : 'سعي';
  };

  const commit = (next: TimerState) => {
    stRef.current = next;
    setSt(next);
    saveTimer(next);
    // إشعار العد التنازلي في الستارة يتبع حالة المؤقت
    if (next.endsAt) showLiveTimer(LIVE[next.mode], subjectLabel(next.subjectId), next.endsAt, next.mode === 'focus' ? '#2346F5' : BREAK_GREEN);
    else hideLiveTimer();
  };

  const record = (minutes: number, subjectId: string | null) => {
    const m = Math.min(600, Math.round(minutes));
    if (m < 1) return;
    supabase.from('study_sessions').insert({
      user_id: me.id, subject_id: subjectId, minutes: m, started_at: new Date(Date.now() - m * 60000).toISOString(),
    }).then(() => sessions.reload());
  };

  const startWith = async (base: TimerState) => {
    const endsAt = Date.now() + base.left * 1000;
    const running = { ...base, endsAt, notifId: null };
    commit(running);
    setNow(Date.now());
    const [title, body] = ALARM[base.mode];
    const id = await scheduleAlarm(title, body, new Date(endsAt));
    // قد يكون الطالب أوقفه قبل أن يُجدول المنبّه
    if (stRef.current?.endsAt === endsAt) commit({ ...stRef.current, notifId: id });
    else if (id) cancelReminder(id);
  };

  /** انتهت الجلسة: نسجل وقت التركيز وننتقل للتالية. live = انتهت والشاشة مفتوحة */
  const complete = (cur: TimerState, s: TimerSettings, live: boolean) => {
    if (cur.mode === 'focus') record(cur.total / 60, cur.subjectId);
    const { mode, done } = nextMode(cur, s);
    const next = freshState(s, mode, { subjectId: cur.subjectId, done });
    if (live) tap('success');
    if (live && s.autoNext) startWith(next);
    else commit(next);
  };

  // التحميل: لو انتهى الوقت والتطبيق مغلق نكمل الجلسة الآن
  useEffect(() => {
    let alive = true;
    loadTimer().then(({ settings: s, state }) => {
      if (!alive) return;
      setSettings(s);
      if (state.endsAt && state.endsAt <= Date.now()) complete(state, s, false);
      else commit(state);
    });
    notificationsAllowed().then(setAllowed);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = !!st?.endsAt;
  const remaining = st ? (st.endsAt ? Math.max(0, Math.ceil((st.endsAt - now) / 1000)) : st.left) : settings.focus * 60;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    const sub = AppState.addEventListener('change', (a) => { if (a === 'active') setNow(Date.now()); });
    return () => { clearInterval(t); sub.remove(); };
  }, [running]);

  useEffect(() => {
    if (st?.endsAt && remaining === 0) {
      // تأخر أكثر من ثوانٍ = انتهت والتطبيق في الخلفية؛ لا نبدأ التالية تلقائياً بوقت متأخر
      complete(st, settings, Date.now() - st.endsAt < 5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, st?.endsAt]);

  // الحلقة تتحرك بسلاسة على خيط الرسوم بدل القفز كل ثانية
  const total = st?.total ?? settings.focus * 60;
  const progress = useSharedValue(1);
  useEffect(() => {
    if (!st) return;
    cancelAnimation(progress);
    if (st.endsAt) {
      const ms = Math.max(0, st.endsAt - Date.now());
      progress.value = ms / 1000 / st.total;
      progress.value = withTiming(0, { duration: ms, easing: Easing.linear });
    } else {
      progress.value = withTiming(st.left / st.total, { duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.endsAt, st?.left, st?.total]);

  const start = () => { if (st) startWith(st); };
  const pause = () => {
    if (!st) return;
    if (st.notifId) cancelReminder(st.notifId);
    commit({ ...st, endsAt: null, left: remaining, notifId: null });
  };
  const reset = () => {
    if (!st) return;
    if (st.notifId) cancelReminder(st.notifId);
    commit({ ...st, endsAt: null, left: st.total, notifId: null });
  };
  const skip = () => {
    if (!st) return;
    if (st.notifId) cancelReminder(st.notifId);
    const studied = (st.total - remaining) / 60;
    if (st.mode === 'focus' && studied >= MIN_PARTIAL) record(studied, st.subjectId);
    const { mode, done } = nextMode(st, settings);
    commit(freshState(settings, mode, { subjectId: st.subjectId, done: st.mode === 'focus' && studied < MIN_PARTIAL ? st.done : done }));
  };
  const switchMode = (m: TimerMode) => {
    if (!st || running) return;
    commit(freshState(settings, m, { subjectId: st.subjectId, done: st.done }));
  };
  const updateSettings = (s: TimerSettings) => {
    setSettings(s);
    saveTimerSettings(s);
    // جلسة لم تبدأ بعد تأخذ المدة الجديدة
    if (st && !running && st.left === st.total) commit(freshState(s, st.mode, { subjectId: st.subjectId, done: st.done }));
  };

  // ---------------------------------------------------------------- الإحصاءات
  const list = sessions.data ?? [];
  const todayKey = dayKey(new Date());
  const days = new Set(list.map((x) => dayKey(new Date(x.started_at))));
  const todayMin = list.filter((x) => dayKey(new Date(x.started_at)) === todayKey).reduce((a, x) => a + x.minutes, 0);
  const todayCount = list.filter((x) => dayKey(new Date(x.started_at)) === todayKey).length;
  const streak = streakOf(days);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const k = dayKey(d);
    return { k, day: d.getDay(), minutes: list.filter((x) => dayKey(new Date(x.started_at)) === k).reduce((a, x) => a + x.minutes, 0) };
  });
  const weekTotal = week.reduce((a, d) => a + d.minutes, 0);
  const maxMin = Math.max(60, ...week.map((d) => d.minutes));
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const bySubject = new Map<string | null, number>();
  list.filter((x) => new Date(x.started_at) >= weekStart).forEach((x) => bySubject.set(x.subject_id, (bySubject.get(x.subject_id) ?? 0) + x.minutes));
  const subjectRows = [...bySubject.entries()].sort((a, b) => b[1] - a[1]);
  const subjectName = (id: string | null) => {
    const s = (subjects.data ?? []).find((x: Subject) => x.id === id);
    return s ? shortSubject(s.name) : 'بدون مادة';
  };

  const mode = st?.mode ?? 'focus';
  const color = mode === 'focus' ? c.accent : BREAK_GREEN;
  const size = Math.min(300, width - 64);

  return (
    <Screen>
      <Header title="مؤقت الدراسة" right={<IconButton name="settings" label="إعدادات المؤقت" onPress={() => setShowSettings(true)} />} />

      <Segmented
        options={[{ key: 'focus', label: 'تركيز' }, { key: 'short', label: 'استراحة' }, { key: 'long', label: 'استراحة طويلة' }]}
        value={mode} onChange={switchMode} />

      <Ring size={size} color={color} track={c.line} progress={progress}>
        <T dim size={14}>{LABELS[mode]}</T>
        <T display size={size * 0.22} style={{ letterSpacing: 1 }}>{clock(remaining)}</T>
        <CycleDots done={st?.done ?? 0} of={settings.longEvery} color={color} track={c.line} />
        {mode === 'focus' && st?.subjectId ? <T dim size={13}>{subjectName(st.subjectId)}</T> : null}
      </Ring>

      {/* أزرار التحكم */}
      <Row gap={22} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <RoundButton icon="refresh" label="إعادة" onPress={reset} />
        <PressScale onPress={running ? pause : start} haptic accessibilityRole="button" accessibilityLabel={running ? 'إيقاف مؤقت' : 'ابدأ'}
          style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          {running ? <PauseGlyph color="#FFFFFF" /> : <Icon name="play" size={34} color="#FFFFFF" fill="#FFFFFF" />}
        </PressScale>
        <RoundButton icon="forward" label={mode === 'focus' ? 'إنهاء' : 'تخطّي'} onPress={skip} />
      </Row>
      {running && mode === 'focus' ? (
        <PressScale onPress={() => setFull(true)} accessibilityRole="button" accessibilityLabel="وضع التركيز" style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
          <Icon name="target" size={18} color={c.ink2} />
          <T weight="bold" size={14} color={c.ink2}>وضع التركيز بملء الشاشة</T>
        </PressScale>
      ) : null}

      {/* اختيار المدة والمادة قبل البدء */}
      {mode === 'focus' && !running ? (
        <View style={{ gap: 10 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {FOCUS_CHOICES.map((m) => (
              <Chip small key={m} label={`${arDigits(m)} دقيقة`} active={settings.focus === m} onPress={() => updateSettings({ ...settings, focus: m })} />
            ))}
            {!FOCUS_CHOICES.includes(settings.focus) ? <Chip small label={`${arDigits(settings.focus)} دقيقة`} active onPress={() => setShowSettings(true)} /> : null}
            <Chip small label="مدة أخرى" onPress={() => setShowSettings(true)} />
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip small label="بدون مادة" active={!st?.subjectId} onPress={() => st && commit({ ...st, subjectId: null })} />
            {(subjects.data ?? []).map((s: Subject) => (
              <Chip small key={s.id} label={shortSubject(s.name)} active={st?.subjectId === s.id} onPress={() => st && commit({ ...st, subjectId: s.id })} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {allowed === false ? (
        <Card tone="soft" style={{ gap: 6 }}>
          <T weight="bold">الإشعارات مطفأة</T>
          <T dim size={14}>لن يرنّ المؤقت والتطبيق مغلق. فعّل إشعارات سعي من إعدادات الهاتف.</T>
          <PressScale onPress={() => IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, { data: 'package:com.saey.app' }).catch(() => {})}>
            <T weight="bold" size={14} color={c.accent}>فتح الإعدادات</T>
          </PressScale>
        </Card>
      ) : null}

      {/* اليوم */}
      <Card style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ gap: 2 }}>
            <T dim size={13}>دراسة اليوم</T>
            <T display size={30}>{hm(todayMin)}</T>
          </View>
          <T dim size={13}>الهدف {hm(settings.dailyGoal)}</T>
        </Row>
        <ProgressBar value={Math.min(1, todayMin / Math.max(1, settings.dailyGoal))} color={todayMin >= settings.dailyGoal ? BREAK_GREEN : c.accent} track={c.line} height={8} />
        <Row gap={10}>
          <Stat label="جلسات اليوم" value={arDigits(todayCount)} />
          <Stat label="أيام متتالية" value={arDigits(streak)} />
          <Stat label="هذا الأسبوع" value={hm(weekTotal)} />
        </Row>
      </Card>

      {/* الأسبوع */}
      <Card style={{ gap: 12 }}>
        <T weight="bold">آخر ٧ أيام</T>
        <Row style={{ alignItems: 'flex-end', height: 120, justifyContent: 'space-between' }} gap={6}>
          {week.map((d) => (
            <View key={d.k} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              {d.minutes ? <T dim size={10}>{arDigits(d.minutes)}</T> : null}
              <View style={{ width: '70%', height: Math.max(6, (d.minutes / maxMin) * 80), borderRadius: 8, backgroundColor: d.k === todayKey ? c.accent : d.minutes ? c.ink : c.line }} />
              <T dim size={11}>{DAYS[d.day]}</T>
            </View>
          ))}
        </Row>
        {subjectRows.length ? (
          <View style={{ gap: 10, marginTop: 4 }}>
            {subjectRows.map(([id, min]) => (
              <View key={id ?? 'none'} style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T size={14}>{subjectName(id)}</T>
                  <T dim size={13}>{hm(min)}</T>
                </Row>
                <ProgressBar value={min / Math.max(1, subjectRows[0][1])} color={c.ink} track={c.line} />
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {Platform.OS === 'android' ? (
        <PressScale onPress={() => IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(() => {})}
          style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 }}>
          <Icon name="info" size={18} color={c.ink2} />
          <T dim size={13} style={{ flex: 1 }}>لم يرنّ والتطبيق مغلق؟ بعض الهواتف (شاومي، هواوي…) توقف التطبيقات لتوفير البطارية. اضغط هنا واختر «سعي» ثم «بلا قيود».</T>
        </PressScale>
      ) : null}

      <TimerSettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} value={settings} onChange={updateSettings} />
      {full && running ? (
        <FocusMode remaining={remaining} total={total} subject={st?.subjectId ? subjectName(st.subjectId) : null}
          onPause={() => { pause(); setFull(false); }} onClose={() => setFull(false)} />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- أجزاء الشاشة
function Ring({ size, color, track, progress, children }: {
  size: number; color: string; track: string; progress: { value: number }; children: React.ReactNode;
}) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const props = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - progress.value) }));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', marginVertical: 8 }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ} ${circ}`} animatedProps={props} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', gap: 2 }}>{children}</View>
    </View>
  );
}

function CycleDots({ done, of, color, track }: { done: number; of: number; color: string; track: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }} accessibilityLabel={`أكملت ${arDigits(done)} من ${arDigits(of)} جلسات`}>
      {Array.from({ length: of }, (_, i) => (
        <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < done ? color : track }} />
      ))}
    </View>
  );
}

function PauseGlyph({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ width: 8, height: 28, borderRadius: 3, backgroundColor: color }} />
      <View style={{ width: 8, height: 28, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <PressScale onPress={onPress} haptic accessibilityRole="button" accessibilityLabel={label}
        style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={c.ink} />
      </PressScale>
      <T dim size={12}>{label}</T>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.soft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', gap: 2 }}>
      <T weight="bold" size={16}>{value}</T>
      <T dim size={11}>{label}</T>
    </View>
  );
}

function StepRow({ label, value, unit, min, max, step = 1, onChange }: {
  label: string; value: number; unit: string; min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  const { c } = useTheme();
  const btn = (icon: IconName, next: number, a11y: string) => (
    <PressScale onPress={() => onChange(Math.max(min, Math.min(max, next)))} haptic accessibilityLabel={a11y}
      style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={18} color={c.ink} />
    </PressScale>
  );
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 }}>
      <T weight="medium" size={15} style={{ flex: 1 }}>{label}</T>
      <Row gap={10} style={{ alignItems: 'center' }}>
        {btn('plus', value + step, `زيادة ${label}`)}
        <T weight="bold" size={15} style={{ minWidth: 64, textAlign: 'center' }}>{arDigits(value)} {unit}</T>
        {btn('minus', value - step, `إنقاص ${label}`)}
      </Row>
    </Row>
  );
}

function TimerSettingsSheet({ visible, onClose, value, onChange }: {
  visible: boolean; onClose: () => void; value: TimerSettings; onChange: (s: TimerSettings) => void;
}) {
  const set = (k: keyof TimerSettings, v: number | boolean) => onChange({ ...value, [k]: v });
  return (
    <Sheet visible={visible} onClose={onClose}>
      <T weight="bold" size={18} style={{ marginBottom: 4 }}>إعدادات المؤقت</T>
      <StepRow label="التركيز" value={value.focus} unit="د" min={5} max={180} step={5} onChange={(v) => set('focus', v)} />
      <StepRow label="الاستراحة" value={value.short} unit="د" min={1} max={30} onChange={(v) => set('short', v)} />
      <StepRow label="الاستراحة الطويلة" value={value.long} unit="د" min={5} max={60} step={5} onChange={(v) => set('long', v)} />
      <StepRow label="استراحة طويلة كل" value={value.longEvery} unit="جلسات" min={2} max={8} onChange={(v) => set('longEvery', v)} />
      <StepRow label="هدف اليوم" value={value.dailyGoal} unit="د" min={15} max={600} step={15} onChange={(v) => set('dailyGoal', v)} />
      <View style={{ gap: 8, paddingTop: 8 }}>
        <T weight="medium" size={15}>بدء الجلسة التالية تلقائياً</T>
        <Segmented options={[{ key: 'on', label: 'نعم' }, { key: 'off', label: 'لا' }]} value={value.autoNext ? 'on' : 'off'} onChange={(k) => set('autoNext', k === 'on')} />
      </View>
    </Sheet>
  );
}

/** وضع التركيز: شاشة داكنة كاملة، الأرقام كبيرة، والشاشة لا تنطفئ */
function FocusMode({ remaining, total, subject, onPause, onClose }: {
  remaining: number; total: number; subject: string | null; onPause: () => void; onClose: () => void;
}) {
  useKeepAwake('saey-focus');
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const done = 1 - remaining / total;
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: '#0B0B0C', alignItems: 'center', justifyContent: 'center', gap: 18, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <PressScale onPress={onClose} accessibilityLabel="خروج من وضع التركيز"
          style={{ position: 'absolute', top: insets.top + 12, left: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={22} color="#FFFFFF" />
        </PressScale>
        <T size={16} color="rgba(255,255,255,0.55)">{subject ?? 'وقت التركيز'}</T>
        <T display size={Math.min(120, width * 0.26)} color="#FFFFFF" style={{ letterSpacing: 2 }}>{clock(remaining)}</T>
        <View style={{ width: Math.min(320, width - 80), height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <View style={{ width: `${done * 100}%`, height: 4, backgroundColor: '#FFFFFF' }} />
        </View>
        <PressScale onPress={onPause} haptic accessibilityLabel="إيقاف مؤقت"
          style={{ marginTop: 24, height: 52, paddingHorizontal: 28, borderRadius: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 5 }}>
            <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
            <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
          </View>
          <T weight="bold" size={15} color="#FFFFFF">إيقاف مؤقت</T>
        </PressScale>
        <T size={12} color="rgba(255,255,255,0.35)" style={{ position: 'absolute', bottom: insets.bottom + 20 }}>الشاشة ستبقى مضاءة · سيرنّ المنبّه عند الانتهاء</T>
      </View>
    </Modal>
  );
}
