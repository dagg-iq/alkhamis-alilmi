import { PERIOD_LABELS, PERIODS, QUESTION_KIND_LABELS, type Period, type QuestionKind, type Section } from '@saey/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Icon } from '@/components/icon';
import { Button, Card, Chip, Field, Header, Row, Screen, Segmented, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { compressImage, uploadFile } from '@/lib/files';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { callFunction, must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function Scan() {
  const { c } = useTheme();
  const { isStaff } = useAuth();
  const [photos, setPhotos] = useState<string[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('month1');
  const [kind, setKind] = useState<QuestionKind>('school_exam');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const subjects = useLoad(loadSubjects);
  const sections = useLoad(async () => must(supabase.from('sections').select('*').order('sort')) as Promise<Section[]>);

  if (!isStaff) return <Screen><Header title="تصوير الأسئلة" /><T dim>هذه الميزة للأدمن والمشرفين.</T></Screen>;

  const add = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: camera, allowsMultipleSelection: !camera };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => a.uri)].slice(0, 10));
  };

  const process = async () => {
    if (!photos.length) return Alert.alert('صوّر ورقة الأسئلة أولاً');
    if (!subjectId) return Alert.alert('اختر المادة');
    try {
      const keys: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setStep(`رفع الصورة ${i + 1} من ${photos.length}…`);
        // دقة عالية لقراءة النص بوضوح
        const img = await compressImage(photos[i], 2000, 0.85);
        keys.push(await uploadFile(img.uri, 'scan', 'image/jpeg'));
      }
      setStep('قراءة الأسئلة وتحويلها إلى نص وPDF…');
      const subjectName = subjects.data?.find((s) => s.id === subjectId)?.name ?? '';
      const res = await callFunction<{ id: string }>('ocr', {
        scanKeys: keys, subjectId, period, kind, sectionId,
        title: title.trim() || `أسئلة ${PERIOD_LABELS[period]} — ${shortSubject(subjectName)}`,
      });
      router.replace(`/questions/${res.id}`);
    } catch (e) {
      Alert.alert('تعذّرت المعالجة', e instanceof Error ? e.message : '');
    } finally {
      setStep(null);
    }
  };

  return (
    <Screen>
      <Header title="تصوير الأسئلة" subtitle="صوّر الورقة ← نص واضح بالمعادلات + PDF ← راجعه ثم انشره" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {photos.map((p, i) => (
          <View key={p}>
            <Image source={{ uri: p }} style={{ width: 110, height: 150, borderRadius: 14 }} contentFit="cover" />
            <Pressable onPress={() => setPhotos(photos.filter((_, j) => j !== i))} accessibilityLabel="حذف الصورة"
              style={{ position: 'absolute', top: 6, left: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#FFFFFF" strokeWidth={2.4} />
            </Pressable>
          </View>
        ))}
        <Pressable onPress={() => add(true)} style={{ width: 110, height: 150, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="camera" size={28} color={c.accent} />
          <T size={12} weight="bold" color={c.accent}>صوّر صفحة</T>
        </Pressable>
        <Pressable onPress={() => add(false)} style={{ width: 110, height: 150, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="image" size={28} color={c.ink2} />
          <T size={12} weight="bold" dim>من المعرض</T>
        </Pressable>
      </ScrollView>
      <T dim size={12}>نصيحة: صوّر في إضاءة جيدة والورقة مستوية، وقصّ الأطراف.</T>

      <Segmented options={(['school_exam', 'expected'] as QuestionKind[]).map((k) => ({ key: k, label: QUESTION_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>المادة</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(subjects.data ?? []).map((s) => <Chip key={s.id} label={shortSubject(s.name)} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>الامتحان</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PERIODS.map((p) => <Chip key={p} label={PERIOD_LABELS[p]} active={period === p} onPress={() => setPeriod(p)} />)}
        </View>
      </View>
      {kind === 'school_exam' ? (
        <View style={{ gap: 8 }}>
          <T weight="bold" size={14}>الشعبة (اختياري)</T>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Chip label="كل الشعب" active={!sectionId} onPress={() => setSectionId(null)} />
            {(sections.data ?? []).map((s) => <Chip key={s.id} label={`شعبة ${s.name}`} active={sectionId === s.id} onPress={() => setSectionId(s.id)} />)}
          </Row>
        </View>
      ) : null}
      <Field label="العنوان (اختياري)" value={title} onChangeText={setTitle} placeholder="يُكتب تلقائياً إن تركته" />
      {step ? (
        <Card tone="soft"><T weight="bold" color={c.softInk}>{step}</T></Card>
      ) : null}
      <Button title="معالجة وإنشاء مسودة" icon="scan" onPress={process} loading={!!step} disabled={!photos.length} />
    </Screen>
  );
}
