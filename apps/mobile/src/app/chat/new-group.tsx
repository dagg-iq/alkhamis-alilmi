import { arDigits } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ConversationMark } from '@/components/group-mark';
import { PeoplePicker, type Person } from '@/components/people-picker';
import { Button, Field, Header, Screen, T } from '@/components/ui';
import { Alert } from '@/lib/dialog';
import { must, supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';

/**
 * مجموعة خاصة جديدة: اختيار الأعضاء ← الاسم والوصف ← إنشاء (أنت مالكها).
 * ومع ?add=<المجموعة>: إضافة أعضاء لمجموعة قائمة.
 */
export default function NewGroup() {
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [picked, setPicked] = useState<Person[]>([]);
  const [step, setStep] = useState<'people' | 'details'>('people');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  // في وضع الإضافة: الأعضاء الحاليون لا يظهرون في القائمة
  const existing = useLoad(async () => (add
    ? ((await must(supabase.from('conversation_members').select('user_id').eq('conversation_id', add))) as { user_id: string }[]).map((r) => r.user_id)
    : []), [add]);

  const create = async () => {
    if (!title.trim()) return Alert.alert('اسم المجموعة', 'اكتب اسماً للمجموعة.');
    setBusy(true);
    const { data, error } = await supabase.rpc('create_group_v2', {
      p_title: title.trim(), p_members: picked.map((p) => p.id), p_description: description.trim() || null,
    });
    setBusy(false);
    if (error) return Alert.alert('تعذّر إنشاء المجموعة', error.message);
    router.replace(`/chat/${data}`);
  };

  const addMembers = async () => {
    if (!add || !picked.length) return;
    setBusy(true);
    const { error } = await supabase.rpc('group_add_members', { p_conversation: add, p_members: picked.map((p) => p.id) });
    setBusy(false);
    if (error) return Alert.alert('تعذّرت الإضافة', error.message);
    router.back();
  };

  if (step === 'details' && !add) {
    return (
      <Screen footer={(
        <View style={{ padding: 20, paddingTop: 8 }}>
          <Button title="إنشاء المجموعة" icon="check" onPress={create} loading={busy} disabled={!title.trim()} />
        </View>
      )}>
        <Header title="مجموعة جديدة" subtitle={picked.length ? `${arDigits(picked.length)} عضو مع حضرتك` : 'يمكنك إضافة الأعضاء لاحقاً أو مشاركة رابط دعوة'} />
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <ConversationMark type="group" title={title || 'مجموعة'} size={84} />
        </View>
        <Field label="اسم المجموعة" value={title} onChangeText={setTitle} placeholder="مثلاً: مراجعة الفيزياء" maxLength={60} autoFocus />
        <Field label="الوصف (اختياري)" value={description} onChangeText={setDescription} placeholder="عن ماذا هذه المجموعة؟" multiline maxLength={500} style={{ minHeight: 80 }} />
        <T dim size={12}>المجموعة خاصة: لا يراها ولا يدخلها إلا من تضيفه أو من يملك رابط الدعوة. أنت مالكها وتستطيع تعيين مشرفين.</T>
        <Button title="رجوع لاختيار الأعضاء" variant="ghost" onPress={() => setStep('people')} />
      </Screen>
    );
  }

  return (
    <Screen footer={(
      <View style={{ padding: 20, paddingTop: 8 }}>
        {add ? (
          <Button title={picked.length ? `إضافة ${arDigits(picked.length)}` : 'اختر من تريد إضافته'} icon="user-plus" onPress={addMembers} loading={busy} disabled={!picked.length} />
        ) : (
          <Button title={picked.length ? `التالي (${arDigits(picked.length)})` : 'التالي'} onPress={() => setStep('details')} />
        )}
      </View>
    )}>
      <Header title={add ? 'إضافة أعضاء' : 'مجموعة جديدة'} subtitle={add ? undefined : 'اختر الأعضاء'} />
      {existing.loading ? null : <PeoplePicker picked={picked} onChange={setPicked} exclude={existing.data ?? []} />}
    </Screen>
  );
}
