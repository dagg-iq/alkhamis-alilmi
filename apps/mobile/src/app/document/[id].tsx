import { DOCUMENT_KIND_LABELS, arDigits, type DocumentRow } from '@saey/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Icon } from '@/components/icon';
import { Button, ErrorBox, ProgressBar, Header, Loading, Row, Screen, T } from '@/components/ui';
import { OutlineList } from '@/components/outline-list';
import { PdfThumb } from '@/components/pdf-thumb';
import { downloadMaterial, isDownloaded, openPdf, removeDownload, sharePdf, signedUrl } from '@/lib/files';
import { loadOutline } from '@/lib/outline';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<{ got: number; total: number } | null>(null);
  // حالة «محفوظ» صريحة: تتحدث فور انتهاء التحميل وعند العودة للشاشة (كان زر التحميل يبقى ظاهراً بعد انتهائه)
  const [savedNow, setSavedNow] = useState<boolean | null>(null);
  const q = useLoad(async () => must(supabase.from('documents').select('*, subjects(name)').eq('id', id).single()) as Promise<DocumentRow & { subjects: { name: string } }>, [id], { key: `document:${id}` });

  const outline = useLoad(() => loadOutline(id), [id], { key: `outline:${id}` });

  // معاينة الصفحة الأولى: من الملف المحفوظ إن وُجد، وإلا من رابط مؤقت (يحمّل الصفحة الأولى فقط)
  const key = q.data?.file_key;
  const preview = useLoad(async () => {
    if (!key) return null;
    if (isDownloaded(key)) return { fileUri: (await downloadMaterial(key)).uri };
    return { url: await signedUrl(key) };
  }, [key]);

  const fileKey = q.data?.file_key;
  useFocusEffect(useCallback(() => { if (fileKey) setSavedNow(isDownloaded(fileKey)); }, [fileKey]));

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const d = q.data;
  const saved = savedNow ?? isDownloaded(d.file_key);
  const onProg = (got: number, total: number) => setProg({ got, total });

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try { await fn(); } catch (e) { Alert.alert('تعذّر', e instanceof Error ? e.message : ''); }
    setBusy(null);
    setProg(null);
    setSavedNow(isDownloaded(d.file_key));
  };
  // «فتح»: يحمّل الملف (يبقى محفوظاً) مع نسبة التقدم ثم يفتحه
  const open = (opts: Parameters<typeof openPdf>[2]) => run('open', async () => {
    if (!isDownloaded(d.file_key)) { setProg({ got: 0, total: 0 }); await downloadMaterial(d.file_key, onProg); setSavedNow(true); setProg(null); }
    await openPdf(d.file_key, d.title, opts);
  });
  const pct = prog?.total ? Math.round((prog.got / prog.total) * 100) : 0;

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
      {(busy === 'save' || busy === 'open') && prog ? (
        <View style={{ gap: 6 }}>
          <ProgressBar value={prog.total ? prog.got / prog.total : 0} height={10} />
          <T dim center size={13}>{arDigits(Math.round((prog.total ? prog.got / prog.total : 0) * 100))}٪ — {arDigits((prog.got / 1048576).toFixed(1))} من {arDigits((prog.total / 1048576).toFixed(1))} ميغا</T>
        </View>
      ) : null}
      <Button title={busy === 'open' && prog ? `جارٍ التجهيز ${arDigits(pct)}٪` : 'فتح'} icon="file" loading={busy === 'open' && !prog} disabled={busy === 'open'} onPress={() => open({ docId: d.id })} />
      {/* الأزرار الثانوية في صف واحد حتى تظهر الفصول مبكراً */}
      <Row gap={10}>
        {!saved ? (
          <Button small style={{ flex: 1 }} title="تحميل للقراءة بلا إنترنت" variant="secondary" icon="download" loading={busy === 'save'}
            disabled={busy === 'open'}
            onPress={() => run('save', async () => { setProg({ got: 0, total: 0 }); await downloadMaterial(d.file_key, onProg); setSavedNow(true); })} />
        ) : (
          <Button small style={{ flex: 1 }} title="حذف من الهاتف" variant="secondary" icon="trash" onPress={() => { removeDownload(d.file_key); setSavedNow(false); }} />
        )}
        <Button small style={{ flex: saved ? 1 : 0, minWidth: 110 }} title="مشاركة" variant="secondary" icon="share" loading={busy === 'share'} onPress={() => run('share', () => sharePdf(d.file_key, d.title))} />
      </Row>
      <View style={{ gap: 10, marginTop: 8 }}>
        <T display size={22}>الفصول والمواضيع</T>
        {outline.data?.length ? (
          <>
            <T dim size={12}>اضغط على فصل ليُفتح مباشرة، أو على موضوع ليُفتح داخل فصله. زر الرابط بجانب الموضوع يعرض نفس الموضوع في الكتب والملازم الأخرى.</T>
            <OutlineList nodes={outline.data}
              onChapter={(c) => open({ docId: d.id, from: c.start_page, to: c.end_page ?? undefined, page: c.start_page })}
              onTopic={(t, c) => open({ docId: d.id, from: c.start_page, to: c.end_page ?? undefined, page: t.start_page })} />
          </>
        ) : (
          <T dim size={13}>{d.outline_status === 'running' ? 'يجري بناء الفهرس…' : d.ingest_status === 'done' ? 'الفهرس غير جاهز بعد. سيظهر هنا قريباً.' : 'لم يُفهرس هذا الملف بعد. افتحه كاملاً من الأزرار أعلاه.'}</T>
        )}
      </View>
      <T dim size={12} center>{saved ? 'محفوظ على هاتفك — يُفتح داخل التطبيق بدون إنترنت' : 'بعد التحميل يُفتح داخل التطبيق بدون إنترنت'}</T>
    </Screen>
  );
}
