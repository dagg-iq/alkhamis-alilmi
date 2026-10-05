import { ROLE_LABELS, type Profile } from '@saey/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Avatar, Empty, Field, Header, Loading, NameLine, Screen, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { must, supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';

export default function NewChat() {
  const me = useMe();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useLoad(async () => {
    const [people, sections] = await Promise.all([
      must(supabase.from('profiles').select('*').eq('status', 'approved').neq('id', me.id).order('full_name')),
      must(supabase.from('sections').select('id, name')),
    ]);
    return { people: people as Profile[], sections: Object.fromEntries((sections as { id: string; name: string }[]).map((s) => [s.id, s.name])) };
  }, [me.id]);

  const start = async (p: Profile) => {
    setBusy(p.id);
    const { data, error } = await supabase.rpc('start_direct', { p_other: p.id });
    setBusy(null);
    if (error) return Alert.alert('تعذّر بدء المحادثة', error.message);
    router.replace(`/chat/${data}`);
  };

  const list = (q.data?.people ?? []).filter((p) => p.full_name.includes(search.trim()));
  return (
    <Screen>
      <Header title="رسالة جديدة" />
      <Field placeholder="ابحث بالاسم" value={search} onChangeText={setSearch} />
      {q.loading ? <Loading /> : list.length === 0 ? <Empty icon="users" title="لا يوجد أحد بهذا الاسم" /> : (
        <View>
          {list.map((p) => (
            <Pressable key={p.id} onPress={() => start(p)} disabled={!!busy}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed || busy === p.id ? 0.5 : 1 })}>
              <Avatar name={p.full_name} url={p.avatar_url} verified={p.is_verified} />
              <View style={{ flex: 1 }}>
                <NameLine name={p.full_name} verified={p.is_verified} />
                <T dim size={13}>{p.role !== 'student' ? ROLE_LABELS[p.role] : p.section_id ? `شعبة ${q.data!.sections[p.section_id] ?? ''}` : 'طالب'}</T>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
