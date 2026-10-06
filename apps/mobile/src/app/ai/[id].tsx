import type { AiSource, Subject } from '@saey/shared';
import { analyzeGrades, arDigits, studentBrief } from '@saey/shared';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardView, PressScale, tap } from '@/components/motion';
import { Icon, LogoMark, type IconName } from '@/components/icon';
import { RichText, markdownHtml } from '@/components/rich-text';
import { Chip, IconButton, Row, T, MAX_WIDTH } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { loadGoal } from '@/lib/goal';
import { loadMyGrades, loadSubjects, shortSubject } from '@/lib/queries';
import { useGradingRules } from '@/lib/settings';
import { callFunction, supabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';

interface Msg { id: string; role: 'user' | 'assistant'; content: string; sources?: AiSource[] | null; error?: boolean }

/** طلبات جاهزة — تُكمل بالمادة المختارة */
const QUICK: { icon: IconName; label: string; prompt: (subject: string) => string }[] = [
  { icon: 'quiz', label: 'اعمل لي أسئلة', prompt: (s) => `اعمل لي ١٠ أسئلة امتحانية متنوعة${s ? ` في ${s}` : ''} مع الإجابات النموذجية في النهاية.` },
  { icon: 'list', label: 'لخّص لي', prompt: (s) => `لخّص لي أهم نقاط${s ? ` ${s}` : ' الفصل الذي أدرسه'} بشكل ملزمة مركزة: التعاريف والقوانين والتعليلات.` },
  { icon: 'sparkle', label: 'اشرح بمثال', prompt: (s) => `اشرح لي${s ? ` أصعب موضوع في ${s}` : ' '} بمثال محلول خطوة بخطوة.` },
  { icon: 'target', label: 'انصحني حسب درجاتي', prompt: () => 'شوف درجاتي وهدفي، وقل لي بصراحة وضعي، وأي مادة أركز عليها هذا الأسبوع، واعمل لي خطة دراسة قصيرة.' },
];

export default function AiChat() {
  const params = useLocalSearchParams<{ id: string; subjectId?: string; prompt?: string }>();
  const { c, verdict } = useTheme();
  const me = useMe();
  const rules = useGradingRules();
  const brief = useRef('');
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
    // ملخص درجات الطالب وهدفه حتى ينصحه المساعد بناءً عليها
    Promise.all([loadSubjects(), loadMyGrades(me.id), loadGoal()]).then(([subs, grades, goal]) => {
      brief.current = studentBrief(analyzeGrades(subs, grades, goal ?? 'general', rules));
    }).catch(() => {});
    if (chatId) {
      supabase.from('ai_messages').select('id, role, content, sources').eq('chat_id', chatId).order('created_at')
        .then(({ data }) => setMessages((data ?? []) as Msg[]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async (preset?: string) => {
    const question = (preset ?? text).trim();
    if (!question || thinking) return;
    setText('');
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', content: question }]);
    setThinking(true);
    try {
      const res = await callFunction<{ chatId: string; answer: string; sources: AiSource[]; remaining: number | null }>('ai-chat', {
        chatId, message: question, subjectId, brief: brief.current,
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

  const subjectName = subjects.find((x) => x.id === subjectId)?.name ?? '';

  const exportPdf = async (m: Msg) => {
    const question = messages[messages.indexOf(m) - 1];
    const title = question?.role === 'user' ? (question.content.length > 70 ? `${question.content.slice(0, 70)}…` : question.content) : 'مساعد سعي';
    try {
      const html = markdownHtml(m.content, { color: '#111111', bg: '#FFFFFF', accent: '#2346F5', size: 16, title, footer: `${me.full_name} · مساعد سعي` });
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
    } catch (e) {
      Alert.alert('تعذّر إنشاء PDF', e instanceof Error ? e.message : '');
    }
  };

  return (
    <KeyboardView style={{ flex: 1, backgroundColor: c.bg }} bottomInset={insets.bottom}>
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
        contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', gap: 18, paddingTop: 40 }}>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <LogoMark size={56} ink={c.ink} dot={c.accent} />
              <T display size={24} center>{me.full_name ? `أهلاً ${me.full_name.split(' ')[0]}، شنو نراجع اليوم؟` : 'اسأل أي سؤال عن المنهج'}</T>
              <T dim center size={14}>مسألة، قانون، تعريف، تلخيص، أو أسئلة امتحانية.{'\n'}أعرف درجاتك وهدفك، فاسألني عن خطتك أيضاً.</T>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {QUICK.map((q) => (
                <PressScale key={q.label} onPress={() => ask(q.prompt(subjectName))} haptic accessibilityRole="button"
                  style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={q.icon} size={20} color={c.accent} />
                  </View>
                  <T weight="bold" size={15}>{q.label}</T>
                </PressScale>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => item.role === 'user' ? (
          <View style={{ alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: c.ink, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 }}>
            <T color={c.bg} selectable>{item.content}</T>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={{ backgroundColor: item.error ? verdict.risk.bg : c.card, borderRadius: 20, borderWidth: item.error ? 0 : 1, borderColor: c.line, padding: 14 }}>
              {item.error ? <T color={verdict.risk.ink}>{item.content}</T> : <RichText text={item.content} size={17} />}
            </View>
            {!item.error ? (
              <Row gap={8}>
                <AnswerAction icon="file" label="PDF" onPress={() => exportPdf(item)} />
                <AnswerAction icon="copy" label="نسخ" onPress={() => { Clipboard.setStringAsync(item.content); tap('success'); }} />
              </Row>
            ) : null}
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

      {messages.length && !thinking ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          style={{ flexGrow: 0, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingTop: 10 }}>
          {QUICK.map((q) => <Chip small key={q.label} label={q.label} onPress={() => ask(q.prompt(subjectName))} />)}
        </ScrollView>
      ) : null}
      <Row gap={8} style={{ backgroundColor: c.card, paddingTop: 10, paddingBottom: insets.bottom + 10, borderTopWidth: messages.length && !thinking ? 0 : 1, borderTopColor: c.line, alignItems: 'flex-end', paddingHorizontal: Math.max(12, (width - MAX_WIDTH) / 2) }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="اكتب سؤالك…"
          placeholderTextColor={c.ink3}
          multiline
          style={{ flex: 1, minHeight: 44, maxHeight: 160, borderRadius: 22, backgroundColor: c.bg, paddingHorizontal: 16, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 16, color: c.ink, writingDirection: 'rtl' }}
        />
        <Pressable onPress={() => ask()} disabled={thinking || !text.trim()} accessibilityLabel="إرسال"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() && !thinking ? c.accent : c.line, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={20} color={text.trim() && !thinking ? c.accentInk : c.ink3} strokeWidth={2} />
        </Pressable>
      </Row>
    </KeyboardView>
  );
}

function AnswerAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label === 'PDF' ? 'حفظ الإجابة PDF' : label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
      <Icon name={icon} size={16} color={c.ink2} />
      <T size={13} weight="bold" color={c.ink2}>{label}</T>
    </PressScale>
  );
}
