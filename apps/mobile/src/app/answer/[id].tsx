import type { Attachment } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { ConversationPicker } from '@/components/conversation-picker';
import { LogoMark } from '@/components/icon';
import { tap } from '@/components/motion';
import { RichText } from '@/components/rich-text';
import { Button, Card, ErrorBox, Header, Loading, Row, Screen, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { conversationTitle } from '@/lib/chat';
import { markdownPdf, sendAttachment } from '@/lib/pdf';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Answer = Extract<Attachment, { type: 'answer' }>;

/** إجابة من مساعد سعي أرسلها طالب في دردشة */
export default function SharedAnswer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const q = useLoad(async () => {
    const m = await must(supabase.from('messages').select('attachment, sender_id, profiles:sender_id(full_name)').eq('id', id).single()) as unknown as
      { attachment: Attachment | null; profiles: { full_name: string } | null };
    if (m.attachment?.type !== 'answer') throw new Error('هذه الرسالة لا تحتوي على إجابة.');
    return { a: m.attachment, from: m.profiles?.full_name ?? '' };
  }, [id]);

  if (q.loading) return <Screen><Header title="إجابة من مساعد سعي" /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header title="إجابة من مساعد سعي" /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const { a, from } = q.data as { a: Answer; from: string };

  const pdf = async () => {
    setBusy(true);
    try {
      const f = await markdownPdf(a.body, a.title, `مساعد سعي${from ? ` · شاركها ${from}` : ''}`);
      router.push({ pathname: '/pdf', params: { uri: f.uri, title: a.title } });
    } catch (e) {
      Alert.alert('تعذّر إنشاء PDF', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="إجابة من مساعد سعي" />
      <Row gap={10} style={{ alignItems: 'center' }}>
        <LogoMark size={26} ink={c.ink} dot={c.accent} />
        <View style={{ flex: 1 }}>
          <T weight="bold" size={16}>{a.title}</T>
          {from ? <T dim size={12}>شاركها {from}</T> : null}
        </View>
      </Row>
      <Card><RichText text={a.body} size={17} /></Card>
      <Row gap={10}>
        <Button style={{ flex: 1 }} title="PDF" icon="file" variant="secondary" loading={busy} onPress={pdf} />
        <Button style={{ flex: 1 }} title="إرسال" icon="send" variant="secondary" onPress={() => setPicking(true)} />
      </Row>
      <ConversationPicker visible={picking} onClose={() => setPicking(false)} title="إرسال الإجابة إلى"
        onPick={async (conv) => {
          try {
            await sendAttachment(conv.id, me.id, a);
            setPicking(false);
            tap('success');
            Alert.alert('أُرسلت', `أُرسلت الإجابة إلى «${conversationTitle(conv)}».`);
          } catch (e) {
            Alert.alert('لم تُرسل', e instanceof Error ? e.message : '');
          }
        }} />
    </Screen>
  );
}
