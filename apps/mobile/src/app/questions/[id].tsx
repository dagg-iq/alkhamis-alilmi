import { PERIOD_LABELS, QUESTION_KIND_LABELS, type QuestionSet } from '@saey/shared';
import * as Print from 'expo-print';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { RichText, markdownHtml } from '@/components/rich-text';
import { PdfThumb } from '@/components/pdf-thumb';
import { Button, Card, Chip, ErrorBox, Field, Header, IconButton, Loading, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { downloadMaterial, isDownloaded, openPdf, signedUrl } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function QuestionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, verdict } = useTheme();
  const { isStaff } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useLoad(async () =>
    must(supabase.from('question_sets').select('*, subjects(name)').eq('id', id).single()) as Promise<QuestionSet & { subjects: { name: string } }>,
  [id]);

  // أسئلة PDF (بلا نص): معاينة الصفحة الأولى + فتح الملف
  const pdfKey = q.data?.pdf_key;
  const preview = useLoad(async () => {
    if (!pdfKey) return null;
    if (isDownloaded(pdfKey)) return { fileUri: (await downloadMaterial(pdfKey)).uri };
    return { url: await signedUrl(pdfKey) };
  }, [pdfKey]);

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const s = q.data;

  const exportPdf = async () => {
    setBusy('export');
    try {
      const html = markdownHtml(s.content_md ?? '', { color: '#111111', bg: '#FFFFFF', accent: '#2346F5', size: 15, title: `${s.subjects.name} — ${s.title}` });
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: s.title });
    } catch (e) {
      Alert.alert('تعذّر إنشاء PDF', e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  };

  const save = async (publish?: boolean) => {
    setBusy(publish ? 'publish' : 'save');
    const patch: Partial<QuestionSet> = { content_md: editing ? draft : s.content_md };
    if (publish !== undefined) patch.status = publish ? 'published' : 'draft';
    const { error } = await supabase.from('question_sets').update(patch).eq('id', s.id);
    setBusy(null);
    if (error) return Alert.alert('تعذّر الحفظ', error.message);
    setEditing(false);
    q.reload();
  };

  const remove = () => Alert.alert('حذف الأسئلة', 'هل أنت متأكد؟', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => {
      const { error } = await supabase.from('question_sets').delete().eq('id', s.id);
      if (error) Alert.alert('تعذّر الحذف', error.message);
      else router.back();
    } },
  ]);

  return (
    <Screen>
      <Header
        title={s.title}
        subtitle={`${s.subjects.name} · ${QUESTION_KIND_LABELS[s.kind]} · ${PERIOD_LABELS[s.period]}`}
        right={isStaff ? (
          <>
            <IconButton name="edit" label="تعديل" onPress={() => { setDraft(s.content_md ?? ''); setEditing(!editing); }} />
            <IconButton name="trash" label="حذف" onPress={remove} />
          </>
        ) : undefined}
      />
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        {s.source ? <Chip small label={s.source} /> : null}
        {s.status === 'draft' ? <Chip small label="مسودة — لا يراها الطلاب" bg={verdict.near.bg} color={verdict.near.ink} /> : null}
      </Row>

      {editing ? (
        <View style={{ gap: 10 }}>
          <Field multiline value={draft} onChangeText={setDraft} style={{ minHeight: 320 }}
            hint="Markdown: # عنوان، **عريض**، - نقطة. المعادلات بين $...$" />
          <Button title="حفظ التعديل" onPress={() => save()} loading={busy === 'save'} />
        </View>
      ) : (
        s.content_md || !s.pdf_key ? (
          <Card style={{ padding: 18 }}>
            {s.content_md ? <RichText text={s.content_md} size={16} /> : <T dim>لا يوجد نص بعد.</T>}
          </Card>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            {preview.data ? <PdfThumb {...preview.data} width={260} /> : null}
          </View>
        )
      )}

      <View style={{ gap: 10 }}>
        {isStaff && s.status === 'draft' ? <Button title="نشر للطلاب" icon="send" onPress={() => save(true)} loading={busy === 'publish'} /> : null}
        {s.pdf_key ? (
          <Button title={s.content_md ? 'الورقة الأصلية (PDF)' : 'فتح الأسئلة'} variant={s.content_md ? 'secondary' : 'primary'} icon="file" loading={busy === 'pdf'}
            onPress={async () => {
              setBusy('pdf');
              try { await openPdf(s.pdf_key!, s.title); } catch (e) { Alert.alert('تعذّر الفتح', e instanceof Error ? e.message : ''); }
              setBusy(null);
            }} />
        ) : null}
        {s.content_md ? <Button title="تصدير كـ PDF" variant="secondary" icon="share" onPress={exportPdf} loading={busy === 'export'} /> : null}
        <Button title="اسأل المساعد عن هذه الأسئلة" variant="ghost" icon="sparkle"
          onPress={() => router.push({ pathname: '/ai', params: { subjectId: s.subject_id, prompt: `ساعدني في حل أسئلة «${s.title}»:\n\n${(s.content_md ?? '').slice(0, 1500)}` } })} />
        {isStaff && s.status === 'published' ? <Button title="إرجاع إلى مسودة" variant="ghost" onPress={() => save(false)} /> : null}
      </View>
      <View style={{ height: 8, backgroundColor: c.bg }} />
    </Screen>
  );
}
