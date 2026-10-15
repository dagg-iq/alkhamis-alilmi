import { ROLE_LABELS, type Profile } from '@saey/shared';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useMe } from '@/lib/auth';
import { normalizeArabic } from '@/lib/chat';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';
import { Icon } from './icon';
import { tap } from './motion';
import { Avatar, Empty, Field, Loading, NameLine, T } from './ui';

export type Person = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'is_verified' | 'role' | 'section_id'>;

/** اختيار عدة أشخاص من طلاب المدرسة (بحث بالاسم وتصفية بالشعبة) */
export function PeoplePicker({ picked, onChange, exclude = [] }: {
  picked: Person[]; onChange: (p: Person[]) => void; exclude?: string[];
}) {
  const { c } = useTheme();
  const me = useMe();
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<string | null>(null);
  const q = useLoad(async () => {
    const [people, sections] = await Promise.all([
      must(supabase.from('profiles').select('id, full_name, avatar_url, is_verified, role, section_id').eq('status', 'approved').neq('id', me.id).order('full_name')),
      must(supabase.from('sections').select('id, name').order('sort')),
    ]);
    return { people: people as Person[], sections: sections as { id: string; name: string }[] };
  }, [me.id], { key: 'people' });

  const sectionName = useMemo(() => Object.fromEntries((q.data?.sections ?? []).map((s) => [s.id, s.name])), [q.data]);
  const skip = new Set(exclude);
  const term = normalizeArabic(search);
  const list = (q.data?.people ?? [])
    .filter((p) => !skip.has(p.id))
    .filter((p) => !section || p.section_id === section)
    .filter((p) => !term || normalizeArabic(p.full_name).includes(term));
  const isPicked = (id: string) => picked.some((x) => x.id === id);
  const toggle = (p: Person) => {
    tap('select');
    onChange(isPicked(p.id) ? picked.filter((x) => x.id !== p.id) : [...picked, p]);
  };

  return (
    <View style={{ gap: 12 }}>
      <Field placeholder="ابحث بالاسم" value={search} onChangeText={setSearch} />
      {q.data?.sections.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[{ id: null as string | null, name: 'الكل' }, ...q.data.sections].map((s) => (
            <Pressable key={s.id ?? 'all'} onPress={() => setSection(s.id)} accessibilityRole="button" accessibilityState={{ selected: section === s.id }}
              style={{ height: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: section === s.id ? c.ink : c.card, borderWidth: section === s.id ? 0 : 1, borderColor: c.line }}>
              <T size={13} weight="bold" color={section === s.id ? c.bg : c.ink}>{s.id ? `شعبة ${s.name}` : s.name}</T>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {picked.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
          {picked.map((p) => (
            <Pressable key={p.id} onPress={() => toggle(p)} accessibilityLabel={`إزالة ${p.full_name}`} style={{ alignItems: 'center', width: 64, gap: 4 }}>
              <View>
                <Avatar name={p.full_name} url={p.avatar_url} size={48} />
                <View style={{ position: 'absolute', bottom: -2, left: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: c.ink3, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={10} color={c.bg} strokeWidth={2.4} />
                </View>
              </View>
              <T size={11} lines={1}>{p.full_name.split(' ')[0]}</T>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {q.loading ? <Loading /> : list.length === 0 ? <Empty icon="users" title="لا يوجد أحد بهذا الاسم" /> : (
        <View>
          {list.map((p) => {
            const on = isPicked(p.id);
            return (
              <Pressable key={p.id} onPress={() => toggle(p)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={p.full_name}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
                <Avatar name={p.full_name} url={p.avatar_url} verified={p.is_verified} />
                <View style={{ flex: 1 }}>
                  <NameLine name={p.full_name} verified={p.is_verified} />
                  <T dim size={13}>{p.role !== 'student' ? ROLE_LABELS[p.role] : p.section_id ? `شعبة ${sectionName[p.section_id] ?? ''}` : 'طالب'}</T>
                </View>
                <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: on ? 0 : 2, borderColor: c.line, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icon name="check" size={16} color={c.accentInk} strokeWidth={2.4} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
