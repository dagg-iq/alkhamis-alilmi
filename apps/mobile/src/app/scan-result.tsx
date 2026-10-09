import { PERIOD_LABELS, PERIODS, QUESTION_KIND_LABELS, type Period, type QuestionKind, type Section } from '@saey/shared';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConversationPicker } from '@/components/conversation-picker';
import { Icon, type IconName } from '@/components/icon';
import { PressScale, tap } from '@/components/motion';
import { PdfView, type PdfViewHandle } from '@/components/pdf-view';
import { Sheet } from '@/components/sheet';
import { Button, Chip, Field, IconButton, Row, Segmented, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { conversationTitle } from '@/lib/chat';
import { Alert } from '@/lib/dialog';
import { uploadFile } from '@/lib/files';
import { pdfName, sendAttachment } from '@/lib/pdf';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { getScanResult } from '@/lib/scan-store';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Panel = null | 'send' | 'save' | 'sets';

/** نتيجة التحويل: معاينة PDF ثم إرسال (PDF أو صور) أو حفظ أو إضافة إلى الأسئلة (للمشرفين) */
export default function ScanResult() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const { isStaff } = useAuth();
  const result = getScanResult();
  const viewRef = useRef<PdfViewHandle>(null);
  const [b64, setB64] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [sendAs, setSendAs] = useState<'pdf' | 'image' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { result?.file.base64().then(setB64).catch(() => {}); }, [result]);

  if (!result) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <T dim center>لا توجد ورقة محوّلة. ابدأ من «تحويل ورقة إلى PDF».</T>
        <Button title="رجوع" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }
  const { file, title } = result;
  const baseName = pdfName(title).replace(/\.pdf$/, '');

  /** صفحات الملف كصور JPEG محفوظة في ذاكرة مؤقتة */
  const pageFiles = async () => {
    const imgs = await viewRef.current!.exportImages(1240, 0.9);
    return imgs.map((im, i) => {
      const f = new File(Paths.cache, `${baseName}-${i + 1}-${Date.now()}.jpg`);
      f.write(im.dataUrl.replace(/^data:image\/jpeg;base64,/, ''), { encoding: 'base64' });
      return { file: f, width: im.width, height: im.height, n: i + 1 };
    });
  };

  const send = async (conv: Parameters<NonNullable<React.ComponentProps<typeof ConversationPicker>['onPick']>>[0]) => {
    try {
      if (sendAs === 'pdf') {
        const key = await uploadFile(file.uri, 'chat', 'application/pdf', conv.id);
        await sendAttachment(conv.id, me.id, { type: 'file', key, title: baseName, size: file.size ?? undefined });
      } else {
        for (const p of await pageFiles()) {
          const key = await uploadFile(p.file.uri, 'chat', 'image/jpeg', conv.id);
          await sendAttachment(conv.id, me.id, { type: 'image', key, width: p.width, height: p.height });
        }
      }
      setSendAs(null);
      tap('success');
      Alert.alert('أُرسل', `أُرسل إلى «${conversationTitle(conv)}».`);
    } catch (e) {
      Alert.alert('لم يُرسل', e instanceof Error ? e.message : '');
    }
  };

  const save = async (as: 'pdf' | 'image') => {
    setPanel(null);
    try {
      if (Platform.OS !== 'android') {
        if (as === 'pdf') await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
        else for (const p of await pageFiles()) await Sharing.shareAsync(p.file.uri, { mimeType: 'image/jpeg' });
        return;
      }
      const dir = await Directory.pickDirectoryAsync();
      setBusy('save');
      if (as === 'pdf') {
        dir.createFile(baseName, 'application/pdf').write(await file.bytes());
      } else {
        for (const p of await pageFiles()) dir.createFile(`${baseName}-${p.n}`, 'image/jpeg').write(await p.file.bytes());
      }
      tap('success');
      Alert.alert('تم الحفظ', 'حُفظ في المجلد الذي اخترته.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!/cancel/i.test(msg)) Alert.alert('لم يُحفظ', msg);
    } finally {
      setBusy(null);
    }
  };

  const shareOut = () => Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' }).catch(() => {});

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Row gap={8} style={{ paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 12, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <IconButton name="back" label="رجوع" size={40} onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <T weight="bold" size={15} lines={1}>{title}</T>
          <T dim size={12}>الورقة جاهزة — راجعها ثم اختر</T>
        </View>
        <IconButton name="share" label="مشاركة خارج التطبيق" size={40} onPress={shareOut} />
      </Row>
      <View style={{ flex: 1 }}>{b64 ? <PdfView ref={viewRef} base64={b64} /> : <PdfView />}</View>
      <View style={{ flexDirection: 'row', gap: 10, padding: 12, paddingBottom: Math.max(insets.bottom, 10) + 6, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line }}>
        <Action icon="send" label="إرسال" onPress={() => setPanel('send')} />
        <Action icon="download" label={busy === 'save' ? 'يحفظ…' : 'حفظ'} onPress={() => setPanel('save')} />
        {isStaff ? <Action icon="quiz" label="إلى الأسئلة" onPress={() => setPanel('sets')} /> : null}
      </View>

      <Sheet visible={panel === 'send'} onClose={() => setPanel(null)}>
        <T display size={22}>إرسال الورقة</T>
        <T dim size={13}>اختر الصيغة ثم المجموعة أو الشخص.</T>
        <Choice icon="file" title="ملف PDF" body="ملف واحد بكل الصفحات" onPress={() => { setSendAs('pdf'); setPanel(null); }} />
        <Choice icon="image" title="صور" body="كل صفحة صورة تظهر في المحادثة" onPress={() => { setSendAs('image'); setPanel(null); }} />
      </Sheet>
      <Sheet visible={panel === 'save'} onClose={() => setPanel(null)}>
        <T display size={22}>حفظ في الهاتف</T>
        <T dim size={13}>ستختار المجلد (التنزيلات مثلاً).</T>
        <Choice icon="file" title="حفظ كملف PDF" body="ملف واحد بكل الصفحات" onPress={() => save('pdf')} />
        <Choice icon="image" title="حفظ كصور" body="صورة لكل صفحة" onPress={() => save('image')} />
      </Sheet>
      <ConversationPicker visible={!!sendAs} onClose={() => setSendAs(null)} onPick={send} title={sendAs === 'pdf' ? 'إرسال PDF إلى' : 'إرسال الصور إلى'} />
      {isStaff ? <SetsSheet visible={panel === 'sets'} onClose={() => setPanel(null)} file={file} title={title} /> : null}
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
      <Icon name={icon} size={20} color="#FFFFFF" />
      <T weight="bold" size={15} color="#FFFFFF">{label}</T>
    </PressScale>
  );
}

function Choice({ icon, title, body, onPress }: { icon: IconName; title: string; body: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, backgroundColor: c.soft, marginTop: 6 }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <T weight="bold" size={16}>{title}</T>
        <T dim size={13}>{body}</T>
      </View>
      <Icon name="forward" size={18} color={c.ink3} />
    </PressScale>
  );
}

/** إضافة الملف إلى الأسئلة المتوقعة أو الامتحانات السابقة (للأدمن والمشرفين) */
function SetsSheet({ visible, onClose, file, title }: { visible: boolean; onClose: () => void; file: File; title: string }) {
  const me = useMe();
  const [kind, setKind] = useState<QuestionKind>('expected');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('month1');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const subjects = useLoad(loadSubjects);
  const sections = useLoad(async () => must(supabase.from('sections').select('*').order('sort')) as Promise<Section[]>);
  useEffect(() => { if (visible) setName(title); }, [visible, title]);

  const add = async () => {
    if (!subjectId) return Alert.alert('اختر المادة');
    setBusy(true);
    try {
      const key = await uploadFile(file.uri, 'material', 'application/pdf');
      const { data, error } = await supabase.from('question_sets').insert({
        subject_id: subjectId, kind, period, section_id: kind === 'school_exam' ? sectionId : null,
        title: name.trim() || title, content_md: null, pdf_key: key, scan_keys: [], status: 'published', created_by: me.id,
      }).select('id').single();
      if (error) throw new Error(error.message);
      tap('success');
      onClose();
      router.replace(`/questions/${data.id}`);
    } catch (e) {
      Alert.alert('تعذّرت الإضافة', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T display size={22}>إضافة إلى الأسئلة</T>
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
        <Segmented options={(['expected', 'school_exam'] as QuestionKind[]).map((k) => ({ key: k, label: QUESTION_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
        <View style={{ gap: 8 }}>
          <T weight="bold" size={14}>المادة</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(subjects.data ?? []).map((s) => <Chip key={s.id} label={shortSubject(s.name)} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <T weight="bold" size={14}>الامتحان</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PERIODS.map((p) => <Chip key={p} label={PERIOD_LABELS[p]} active={period === p} onPress={() => setPeriod(p)} />)}
          </View>
        </View>
        {kind === 'school_exam' ? (
          <View style={{ gap: 8 }}>
            <T weight="bold" size={14}>الشعبة (اختياري)</T>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Chip label="كل الشعب" active={!sectionId} onPress={() => setSectionId(null)} />
              {(sections.data ?? []).map((s) => <Chip key={s.id} label={`شعبة ${s.name}`} active={sectionId === s.id} onPress={() => setSectionId(s.id)} />)}
            </Row>
          </View>
        ) : null}
        <Field label="العنوان" value={name} onChangeText={setName} />
      </ScrollView>
      <Button title="إضافة ونشر للطلاب" icon="send" onPress={add} loading={busy} />
    </Sheet>
  );
}
