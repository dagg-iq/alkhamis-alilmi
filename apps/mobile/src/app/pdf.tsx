import { File, Paths, Directory } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConversationPicker } from '@/components/conversation-picker';
import { tap } from '@/components/motion';
import { PdfView } from '@/components/pdf-view';
import { IconButton, Row, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { conversationTitle } from '@/lib/chat';
import { signedUrl, uploadFile } from '@/lib/files';
import { pdfName, sendAttachment } from '@/lib/pdf';
import { useTheme } from '@/lib/theme';

/**
 * عرض ملف PDF داخل التطبيق مع: حفظ في الهاتف، مشاركة، وإرسال إلى دردشة.
 * يقبل ملفاً محلياً (uri) أو مفتاح ملف مرفوع (key).
 */
export default function PdfScreen() {
  const { uri, key, title = 'ملف PDF' } = useLocalSearchParams<{ uri?: string; key?: string; title?: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const [file, setFile] = useState<File | null>(uri ? new File(uri) : null);
  const [b64, setB64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

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
        <T weight="bold" size={15} lines={1} style={{ flex: 1 }}>{title}</T>
        <IconButton name="download" label="حفظ في الهاتف" size={40} onPress={save} />
        <IconButton name="share" label="مشاركة" size={40} onPress={share} />
        <IconButton name="send" label="إرسال إلى دردشة" size={40} onPress={() => setPicking(true)} />
      </Row>
      <View style={{ flex: 1 }}>
        {error ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><T dim center>{error}</T></View>
        ) : b64 ? <PdfView base64={b64} /> : <PdfView />}
      </View>
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
