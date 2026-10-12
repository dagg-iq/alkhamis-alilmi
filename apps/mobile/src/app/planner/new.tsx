import { TASK_TYPE_LABELS, arDigits, formatDayDate, type Section, type TaskScope, type TaskType } from '@saey/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Button, Chip, Field, Header, IconButton, Row, Screen, Segmented, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { scheduleReminder } from '@/lib/push';
import { saveTaskReminder } from '@/lib/reminders';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

const TIMES = [8, 14, 17, 20, 22];

export default function NewTask() {
  const { c } = useTheme();
  const me = useMe();
  const { isStaff } = useAuth();
  const [type, setType] = useState<TaskType>('homework');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [dayOffset, setDayOffset] = useState(1);
  const [hour, setHour] = useState(20);
  const [remind, setRemind] = useState(true);
  const [scope, setScope] = useState<TaskScope>('personal');
  const [sectionId, setSectionId] = useState<string | null>(me.section_id);
  const [busy, setBusy] = useState(false);
  const subjects = useLoad(loadSubjects);
  const sections = useLoad(async () => (isStaff ? must(supabase.from('sections').select('*').order('sort')) as Promise<Section[]> : []), [isStaff]);

  const due = new Date();
  due.setDate(due.getDate() + dayOffset);
  due.setHours(hour, 0, 0, 0);

  const save = async () => {
    if (!title.trim()) return Alert.alert('اكتب عنوان المهمة');
    if (scope === 'section' && !sectionId) return Alert.alert('اختر الشعبة');
    // موعد مضى (مثلاً «اليوم» بساعة سابقة): نسأل أولاً لأنه لن يصل تذكير
    if (due.getTime() <= Date.now()) {
      return Alert.alert('الموعد مضى', 'هذا الوقت مضى، فلن يصل تذكير. حفظ المهمة على أي حال؟', [
        { text: 'تغيير الموعد', style: 'cancel' },
        { text: 'حفظ', onPress: () => { doSave(); } },
      ]);
    }
    await doSave();
  };

  const doSave = async () => {
    setBusy(true);
    const { data, error } = await supabase.from('tasks').insert({
      owner_id: me.id, type, title: title.trim(), notes: notes.trim() || null, subject_id: subjectId,
      due_at: due.toISOString(), scope, section_id: scope === 'section' ? sectionId : null,
    }).select('id').single();
    if (error || !data) {
      setBusy(false);
      return Alert.alert('تعذّر الحفظ', error?.message ?? 'حاول مرة أخرى');
    }
    if (remind && due.getTime() > Date.now()) {
      // تذكير قبل الموعد: الامتحان مساء اليوم السابق، وغيره قبل ساعتين — وإن كان ذلك قد مضى فبعد دقيقة (قبل الموعد)
      const at = new Date(due);
      if (type === 'exam') { at.setDate(at.getDate() - 1); at.setHours(20, 0, 0, 0); } else at.setHours(at.getHours() - 2);
      const soon = Date.now() + 60_000;
      if (at.getTime() < soon && due.getTime() > soon + 60_000) at.setTime(soon);
      const id = await scheduleReminder(type === 'exam' ? `امتحان قريب: ${title}` : `تذكير: ${title}`, type === 'exam' ? 'راجع جيداً — اسعَ تُعفَ.' : 'لا تنسَ إنجازها.', at);
      if (id) await saveTaskReminder((data as { id: string }).id, id);
    }
    setBusy(false);
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="مهمة جديدة" />
      <Segmented options={(['homework', 'preparation', 'exam', 'other'] as TaskType[]).map((k) => ({ key: k, label: TASK_TYPE_LABELS[k] }))} value={type} onChange={setType} />
      <Field label="العنوان" value={title} onChangeText={setTitle} placeholder={type === 'exam' ? 'مثلاً: امتحان الشهر الأول — فيزياء' : 'مثلاً: حل أسئلة الفصل الثاني'} />
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>المادة</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(subjects.data ?? []).map((s) => (
            <Chip key={s.id} label={shortSubject(s.name)} active={subjectId === s.id} onPress={() => setSubjectId(subjectId === s.id ? null : s.id)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>الموعد</T>
        <Row style={{ justifyContent: 'space-between', backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 8 }}>
          <IconButton name="forward" label="يوم سابق" size={40} onPress={() => setDayOffset(Math.max(0, dayOffset - 1))} />
          <T weight="bold" size={16}>{formatDayDate(due)}</T>
          <IconButton name="back" label="يوم لاحق" size={40} onPress={() => setDayOffset(dayOffset + 1)} />
        </Row>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[{ k: 0, l: 'اليوم' }, { k: 1, l: 'غداً' }, { k: 3, l: 'بعد ٣ أيام' }, { k: 7, l: 'بعد أسبوع' }].map((o) => (
            <Chip key={o.k} label={o.l} active={dayOffset === o.k} onPress={() => setDayOffset(o.k)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TIMES.map((h) => <Chip key={h} label={`${arDigits(h > 12 ? h - 12 : h)} ${h < 12 ? 'ص' : 'م'}`} active={hour === h} onPress={() => setHour(h)} />)}
        </View>
      </View>
      <Field label="ملاحظات (اختياري)" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 90 }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <T weight="bold">تذكير قبل الموعد</T>
        <Switch value={remind} onValueChange={setRemind} trackColor={{ true: c.accent, false: c.line }} />
      </Row>
      {isStaff ? (
        <View style={{ gap: 8 }}>
          <T weight="bold" size={14}>لمن؟</T>
          <Segmented options={[{ key: 'personal', label: 'لي فقط' }, { key: 'section', label: 'لشعبة' }, { key: 'school', label: 'للجميع' }]} value={scope} onChange={setScope} />
          {scope === 'section' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(sections.data ?? []).map((s) => <Chip key={s.id} label={`شعبة ${s.name}`} active={sectionId === s.id} onPress={() => setSectionId(s.id)} />)}
            </View>
          ) : null}
        </View>
      ) : null}
      <Button title="حفظ" onPress={save} loading={busy} />
    </Screen>
  );
}
