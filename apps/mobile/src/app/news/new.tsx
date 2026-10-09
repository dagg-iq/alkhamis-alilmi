import { POST_KIND_LABELS, type PostKind, type Section } from '@saey/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Button, Chip, Field, Header, Row, Screen, Segmented, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
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
  const sections = useLoad(async () => must(supabase.from('sections').select('*').order('sort')) as Promise<Section[]>);

  const publish = async () => {
    if (!title.trim()) return Alert.alert('اكتب عنوان الخبر');
    setBusy(true);
    const { error } = await supabase.from('posts').insert({ author_id: me.id, kind, title: title.trim(), body: body.trim(), is_pinned: pinned, section_id: sectionId });
    setBusy(false);
    if (error) return Alert.alert('تعذّر النشر', error.message);
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="خبر جديد" subtitle="يصل إشعار فوري لكل الطلاب" />
      <Segmented options={(['news', 'holiday', 'exam', 'urgent'] as PostKind[]).map((k) => ({ key: k, label: POST_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
      <Field label="العنوان" value={title} onChangeText={setTitle} placeholder="مثلاً: غداً عطلة رسمية" />
      <Field label="التفاصيل" value={body} onChangeText={setBody} multiline style={{ minHeight: 140 }} />
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
