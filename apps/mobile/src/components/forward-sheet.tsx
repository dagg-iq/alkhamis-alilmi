import type { Message } from '@saey/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth, useMe } from '@/lib/auth';
import { conversationTitle, type ConversationRow } from '@/lib/chat';
import { Alert } from '@/lib/dialog';
import { forwardMessage } from '@/lib/forward';
import { readSnapshot } from '@/lib/offline';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { ConversationMark } from './group-mark';
import { Icon } from './icon';
import { tap } from './motion';
import { Sheet } from './sheet';
import { Avatar, Button, Field, NameLine, T } from './ui';

const MAX_TARGETS = 5;

/** إعادة توجيه رسالة: اختيار محادثة أو أكثر (حتى ٥) مثل تطبيقات المراسلة */
export function ForwardSheet({ message, fromConversation, onClose }: {
  message: Message | null; fromConversation: string; onClose: () => void;
}) {
  const { c } = useTheme();
  const me = useMe();
  const { isStaff } = useAuth();
  const [convs, setConvs] = useState<ConversationRow[]>([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!message) return;
    setPicked([]);
    setSearch('');
    // القائمة المحفوظة فوراً، ثم الحديثة من الخادم
    readSnapshot<ConversationRow[]>('chats').then((s) => { if (s) setConvs((cur) => (cur.length ? cur : s)); });
    supabase.rpc('my_conversations').then(({ data }) => { if (data) setConvs(data as ConversationRow[]); });
  }, [message]);

  const list = useMemo(() => {
    const q = search.trim();
    return convs
      .filter((x) => isStaff || !x.only_staff_can_post)
      .filter((x) => !q || conversationTitle(x).includes(q))
      // المحادثة الحالية في آخر القائمة (إعادة التوجيه عادةً لمحادثة أخرى)
      .sort((a, b) => Number(a.id === fromConversation) - Number(b.id === fromConversation));
  }, [convs, search, isStaff, fromConversation]);

  const toggle = (id: string) => {
    tap('select');
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TARGETS ? p : [...p, id]));
  };

  const send = async () => {
    if (!message || !picked.length) return;
    setBusy(true);
    const results = await Promise.all(picked.map((to) => forwardMessage(message, to, me.id).then(
      (r) => ({ to, ok: true as const, queued: r.queued }),
      (e: unknown) => ({ to, ok: false as const, error: e instanceof Error ? e.message : 'تعذّر الإرسال' }),
    )));
    setBusy(false);
    const failed = results.filter((r) => !r.ok);
    const queued = results.some((r) => r.ok && r.queued);
    if (failed.length === results.length) {
      Alert.alert('لم تُعَد إعادة التوجيه', (failed[0] as { error: string }).error);
      return;
    }
    tap('success');
    onClose();
    if (failed.length) Alert.alert('أُرسلت لبعض المحادثات فقط', `تعذّر الإرسال إلى ${failed.length} محادثة.`);
    else if (queued) Alert.alert('بانتظار الإنترنت', 'تُرسل الرسالة تلقائياً عند عودة الاتصال.');
    // محادثة واحدة: نفتحها (مثل واتساب)
    if (picked.length === 1 && picked[0] !== fromConversation) router.push(`/chat/${picked[0]}`);
  };

  return (
    <Sheet visible={!!message} onClose={onClose}>
      <T display size={22}>إعادة توجيه</T>
      {message ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: c.soft }}>
          <Icon name="forward-msg" size={18} color={c.accent} />
          <T size={13} lines={2} style={{ flex: 1 }}>{message.body ?? attachmentLabel(message)}</T>
        </View>
      ) : null}
      <Field placeholder="ابحث عن محادثة" value={search} onChangeText={setSearch} />
      <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
        {list.length === 0 ? <T dim center style={{ paddingVertical: 20 }}>لا محادثات</T> : list.map((conv) => {
          const on = picked.includes(conv.id);
          return (
            <Pressable key={conv.id} onPress={() => toggle(conv.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
              {conv.type === 'direct'
                ? <Avatar name={conv.peer_name ?? '؟'} url={conv.peer_avatar} size={42} />
                : <ConversationMark type={conv.type} title={conversationTitle(conv)} size={42} />}
              <View style={{ flex: 1 }}><NameLine name={conversationTitle(conv)} size={15} /></View>
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Button title={picked.length > 1 ? `إرسال إلى ${picked.length} محادثات` : 'إرسال'} icon="send" onPress={send} loading={busy} disabled={!picked.length} />
    </Sheet>
  );
}

function attachmentLabel(m: Message): string {
  const a = m.attachment;
  if (!a) return '';
  if (a.type === 'image') return 'صورة';
  if (a.type === 'file') return `ملف: ${a.title}`;
  return a.title;
}
