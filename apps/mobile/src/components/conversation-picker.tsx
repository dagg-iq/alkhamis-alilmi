import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useMe } from '@/lib/auth';
import { canPostIn, conversationTitle, fetchConversations, type ConversationRow } from '@/lib/chat';
import { useTheme } from '@/lib/theme';
import { ConversationMark } from './group-mark';
import { Sheet } from './sheet';
import { Avatar, Field, T } from './ui';

/** اختيار مجموعة أو شخص لإرسال شيء إليه */
export function ConversationPicker({ visible, onClose, onPick, title = 'إرسال إلى' }: {
  visible: boolean; onClose: () => void; onPick: (c: ConversationRow) => Promise<void> | void; title?: string;
}) {
  const { c } = useTheme();
  const me = useMe();
  const [list, setList] = useState<ConversationRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQ('');
    fetchConversations().then(setList).catch(() => setList([]));
  }, [visible]);

  // المجموعات التي يكتب فيها المشرفون فقط لا تظهر للطالب
  const shown = (list ?? []).filter((x) => canPostIn(x, me.role !== 'student')).filter((x) => !q.trim() || conversationTitle(x).includes(q.trim()));

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T display size={22}>{title}</T>
      <Field placeholder="ابحث عن مجموعة أو شخص" value={q} onChangeText={setQ} />
      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        {list === null ? <ActivityIndicator color={c.accent} style={{ paddingVertical: 20 }} /> : shown.length === 0 ? (
          <T dim center style={{ paddingVertical: 20 }}>لا توجد محادثات</T>
        ) : shown.map((x) => (
          <Pressable key={x.id} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`إرسال إلى ${conversationTitle(x)}`}
            onPress={async () => {
              setBusy(x.id);
              try { await onPick(x); } finally { setBusy(null); }
            }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
            {x.type === 'direct'
              ? <Avatar name={x.peer_name ?? ''} url={x.peer_avatar} size={42} />
              : <ConversationMark type={x.type} title={conversationTitle(x)} size={42} />}
            <T weight="bold" style={{ flex: 1 }} lines={1}>{conversationTitle(x)}</T>
            {busy === x.id ? <ActivityIndicator color={c.accent} /> : <View />}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}
