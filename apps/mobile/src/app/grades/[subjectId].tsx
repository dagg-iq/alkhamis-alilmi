import {
  EFFORT_PERIODS, PERIOD_LABELS, PERIODS, arDigits, effortStatus, formatScore, neededFor, semester1, semester2,
  type Period,
} from '@saey/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/icon';
import { Card, ErrorBox, Header, Loading, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { loadMyGrades } from '@/lib/queries';
import { useGradingRules } from '@/lib/settings';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function SubjectGrades() {
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();
  const { c, verdict } = useTheme();
  const me = useMe();
  const rules = useGradingRules();
  const q = useLoad(async () => {
    const [subject, grades] = await Promise.all([
      must(supabase.from('subjects').select('name').eq('id', subjectId).single()),
      loadMyGrades(me.id),
    ]);
    return { name: (subject as { name: string }).name, g: grades[subjectId] ?? {} };
  }, [subjectId, me.id]);
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  if (q.loading) return <Screen><Header /><Loading /></Screen>;
  if (q.error || !q.data) return <Screen><Header /><ErrorBox message={q.error ?? ''} onRetry={q.reload} /></Screen>;
  const { name, g } = q.data;
  const st = effortStatus(g);
  const targets = [
    { label: 'الإعفاء الفردي', value: rules.individualExempt },
    { label: 'حد الإعفاء العام', value: rules.generalMin },
    { label: 'النجاح', value: rules.pass },
  ];

  const edit = (p: Period) => router.push({ pathname: '/grades/edit', params: { subjectId, period: p } });

  return (
    <Screen>
      <Header title={name} subtitle="الدرجات والسعي السنوي" />
      <Row gap={10}>
        <Card tone="hero" style={{ flex: 1 }}>
          <T size={13} color={c.heroInk2}>{st.annual !== null ? 'السعي السنوي' : 'المعدل الحالي'}</T>
          <T display size={36} color={c.heroInk}>{formatScore(st.annual ?? st.current)}</T>
        </Card>
        <Card style={{ flex: 1, gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}><T dim size={13}>الفصل الأول</T><T weight="bold">{formatScore(semester1(g))}</T></Row>
          <Row style={{ justifyContent: 'space-between' }}><T dim size={13}>نصف السنة</T><T weight="bold">{formatScore(g.midyear)}</T></Row>
          <Row style={{ justifyContent: 'space-between' }}><T dim size={13}>الفصل الثاني</T><T weight="bold">{formatScore(semester2(g))}</T></Row>
        </Card>
      </Row>

      <SectionTitle title="الامتحانات" />
      <Card style={{ padding: 0 }}>
        {PERIODS.map((p, i) => (
          <Pressable key={p} onPress={() => edit(p)} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 54, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, opacity: pressed ? 0.6 : 1 })}>
            <T style={{ flex: 1 }} weight="medium">{PERIOD_LABELS[p]}</T>
            {g[p] != null ? <T weight="bold" size={17}>{formatScore(g[p])}</T> : <T dim size={13}>{EFFORT_PERIODS.includes(p as never) ? 'أضف' : 'خارج السعي'}</T>}
            <View style={{ width: 10 }} />
            <Icon name={g[p] != null ? 'edit' : 'plus'} size={16} color={c.ink3} />
          </Pressable>
        ))}
      </Card>

      <SectionTitle title="كم تحتاج؟" />
      {targets.map((t) => {
        const need = neededFor(g, t.value, rules);
        const col = need.state === 'achieved' ? verdict.exempt : need.state === 'possible' ? verdict.near : verdict.risk;
        return (
          <Card key={t.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T weight="bold">{t.label} ({arDigits(t.value)})</T>
              <T dim size={13}>
                {need.state === 'achieved' ? 'متحقق — حافظ على مستواك'
                  : need.state === 'missed' ? 'لم يتحقق هذه السنة'
                    : need.state === 'impossible' ? 'غير ممكن رياضياً بالامتحانات المتبقية'
                      : `في كل من: ${need.remaining.map((p) => PERIOD_LABELS[p]).join('، ')}`}
              </T>
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: col.bg }}>
              <T weight="bold" color={col.ink}>{need.state === 'possible' ? formatScore(need.perExam) : need.state === 'achieved' ? '✓' : '✗'}</T>
            </View>
          </Card>
        );
      })}
      <T dim size={12} center>المطلوب محسوب بافتراض الدرجة نفسها في كل امتحان متبقٍ.</T>
    </Screen>
  );
}
