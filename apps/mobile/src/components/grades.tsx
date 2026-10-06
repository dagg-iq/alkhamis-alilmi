import {
  EFFORT_PERIODS, GOALS, PERIOD_LABELS, arDigits, type Goal, type GradingRules, type RowTone, type SubjectScores,
} from '@saey/shared';
import { ScrollView, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
import { Icon } from './icon';
import { PressScale, tap } from './motion';
import { Sheet } from './sheet';
import { Row, T } from './ui';

/** ألوان كل حالة (من ألوان الدرجات في الهوية فقط) */
export function useToneColors() {
  const { verdict } = useTheme();
  return (t: RowTone) => (t === 'done' || t === 'ontrack' ? verdict.exempt : t === 'improve' ? verdict.near : t === 'risk' ? verdict.risk : verdict.empty);
}

/** رمز صغير لكل هدف: سلم يصعد بقدر طموح الهدف */
function GoalGlyph({ goal, color, dot }: { goal: Goal; color: string; dot: string }) {
  const n = goal === 'pass' ? 1 : goal === 'individual' ? 2 : 3;
  return (
    <Svg width={34} height={34} viewBox="0 0 120 120">
      <Rect x="80" y="62" width="20" height="42" rx="10" fill={color} opacity={1} />
      <Rect x="50" y="44" width="20" height="60" rx="10" fill={color} opacity={n >= 2 ? 1 : 0.22} />
      <Rect x="20" y="30" width="20" height="74" rx="10" fill={color} opacity={n >= 3 ? 1 : 0.22} />
      <Rect x="20" y="84" width="80" height="20" rx="10" fill={color} />
      {n === 3 ? <Circle cx="30" cy="12" r="10" fill={dot} /> : null}
    </Svg>
  );
}

/** اختيار الهدف: ثلاث بطاقات كبيرة واضحة */
export function GoalPicker({ value, onPick, rules }: { value: Goal | null | undefined; onPick: (g: Goal) => void; rules: GradingRules }) {
  const { c } = useTheme();
  const rule = (g: Goal) =>
    g === 'general' ? `معدل ${arDigits(rules.generalAvg)} فأكثر، ولا مادة تحت ${arDigits(rules.generalMin)}`
      : g === 'individual' ? `سعي المادة ${arDigits(rules.individualExempt)} فأكثر`
        : `سعي كل مادة ${arDigits(rules.pass)} فأكثر`;
  return (
    <View style={{ gap: 10 }}>
      {GOALS.map((g) => {
        const on = value === g.key;
        return (
          <PressScale key={g.key} onPress={() => { tap('select'); onPick(g.key); }} scaleTo={0.98}
            accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22,
              backgroundColor: on ? c.soft : c.card, borderWidth: on ? 2 : 1, borderColor: on ? c.accent : c.line,
            }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: on ? c.card : c.bg, alignItems: 'center', justifyContent: 'center' }}>
              <GoalGlyph goal={g.key} color={on ? c.accent : c.ink} dot={c.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="bold" size={17}>{g.title}</T>
              <T dim size={13}>{g.body}</T>
              <T size={12} weight="medium" color={c.accent}>{rule(g.key)}</T>
            </View>
            <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: on ? 0 : 1.5, borderColor: c.ink3, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {on ? <Icon name="check" size={16} color="#FFFFFF" strokeWidth={2.4} /> : null}
            </View>
          </PressScale>
        );
      })}
    </View>
  );
}

/** خمس نقاط = امتحانات السعي الخمسة (ممتلئة إذا أُدخلت، ولونها حسب الدرجة) */
export function ExamDots({ scores, rules, size = 8 }: { scores: SubjectScores; rules: GradingRules; size?: number }) {
  const { c, verdict } = useTheme();
  return (
    <Row gap={4}>
      {EFFORT_PERIODS.map((p) => {
        const v = scores[p];
        const bg = typeof v !== 'number' ? c.line
          : v >= rules.individualExempt ? verdict.exempt.ink
            : v >= rules.pass ? c.ink2 : verdict.risk.ink;
        return <View key={p} accessibilityLabel={`${PERIOD_LABELS[p]} ${typeof v === 'number' ? arDigits(v) : 'لم تُدخل'}`}
          style={{ width: p === 'midyear' ? size * 2 : size, height: size, borderRadius: size / 2, backgroundColor: bg }} />;
      })}
    </Row>
  );
}

/** شريحة الحالة */
export function ToneChip({ tone, label, big }: { tone: RowTone; label: string; big?: boolean }) {
  const col = useToneColors()(tone);
  return (
    <View style={{ paddingHorizontal: big ? 14 : 10, paddingVertical: big ? 6 : 3, borderRadius: 999, backgroundColor: col.bg, alignSelf: 'flex-start' }}>
      <T size={big ? 15 : 13} weight="bold" color={col.ink}>{label}</T>
    </View>
  );
}

/** شرح بسيط لطريقة الحساب */
export function HowItWorks({ visible, onClose, rules }: { visible: boolean; onClose: () => void; rules: GradingRules }) {
  const { c } = useTheme();
  const step = (n: string, title: string, body: string) => (
    <Row style={{ alignItems: 'flex-start' }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
        <T size={13} weight="bold" color={c.accent}>{n}</T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="bold" size={15}>{title}</T>
        <T dim size={14}>{body}</T>
      </View>
    </Row>
  );
  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
        <T display size={24}>كيف يحسب سعي؟</T>
        {step('١', 'الفصل الأول', 'معدل الشهر الأول والثاني. إذا كان شهراً واحداً فقط فهو الفصل كله.')}
        {step('٢', 'نصف السنة', 'درجة امتحان نصف السنة كما هي.')}
        {step('٣', 'الفصل الثاني', 'معدل الشهر الثالث والرابع.')}
        <View style={{ backgroundColor: c.soft, borderRadius: 18, padding: 14, gap: 4 }}>
          <T weight="bold" color={c.softInk}>السعي السنوي = (الفصل الأول + نصف السنة + الفصل الثاني) ÷ ٣</T>
          <T size={13} color={c.softInk}>كل جزء ثلث السعي. لذلك نصف السنة وحده = ثلث درجتك.</T>
        </View>
        {step('٤', 'الإعفاء', `من مادة: سعيها ${arDigits(rules.individualExempt)} فأكثر. العام: معدل كل المواد ${arDigits(rules.generalAvg)} فأكثر ولا مادة تحت ${arDigits(rules.generalMin)}.${rules.round === 'half_up' ? ' والكسر يُجبر: ٨٩٫٥ تصبح ٩٠.' : ''}`)}
        {step('٥', 'كم تحتاج؟', 'سعي يحسب الدرجة التي تكفيك إذا أخذتها في كل امتحان متبقٍ — أي درجة أعلى منها تقرّبك أكثر.')}
        <T dim size={12}>الأرقام حسب ضوابط وزارة التربية، ويحدّثها الأدمن إذا تغيرت.</T>
      </ScrollView>
    </Sheet>
  );
}
