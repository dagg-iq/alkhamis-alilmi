import type { AiSource, Subject } from '@saey/shared';
import { analyzeGrades, arDigits, studentBrief } from '@saey/shared';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardView, PressScale, tap } from '@/components/motion';
import { Icon, LogoMark, type IconName } from '@/components/icon';
import { ConversationPicker } from '@/components/conversation-picker';
import { RichText, clock } from '@/components/rich-text';
import { Chip, IconButton, Row, T, MAX_WIDTH } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { conversationTitle } from '@/lib/chat';
import { markdownPdf, sendAttachment } from '@/lib/pdf';
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
      supabase.from('ai_messages').select('id, role, content, sources, created_at').eq('chat_id', chatId).order('created_at')
        .then(({ data }) => {
          // السؤال قبل جوابه حتى لو حُفظا بنفس الوقت (رسائل قديمة)
          const rows = ((data ?? []) as (Msg & { created_at: string })[])
            .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || (a.role === 'user' ? -1 : 1));
          setMessages(rows);
        });
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
      const res = await callFunction<{ chatId: string; answer: string; messageId: string | null; sources: AiSource[]; remaining?: number | null }>('ai-chat', {
        chatId, message: question, subjectId, brief: brief.current,
      });
      setChatId(res.chatId);
      if (res.remaining !== undefined) setRemaining(res.remaining);
      setMessages((m) => [...m, { id: res.messageId ?? `a${Date.now()}`, role: 'assistant', content: res.answer, sources: res.sources }]);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: 'assistant', content: e instanceof Error ? e.message : 'حدث خطأ', error: true }]);
    } finally {
      setThinking(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  const subjectName = subjects.find((x) => x.id === subjectId)?.name ?? '';

  const titleFor = (m: Msg) => {
    const i = messages.indexOf(m);
    const question = i > 0 ? messages[i - 1] : null;
    return question?.role === 'user' ? (question.content.length > 70 ? `${question.content.slice(0, 70)}…` : question.content) : 'مساعد سعي';
  };

  // تحويل الإجابة إلى PDF: يظهر في المحادثة كمرفق من المساعد «تم التحويل إلى PDF»، ويُفتح داخل التطبيق
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const openPdf = async (source: Msg) => {
    const title = titleFor(source);
    const f = await markdownPdf(source.content, title, `${me.full_name ? `${me.full_name} · ` : ''}مساعد سعي`);
    router.push({ pathname: '/pdf', params: { uri: f.uri, title } });
  };
  const exportPdf = async (m: Msg) => {
    if (pdfBusy) return;
    setPdfBusy(m.id);
    try {
      await markdownPdf(m.content, titleFor(m)); // نتأكد أن التحويل نجح قبل الرسالة
      let noteId = `p${Date.now()}`;
      if (chatId && /^[0-9a-f-]{36}$/.test(m.id)) {
        const r = await callFunction<{ id: string }>('ai-chat', { chatId, note: 'pdf', of: m.id }).catch(() => null);
        if (r?.id) noteId = r.id;
      }
      setMessages((list) => [...list, { id: noteId, role: 'assistant', content: `[[pdf:${m.id}]]` }]);
      tap('success');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e) {
      Alert.alert('تعذّر إنشاء PDF', e instanceof Error ? e.message : '');
    } finally {
      setPdfBusy(null);
    }
  };

  const [sharing, setSharing] = useState<Msg | null>(null);

  const pdfCard = (of: string) => {
    const source = messages.find((x) => x.id === of);
    return (
      <PressScale onPress={() => source && openPdf(source).catch((e) => Alert.alert('تعذّر فتح PDF', e instanceof Error ? e.message : ''))}
        accessibilityRole="button" accessibilityLabel="فتح ملف PDF"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: c.soft, maxWidth: 320 }}>
        <View style={{ width: 46, height: 54, borderRadius: 10, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="file" size={24} color={c.accent} />
          <View style={{ position: 'absolute', bottom: 4, paddingHorizontal: 4, borderRadius: 4, backgroundColor: c.accent }}>
            <T size={8} weight="bold" color={c.accentInk}>PDF</T>
          </View>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <T size={11} weight="bold" color={c.ink2}>تم التحويل إلى PDF</T>
          <T weight="bold" size={14} lines={2}>{source ? titleFor(source) : 'ملف PDF'}</T>
          <T size={12} color={c.ink2}>اضغط للفتح، ثم احفظه أو أرسله</T>
        </View>
        <Icon name="forward" size={16} color={c.ink2} />
      </PressScale>
    );
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
              {item.error ? <T color={verdict.risk.ink}>{item.content}</T> : (
                <RichText text={item.content} size={17} renderToken={(t) => (t.kind === 'pdf' ? pdfCard(t.of) : null)} />
              )}
            </View>
            {!item.error && !item.content.startsWith('[[pdf:') ? (
              <Row gap={8}>
                <AnswerAction icon="file" label="PDF" busy={pdfBusy === item.id} onPress={() => exportPdf(item)} />
                <AnswerAction icon="share" label="مشاركة" onPress={() => setSharing(item)} />
                <AnswerAction icon="copy" label="نسخ" onPress={() => { Clipboard.setStringAsync(item.content); tap('success'); }} />
              </Row>
            ) : null}
            {item.sources?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {item.sources.map((s, i) => (
                  <Pressable key={i} disabled={!s.lecture_id}
                    onPress={() => s.lecture_id && router.push({ pathname: '/lecture/[id]', params: { id: s.lecture_id, t: String(s.start ?? 0) } })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.soft }}>
                    <Icon name={s.lecture_id ? 'play' : 'file'} size={12} color={c.accent} />
                    <T size={11} weight="bold" color={c.softInk}>
                      [{arDigits(i + 1)}] {s.title}{s.page ? ` · ص${arDigits(s.page)}` : ''}{s.lecture_id ? ` · ${arDigits(clock(s.start ?? 0))}` : ''}
                    </T>
                  </Pressable>
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
          style={{ flexGrow: 0, flexShrink: 0, height: 46, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, alignItems: 'center', paddingTop: 6 }}>
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
      <ConversationPicker visible={!!sharing} onClose={() => setSharing(null)} title="مشاركة الإجابة مع"
        onPick={async (conv) => {
          if (!sharing) return;
          try {
            await sendAttachment(conv.id, me.id, { type: 'answer', title: titleFor(sharing), body: sharing.content.slice(0, 20000) });
            setSharing(null);
            tap('success');
            Alert.alert('أُرسلت', `أُرسلت الإجابة إلى «${conversationTitle(conv)}».`);
          } catch (e) {
            Alert.alert('لم تُرسل', e instanceof Error ? e.message : '');
          }
        }} />
    </KeyboardView>
  );
}

function AnswerAction({ icon, label, onPress, busy }: { icon: IconName; label: string; onPress: () => void; busy?: boolean }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label === 'PDF' ? 'تحويل الإجابة إلى PDF' : label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
      {busy ? <ActivityIndicator size="small" color={c.ink2} /> : <Icon name={icon} size={16} color={c.ink2} />}
      <T size={13} weight="bold" color={c.ink2}>{label}</T>
    </PressScale>
  );
}
