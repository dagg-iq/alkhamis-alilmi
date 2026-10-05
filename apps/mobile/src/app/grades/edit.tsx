import { PERIOD_LABELS, PERIODS, parseNumber, type Period, type Subject } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Chip, Field, Header, Screen, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';

export default function EditGrade() {
  const params = useLocalSearchParams<{ subjectId?: string; period?: Period }>();
  const me = useMe();
  const [subjectId, setSubjectId] = useState<string | null>(params.subjectId ?? null);
  const [period, setPeriod] = useState<Period>(params.period ?? 'month1');
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');
  const [existing, setExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subjects = useLoad(loadSubjects);

  useEffect(() => {
    if (!subjectId) return;
    supabase.from('grades').select('id, score, note').eq('user_id', me.id).eq('subject_id', subjectId).eq('period', period).maybeSingle()
      .then(({ data }) => {
        setExisting(data?.id ?? null);
        setScore(data ? String(Number(data.score)) : '');
        setNote(data?.note ?? '');
      });
  }, [subjectId, period, me.id]);

  const save = async () => {
    const n = parseNumber(score);
    if (!subjectId) return Alert.alert('اختر المادة');
    if (n === null || n < 0 || n > 100) return Alert.alert('الدرجة', 'اكتب درجة بين ٠ و ١٠٠');
    setBusy(true);
    const { error } = await supabase.from('grades').upsert(
      { user_id: me.id, subject_id: subjectId, period, score: n, note: note || null },
      { onConflict: 'user_id,subject_id,period' },
    );
    setBusy(false);
    if (error) return Alert.alert('تعذّر الحفظ', error.message);
    router.back();
  };

  const remove = async () => {
    if (!existing) return;
    await supabase.from('grades').delete().eq('id', existing);
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title={existing ? 'تعديل درجة' : 'درجة جديدة'} />
      <View style={{ gap: 10 }}>
        <T weight="bold" size={14}>المادة</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(subjects.data ?? []).map((s: Subject) => (
            <Chip key={s.id} label={shortSubject(s.name)} active={s.id === subjectId} onPress={() => setSubjectId(s.id)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <T weight="bold" size={14}>الامتحان</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PERIODS.map((p) => <Chip key={p} label={PERIOD_LABELS[p]} active={p === period} onPress={() => setPeriod(p)} />)}
        </View>
      </View>
      <Field label="الدرجة (من ١٠٠)" value={score} onChangeText={setScore} keyboardType="decimal-pad" placeholder="٨٥" style={{ fontSize: 28, height: 72 }} />
      <Field label="ملاحظة (اختياري)" value={note} onChangeText={setNote} placeholder="مثلاً: أخطأت في سؤال القوانين" />
      <Button title="حفظ" onPress={save} loading={busy} />
      {existing ? <Button title="حذف الدرجة" variant="danger" onPress={remove} /> : null}
    </Screen>
  );
}
