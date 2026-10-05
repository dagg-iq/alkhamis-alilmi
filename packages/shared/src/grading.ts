/**
 * حساب السعي السنوي والإعفاء وفق ضوابط وزارة التربية العراقية (المراحل غير المنتهية).
 * كل الأرقام تأتي من GradingRules (تُعدَّل من لوحة التحكم) وليست ثابتة هنا.
 *
 * الفصل الأول  = معدل الشهر الأول والثاني (شهر واحد كحد أدنى)
 * الفصل الثاني = معدل الشهر الثالث والرابع
 * السعي       = (الفصل الأول + نصف السنة + الفصل الثاني) ÷ ٣
 */

export const PERIODS = ['month1', 'month2', 'midyear', 'month3', 'month4', 'final'] as const;
export type Period = (typeof PERIODS)[number];
/** الامتحانات التي تدخل في السعي السنوي (النهائي خارجها). */
export const EFFORT_PERIODS = ['month1', 'month2', 'midyear', 'month3', 'month4'] as const;
export type EffortPeriod = (typeof EFFORT_PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  month1: 'الشهر الأول',
  month2: 'الشهر الثاني',
  midyear: 'نصف السنة',
  month3: 'الشهر الثالث',
  month4: 'الشهر الرابع',
  final: 'النهائي',
};

export interface GradingRules {
  /** الإعفاء الفردي: سعي المادة ≥ هذا الرقم */
  individualExempt: number;
  /** الإعفاء العام: معدل السعي لكل المواد ≥ هذا الرقم */
  generalAvg: number;
  /** الإعفاء العام: أقل سعي في أي مادة ≥ هذا الرقم */
  generalMin: number;
  /** درجة الدخول/النجاح */
  pass: number;
  /** جبر الكسور قبل المقارنة: half_up يقرّب ٨٩٫٥ إلى ٩٠ */
  round: 'half_up' | 'none';
}

export const DEFAULT_RULES: GradingRules = {
  individualExempt: 90,
  generalAvg: 85,
  generalMin: 75,
  pass: 50,
  round: 'half_up',
};

/** يقبل الشكل المخزَّن في app_settings (snake_case) أو الشكل الداخلي. */
export function parseRules(raw: unknown): GradingRules {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    individualExempt: num(r.individualExempt ?? r.individual_exempt, DEFAULT_RULES.individualExempt),
    generalAvg: num(r.generalAvg ?? r.general_avg, DEFAULT_RULES.generalAvg),
    generalMin: num(r.generalMin ?? r.general_min, DEFAULT_RULES.generalMin),
    pass: num(r.pass, DEFAULT_RULES.pass),
    round: r.round === 'none' ? 'none' : 'half_up',
  };
}

export type SubjectScores = Partial<Record<Period, number | null>>;

const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function semester1(s: SubjectScores): number | null {
  return mean([s.month1, s.month2].filter(has));
}

export function semester2(s: SubjectScores): number | null {
  return mean([s.month3, s.month4].filter(has));
}

/** السعي السنوي النهائي — فقط عندما تكتمل المكونات الثلاثة. */
export function annualEffort(s: SubjectScores): number | null {
  const s1 = semester1(s);
  const s2 = semester2(s);
  if (s1 === null || s2 === null || !has(s.midyear)) return null;
  return (s1 + s.midyear + s2) / 3;
}

/**
 * أوزان كل امتحان في السعي. الفصل الذي انتهى (بعد نصف السنة للفصل الأول) يُقسم
 * وزنه على الأشهر المُدخلة فعلاً؛ الفصل الجاري يُفترض فيه شهران.
 */
function weights(s: SubjectScores): Record<EffortPeriod, number> {
  const third = 1 / 3;
  const w: Record<EffortPeriod, number> = { month1: 1 / 6, month2: 1 / 6, midyear: third, month3: 1 / 6, month4: 1 / 6 };
  const s1Closed = has(s.midyear) || has(s.month3) || has(s.month4);
  if (s1Closed) {
    const known = (['month1', 'month2'] as const).filter((p) => has(s[p]));
    if (known.length === 1) {
      w[known[0]] = third;
      w[known[0] === 'month1' ? 'month2' : 'month1'] = 0;
    }
  }
  return w;
}

export interface EffortStatus {
  /** المعدل الحالي من الامتحانات المُدخلة (null إذا لا توجد درجات) */
  current: number | null;
  /** السعي النهائي إذا اكتمل */
  annual: number | null;
  /** الامتحانات المتبقية التي تدخل في السعي */
  remaining: EffortPeriod[];
}

export function effortStatus(s: SubjectScores): EffortStatus {
  const w = weights(s);
  let sum = 0;
  let wsum = 0;
  const remaining: EffortPeriod[] = [];
  for (const p of EFFORT_PERIODS) {
    if (w[p] === 0) continue;
    const v = s[p];
    if (has(v)) {
      sum += v * w[p];
      wsum += w[p];
    } else remaining.push(p);
  }
  return { current: wsum > 0 ? sum / wsum : null, annual: annualEffort(s), remaining };
}

export type NeedState = 'achieved' | 'possible' | 'impossible' | 'missed';

export interface Need {
  state: NeedState;
  /** الدرجة المطلوبة في كل امتحان متبقٍ (نفس الدرجة في كلها) */
  perExam: number | null;
  remaining: EffortPeriod[];
}

/**
 * كم يحتاج الطالب في كل امتحان متبقٍ ليصل سعيه إلى target.
 * achieved: وصل مسبقاً (السعي مكتمل وفوق الهدف، أو حتى صفر في الباقي يكفي)
 * missed:   السعي مكتمل وتحت الهدف
 */
export function neededFor(s: SubjectScores, target: number, rules: GradingRules = DEFAULT_RULES): Need {
  const w = weights(s);
  let known = 0;
  let wRemaining = 0;
  const remaining: EffortPeriod[] = [];
  for (const p of EFFORT_PERIODS) {
    if (w[p] === 0) continue;
    const v = s[p];
    if (has(v)) known += v * w[p];
    else {
      wRemaining += w[p];
      remaining.push(p);
    }
  }
  if (remaining.length === 0) {
    const annual = applyRounding(known, rules);
    return { state: annual >= target ? 'achieved' : 'missed', perExam: null, remaining };
  }
  // مع جبر الكسور يكفي الوصول إلى target - 0.5
  const effectiveTarget = rules.round === 'half_up' ? target - 0.5 : target;
  const x = Math.round(((effectiveTarget - known) / wRemaining) * 1e6) / 1e6; // تجنب أخطاء الكسور العشرية
  if (x <= 0) return { state: 'achieved', perExam: 0, remaining };
  const perExam = Math.ceil(x * 2) / 2; // لأقرب نصف درجة للأعلى
  return { state: perExam > 100 ? 'impossible' : 'possible', perExam, remaining };
}

export function applyRounding(value: number, rules: GradingRules = DEFAULT_RULES): number {
  return rules.round === 'half_up' ? Math.floor(value + 0.5) : value;
}

export function isIndividuallyExempt(annual: number | null, rules: GradingRules = DEFAULT_RULES): boolean {
  return annual !== null && applyRounding(annual, rules) >= rules.individualExempt;
}

export interface GeneralStatus {
  average: number | null;
  min: number | null;
  /** المادة صاحبة أقل معدل */
  minSubjectId: string | null;
  meetsAverage: boolean;
  meetsMin: boolean;
  /** متحقق نهائياً: كل المواد مكتملة والشروط محققة */
  final: boolean;
  exempt: boolean;
}

/**
 * الإعفاء العام. يستخدم السعي النهائي إن اكتمل، وإلا المعدل الحالي كتوقع.
 * المواد التي لا درجات لها لا تدخل في المعدل.
 */
export function generalExemption(
  subjects: Record<string, SubjectScores>,
  rules: GradingRules = DEFAULT_RULES,
): GeneralStatus {
  const values: { id: string; value: number; final: boolean }[] = [];
  for (const [id, s] of Object.entries(subjects)) {
    const st = effortStatus(s);
    const v = st.annual ?? st.current;
    if (v !== null) values.push({ id, value: v, final: st.annual !== null });
  }
  if (!values.length) {
    return { average: null, min: null, minSubjectId: null, meetsAverage: false, meetsMin: false, final: false, exempt: false };
  }
  const average = values.reduce((a, b) => a + b.value, 0) / values.length;
  const minEntry = values.reduce((a, b) => (b.value < a.value ? b : a));
  const meetsAverage = applyRounding(average, rules) >= rules.generalAvg;
  const meetsMin = applyRounding(minEntry.value, rules) >= rules.generalMin;
  const allFinal = values.length === Object.keys(subjects).length && values.every((v) => v.final);
  return {
    average,
    min: minEntry.value,
    minSubjectId: minEntry.id,
    meetsAverage,
    meetsMin,
    final: allFinal,
    exempt: meetsAverage && meetsMin,
  };
}

export type SubjectVerdict = 'exempt' | 'near' | 'safe' | 'risk' | 'empty';

/** حكم مختصر لكل مادة يُستخدم للألوان في الواجهة. */
export function subjectVerdict(s: SubjectScores, rules: GradingRules = DEFAULT_RULES): SubjectVerdict {
  const st = effortStatus(s);
  const v = st.annual ?? st.current;
  if (v === null) return 'empty';
  const need = neededFor(s, rules.individualExempt, rules);
  if (need.state === 'achieved') return 'exempt';
  if (need.state === 'possible') return 'near';
  return applyRounding(v, rules) >= rules.pass ? 'safe' : 'risk';
}
