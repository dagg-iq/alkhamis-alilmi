import { PERIOD_LABELS, PERIODS, arDigits, parseNumber, type Period, type Subject } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Button, ChipRow, Header, Loading, Screen, T } from '@/components/ui';
import { tap } from '@/components/motion';
import { useMe } from '@/lib/auth';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { useGradingRules } from '@/lib/settings';
import { useLoad } from '@/lib/use-load';

/**
 * إدخال الدرجات: تختار الامتحان (الشهر الأول مثلاً) ثم تكتب درجة كل مادة في قائمة واحدة.
 * من صفحة المادة يفتح على امتحان تلك المادة ويضع المؤشر في حقلها مباشرة.
 */
export default function EditGrades() {
  const params = useLocalSearchParams<{ subjectId?: string; period?: Period }>();
  const { c, verdict } = useTheme();
  const me = useMe();
  const rules = useGradingRules();
  const [period, setPeriod] = useState<Period>(params.period ?? 'month1');
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loadingPeriod, setLoadingPeriod] = useState(true);
  const [busy, setBusy] = useState(false);
  const subjects = useLoad(loadSubjects);
  const inputs = useRef<Record<string, TextInput | null>>({});

  useEffect(() => {
    let alive = true;
    setLoadingPeriod(true);
    supabase.from('grades').select('subject_id, score').eq('user_id', me.id).eq('period', period).then(({ data }) => {
      if (!alive) return;
      const map: Record<string, string> = {};
      for (const r of data ?? []) map[r.subject_id] = arDigits(Number(r.score));
      setValues(map);
      setOriginal(map);
      setLoadingPeriod(false);
    });
    return () => { alive = false; };
  }, [period, me.id]);

  // من صفحة المادة: المؤشر في حقلها
  useEffect(() => {
    if (!loadingPeriod && params.subjectId) setTimeout(() => inputs.current[params.subjectId!]?.focus(), 250);
  }, [loadingPeriod, params.subjectId]);

  const list: Subject[] = subjects.data ?? [];
  const changed = list.filter((s) => (values[s.id] ?? '') !== (original[s.id] ?? ''));
  const invalid = list.filter((s) => {
    const v = (values[s.id] ?? '').trim();
    if (!v) return false;
    const n = parseNumber(v);
    return n === null || n < 0 || n > 100;
  });

  const save = async () => {
    if (invalid.length) return Alert.alert('درجة غير صحيحة', `اكتب درجة بين ٠ و١٠٠ في: ${invalid.map((s) => shortSubject(s.name)).join('، ')}`);
    if (!changed.length) return router.back();
    setBusy(true);
    const upserts = changed.filter((s) => (values[s.id] ?? '').trim())
      .map((s) => ({ user_id: me.id, subject_id: s.id, period, score: parseNumber(values[s.id])! }));
    const removed = changed.filter((s) => !(values[s.id] ?? '').trim()).map((s) => s.id);
    const [a, b] = await Promise.all([
      upserts.length ? supabase.from('grades').upsert(upserts, { onConflict: 'user_id,subject_id,period' }) : Promise.resolve({ error: null }),
      removed.length ? supabase.from('grades').delete().eq('user_id', me.id).eq('period', period).in('subject_id', removed) : Promise.resolve({ error: null }),
    ]);
    setBusy(false);
    const error = a.error ?? b.error;
    if (error) return Alert.alert('تعذّر الحفظ', error.message);
    tap('success');
    router.back();
  };

  const filled = list.filter((s) => (values[s.id] ?? '').trim()).length;

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="إدخال الدرجات" subtitle="اختر الامتحان ثم اكتب درجة كل مادة (من ١٠٠)" />
      <ChipRow options={PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p] }))} value={period}
        onChange={(p) => {
          if (changed.length) {
            Alert.alert('لم تحفظ التغييرات', 'هل تريد تركها والانتقال لامتحان آخر؟', [
              { text: 'البقاء', style: 'cancel' },
              { text: 'انتقال', style: 'destructive', onPress: () => setPeriod(p) },
            ]);
          } else setPeriod(p);
        }} />
      {period === 'final' ? <T dim size={13}>النهائي لا يدخل في السعي، لكنه يفيد في حساب الفصل الثاني إن نقص شهر.</T> : null}

      {subjects.loading || loadingPeriod ? <Loading /> : (
        <View style={{ backgroundColor: c.card, borderRadius: 22, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
          {list.map((s, i) => {
            const raw = values[s.id] ?? '';
            const n = raw.trim() ? parseNumber(raw) : null;
            const bad = raw.trim() !== '' && (n === null || n < 0 || n > 100);
            const col = n === null || bad ? null : n >= rules.individualExempt ? verdict.exempt : n >= rules.pass ? null : verdict.risk;
            return (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <T weight="bold" size={16} style={{ flex: 1 }} lines={1}>{shortSubject(s.name)}</T>
                <TextInput
                  ref={(r) => { inputs.current[s.id] = r; }}
                  value={raw}
                  onChangeText={(t) => setValues((v) => ({ ...v, [s.id]: t }))}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={c.ink3}
                  returnKeyType={i < list.length - 1 ? 'next' : 'done'}
                  onSubmitEditing={() => inputs.current[list[i + 1]?.id]?.focus()}
                  submitBehavior={i < list.length - 1 ? 'submit' : 'blurAndSubmit'}
                  maxLength={5}
                  selectTextOnFocus
                  accessibilityLabel={`درجة ${s.name}`}
                  style={{
                    width: 92, height: 48, borderRadius: 14, textAlign: 'center',
                    borderWidth: bad ? 2 : 1, borderColor: bad ? '#C8312B' : c.line,
                    backgroundColor: col ? col.bg : c.bg, color: col ? col.ink : c.ink,
                    fontFamily: fonts.bold, fontSize: 20, paddingVertical: 0,
                  }}
                />
              </View>
            );
          })}
        </View>
      )}

      <T dim size={12} center>
        {arDigits(filled)} من {arDigits(list.length)} مواد · اترك الحقل فارغاً إذا لم يُجرَ الامتحان بعد · امسح الرقم لحذف الدرجة
      </T>
      <Button title={changed.length ? `حفظ (${arDigits(changed.length)})` : 'تم'} onPress={save} loading={busy} />
    </Screen>
  );
}
