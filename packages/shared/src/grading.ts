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
  // الفصل الذي انتهى بشهر واحد فقط: ذلك الشهر يأخذ وزن الفصل كاملاً
  const closeSemester = (a: EffortPeriod, b: EffortPeriod) => {
    const known = [a, b].filter((p) => has(s[p]));
    if (known.length === 1) {
      w[known[0]] = third;
      w[known[0] === a ? b : a] = 0;
    }
  };
  if (has(s.midyear) || has(s.month3) || has(s.month4)) closeSemester('month1', 'month2');
  // الفصل الثاني ينتهي بالامتحان النهائي
  if (has(s.final)) closeSemester('month3', 'month4');
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
  // نزيل أخطاء الكسور العشرية أولاً (٨٤٫٥ قد تُحسب ٨٤٫٤٩٩٩٩٩٩) حتى لا يضيع جبر الكسر على الطالب
  const v = Math.round(value * 1e6) / 1e6;
  return rules.round === 'half_up' ? Math.floor(v + 0.5) : v;
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

// ---------------------------------------------------------------- الهدف والخطة

/** هدف الطالب لهذه السنة (يختاره عند أول دخول للدرجات ويغيّره متى شاء) */
export type Goal = 'pass' | 'individual' | 'general';

export const GOALS: { key: Goal; title: string; short: string; body: string }[] = [
  { key: 'general', title: 'الإعفاء العام', short: 'الإعفاء العام', body: 'أُعفى من كل الامتحانات النهائية: معدل عالٍ ولا مادة ضعيفة.' },
  { key: 'individual', title: 'الإعفاء من مواد', short: 'إعفاء المواد', body: 'أُعفى من المواد التي أقدر عليها، وأدخل النهائي في الباقي.' },
  { key: 'pass', title: 'النجاح', short: 'النجاح', body: 'أضمن النجاح في كل المواد بأريحية.' },
];

/** الدرجة التي يجب أن يصلها سعي كل مادة حسب الهدف */
export function goalTarget(goal: Goal, rules: GradingRules = DEFAULT_RULES): number {
  return goal === 'pass' ? rules.pass : goal === 'individual' ? rules.individualExempt : rules.generalMin;
}

/** الوزن المعروف والمتبقي لمادة (مجموع الأوزان دائماً ١) */
function parts(s: SubjectScores) {
  const w = weights(s);
  let known = 0;
  let wRemaining = 0;
  for (const p of EFFORT_PERIODS) {
    if (w[p] === 0) continue;
    const v = s[p];
    if (has(v)) known += v * w[p];
    else wRemaining += w[p];
  }
  return { known, wRemaining };
}

/** «ماذا لو»: السعي المتوقع إذا أخذ الطالب الدرجة نفسها في كل امتحان متبقٍ */
export function projectedEffort(s: SubjectScores, assumed: number): number {
  const { known, wRemaining } = parts(s);
  return known + wRemaining * Math.max(0, Math.min(100, assumed));
}

export interface GeneralPlan {
  /** حالة الإعفاء العام ككل */
  state: NeedState;
  /** الدرجة نفسها في كل امتحان متبقٍ بكل المواد ليصل المعدل إلى الحد المطلوب */
  perExam: number | null;
  /** ما تحتاجه كل مادة: الأعلى بين «درجة المعدل» و«حد أقل مادة» */
  bySubject: Record<string, Need>;
  /** المواد التي تمنع الإعفاء العام (لا يمكنها الوصول لحد أقل مادة) */
  blockers: string[];
}

/**
 * خطة الإعفاء العام: كل المواد تدخل في المعدل (المادة بلا درجات = كل امتحاناتها متبقية).
 * المعدل = متوسط سعي المواد ≥ generalAvg، وكل مادة ≥ generalMin.
 */
export function generalPlan(subjects: Record<string, SubjectScores>, rules: GradingRules = DEFAULT_RULES): GeneralPlan {
  const ids = Object.keys(subjects);
  const bySubject: Record<string, Need> = {};
  const blockers: string[] = [];
  if (!ids.length) return { state: 'impossible', perExam: null, bySubject, blockers };

  let sumKnown = 0;
  let sumRemaining = 0;
  for (const id of ids) {
    const p = parts(subjects[id]);
    sumKnown += p.known;
    sumRemaining += p.wRemaining;
  }
  const effAvg = rules.round === 'half_up' ? rules.generalAvg - 0.5 : rules.generalAvg;

  let avgState: NeedState;
  let perExam: number | null;
  if (sumRemaining === 0) {
    perExam = null;
    avgState = applyRounding(sumKnown / ids.length, rules) >= rules.generalAvg ? 'achieved' : 'missed';
  } else {
    const x = Math.round(((ids.length * effAvg - sumKnown) / sumRemaining) * 1e6) / 1e6;
    if (x <= 0) {
      perExam = 0;
      avgState = 'achieved';
    } else {
      perExam = Math.ceil(x * 2) / 2;
      avgState = perExam > 100 ? 'impossible' : 'possible';
    }
  }

  for (const id of ids) {
    const minNeed = neededFor(subjects[id], rules.generalMin, rules);
    if (minNeed.state === 'impossible' || minNeed.state === 'missed') blockers.push(id);
    if (minNeed.state !== 'possible' && minNeed.state !== 'achieved') {
      bySubject[id] = minNeed;
    } else if (perExam === null || minNeed.remaining.length === 0) {
      bySubject[id] = minNeed;
    } else {
      const per = Math.max(perExam, minNeed.perExam ?? 0);
      bySubject[id] = {
        state: per <= 0 ? 'achieved' : per > 100 ? 'impossible' : 'possible',
        perExam: per,
        remaining: minNeed.remaining,
      };
    }
  }

  let state: NeedState = avgState;
  if (blockers.length) state = ids.some((id) => bySubject[id].state === 'missed') ? 'missed' : 'impossible';
  else if (avgState === 'achieved' && Object.values(bySubject).some((n) => n.state === 'possible')) state = 'possible';
  return { state, perExam, bySubject, blockers };
}

/** خطة المادة حسب الهدف (للأهداف الفردية: النجاح أو إعفاء المادة) */
export function subjectNeed(s: SubjectScores, goal: Goal, rules: GradingRules = DEFAULT_RULES): Need {
  return neededFor(s, goalTarget(goal, rules), rules);
}

/**
 * تقريبي: كم يحتاج الطالب في الامتحان النهائي لينجح في مادة لم يُعفَ منها،
 * حسب الضابطة الشائعة: الدرجة النهائية = (السعي + النهائي) ÷ ٢ ≥ درجة النجاح.
 */
export function finalExamNeeded(annual: number, rules: GradingRules = DEFAULT_RULES): number {
  const eff = rules.round === 'half_up' ? rules.pass - 0.5 : rules.pass;
  return Math.max(0, Math.ceil((2 * eff - annual) * 2) / 2);
}
