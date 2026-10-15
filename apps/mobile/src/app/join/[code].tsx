import { countOf } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ConversationMark } from '@/components/group-mark';
import { Button, Card, Empty, ErrorBox, Header, Loading, Screen, T } from '@/components/ui';
import { Alert } from '@/lib/dialog';
import { must, supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';

interface Preview { id: string; title: string | null; description: string | null; member_count: number; is_member: boolean }

/** رابط دعوة لمجموعة (saey://join/<رمز> أو من الموقع): معاينة ثم انضمام */
export default function JoinGroup() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [busy, setBusy] = useState(false);
  const q = useLoad(async () => ((await must(supabase.rpc('group_preview', { p_code: code }))) as Preview[])[0] ?? null, [code]);

  const join = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('join_group', { p_code: code });
    setBusy(false);
    if (error) return Alert.alert('تعذّر الانضمام', error.message);
    router.replace(`/chat/${data}`);
  };

  return (
    <Screen>
      <Header title="دعوة لمجموعة" />
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data ? (
        <Empty icon="link" title="الرابط غير صالح" body="ربما غيّره مشرف المجموعة. اطلب منه رابطاً جديداً." />
      ) : (
        <Card>
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
            <ConversationMark type="group" title={q.data.title ?? 'مجموعة'} size={84} />
            <T display size={26} center>{q.data.title ?? 'مجموعة'}</T>
            <T dim size={14}>{countOf(q.data.member_count, 'عضو', 'عضوان', 'أعضاء', 'عضو واحد')}</T>
            {q.data.description ? <T center size={15}>{q.data.description}</T> : null}
          </View>
          <View style={{ marginTop: 16 }}>
            {q.data.is_member
              ? <Button title="فتح المجموعة" icon="chat" onPress={() => router.replace(`/chat/${q.data!.id}`)} />
              : <Button title="انضمام للمجموعة" icon="user-plus" onPress={join} loading={busy} />}
          </View>
        </Card>
      )}
    </Screen>
  );
}
