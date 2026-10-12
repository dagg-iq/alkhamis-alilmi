import {
  arDigits, DOCUMENT_KIND_LABELS, PERIOD_LABELS, PERIODS,
  type Book, type Chapter, type DocumentRow, type Lecture, type QuestionSet, type Subject, type Teacher, countOf,
} from '@saey/shared';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Icon } from '@/components/icon';
import { Button, Card, ChipRow, Empty, ErrorBox, Header, IconButton, Loading, ProgressBar, Row, Screen, Segmented, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { isDownloaded } from '@/lib/files';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Tab = 'lectures' | 'documents' | 'expected' | 'school_exam';
const TABS: { key: Tab; label: string }[] = [
  { key: 'lectures', label: 'المحاضرات' },
  { key: 'documents', label: 'الملازم' },
  { key: 'expected', label: 'الأسئلة المتوقعة' },
  { key: 'school_exam', label: 'امتحاناتنا' },
];

export default function SubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const me = useMe();
  const { isStaff } = useAuth();
  const [tab, setTab] = useState<Tab>('lectures');
  const [bookId, setBookId] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const q = useLoad(async () => {
    const [subject, books, teachers, docs, qsets] = await Promise.all([
      must(supabase.from('subjects').select('*').eq('id', id).single()),
      must(supabase.from('books').select('*').eq('subject_id', id).order('sort')),
      must(supabase.from('teachers').select('*')),
      must(supabase.from('documents').select('*').eq('subject_id', id).order('sort')),
      must(supabase.from('question_sets').select('id, title, kind, period, source, section_id, status, created_at').eq('subject_id', id).order('created_at', { ascending: false })),
    ]);
    const bookIds = (books as Book[]).map((b) => b.id);
    const chapters = bookIds.length
      ? await must(supabase.from('chapters').select('*').in('book_id', bookIds).order('sort').order('number')) as Chapter[]
      : [];
    const chapterIds = chapters.map((ch) => ch.id);
    const [lectures, progress] = await Promise.all([
      chapterIds.length ? must(supabase.from('lectures').select('*').in('chapter_id', chapterIds).order('sort')) : Promise.resolve([]),
      must(supabase.from('progress').select('item_type, item_id, state').eq('user_id', me.id)),
    ]);
    return {
      subject: subject as Subject,
      books: books as Book[],
      chapters,
      lectures: lectures as Lecture[],
      teachers: teachers as Teacher[],
      docs: docs as DocumentRow[],
      qsets: qsets as QuestionSet[],
      progress: progress as { item_type: string; item_id: string; state: string }[],
    };
  }, [id, me.id], { key: `subject:${id}` });

  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const d = q.data;
  const activeBook = bookId ?? d?.books[0]?.id ?? null;
  const watched = useMemo(() => new Set(d?.progress.filter((p) => p.item_type === 'lecture').map((p) => p.item_id)), [d]);
  const chapterState = useMemo(
    () => Object.fromEntries((d?.progress ?? []).filter((p) => p.item_type === 'chapter').map((p) => [p.item_id, p.state])),
    [d],
  );
  const teacherName = (tid: string | null) => d?.teachers.find((t) => t.id === tid)?.name;
  const chapters = (d?.chapters ?? []).filter((ch) => ch.book_id === activeBook);
  const totalLectures = d?.lectures.length ?? 0;

  const markChapter = async (ch: Chapter, state: 'studied' | 'reviewed') => {
    if (chapterState[ch.id] === state) {
      await supabase.from('progress').delete().match({ user_id: me.id, item_type: 'chapter', item_id: ch.id });
    } else {
      await supabase.from('progress').upsert({ user_id: me.id, item_type: 'chapter', item_id: ch.id, state, updated_at: new Date().toISOString() });
    }
    q.reload();
  };


  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !d) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;

  const docGroups = groupDocs(d.docs, d.chapters);
  const kindSets = d.qsets.filter((s) => s.kind === tab);

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header
        title={d.subject.name}
        big
        subtitle={`${countOf(d.chapters.length, 'فصل', 'فصلان', 'فصول', 'فصل واحد')} · ${countOf(totalLectures, 'محاضرة', 'محاضرتان', 'محاضرات', 'محاضرة واحدة')} · ${countOf(d.docs.length, 'ملزمة', 'ملزمتان', 'ملازم', 'ملزمة واحدة')}`}
        right={<IconButton name="sparkle" label="اسأل المساعد" onPress={() => router.push({ pathname: '/ai', params: { subjectId: d.subject.id } })} />}
      />
      <ChipRow options={TABS} value={tab} onChange={setTab} />

      {tab === 'lectures' && (
        <>
          {d.books.length > 1 ? (
            <Segmented options={d.books.map((b) => ({ key: b.id, label: b.name }))} value={activeBook ?? ''} onChange={setBookId} />
          ) : null}
          {chapters.length === 0 ? <Empty title="لا توجد فصول بعد" body="سيضيف الأدمن المحاضرات قريباً." /> : chapters.map((ch) => {
            const lecs = d.lectures.filter((l) => l.chapter_id === ch.id);
            const seen = lecs.filter((l) => watched.has(l.id)).length;
            const isOpen = open[ch.id] ?? false;
            const st = chapterState[ch.id];
            return (
              <Card key={ch.id} style={{ gap: 12 }}>
                <Pressable onPress={() => setOpen({ ...open, [ch.id]: !isOpen })} accessibilityRole="button" style={{ gap: 10 }}>
                  <Row>
                    <View style={{ flex: 1 }}>
                      <T weight="bold" size={17}>الفصل {arDigits(ch.number)}{ch.title ? ` — ${ch.title}` : ''}</T>
                      <T dim size={13}>{countOf(lecs.length, 'محاضرة', 'محاضرتان', 'محاضرات', 'محاضرة واحدة')} · شاهدت {arDigits(seen)}{st ? ` · ${st === 'reviewed' ? 'راجعته' : 'درسته'}` : ''}</T>
                    </View>
                    <Icon name={isOpen ? 'up' : 'down'} size={20} color={c.ink} />
                  </Row>
                  <ProgressBar value={lecs.length ? seen / lecs.length : 0} height={4} />
                </Pressable>
                {isOpen && (
                  <View style={{ gap: 12 }}>
                    {lecs.map((l, i) => (
                      <Pressable key={l.id} onPress={() => router.push(`/lecture/${l.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <View style={{ width: 88, height: 52, borderRadius: 12, backgroundColor: c.heroBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {l.youtube_id ? (
                            <Image source={{ uri: `https://i.ytimg.com/vi/${l.youtube_id}/mqdefault.jpg` }} contentFit="cover" transition={120}
                              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
                          ) : null}
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="play" size={14} color="#FFFFFF" />
                          </View>
                        </View>
                        <View style={{ flex: 1 }}>
                          <T weight="bold" lines={2}>{l.title || `المحاضرة ${arDigits(i + 1)}`}</T>
                          {teacherName(l.teacher_id) ? <T dim size={12}>الأستاذ {teacherName(l.teacher_id)}</T> : null}
                        </View>
                        {watched.has(l.id) ? (
                          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="check" size={14} color={c.accentInk} strokeWidth={3} />
                          </View>
                        ) : <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: c.ink3 }} />}
                      </Pressable>
                    ))}
                    <Row gap={8} style={{ flexWrap: 'wrap' }}>
                      <SmallAction label={st === 'studied' ? 'درسته ✓' : 'درسته'} active={st === 'studied'} onPress={() => markChapter(ch, 'studied')} />
                      <SmallAction label={st === 'reviewed' ? 'راجعته ✓' : 'راجعته'} active={st === 'reviewed'} onPress={() => markChapter(ch, 'reviewed')} />
                      <SmallAction label="اختبر نفسك" icon onPress={() => router.push(`/quiz/${ch.id}`)} />
                    </Row>
                  </View>
                )}
              </Card>
            );
          })}
        </>
      )}

      {tab === 'documents' && (
        docGroups.length === 0 ? <Empty icon="file" title="لا توجد ملازم بعد" /> : docGroups.map((g) => (
          <View key={g.title} style={{ gap: 8 }}>
            <T dim weight="bold" size={13}>{g.title}</T>
            {g.docs.map((doc) => (
              <Card key={doc.id} onPress={() => router.push(`/document/${doc.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 44, height: 52, borderRadius: 10, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="file" size={22} color={c.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <T weight="bold" lines={2}>{doc.title}</T>
                  <T dim size={12}>
                    {DOCUMENT_KIND_LABELS[doc.kind]}
                    {teacherName(doc.teacher_id) ? ` · ${teacherName(doc.teacher_id)}` : ''}
                    {doc.pages ? ` · ${arDigits(doc.pages)} صفحة` : ''}
                    {doc.size_bytes ? ` · ${arDigits((doc.size_bytes / 1048576).toFixed(1))} م.ب` : ''}
                  </T>
                </View>
                {isDownloaded(doc.file_key) ? <Icon name="check" size={18} color={c.accent} />
                    : <Icon name="download" size={20} color={c.ink2} />}
              </Card>
            ))}
          </View>
        ))
      )}

      {isStaff && (tab === 'expected' || tab === 'school_exam') ? (
        <Button title="إضافة أسئلة (صور أو تحويل ذكي)" icon="scan" variant="secondary"
          onPress={() => router.push({ pathname: '/scan', params: { subjectId: id, kind: tab } })} />
      ) : null}

      {(tab === 'expected' || tab === 'school_exam') && (
        kindSets.length === 0
          ? <Empty icon="quiz" title="لا توجد أسئلة بعد" body={tab === 'school_exam' ? 'عند امتحان المدرسة تُصوّر الأسئلة وتظهر هنا.' : undefined} />
          : PERIODS.map((p) => {
            const sets = kindSets.filter((s) => s.period === p);
            if (!sets.length) return null;
            return (
              <View key={p} style={{ gap: 8 }}>
                <T dim weight="bold" size={13}>{PERIOD_LABELS[p]}</T>
                {sets.map((s) => (
                  <Card key={s.id} onPress={() => router.push(`/questions/${s.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <T weight="bold">{s.title}</T>
                      {s.source ? <T dim size={12}>{s.source}</T> : null}
                    </View>
                    {s.status === 'draft' ? <T size={12} weight="bold" color="#B25E00">مسودة</T> : null}
                    <Icon name="forward" size={18} color={c.ink3} />
                  </Card>
                ))}
              </View>
            );
          })
      )}
    </Screen>
  );
}

function SmallAction({ label, onPress, active, icon }: { label: string; onPress: () => void; active?: boolean; icon?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: active ? c.accent : c.soft }}>
      {icon ? <Icon name="quiz" size={16} color={c.accent} /> : null}
      <T size={13} weight="bold" color={active ? c.accentInk : c.accent}>{label}</T>
    </Pressable>
  );
}

function groupDocs(docs: DocumentRow[], chapters: Chapter[]) {
  const groups: { title: string; docs: DocumentRow[] }[] = [];
  const whole = docs.filter((d) => !d.chapter_id);
  if (whole.length) groups.push({ title: 'المادة كاملة', docs: whole });
  for (const ch of chapters) {
    const list = docs.filter((d) => d.chapter_id === ch.id);
    if (list.length) groups.push({ title: `الفصل ${arDigits(ch.number)}${ch.title ? ` — ${ch.title}` : ''}`, docs: list });
  }
  return groups;
}
