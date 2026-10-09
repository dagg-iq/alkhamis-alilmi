import { POST_KIND_LABELS, type PostKind, type Section } from '@saey/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Icon } from '@/components/icon';
import { Alert } from '@/lib/dialog';
import { Button, Chip, Field, Header, Row, Screen, Segmented, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { compressImage, uploadFile } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function NewPost() {
  const { c } = useTheme();
  const me = useMe();
  const [kind, setKind] = useState<PostKind>('news');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState<string | null>(null);
  const sections = useLoad(async () => must(supabase.from('sections').select('*').order('sort')) as Promise<Section[]>);

  const publish = async () => {
    if (!title.trim()) return Alert.alert('اكتب عنوان الخبر');
    setBusy(true);
    try {
      // صورة الخبر (اختيارية): تُضغط ثم تُرفع
      let cover_key: string | null = null;
      if (cover) {
        const img = await compressImage(cover, 1600, 0.8);
        cover_key = await uploadFile(img.uri, 'cover', 'image/jpeg');
      }
      const { error } = await supabase.from('posts').insert({ author_id: me.id, kind, title: title.trim(), body: body.trim(), is_pinned: pinned, section_id: sectionId, cover_key });
      if (error) throw new Error(error.message);
      router.back();
    } catch (e) {
      Alert.alert('تعذّر النشر', e instanceof Error ? e.message : 'حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="خبر جديد" subtitle="يصل إشعار فوري لكل الطلاب" />
      <Segmented options={(['news', 'holiday', 'exam', 'urgent'] as PostKind[]).map((k) => ({ key: k, label: POST_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
      <Field label="العنوان" value={title} onChangeText={setTitle} placeholder="مثلاً: غداً عطلة رسمية" />
      <Field label="التفاصيل" value={body} onChangeText={setBody} multiline style={{ minHeight: 140 }} />
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>صورة الخبر (اختياري)</T>
        {cover ? (
          <View>
            <Image source={{ uri: cover }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 18 }} contentFit="cover" />
            <Pressable onPress={() => setCover(null)} accessibilityLabel="إزالة الصورة"
              style={{ position: 'absolute', top: 8, left: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={16} color="#FFFFFF" strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : (
          <Row gap={10}>
            <Button title="من المعرض" icon="image" variant="secondary" style={{ flex: 1 }} onPress={async () => {
              const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: true, aspect: [16, 9] });
              if (!r.canceled) setCover(r.assets[0].uri);
            }} />
            <Button title="تصوير" icon="camera" variant="secondary" style={{ flex: 1 }} onPress={async () => {
              const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: true, aspect: [16, 9] });
              if (!r.canceled) setCover(r.assets[0].uri);
            }} />
          </Row>
        )}
      </View>
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>لمن؟</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="كل الطلاب" active={!sectionId} onPress={() => setSectionId(null)} />
          {(sections.data ?? []).map((s) => <Chip key={s.id} label={`شعبة ${s.name}`} active={sectionId === s.id} onPress={() => setSectionId(s.id)} />)}
        </View>
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <T weight="bold">تثبيت في الأعلى</T>
        <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: c.accent, false: c.line }} />
      </Row>
      <Button title="نشر" icon="send" onPress={publish} loading={busy} />
    </Screen>
  );
}
