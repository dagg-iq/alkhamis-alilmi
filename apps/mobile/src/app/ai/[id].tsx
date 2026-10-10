import type { AiSource, Subject } from '@saey/shared';
import { analyzeGrades, arDigits, studentBrief } from '@saey/shared';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Alert } from '@/lib/dialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardView, PressScale, tap } from '@/components/motion';
import { Icon, LogoMark, type IconName } from '@/components/icon';
import { ConversationPicker } from '@/components/conversation-picker';
import { Sheet, SheetItem } from '@/components/sheet';
import { RichText, clock } from '@/components/rich-text';
import { Chip, IconButton, Row, T, MAX_WIDTH } from '@/components/ui';
import { chatTitle } from '@/lib/ai-title';
import { useMe } from '@/lib/auth';
import { compressImage } from '@/lib/files';
import { conversationTitle } from '@/lib/chat';
import { openDocumentAt } from '@/lib/outline';
import { markdownPdf, sendAttachment } from '@/lib/pdf';
import { loadGoal } from '@/lib/goal';
import { loadMyGrades, loadSubjects, shortSubject } from '@/lib/queries';
import { useGradingRules } from '@/lib/settings';
import { callFunction, supabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';

interface Msg { id: string; role: 'user' | 'assistant'; content: string; sources?: AiSource[] | null; error?: boolean; files?: Pending[] }
/** مرفق ينتظر الإرسال مع السؤال (صورة مضغوطة أو PDF) */
interface Pending { uri: string; mime: string; name: string; size?: number }
/** خطة شرح فصل طويل على أقسام (من الخادم) */
interface Plan { title: string; docTitle: string; parts: { from: number; to: number }[]; next: number; ids: string[]; done?: boolean }
const MAX_PDF = 8 * 1048576;

/** طلبات جاهزة — تُكمل بالمادة المختارة */
// تُكتب في صندوق النص (لا تُرسل مباشرة) حتى يكمّلها الطالب: رقم الفصل أو اسم الموضوع
const QUICK: { icon: IconName; label: string; prompt: (subject: string) => string }[] = [
  { icon: 'book', label: 'اشرح فصلاً كاملاً', prompt: (s) => `اشرح لي الفصل ${s ? `… من ${s}` : '… من مادة …'} كاملاً بالتفصيل` },
  { icon: 'quiz', label: 'أسئلة امتحانية', prompt: (s) => `اعمل لي ١٠ أسئلة وزارية متنوعة${s ? ` في ${s}` : ''} عن … مع الإجابات النموذجية` },
  { icon: 'list', label: 'لخّص لي', prompt: (s) => `لخّص لي ${s ? `الفصل … من ${s}` : '…'} بشكل ملزمة مركزة: التعاريف والقوانين والتعليلات` },
  { icon: 'sparkle', label: 'حل مسألة', prompt: (s) => `حل لي هذه المسألة${s ? ` في ${s}` : ''} خطوة بخطوة: …` },
  { icon: 'check', label: 'الداخل في الامتحان', prompt: (s) => `ما المطلوب للامتحان وما هو للاطلاع في ${s ? `${s} — ` : ''}…؟` },
  { icon: 'target', label: 'انصحني حسب درجاتي', prompt: () => 'شوف درجاتي وهدفي، وقل لي بصراحة وضعي، وأي مادة أركز عليها هذا الأسبوع، واعمل لي خطة دراسة قصيرة.' },
];
/** بعد أول جواب: متابعة على نفس الموضوع */
const FOLLOW: { label: string; prompt: string }[] = [
  { label: 'وضّح أكثر', prompt: 'وضّح لي هذا أكثر بمثال أبسط' },
  { label: 'مثال محلول', prompt: 'أعطني مثالاً محلولاً خطوة بخطوة على هذا' },
  { label: 'أسئلة على هذا', prompt: 'اعمل لي ٥ أسئلة امتحانية على هذا مع الإجابات' },
  { label: 'لخّص الجواب', prompt: 'لخّص لي هذا الجواب في نقاط قصيرة للحفظ' },
  { label: 'الداخل في الامتحان', prompt: 'ما المطلوب للامتحان من هذا وما هو للاطلاع؟' },
];

/** طلبات جاهزة عند السؤال من داخل ملزمة/كتاب (الصفحة أو الفصل الحالي) */
const DOC_QUICK: { icon: IconName; label: string; prompt: (hasRange: boolean) => string }[] = [
  { icon: 'file', label: 'اشرح هذه الصفحة', prompt: () => 'اشرح لي هذه الصفحة بالتفصيل الوافي، نقطة نقطة، مع ذكر رقم الصفحة.' },
  { icon: 'book', label: 'اشرح الفصل', prompt: (r) => (r ? 'اشرح لي هذا الفصل كاملاً بالتفصيل بحسب ترتيب صفحاته، مع رقم الصفحة بجانب كل فقرة.' : 'اشرح لي هذا الفصل كاملاً بالتفصيل.') },
  { icon: 'list', label: 'لخّص الفصل', prompt: () => 'لخّص لي هذا الفصل في ملزمة مركزة: التعاريف والقوانين والتعليلات، مع أرقام الصفحات.' },
  { icon: 'quiz', label: 'أسئلة من الفصل', prompt: () => 'اعمل لي أسئلة امتحانية متنوعة من هذا الفصل مع الإجابات النموذجية، واذكر صفحة كل إجابة في الكتاب.' },
];

export default function AiChat() {
  const params = useLocalSearchParams<{ id: string; subjectId?: string; prompt?: string; doc?: string; docPage?: string; from?: string; to?: string; docTitle?: string }>();
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
  // السؤال من داخل عارض ملزمة: الملف والصفحة أو الفصل الذي يقرؤه الآن
  const [docCtx, setDocCtx] = useState<{ documentId: string; page?: number; from?: number; to?: number; title?: string } | null>(
    params.doc ? { documentId: params.doc, page: params.docPage ? Number(params.docPage) : undefined, from: params.from ? Number(params.from) : undefined, to: params.to ? Number(params.to) : undefined, title: params.docTitle } : null);
  const [thinking, setThinking] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [files, setFiles] = useState<Pending[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);
  const inputRef = useRef<TextInput>(null);
  // الاقتراح يُكتب في الصندوق ليكمله الطالب، والمؤشر عند «…» إن وُجدت
  const suggest = (p: string) => { setText(p); tap('light'); setTimeout(() => inputRef.current?.focus(), 50); };

  const pickImage = async (camera: boolean) => {
    setAttachOpen(false);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: !camera, selectionLimit: 4 };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    try {
      const out: Pending[] = [];
      for (const a of res.assets.slice(0, 4)) {
        const img = await compressImage(a.uri);
        out.push({ uri: img.uri, mime: 'image/jpeg', name: 'صورة' });
      }
      setFiles((f) => [...f, ...out].slice(0, 4));
    } catch (e) {
      Alert.alert('تعذّر تجهيز الصورة', e instanceof Error ? e.message : '');
    }
  };
  const pickPdf = async () => {
    setAttachOpen(false);
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const f = res.assets[0];
    if ((f.size ?? 0) > MAX_PDF) return Alert.alert('الملف كبير', 'أقصى حجم لملف PDF مع السؤال ٨ ميغا. أرسل الصفحات المهمة فقط (أو صوّرها).');
    setFiles((list) => [...list, { uri: f.uri, mime: 'application/pdf', name: f.name || 'ملف PDF', size: f.size ?? undefined }].slice(0, 4));
  };

  useEffect(() => {
    loadSubjects().then(setSubjects).catch(() => {});
    // ملخص درجات الطالب وهدفه حتى ينصحه المساعد بناءً عليها
    Promise.all([loadSubjects(), loadMyGrades(me.id), loadGoal()]).then(([subs, grades, goal]) => {
      brief.current = studentBrief(analyzeGrades(subs, grades, goal ?? 'general', rules));
    }).catch(() => {});
    if (chatId) {
      supabase.from('ai_chats').select('plan').eq('id', chatId).maybeSingle().then(({ data }) => {
        const p = data?.plan as Plan | null | undefined;
        if (p?.parts?.length) setPlan({ ...p, done: p.next >= p.parts.length });
      });
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
    const sending = preset ? [] : files;
    if ((!question && !sending.length) || thinking) return;
    setText('');
    setFiles([]);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', content: question || 'اشرح لي ما في المرفق', files: sending }]);
    setThinking(true);
    try {
      const attachments = await Promise.all(sending.map(async (f) => ({ mime: f.mime, name: f.name, data: await new File(f.uri).base64() })));
      const res = await callFunction<{ chatId: string; answer: string; messageId: string | null; sources: AiSource[]; remaining?: number | null; plan?: Plan | null }>('ai-chat', {
        chatId, message: question, subjectId, brief: brief.current,
        ...(attachments.length ? { attachments } : {}),
        ...(docCtx ? { context: { documentId: docCtx.documentId, page: docCtx.page, from: docCtx.from, to: docCtx.to } } : {}),
      });
      setChatId(res.chatId);
      if (res.plan) setPlan(res.plan);
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

  // عنوان PDF مرتب: «شرح: قانون كولوم»، «أسئلة: الفيزياء»… بدل نص السؤال كما هو
  const titleFor = (m: Msg) => {
    const i = messages.indexOf(m);
    const question = i > 0 ? messages[i - 1] : null;
    if (plan?.ids.includes(m.id)) return `شرح ${plan.title} — القسم ${arDigits(plan.ids.indexOf(m.id) + 1)}`;
    const base = question?.role === 'user' ? chatTitle(question.content.replace(/\n\n\(مرفقات:[^)]*\)$/, '')) : 'مساعد سعي';
    return subjectName && !base.includes(subjectName.replace(/^ال/, '')) ? `${base} — ${shortSubject(subjectName)}` : base;
  };

  // كل أقسام الشرح المقسّم في ملف PDF واحد مرتب
  const [seriesBusy, setSeriesBusy] = useState(false);
  const seriesPdf = async () => {
    if (!plan || seriesBusy) return;
    setSeriesBusy(true);
    try {
      let byId = new Map(messages.map((x) => [x.id, x.content]));
      if (plan.ids.some((id) => !byId.has(id))) {
        const { data } = await supabase.from('ai_messages').select('id, content').in('id', plan.ids);
        byId = new Map([...byId, ...((data ?? []) as { id: string; content: string }[]).map((r) => [r.id, r.content] as [string, string])]);
      }
      // نحذف جمل «اكتب أكمل» و«سأقسم لك» فيبقى الشرح متصلاً
      const clean = (t: string) => t.split('\n').filter((l) => !/اكتب\s*«?\s*أكمل|سأشرحه لك على|سأقسم|انتهى القسم|اكتمل شرح الفصل/.test(l)).join('\n').trim();
      const body = plan.ids.map((id) => clean(byId.get(id) ?? '')).filter(Boolean).join('\n\n---\n\n');
      const title = `شرح ${plan.title}`;
      const f = await markdownPdf(`> **${plan.docTitle}** — ${arDigits(plan.ids.length)} أقسام (الصفحات ${arDigits(plan.parts[0].from)}–${arDigits(plan.parts[plan.parts.length - 1].to)})\n\n${body}`, title, `${me.full_name ? `${me.full_name} · ` : ''}مساعد سعي`);
      router.push({ pathname: '/pdf', params: { uri: f.uri, title } });
    } catch (e) {
      Alert.alert('تعذّر إنشاء PDF', e instanceof Error ? e.message : '');
    } finally {
      setSeriesBusy(false);
    }
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
              {(docCtx ? DOC_QUICK.map((q) => ({ ...q, prompt: () => q.prompt(!!docCtx.from) })) : QUICK).map((q) => (
                <PressScale key={q.label} onPress={() => suggest(q.prompt(subjectName))} haptic accessibilityRole="button"
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
          <View style={{ alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: c.ink, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
            {item.files?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {item.files.map((f, i) => f.mime.startsWith('image/')
                  ? <Image key={i} source={{ uri: f.uri }} style={{ width: 84, height: 84, borderRadius: 12 }} contentFit="cover" />
                  : <Row key={i} gap={6} style={{ paddingHorizontal: 10, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)' }}><Icon name="file" size={14} color={c.bg} /><T size={12} color={c.bg} lines={1}>{f.name}</T></Row>)}
              </View>
            ) : null}
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
            {plan?.done && item.id === plan.ids[plan.ids.length - 1] ? (
              <PressScale onPress={seriesPdf} disabled={seriesBusy} accessibilityRole="button" accessibilityLabel="تحميل الشرح الكامل PDF"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: c.accent }}>
                {seriesBusy ? <ActivityIndicator color={c.accentInk} /> : <Icon name="file" size={24} color={c.accentInk} />}
                <View style={{ flex: 1 }}>
                  <T weight="bold" color={c.accentInk}>الشرح الكامل في ملف PDF واحد</T>
                  <T size={12} color={c.accentInk}>{plan.title} · {arDigits(plan.ids.length)} أقسام مدموجة بترتيبها</T>
                </View>
                <Icon name="forward" size={16} color={c.accentInk} />
              </PressScale>
            ) : null}
            {item.sources?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {item.sources.map((s, i) => (
                  <Pressable key={i} disabled={!s.lecture_id && !s.document_id}
                    onPress={() => {
                      if (s.lecture_id) router.push({ pathname: '/lecture/[id]', params: { id: s.lecture_id, t: String(s.start ?? 0) } });
                      else if (s.document_id) openDocumentAt(s.document_id, { page: s.page }).catch((e) => Alert.alert('تعذّر الفتح', e instanceof Error ? e.message : ''));
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.soft }}>
                    <Icon name={s.lecture_id ? 'play' : 'file'} size={12} color={c.accent} />
                    <T size={11} weight="bold" color={c.softInk}>
                      [{arDigits(i + 1)}] {s.title}{s.page ? ` · ص${arDigits(s.page)}${s.printed && s.printed !== String(s.page) ? ` (المطبوعة ${arDigits(s.printed)})` : ''}` : ''}{s.lecture_id ? ` · ${arDigits(clock(s.start ?? 0))}` : ''}
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

      {plan && !plan.done && !thinking ? (
        <Row gap={10} style={{ backgroundColor: c.soft, paddingVertical: 8, paddingHorizontal: Math.max(12, (width - MAX_WIDTH) / 2), borderTopWidth: 1, borderTopColor: c.line }}>
          <View style={{ flex: 1 }}>
            <T size={12} weight="bold" color={c.softInk} lines={1}>شرح {plan.title}: انتهى {arDigits(plan.next)} من {arDigits(plan.parts.length)} أقسام</T>
            <T size={11} color={c.softInk}>التالي: الصفحات {arDigits(plan.parts[plan.next].from)}–{arDigits(plan.parts[plan.next].to)}</T>
          </View>
          <Chip small label="أكمل القسم التالي" active onPress={() => ask('أكمل')} />
        </Row>
      ) : null}
      {messages.length && !thinking ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          style={{ flexGrow: 0, flexShrink: 0, height: 46, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, alignItems: 'center', paddingTop: 6 }}>
          {(docCtx ? DOC_QUICK.map((q) => ({ label: q.label, prompt: q.prompt(!!docCtx.from) })) : FOLLOW).map((q) => <Chip small key={q.label} label={q.label} onPress={() => suggest(q.prompt)} />)}
        </ScrollView>
      ) : null}
      {docCtx ? (
        <Row gap={8} style={{ backgroundColor: c.soft, paddingVertical: 8, paddingHorizontal: Math.max(12, (width - MAX_WIDTH) / 2), borderTopWidth: 1, borderTopColor: c.line }}>
          <Icon name="file" size={16} color={c.accent} />
          <T size={12} weight="bold" color={c.softInk} lines={1} style={{ flex: 1 }}>
            تسأل عن: {docCtx.title ?? 'الملزمة'}{docCtx.page ? ` · صفحة ${arDigits(docCtx.page)}` : docCtx.from ? ` · ص ${arDigits(docCtx.from)}–${arDigits(docCtx.to ?? docCtx.from)}` : ''}
          </T>
          <Pressable onPress={() => setDocCtx(null)} accessibilityLabel="إلغاء ربط السؤال بالملزمة" hitSlop={8}><Icon name="close" size={16} color={c.softInk} /></Pressable>
        </Row>
      ) : null}
      {files.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, backgroundColor: c.card }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: Math.max(12, (width - MAX_WIDTH) / 2), paddingTop: 8 }}>
          {files.map((f, i) => (
            <View key={`${f.uri}-${i}`}>
              {f.mime.startsWith('image/')
                ? <Image source={{ uri: f.uri }} style={{ width: 60, height: 60, borderRadius: 12 }} contentFit="cover" />
                : <View style={{ width: 130, height: 60, borderRadius: 12, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 2 }}>
                    <Icon name="file" size={18} color={c.accent} />
                    <T size={11} lines={1} color={c.softInk}>{f.name}</T>
                  </View>}
              <Pressable onPress={() => setFiles(files.filter((_, j) => j !== i))} accessibilityLabel="إزالة المرفق" hitSlop={6}
                style={{ position: 'absolute', top: -6, left: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={12} color={c.bg} strokeWidth={2.4} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <Row gap={8} style={{ backgroundColor: c.card, paddingTop: 10, paddingBottom: insets.bottom + 10, borderTopWidth: messages.length && !thinking ? 0 : 1, borderTopColor: c.line, alignItems: 'flex-end', paddingHorizontal: Math.max(12, (width - MAX_WIDTH) / 2) }}>
        <Pressable onPress={() => setAttachOpen(true)} disabled={thinking} accessibilityLabel="إرفاق صورة أو ملف"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="paperclip" size={22} color={c.ink2} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder="اكتب سؤالك…"
          placeholderTextColor={c.ink3}
          multiline
          style={{ flex: 1, minHeight: 44, maxHeight: 160, borderRadius: 22, backgroundColor: c.bg, paddingHorizontal: 16, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 16, color: c.ink, writingDirection: 'rtl' }}
        />
        <Pressable onPress={() => ask()} disabled={thinking || (!text.trim() && !files.length)} accessibilityLabel="إرسال"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: (text.trim() || files.length) && !thinking ? c.accent : c.line, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={20} color={(text.trim() || files.length) && !thinking ? c.accentInk : c.ink3} strokeWidth={2} />
        </Pressable>
      </Row>
      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)}>
        <SheetItem icon="camera" label="تصوير (سؤال، صفحة، حلّك)" onPress={() => pickImage(true)} />
        <SheetItem icon="image" label="صور من المعرض (حتى ٤)" onPress={() => pickImage(false)} />
        <SheetItem icon="file" label="ملف PDF (حتى ٨ ميغا)" onPress={pickPdf} />
      </Sheet>
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
