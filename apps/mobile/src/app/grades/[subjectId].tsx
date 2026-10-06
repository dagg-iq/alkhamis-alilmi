import {
  EFFORT_PERIODS, GOAL_TITLES, PERIOD_LABELS, PERIODS, analyzeGrades, applyRounding, arDigits, effortStatus,
  finalExamNeeded, formatScore, remainingExams, neededFor, projectedEffort, semester1, semester2, type Period,
} from '@saey/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { HowItWorks, ToneChip, useToneColors } from '@/components/grades';
import { Icon } from '@/components/icon';
import { tap } from '@/components/motion';
import { Card, ErrorBox, Header, IconButton, Loading, ProgressBar, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useGoal } from '@/lib/goal';
import { loadMyGrades, loadSubjects, shortSubject } from '@/lib/queries';
import { useGradingRules } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function SubjectGrades() {
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();
  const { c, verdict } = useTheme();
  const me = useMe();
  const rules = useGradingRules();
  const goal = useGoal() ?? 'general';
  const toneColor = useToneColors();
  const [assumed, setAssumed] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const q = useLoad(async () => {
    const [subjects, grades] = await Promise.all([loadSubjects(), loadMyGrades(me.id)]);
    return { subjects, grades };
  }, [me.id]);
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const subject = q.data.subjects.find((s) => s.id === subjectId);
  if (!subject) return <Screen><Header /><ErrorBox message="المادة غير موجودة" /></Screen>;

  const g = q.data.grades[subjectId] ?? {};
  const st = effortStatus(g);
  const value = st.annual ?? st.current;
  const row = analyzeGrades(q.data.subjects, q.data.grades, goal, rules, shortSubject).rows.find((r) => r.id === subjectId)!;
  const remaining = st.remaining.length;
  const sim = assumed ?? Math.min(100, Math.max(50, Math.round(row.need.perExam ?? value ?? 80)));
  const projected = remaining ? projectedEffort(g, sim) : value;
  const edit = (p: Period) => router.push({ pathname: '/grades/edit', params: { subjectId, period: p } });
  const step = (d: number) => { tap('select'); setAssumed(Math.max(0, Math.min(100, sim + d))); };

  const targets = [
    { label: 'الإعفاء من المادة', value: rules.individualExempt },
    { label: 'حد الإعفاء العام', value: rules.generalMin },
    { label: 'النجاح', value: rules.pass },
  ];
  const parts = [
    { label: 'الفصل الأول', v: semester1(g) },
    { label: 'نصف السنة', v: g.midyear ?? null },
    { label: 'الفصل الثاني', v: semester2(g) },
  ];

  return (
    <Screen>
      <Header title={subject.name} subtitle={`هدفك: ${GOAL_TITLES[goal]}`}
        right={<IconButton name="info" label="كيف يحسب سعي؟" onPress={() => setHelp(true)} />} />

      {/* الخلاصة */}
      <Card tone="hero" style={{ padding: 20, gap: 10 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <T size={13} color={c.heroInk2}>{st.annual !== null ? 'السعي السنوي' : 'المعدل حتى الآن'}</T>
            <T display size={48} color={c.heroInk}>{formatScore(value)}</T>
          </View>
          {row.tone !== 'empty' ? <ToneChip big tone={row.tone} label={row.need.state === 'possible' ? `تحتاج ${row.label}` : row.label} /> : null}
        </Row>
        <T size={14} color={c.heroInk2}>
          {row.tone === 'empty' ? 'لم تُدخل أي درجة بعد. ابدأ بأول امتحان.'
            : row.need.state === 'achieved' ? `هدفك (${GOAL_TITLES[goal]}) متحقق في هذه المادة. حافظ على مستواك.`
              : row.need.state === 'possible' ? `خذ ${formatScore(row.need.perExam)} أو أكثر في ${remainingExams(remaining)}.`
                : row.need.state === 'missed' ? 'السعي اكتمل تحت الهدف.' : 'الهدف أعلى من الممكن بالامتحانات المتبقية.'}
        </T>
      </Card>

      {/* مكونات السعي: كل جزء ثلث */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {parts.map((p) => (
          <View key={p.label} style={{ width: '32%', backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.line, padding: 12, gap: 2, alignItems: 'center' }}>
            <T dim size={12} center>{p.label}</T>
            <T display size={24} center color={p.v === null ? c.ink3 : c.ink}>{formatScore(p.v)}</T>
            <T dim size={11} center>ثلث السعي</T>
          </View>
        ))}
      </View>

      <SectionTitle title="الامتحانات" />
      <Card style={{ padding: 0 }}>
        {PERIODS.map((p, i) => {
          const v = g[p];
          const inEffort = (EFFORT_PERIODS as readonly string[]).includes(p);
          const col = typeof v !== 'number' ? null : v >= rules.individualExempt ? verdict.exempt : v >= rules.pass ? verdict.safe : verdict.risk;
          return (
            <Pressable key={p} onPress={() => edit(p)} accessibilityRole="button" accessibilityLabel={`${PERIOD_LABELS[p]}: ${typeof v === 'number' ? arDigits(v) : 'أضف'}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flex: 1 }}>
                <T weight="medium">{PERIOD_LABELS[p]}</T>
                {!inEffort ? <T dim size={11}>لا يدخل في السعي</T> : null}
              </View>
              {col ? (
                <View style={{ minWidth: 52, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, backgroundColor: col.bg, alignItems: 'center' }}>
                  <T weight="bold" size={16} color={col.ink}>{formatScore(v)}</T>
                </View>
              ) : <T size={13} weight="bold" color={c.accent}>أضف</T>}
              <View style={{ width: 10 }} />
              <Icon name={typeof v === 'number' ? 'edit' : 'plus'} size={16} color={c.ink3} />
            </Pressable>
          );
        })}
      </Card>

      {/* ماذا لو؟ */}
      {remaining > 0 ? (
        <>
          <SectionTitle title="ماذا لو؟" />
          <Card style={{ gap: 14 }}>
            <T dim size={14}>إذا أخذت هذه الدرجة في {remainingExams(remaining)}:</T>
            <Row style={{ justifyContent: 'center' }} gap={18}>
              <IconButton name="minus" label="أقل" onPress={() => step(-1)} size={48} />
              <T display size={44} style={{ minWidth: 96 }} center>{arDigits(sim)}</T>
              <IconButton name="plus" label="أكثر" onPress={() => step(1)} size={48} />
            </Row>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {[50, 60, 70, 80, 90, 100].map((n) => (
                <Pressable key={n} onPress={() => { tap('select'); setAssumed(n); }} accessibilityRole="button" accessibilityLabel={`افترض ${arDigits(n)}`}
                  style={{ width: '15.5%', height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: sim === n ? c.ink : c.bg }}>
                  <T size={14} weight="bold" color={sim === n ? c.bg : c.ink2}>{arDigits(n)}</T>
                </Pressable>
              ))}
            </View>
            <View style={{ backgroundColor: c.soft, borderRadius: 18, padding: 14, gap: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T weight="bold" color={c.softInk}>سعيك سيصبح</T>
                <T display size={30} color={c.softInk}>{formatScore(projected)}</T>
              </Row>
              <ProgressBar value={(projected ?? 0) / 100} color={c.accent} track={c.line} marker={rules.individualExempt / 100} />
              <Row gap={14} style={{ flexWrap: 'wrap' }}>
                {targets.map((t) => {
                  const ok = projected !== null && applyRounding(projected, rules) >= t.value;
                  return (
                    <Row key={t.label} gap={4}>
                      <Icon name={ok ? 'check' : 'close'} size={14} color={ok ? verdict.exempt.ink : verdict.risk.ink} strokeWidth={2.4} />
                      <T size={13} weight="medium" color={c.softInk}>{t.label}</T>
                    </Row>
                  );
                })}
              </Row>
            </View>
          </Card>
        </>
      ) : null}

      {/* كم تحتاج لكل هدف */}
      <SectionTitle title="كم تحتاج؟" />
      <Card style={{ padding: 0 }}>
        {targets.map((t, i) => {
          const need = neededFor(g, t.value, rules);
          const tone = need.state === 'achieved' ? 'done' : need.state === 'possible' ? (need.perExam! <= applyRounding(value ?? 0, rules) ? 'ontrack' : 'improve') : 'risk';
          const col = toneColor(tone);
          return (
            <View key={t.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <View style={{ flex: 1 }}>
                <T weight="bold">{t.label} ({arDigits(t.value)})</T>
                <T dim size={13}>
                  {need.state === 'achieved' ? 'متحقق — حتى لو تراجعت قليلاً'
                    : need.state === 'missed' ? 'لم يتحقق هذه السنة'
                      : need.state === 'impossible' ? 'غير ممكن بالامتحانات المتبقية'
                        : `في كل من: ${need.remaining.map((p) => PERIOD_LABELS[p]).join('، ')}`}
                </T>
              </View>
              <View style={{ minWidth: 56, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: col.bg, alignItems: 'center' }}>
                {need.state === 'possible'
                  ? <T weight="bold" color={col.ink}>{formatScore(need.perExam)}</T>
                  : <Icon name={need.state === 'achieved' ? 'check' : 'close'} size={18} color={col.ink} strokeWidth={2.4} />}
              </View>
            </View>
          );
        })}
      </Card>

      {/* النهائي للمادة غير المعفاة */}
      {st.annual !== null && applyRounding(st.annual, rules) < rules.individualExempt ? (
        <Card tone="soft" style={{ gap: 4 }}>
          <T weight="bold" color={c.softInk}>
            الامتحان النهائي: تحتاج تقريباً {formatScore(finalExamNeeded(st.annual, rules))} للنجاح
          </T>
          <T size={12} color={c.softInk}>حسب الضابطة الشائعة: الدرجة النهائية = (السعي + النهائي) ÷ ٢. تأكد من مدرستك.</T>
        </Card>
      ) : null}
      <HowItWorks visible={help} onClose={() => setHelp(false)} rules={rules} />
    </Screen>
  );
}
