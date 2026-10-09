import { File, Paths, Directory } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { arDigits, locate, type OutlineNode } from '@saey/shared';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConversationPicker } from '@/components/conversation-picker';
import { tap } from '@/components/motion';
import { OutlineList } from '@/components/outline-list';
import { PdfView, type PdfViewHandle } from '@/components/pdf-view';
import { Sheet } from '@/components/sheet';
import { Button, IconButton, Row, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { conversationTitle } from '@/lib/chat';
import { signedUrl, uploadFile } from '@/lib/files';
import { loadOutline } from '@/lib/outline';
import { pdfName, sendAttachment } from '@/lib/pdf';
import { useTheme } from '@/lib/theme';

/**
 * عرض ملف PDF داخل التطبيق مع: حفظ في الهاتف، مشاركة، وإرسال إلى دردشة.
 * يقبل ملفاً محلياً (uri) أو مفتاح ملف مرفوع (key).
 */
export default function PdfScreen() {
  const { uri, key, title = 'ملف PDF', doc, from, to, page } = useLocalSearchParams<{ uri?: string; key?: string; title?: string; doc?: string; from?: string; to?: string; page?: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const [file, setFile] = useState<File | null>(uri ? new File(uri) : null);
  const [b64, setB64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // الفصل المعروض (نطاق صفحات) والصفحة الحالية؛ بلا نطاق = الملف كاملاً
  const [view, setView] = useState<{ from?: number; to?: number; goto?: number }>({ from: from ? Number(from) : undefined, to: to ? Number(to) : undefined, goto: page ? Number(page) : undefined });
  const [cur, setCur] = useState<number | undefined>(page ? Number(page) : from ? Number(from) : undefined);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [showOutline, setShowOutline] = useState(false);
  // ملف مفهرس فيه زرّا الفهرس والمساعد، فتُجمع بقية الأزرار في قائمة حتى لا يضيق العنوان
  const [menu, setMenu] = useState(false);
  const viewRef = useRef<PdfViewHandle>(null);

  // فهرس الملف (إن كان مفهرساً) للتنقل بين الفصول والمواضيع من داخل العارض
  useEffect(() => {
    if (!doc) return;
    loadOutline(doc).then(setOutline).catch(() => {});
  }, [doc]);
  const where = cur !== undefined && outline.length ? locate(outline, cur) : null;
  const goTo = (start: number, end: number | null, goto: number) => {
    setShowOutline(false);
    const sameRange = view.from === start && view.to === (end ?? undefined);
    if (sameRange) viewRef.current?.scrollToPage(goto);
    else { setView({ from: start, to: end ?? undefined, goto }); setCur(goto); }
  };

  // ملف مرفوع: نحمّله مرة واحدة إلى ذاكرة الهاتف المؤقتة
  useEffect(() => {
    if (file || !key) return;
    (async () => {
      const url = await signedUrl(key);
      const dest = new File(Paths.cache, pdfName(title));
      setFile(await File.downloadFileAsync(url, dest, { idempotent: true }));
    })().catch((e) => setError(e instanceof Error ? e.message : 'تعذّر تحميل الملف'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!file) return;
    file.base64().then(setB64).catch(() => setError('تعذّر قراءة الملف'));
  }, [file]);

  const share = async () => {
    if (!file) return;
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' }).catch(() => {});
  };

  // حفظ في مجلد يختاره الطالب (التنزيلات مثلاً)
  const save = async () => {
    if (!file) return;
    if (Platform.OS !== 'android') return share();
    try {
      const dir = await Directory.pickDirectoryAsync();
      const out = dir.createFile(pdfName(title).replace(/\.pdf$/, ''), 'application/pdf');
      out.write(await file.bytes());
      tap('success');
      Alert.alert('تم الحفظ', 'حُفظ الملف في المجلد الذي اخترته.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!/cancel/i.test(msg)) Alert.alert('لم يُحفظ الملف', msg);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Row gap={8} style={{ paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 12, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line, alignItems: 'center' }}>
        <IconButton name="back" label="رجوع" size={40} onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <T weight="bold" size={15} lines={1}>{title}</T>
          {where?.chapter ? <T dim size={12} lines={1}>{where.chapter.title}{where.topic ? ` · ${where.topic.title}` : ''}{cur ? ` · ص ${arDigits(cur)}` : ''}</T> : null}
        </View>
        {doc ? <IconButton name="sparkle" label="اسأل سعي AI عن هذه الصفحة" size={40} onPress={() => router.push({ pathname: '/ai/[id]', params: { id: 'new', doc, docPage: cur ? String(cur) : undefined, from: view.from ? String(view.from) : undefined, to: view.to ? String(view.to) : undefined, docTitle: title } })} /> : null}
        {outline.length ? <IconButton name="list" label="فهرس الفصول والمواضيع" size={40} onPress={() => setShowOutline(true)} /> : null}
        {doc || outline.length ? (
          <IconButton name="more" label="خيارات الملف" size={40} onPress={() => setMenu(true)} />
        ) : (
          <>
            <IconButton name="download" label="حفظ في الهاتف" size={40} onPress={save} />
            <IconButton name="share" label="مشاركة" size={40} onPress={share} />
            <IconButton name="send" label="إرسال إلى دردشة" size={40} onPress={() => setPicking(true)} />
          </>
        )}
      </Row>
      <View style={{ flex: 1 }}>
        {error ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><T dim center>{error}</T></View>
        ) : b64 ? <PdfView key={`${view.from ?? 0}-${view.to ?? 0}`} ref={viewRef} base64={b64} from={view.from} to={view.to} goto={view.goto} onPage={setCur} /> : <PdfView />}
      </View>
      <Sheet visible={showOutline} onClose={() => setShowOutline(false)}>
        <T display size={22}>فهرس {title}</T>
        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
          {view.from ? <Button title="عرض الملف كاملاً" variant="secondary" icon="file" onPress={() => { setShowOutline(false); setView({ goto: cur }); }} /> : null}
          <OutlineList nodes={outline} currentPage={cur} compact
            onChapter={(c) => goTo(c.start_page, c.end_page, c.start_page)}
            onTopic={(t, c) => goTo(c.start_page, c.end_page, t.start_page)} />
        </ScrollView>
      </Sheet>
      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <T display size={22}>{title}</T>
        <View style={{ gap: 10, paddingTop: 6 }}>
          <Button title="حفظ في الهاتف" icon="download" variant="secondary" onPress={() => { setMenu(false); save(); }} />
          <Button title="مشاركة" icon="share" variant="secondary" onPress={() => { setMenu(false); share(); }} />
          <Button title="إرسال إلى دردشة" icon="send" variant="secondary" onPress={() => { setMenu(false); setPicking(true); }} />
        </View>
      </Sheet>
      <ConversationPicker visible={picking} onClose={() => setPicking(false)} title="إرسال الملف إلى"
        onPick={async (conv) => {
          if (!file) return;
          try {
            const k = await uploadFile(file.uri, 'chat', 'application/pdf', conv.id);
            await sendAttachment(conv.id, me.id, { type: 'file', key: k, title, size: file.size ?? undefined });
            setPicking(false);
            tap('success');
            Alert.alert('أُرسل', `أُرسل الملف إلى «${conversationTitle(conv)}».`);
          } catch (e) {
            Alert.alert('لم يُرسل الملف', e instanceof Error ? e.message : '');
          }
        }} />
    </View>
  );
}
