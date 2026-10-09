import { SectionMark } from '@/components/group-mark';
import { ROLE_LABELS, formatDate, type Profile } from '@saey/shared';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Avatar, Button, Card, Chip, ErrorBox, Field, Header, Loading, NameLine, Row, Screen, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { compressImage } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const me = useMe();
  const { refreshProfile } = useAuth();
  const isMe = id === me.id;
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);

  const q = useLoad(async () => {
    const p = await must(supabase.from('profiles').select('*, sections(name)').eq('id', id).single()) as Profile & { sections: { name: string } | null };
    return p;
  }, [id]);

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const p = q.data;

  const changeAvatar = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (res.canceled) return;
    setBusy(true);
    try {
      const img = await compressImage(res.assets[0].uri, 400, 0.75);
      const path = `${me.id}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('avatars').upload(path, await new File(img.uri).bytes(), { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', me.id);
      await Promise.all([q.reload(), refreshProfile()]);
    } catch (e) {
      Alert.alert('تعذّر تغيير الصورة', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  };

  const saveBio = async () => {
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ bio: bio.trim() || null }).eq('id', me.id);
    setBusy(false);
    if (error) return Alert.alert('تعذّر الحفظ', error.message);
    setEditing(false);
    q.reload();
  };

  const message = async () => {
    const { data, error } = await supabase.rpc('start_direct', { p_other: p.id });
    if (error) return Alert.alert('تعذّر بدء المحادثة', error.message);
    router.push(`/chat/${data}`);
  };

  return (
    <Screen>
      <Header />
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Pressable onPress={isMe ? changeAvatar : undefined} disabled={busy}>
          <Avatar name={p.full_name} url={p.avatar_url} size={112} verified={p.is_verified} />
        </Pressable>
        {isMe ? <T size={13} weight="bold" color={c.accent}>{busy ? 'جارٍ الرفع…' : 'اضغط على الصورة لتغييرها'}</T> : null}
        <NameLine name={p.full_name} verified={p.is_verified} size={24} />
        <Row gap={8}>
          {p.role !== 'student' ? <Chip small label={ROLE_LABELS[p.role]} bg={c.accent} color={c.accentInk} /> : null}
          {p.sections ? <Row gap={6}><SectionMark name={p.sections.name} size={26} /><T size={13} weight="bold">شعبة {p.sections.name}</T></Row> : null}
        </Row>
      </View>
      {editing ? (
        <View style={{ gap: 10 }}>
          <Field label="نبذة" value={bio} onChangeText={setBio} multiline placeholder="مثلاً: هدفي الإعفاء العام" style={{ minHeight: 90 }} />
          <Button title="حفظ" onPress={saveBio} loading={busy} />
        </View>
      ) : p.bio || isMe ? (
        <Card onPress={isMe ? () => { setBio(p.bio ?? ''); setEditing(true); } : undefined}>
          <T dim={!p.bio}>{p.bio ?? 'أضف نبذة قصيرة عنك'}</T>
        </Card>
      ) : null}
      <T dim size={12} center>انضم في {formatDate(new Date(p.created_at))}</T>
      {!isMe ? <Button title="مراسلة" icon="chat" onPress={message} /> : null}
    </Screen>
  );
}
