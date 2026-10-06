import {
  arDigits, effortStatus, formatScore, generalExemption, neededFor, subjectVerdict, type SubjectVerdict,
} from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { LogoMark } from '@/components/icon';
import { Card, Empty, ErrorBox, Fab, Header, Loading, Row, Screen, T } from '@/components/ui';
import { CountUp } from '@/components/motion';
import { useMe } from '@/lib/auth';
import { loadMyGrades, loadSubjects, shortSubject } from '@/lib/queries';
import { useGradingRules } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function Grades() {
  const { c, verdict } = useTheme();
  const me = useMe();
  const rules = useGradingRules();
  const q = useLoad(async () => {
    const [subjects, grades] = await Promise.all([loadSubjects(), loadMyGrades(me.id)]);
    return { subjects, grades };
  }, [me.id]);
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const footer = <Fab title="أضف درجة" onPress={() => router.push('/grades/edit')} />;
  if (q.loading) return <Screen><Header back={false} title="سجل الدرجات" /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header back={false} title="سجل الدرجات" /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;

  const { subjects, grades } = q.data;
  const hasAny = Object.keys(grades).length > 0;
  const general = generalExemption(Object.fromEntries(subjects.map((s) => [s.id, grades[s.id] ?? {}])), rules);

  const rows = subjects.map((s) => {
    const g = grades[s.id] ?? {};
    const st = effortStatus(g);
    const need = neededFor(g, rules.individualExempt, rules);
    return { s, st, need, v: subjectVerdict(g, rules) };
  });
  const possible = rows.filter((r) => r.need.state === 'possible' || r.need.state === 'achieved').length;
  // أقرب مادة للإعفاء الفردي (أقل درجة مطلوبة)
  const closest = rows
    .filter((r) => r.need.state === 'possible' && r.st.current !== null)
    .sort((a, b) => (a.need.perExam ?? 999) - (b.need.perExam ?? 999))[0];
  const hard = rows.filter((r) => r.need.state === 'impossible').map((r) => shortSubject(r.s.name));

  const needLabel = (r: (typeof rows)[number]) => {
    if (r.v === 'empty') return '—';
    if (r.need.state === 'achieved') return 'معفى';
    if (r.need.state === 'missed') return 'فات';
    if (r.need.state === 'impossible') return 'غير ممكن';
    return formatScore(r.need.perExam);
  };
  const chipColor = (v: SubjectVerdict, state: string) =>
    state === 'impossible' || state === 'missed' ? verdict.risk : verdict[v];

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing} footer={footer}>
      <Header back={false} title="سجل الدرجات" />
      {!hasAny ? (
        <Empty icon="chart" title="ابدأ بتسجيل درجاتك" body="أدخل درجة كل امتحان، وسعي يحسب سعيك السنوي والإعفاء وكم تحتاج في الامتحانات القادمة." />
      ) : (
        <>
          <Row gap={10} style={{ alignItems: 'stretch' }}>
            <Card tone="hero" style={{ flex: 1, gap: 2 }}>
              <T size={13} color={c.heroInk2}>المعدل الحالي</T>
              <CountUp value={general.average}>{(v) => <T display size={34} color={c.heroInk}>{formatScore(v)}</T>}</CountUp>
              <T size={12} color={c.heroInk2}>
                إعفاء عام: {general.exempt ? (general.final ? 'متحقق' : 'على الطريق') : general.meetsAverage ? 'مادة تحت ' + arDigits(rules.generalMin) : 'تحت ' + arDigits(rules.generalAvg)}
              </T>
            </Card>
            <Card style={{ flex: 1, gap: 2 }}>
              <T dim size={13}>إعفاء فردي ممكن</T>
              <T display size={34}>
                {arDigits(possible)}<T dim size={18}> من {arDigits(subjects.length)}</T>
              </T>
              <T dim size={12} lines={1}>{hard.length ? `${hard.slice(0, 2).join(' و')} صعبة` : 'كلها ممكنة'}</T>
            </Card>
          </Row>

          {closest ? (
            <Card tone="soft" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <LogoMark size={20} ink={c.softInk} dot={c.accent} />
              <T size={14} color={c.softInk} style={{ flex: 1 }}>
                لتُعفى من <T size={14} weight="bold" color={c.softInk}>{shortSubject(closest.s.name)}</T> يكفيك{' '}
                <T size={14} weight="bold" color={c.softInk}>{formatScore(closest.need.perExam)}</T> في {closest.need.remaining.length > 1 ? `كل امتحان من الامتحانات الـ${arDigits(closest.need.remaining.length)} القادمة` : 'الامتحان القادم'}.
              </T>
            </Card>
          ) : null}

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Row style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.line }} gap={0}>
              <T dim weight="bold" size={12} style={{ flex: 1.5 }}>المادة</T>
              <T dim weight="bold" size={12} style={{ flex: 1 }} center>المعدل</T>
              <T dim weight="bold" size={12} style={{ flex: 1.3, textAlign: 'left' }}>تحتاج للإعفاء</T>
            </Row>
            {rows.map((r) => {
              const col = chipColor(r.v, r.need.state);
              return (
                <Pressable key={r.s.id} onPress={() => router.push(`/grades/${r.s.id}`)} accessibilityRole="button"
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 50, borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.6 : 1 })}>
                  <T weight="bold" style={{ flex: 1.5 }} lines={1}>{shortSubject(r.s.name)}</T>
                  <T style={{ flex: 1 }} center>{formatScore(r.st.annual ?? r.st.current)}</T>
                  <View style={{ flex: 1.3, alignItems: 'flex-end' }}>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: col.bg }}>
                      <T size={13} weight="bold" color={col.ink}>{needLabel(r)}</T>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </Card>
          <T dim size={12} center>
            الإعفاء الفردي {arDigits(rules.individualExempt)} · العام معدل {arDigits(rules.generalAvg)} وأقل مادة {arDigits(rules.generalMin)}{rules.round === 'half_up' ? ' · مع جبر الكسور' : ''}
          </T>
        </>
      )}
      <View style={{ height: 70 }} />
    </Screen>
  );
}
