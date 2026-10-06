import { SectionMark } from '@/components/group-mark';
import { PressScale, tap } from '@/components/motion';
import { isTripleName, type Section } from '@saey/shared';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Avatar, Button, Chip, Field, Loading, Screen, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { compressImage } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';
import { useTheme } from '@/lib/theme';

export default function Onboarding() {
  const { c } = useTheme();
  const { session, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [avatar, setAvatar] = useState<string | null>(profile?.avatar_url ?? null);
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(profile?.section_id ?? null);
  const [busy, setBusy] = useState(false);
  const sections = useLoad(() => must(supabase.from('sections').select('*').order('sort')) as Promise<Section[]>);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!res.canceled) setLocalAvatar(res.assets[0].uri);
  };

  const save = async () => {
    if (!isTripleName(name)) return Alert.alert('الاسم الثلاثي', 'اكتب اسمك الثلاثي كاملاً (الاسم واسم الأب والجد).');
    if (!section) return Alert.alert('الشعبة', 'اختر شعبتك.');
    const userId = session!.user.id;
    setBusy(true);
    try {
      let avatarUrl = avatar;
      if (localAvatar) {
        const img = await compressImage(localAvatar, 400, 0.75);
        const path = `${userId}/${Date.now()}.jpg`;
        const bytes = await new File(img.uri).bytes();
        const { error } = await supabase.storage.from('avatars').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
        if (error) throw new Error(error.message);
        avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from('profiles')
        .update({ full_name: name.trim().replace(/\s+/g, ' '), avatar_url: avatarUrl, section_id: section, onboarded: true })
        .eq('id', userId);
      if (error) throw new Error(error.message);
      setAvatar(avatarUrl);
      await refreshProfile();
    } catch (e) {
      Alert.alert('تعذّر الحفظ', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ gap: 6, marginTop: 12 }}>
        <T display size={34}>أهلاً بك في سعي</T>
        <T dim>أكمل بياناتك ليتعرف عليك الأدمن ويقبل طلبك.</T>
      </View>

      <Pressable onPress={pick} style={{ alignSelf: 'center', alignItems: 'center', gap: 8, marginVertical: 8 }} accessibilityRole="button" accessibilityLabel="اختيار صورة">
        <Avatar name={name || '؟'} url={localAvatar ?? avatar} size={104} />
        <T weight="bold" color={c.accent}>{localAvatar || avatar ? 'تغيير الصورة' : 'إضافة صورة'}</T>
      </Pressable>

      <Field label="الاسم الثلاثي" value={name} onChangeText={setName} placeholder="مثال: علي حسين كاظم" autoCapitalize="words" />

      <View style={{ gap: 10 }}>
        <T weight="bold" size={14}>الشعبة</T>
        {sections.loading ? <Loading /> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {(sections.data ?? []).map((s) => {
              const on = section === s.id;
              return (
                <PressScale key={s.id} onPress={() => { tap('select'); setSection(s.id); }} scaleTo={0.92}
                  accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ alignItems: 'center', gap: 6, padding: 6, borderRadius: 22, borderWidth: 2, borderColor: on ? c.accent : 'transparent' }}>
                  <SectionMark name={s.name} size={58} />
                  <T size={13} weight={on ? 'bold' : 'medium'} color={on ? c.accent : c.ink2}>شعبة {s.name}</T>
                </PressScale>
              );
            })}
          </View>
        )}
      </View>

      <View style={{ gap: 10, marginTop: 12 }}>
        <Button title="إرسال الطلب" onPress={save} loading={busy} />
        <Button title="تسجيل الخروج" variant="ghost" onPress={signOut} />
      </View>
    </Screen>
  );
}
