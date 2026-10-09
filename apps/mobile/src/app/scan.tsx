import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Icon } from '@/components/icon';
import { Button, Card, Field, Header, Screen, T } from '@/components/ui';
import { Alert } from '@/lib/dialog';
import { convertPhotos } from '@/lib/scan-pdf';
import { setScanResult } from '@/lib/scan-store';
import { useTheme } from '@/lib/theme';

/** تصوير ورقة (أسئلة، ملزمة…) ← الذكاء الاصطناعي يعيدها ملف PDF بنفس تنسيقها */
export default function Scan() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ subjectId?: string; kind?: string }>();
  const [ai, setAi] = useState(true);
  const [photos, setPhotos] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [step, setStep] = useState<string | null>(null);

  const add = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: camera, allowsMultipleSelection: !camera };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => a.uri)].slice(0, 8));
  };

  const run = async () => {
    if (!photos.length) return Alert.alert('صوّر الورقة أولاً', 'اضغط «صوّر صفحة» أو اختر الصور من المعرض.');
    const name = title.trim() || 'ورقة سعي';
    try {
      const r = await convertPhotos(photos, name, setStep, ai);
      setScanResult({ file: r.pdf, text: r.text, title: name, subjectId: params.subjectId, kind: params.kind === 'school_exam' ? 'school_exam' : params.kind === 'expected' ? 'expected' : undefined });
      router.replace('/scan-result');
    } catch (e) {
      Alert.alert('تعذّر التحويل', e instanceof Error ? e.message : 'حاول مرة أخرى.');
    } finally {
      setStep(null);
    }
  };

  return (
    <Screen>
      <Header title="تحويل ورقة إلى PDF" subtitle={ai ? 'صوّر الورقة فتعود ملف PDF بنفس شكلها' : 'صوّر الورقة فتصير ملف PDF'} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ flexGrow: 0, height: 160 }}>
        {photos.map((p, i) => (
          <View key={p}>
            <Image source={{ uri: p }} style={{ width: 110, height: 150, borderRadius: 14 }} contentFit="cover" />
            <Pressable onPress={() => setPhotos(photos.filter((_, j) => j !== i))} accessibilityLabel="حذف الصورة"
              style={{ position: 'absolute', top: 6, left: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#FFFFFF" strokeWidth={2.4} />
            </Pressable>
            <View style={{ position: 'absolute', bottom: 6, right: 6, minWidth: 24, height: 24, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
              <T size={12} weight="bold" color="#FFFFFF">{i + 1}</T>
            </View>
          </View>
        ))}
        <Pressable onPress={() => add(true)} accessibilityLabel="تصوير صفحة" style={{ width: 110, height: 150, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="camera" size={28} color={c.accent} />
          <T size={12} weight="bold" color={c.accent}>صوّر صفحة</T>
        </Pressable>
        <Pressable onPress={() => add(false)} accessibilityLabel="من المعرض" style={{ width: 110, height: 150, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="image" size={28} color={c.ink2} />
          <T size={12} weight="bold" dim>من المعرض</T>
        </Pressable>
      </ScrollView>
      <T dim size={12}>حتى ٨ صفحات في المرة، بالترتيب. صوّر في إضاءة جيدة والورقة مستوية وقصّ الأطراف.</T>

      <Field label="اسم الملف (اختياري)" value={title} onChangeText={setTitle} placeholder="مثال: أسئلة الفيزياء — الشهر الأول" />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T weight="bold">تحسين بالذكاء الاصطناعي</T>
          <T dim size={12}>{ai ? 'يعيد كتابة الورقة بخط واضح ومعادلات منسّقة (أبطأ).' : 'بدونه: كل صورة تصبح صفحة كما هي (سريع).'}</T>
        </View>
        <Switch value={ai} onValueChange={setAi} trackColor={{ true: c.accent, false: c.line }} />
      </Card>
      {step ? <Card tone="soft"><T weight="bold" color={c.softInk}>{step}</T>{ai ? <T dim size={12}>قد يستغرق دقيقة، لا تغلق التطبيق.</T> : null}</Card> : null}
      <Button title={ai ? 'حوّل إلى PDF' : 'جهّز الملف'} icon="scan" onPress={run} loading={!!step} disabled={!photos.length} />
    </Screen>
  );
}
