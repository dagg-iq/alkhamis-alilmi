import { DOCUMENT_KIND_LABELS, arDigits, type DocumentRow } from '@saey/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Icon } from '@/components/icon';
import { Button, ErrorBox, Header, Loading, Screen, T } from '@/components/ui';
import { PdfThumb } from '@/components/pdf-thumb';
import { downloadMaterial, isDownloaded, openPdf, removeDownload, sharePdf, signedUrl } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [, force] = useState(0);
  const q = useLoad(async () => must(supabase.from('documents').select('*, subjects(name)').eq('id', id).single()) as Promise<DocumentRow & { subjects: { name: string } }>, [id]);

  // معاينة الصفحة الأولى: من الملف المحفوظ إن وُجد، وإلا من رابط مؤقت (يحمّل الصفحة الأولى فقط)
  const key = q.data?.file_key;
  const preview = useLoad(async () => {
    if (!key) return null;
    if (isDownloaded(key)) return { base64: await downloadMaterial(key).then((f) => f.base64()) };
    return { url: await signedUrl(key) };
  }, [key]);

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const d = q.data;
  const saved = isDownloaded(d.file_key);

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try { await fn(); } catch (e) { Alert.alert('تعذّر', e instanceof Error ? e.message : ''); }
    setBusy(null);
    force((n) => n + 1);
  };

  return (
    <Screen>
      <Header />
      <View style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}>
        {preview.data ? <PdfThumb {...preview.data} width={230} /> : (
          <View style={{ width: 88, height: 104, borderRadius: 18, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file" size={40} color={c.accent} />
          </View>
        )}
        <T display size={26} center>{d.title}</T>
        <T dim center>{d.subjects.name} · {DOCUMENT_KIND_LABELS[d.kind]}{d.pages ? ` · ${arDigits(d.pages)} صفحة` : ''}</T>
      </View>
      <Button title={saved ? 'فتح' : 'تحميل وفتح'} icon={saved ? 'file' : 'download'} loading={busy === 'open'} onPress={() => run('open', () => openPdf(d.file_key, d.title))} />
      <Button title="مشاركة" variant="secondary" icon="share" loading={busy === 'share'} onPress={() => run('share', () => sharePdf(d.file_key, d.title))} />
      {saved ? <Button title="حذف من الهاتف" variant="ghost" onPress={() => { removeDownload(d.file_key); force((n) => n + 1); }} /> : null}
      <T dim size={12} center>{saved ? 'محفوظ على هاتفك — يفتح بدون إنترنت' : 'بعد التحميل يمكنك فتحه بدون إنترنت'}</T>
    </Screen>
  );
}
