import type { AiSource, Subject } from '@saey/shared';
import { arDigits } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, LogoMark } from '@/components/icon';
import { RichText } from '@/components/rich-text';
import { Chip, IconButton, Row, T } from '@/components/ui';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { callFunction, supabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';

interface Msg { id: string; role: 'user' | 'assistant'; content: string; sources?: AiSource[] | null; error?: boolean }

export default function AiChat() {
  const params = useLocalSearchParams<{ id: string; subjectId?: string; prompt?: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [chatId, setChatId] = useState<string | null>(params.id === 'new' ? null : params.id);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState(params.prompt ?? '');
  const [subjectId, setSubjectId] = useState<string | null>(params.subjectId || null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [thinking, setThinking] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  useEffect(() => {
    loadSubjects().then(setSubjects).catch(() => {});
    if (chatId) {
      supabase.from('ai_messages').select('id, role, content, sources').eq('chat_id', chatId).order('created_at')
        .then(({ data }) => setMessages((data ?? []) as Msg[]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async () => {
    const question = text.trim();
    if (!question || thinking) return;
    setText('');
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', content: question }]);
    setThinking(true);
    try {
      const res = await callFunction<{ chatId: string; answer: string; sources: AiSource[]; remaining: number | null }>('ai-chat', {
        chatId, message: question, subjectId,
      });
      setChatId(res.chatId);
      setRemaining(res.remaining);
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: 'assistant', content: res.answer, sources: res.sources }]);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: 'assistant', content: e instanceof Error ? e.message : 'حدث خطأ', error: true }]);
    } finally {
      setThinking(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, gap: 10, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Row>
          <IconButton name="back" label="رجوع" size={40} onPress={() => router.back()} />
          <LogoMark size={28} ink={c.ink} dot={c.accent} />
          <View style={{ flex: 1 }}>
            <T weight="bold" size={16}>مساعد سعي</T>
            {remaining !== null ? <T dim size={12}>باقي لك اليوم {arDigits(remaining)} سؤالاً</T> : null}
          </View>
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip small label="كل المواد" active={!subjectId} onPress={() => setSubjectId(null)} />
          {subjects.map((s) => <Chip small key={s.id} label={shortSubject(s.name)} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
        </ScrollView>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60 }}>
            <LogoMark size={56} ink={c.ink} dot={c.accent} />
            <T display size={22} center>اسأل أي سؤال عن المنهج</T>
            <T dim center size={14}>مسألة، قانون، تعريف، أو اطلب تلخيص فصل.{'\n'}اختر المادة من الأعلى لإجابة أدق.</T>
          </View>
        }
        renderItem={({ item }) => item.role === 'user' ? (
          <View style={{ alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: c.ink, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 }}>
            <T color={c.bg} selectable>{item.content}</T>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={{ backgroundColor: item.error ? '#FBE6E4' : c.card, borderRadius: 20, borderWidth: 1, borderColor: c.line, padding: 14 }}>
              {item.error ? <T color="#A82620">{item.content}</T> : <RichText text={item.content} size={16} />}
            </View>
            {item.sources?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {item.sources.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.soft }}>
                    <Icon name="file" size={12} color={c.accent} />
                    <T size={11} weight="bold" color={c.softInk}>[{arDigits(i + 1)}] {s.title}{s.page ? ` · ص${arDigits(s.page)}` : ''}</T>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
        ListFooterComponent={thinking ? (
          <Row style={{ paddingVertical: 8 }}>
            <ActivityIndicator color={c.accent} />
            <T dim size={13}>يفكّر ويبحث في الملازم…</T>
          </Row>
        ) : null}
      />

      <Row gap={8} style={{ backgroundColor: c.card, paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderTopColor: c.line, alignItems: 'flex-end' }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="اكتب سؤالك…"
          placeholderTextColor={c.ink3}
          multiline
          style={{ flex: 1, minHeight: 44, maxHeight: 160, borderRadius: 22, backgroundColor: c.bg, paddingHorizontal: 16, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 16, color: c.ink, writingDirection: 'rtl' }}
        />
        <Pressable onPress={ask} disabled={thinking || !text.trim()} accessibilityLabel="إرسال"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() && !thinking ? c.accent : c.line, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={20} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
      </Row>
    </KeyboardAvoidingView>
  );
}
