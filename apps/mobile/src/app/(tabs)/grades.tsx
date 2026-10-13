import { GOAL_TITLES, TONE_LABELS, analyzeGrades, remainingExams, arDigits, formatScore, type GradeSummary } from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ExamDots, GoalPicker, HowItWorks, ToneChip, useToneColors } from '@/components/grades';
import { Icon, LogoMark } from '@/components/icon';
import { CountUp } from '@/components/motion';
import { Button, Card, ErrorBox, Header, IconButton, Loading, ProgressBar, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { setGoal, useGoal } from '@/lib/goal';
import { loadMyGrades, loadSubjects, shortSubject } from '@/lib/queries';
import { useGradingRules } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function Grades() {
  const { c } = useTheme();
  const me = useMe();
  const rules = useGradingRules();
  const goal = useGoal();
  const [picking, setPicking] = useState(false);
  const [help, setHelp] = useState(false);
  const toneColor = useToneColors();
  const q = useLoad(async () => {
    const [subjects, grades] = await Promise.all([loadSubjects(), loadMyGrades(me.id)]);
    return { subjects, grades };
  }, [me.id], { key: `grades:${me.id}` });
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const header = (
    <Header back={false} title="الدرجات" right={goal ? (
      <>
        <IconButton name="info" label="كيف يحسب سعي؟" onPress={() => setHelp(true)} />
        <IconButton name="target" label="تغيير الهدف" onPress={() => setPicking((v) => !v)} />
      </>
    ) : undefined} />
  );

  if (goal === undefined || q.loading) return <Screen>{header}<Loading /></Screen>;
  if (q.error || !q.data) return <Screen>{header}<ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;

  // أول مرة: اختيار الهدف قبل أي شيء
  if (!goal || picking) {
    return (
      <Screen>
        {header}
        <View style={{ gap: 4 }}>
          <T display size={26}>ما هدفك هذه السنة؟</T>
          <T dim size={14}>سعي يبني حساباته ونصائحه على هدفك. تقدر تغيّره في أي وقت.</T>
        </View>
        <GoalPicker value={goal} rules={rules} onPick={(g) => { setGoal(g); setPicking(false); }} />
        {goal ? <Button title="إلغاء" variant="ghost" onPress={() => setPicking(false)} /> : null}
      </Screen>
    );
  }

  const { subjects, grades } = q.data;
  const sum = analyzeGrades(subjects, grades, goal, rules, shortSubject);
  const target = goal === 'general' ? rules.generalAvg : goal === 'individual' ? rules.individualExempt : rules.pass;

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      {header}

      <Hero sum={sum} target={target} onGoal={() => setPicking(true)} />

      <Button title="أدخل درجات امتحان" icon="list" onPress={() => router.push('/grades/edit')} />

      {sum.focus && sum.state !== 'empty' ? (
        <Card tone="soft" onPress={() => router.push(`/grades/${sum.focus!.id}`)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <LogoMark size={22} ink={c.softInk} dot={c.accent} />
          <View style={{ flex: 1 }}>
            <T size={12} weight="bold" color={c.accent}>ركّز الآن على</T>
            <T size={15} weight="bold" color={c.softInk}>
              {shortSubject(sum.focus.name)}
              {sum.focus.need.state === 'possible' ? ` — تحتاج ${formatScore(sum.focus.need.perExam)} في ${remainingExams(sum.focus.need.remaining.length)}` : ''}
            </T>
          </View>
          <Icon name="forward" size={18} color={c.softInk} />
        </Card>
      ) : null}

      <SectionTitle title="موادك" />
      <View style={{ gap: 8 }}>
        {sum.rows.map((r) => {
          const col = toneColor(r.tone);
          return (
            <Pressable key={r.id} onPress={() => router.push(`/grades/${r.id}`)} accessibilityRole="button"
              accessibilityLabel={`${r.name}، المعدل ${formatScore(r.value)}، ${r.label}`}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderRadius: 20,
                borderWidth: 1, borderColor: c.line, paddingHorizontal: 14, paddingVertical: 12, opacity: pressed ? 0.7 : 1,
              })}>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: r.tone === 'empty' ? c.line : col.ink }} />
              <View style={{ flex: 1, gap: 6 }}>
                <T weight="bold" size={16} lines={1}>{shortSubject(r.name)}</T>
                <ExamDots scores={r.scores} rules={rules} />
              </View>
              <View style={{ alignItems: 'center', minWidth: 56 }}>
                <T display size={22}>{formatScore(r.value)}</T>
                <T dim size={11}>{r.final ? 'السعي' : 'المعدل'}</T>
              </View>
              <View style={{ alignItems: 'flex-end', minWidth: 84, gap: 2 }}>
                <ToneChip tone={r.tone} label={r.need.state === 'possible' ? `تحتاج ${r.label}` : r.label} />
                {r.tone === 'empty' ? <T dim size={11}>أضف درجة</T> : r.need.state === 'possible' ? <T size={11} weight="medium" color={col.ink}>{TONE_LABELS[r.tone]}</T> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <T dim size={12} center>
        النقاط = امتحانات السعي الخمسة (الأعرض نصف السنة). الأخضر {arDigits(rules.individualExempt)}+ والأحمر تحت {arDigits(rules.pass)}.
      </T>
      <HowItWorks visible={help} onClose={() => setHelp(false)} rules={rules} />
    </Screen>
  );
}

/** البطاقة الكبيرة: جملة واحدة واضحة + المعدل والهدف */
function Hero({ sum, target, onGoal }: { sum: GradeSummary; target: number; onGoal: () => void }) {
  const { c } = useTheme();
  return (
    <Card tone="hero" style={{ padding: 20, gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={onGoal} hitSlop={8} accessibilityRole="button" accessibilityLabel="تغيير الهدف"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' }}>
          <Icon name="target" size={14} color={c.heroInk} />
          <T size={12} weight="bold" color={c.heroInk}>هدفي: {GOAL_TITLES[sum.goal]}</T>
        </Pressable>
        <T size={12} color={c.heroInk2}>{arDigits(sum.counted)} من {arDigits(sum.total)} مواد فيها درجات</T>
      </Row>

      <T display size={28} color={c.heroInk}>{sum.headline}</T>
      <T size={14} color={c.heroInk2}>{sum.detail}</T>

      {sum.average !== null ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <T size={12} color={c.heroInk2}>{sum.goal === 'general' ? 'معدلك الحالي' : 'معدل موادك'}</T>
              <CountUp value={sum.average}>{(v) => <T display size={40} color={c.heroInk}>{formatScore(v)}</T>}</CountUp>
            </View>
            {sum.perExam !== null && sum.state === 'possible' ? (
              <View style={{ alignItems: 'flex-end' }}>
                <T size={12} color={c.heroInk2}>تحتاج في كل امتحان</T>
                <T display size={40} color={c.heroInk}>{formatScore(sum.perExam)}</T>
              </View>
            ) : null}
          </Row>
          <ProgressBar value={sum.average / 100} track={c.track} color="#FFFFFF" marker={target / 100} height={8} />
          <T size={12} color={c.heroInk2}>الخط = {sum.goal === 'general' ? 'معدل الإعفاء العام' : sum.goal === 'individual' ? 'حد الإعفاء من المادة' : 'درجة النجاح'} ({arDigits(target)})</T>
        </View>
      ) : null}
    </Card>
  );
}
