/**
 * تحليل الدرجات حسب هدف الطالب — نتيجة واحدة تستخدمها شاشة الدرجات والرئيسية والويدجتات،
 * مكتوبة بجمل بسيطة يفهمها الطالب مباشرة.
 */
import { arDigits, formatScore } from './format';
import {
  DEFAULT_RULES, EFFORT_PERIODS, applyRounding, effortStatus, generalPlan, goalTarget, neededFor,
  type Goal, type GradingRules, type Need, type SubjectScores,
} from './grading';

export type RowTone = 'done' | 'ontrack' | 'improve' | 'risk' | 'empty';

export interface SubjectRow {
  id: string;
  name: string;
  scores: SubjectScores;
  /** السعي إن اكتمل وإلا المعدل الحالي */
  value: number | null;
  final: boolean;
  /** عدد امتحانات السعي المُدخلة (من ٥) */
  entered: number;
  need: Need;
  tone: RowTone;
  label: string;
}

export interface GradeSummary {
  goal: Goal;
  /** معدل المواد التي فيها درجات */
  average: number | null;
  counted: number;
  total: number;
  state: Need['state'] | 'empty';
  /** الدرجة المطلوبة في كل امتحان قادم (الأعلى بين المواد الممكنة) */
  perExam: number | null;
  headline: string;
  detail: string;
  /** المادة التي تحتاج أكبر انتباه الآن */
  focus: SubjectRow | null;
  rows: SubjectRow[];
  /** عدد المواد التي تحقق الهدف أو على طريقه */
  onTrack: number;
}

export const TONE_LABELS: Record<RowTone, string> = {
  done: 'متحقق',
  ontrack: 'على الطريق',
  improve: 'تحتاج تحسين',
  risk: 'صعب',
  empty: 'لا درجات',
};

export const GOAL_TITLES: Record<Goal, string> = {
  general: 'الإعفاء العام',
  individual: 'الإعفاء من المواد',
  pass: 'النجاح',
};

function toneOf(need: Need, value: number | null, rules: GradingRules): RowTone {
  if (value === null) return 'empty';
  if (need.state === 'achieved') return 'done';
  if (need.state === 'impossible' || need.state === 'missed') return 'risk';
  // إذا بقي على مستواه الحالي يصل للهدف ← على الطريق
  return need.perExam !== null && need.perExam <= applyRounding(value, rules) ? 'ontrack' : 'improve';
}

function rowLabel(r: { tone: RowTone; need: Need }) {
  if (r.tone === 'empty') return r.need.state === 'possible' ? formatScore(r.need.perExam) : '—';
  if (r.need.state === 'achieved') return 'متحقق';
  if (r.need.state === 'missed') return 'فات';
  if (r.need.state === 'impossible') return 'غير ممكن';
  return formatScore(r.need.perExam);
}

/** العدد مع المعدود بالعربية: مادة واحدة، مادتان، ٣ مواد، ١١ مادة */
export function countOf(n: number, singular: string, dual: string, plural: string, one?: string) {
  if (n === 1) return one ?? singular;
  if (n === 2) return dual;
  return `${arDigits(n)} ${n >= 3 && n <= 10 ? plural : singular}`;
}

/** «في …»: الامتحان القادم / كل من الامتحانين القادمين / كل امتحان من الـ٣ القادمة */
export function remainingExams(n: number) {
  if (n <= 1) return 'الامتحان القادم';
  if (n === 2) return 'كل من الامتحانين القادمين';
  return `كل امتحان من الامتحانات الـ${arDigits(n)} القادمة`;
}
const exams = remainingExams;

export function analyzeGrades(
  subjects: { id: string; name: string }[],
  grades: Record<string, SubjectScores>,
  goal: Goal,
  rules: GradingRules = DEFAULT_RULES,
  short: (name: string) => string = (n) => n,
): GradeSummary {
  const all = Object.fromEntries(subjects.map((s) => [s.id, grades[s.id] ?? {}]));
  const gp = goal === 'general' ? generalPlan(all, rules) : null;

  const rows: SubjectRow[] = subjects.map((s) => {
    const scores = all[s.id];
    const st = effortStatus(scores);
    const value = st.annual ?? st.current;
    const need = gp ? gp.bySubject[s.id] : neededFor(scores, goalTarget(goal, rules), rules);
    const tone = toneOf(need, value, rules);
    const entered = EFFORT_PERIODS.filter((p) => typeof scores[p] === 'number').length;
    return { id: s.id, name: s.name, scores, value, final: st.annual !== null, entered, need, tone, label: rowLabel({ tone, need }) };
  });

  const withValues = rows.filter((r) => r.value !== null);
  const average = withValues.length ? withValues.reduce((a, r) => a + (r.value as number), 0) / withValues.length : null;
  const onTrack = rows.filter((r) => r.tone === 'done' || r.tone === 'ontrack').length;
  const possible = rows.filter((r) => r.need.state === 'possible');
  const hardest = [...possible].sort((a, b) => (b.need.perExam ?? 0) - (a.need.perExam ?? 0))[0] ?? null;
  // المادة الأحوج للانتباه: أكبر فرق بين المطلوب ومستواه الحالي
  const weakest = rows.filter((r) => r.tone === 'improve')
    .sort((a, b) => ((b.need.perExam ?? 0) - (b.value ?? 0)) - ((a.need.perExam ?? 0) - (a.value ?? 0)))[0] ?? null;
  const base = { goal, average, counted: withValues.length, total: subjects.length, rows, onTrack };

  if (!withValues.length) {
    return {
      ...base, state: 'empty', perExam: null, focus: null,
      headline: 'أدخل أول درجة',
      detail: 'سجّل درجة أي امتحان، وسعي يخبرك بالضبط كم تحتاج في الامتحانات القادمة لتصل لهدفك.',
    };
  }

  // ---------------------------------------------------------------- الإعفاء العام
  if (gp) {
    const blockers = rows.filter((r) => gp.blockers.includes(r.id));
    if (gp.state === 'achieved') {
      const final = rows.every((r) => r.final);
      return {
        ...base, state: 'achieved', perExam: 0, focus: null,
        headline: final ? 'معفى إعفاءً عاماً' : 'الإعفاء العام مضمون',
        detail: `معدلك فوق ${arDigits(rules.generalAvg)} وكل موادك فوق ${arDigits(rules.generalMin)}. حافظ على مستواك.`,
      };
    }
    if (gp.state === 'missed' || gp.state === 'impossible') {
      const names = blockers.map((r) => short(r.name));
      return {
        ...base, state: gp.state, perExam: null, focus: blockers[0] ?? hardest,
        headline: gp.state === 'missed' ? 'لم يتحقق الإعفاء العام' : 'الإعفاء العام صعب هذه السنة',
        detail: names.length
          ? `${names.slice(0, 2).join(' و')} لا ${names.length > 1 ? 'تستطيعان' : 'تستطيع'} الوصول إلى ${arDigits(rules.generalMin)}. اجعل هدفك الإعفاء من المواد التي تقدر عليها، أو النجاح بدرجات عالية.`
          : `المعدل المطلوب (${arDigits(rules.generalAvg)}) أعلى مما تسمح به الامتحانات المتبقية. جرّب هدف الإعفاء من المواد.`,
      };
    }
    const per = Math.max(...possible.map((r) => r.need.perExam ?? 0), gp.perExam ?? 0);
    const extra = possible.filter((r) => (r.need.perExam ?? 0) > (gp.perExam ?? 0));
    const tone = per <= (average ?? 0) ? 'على طريق الإعفاء العام' : per <= 95 ? 'الإعفاء العام ممكن' : 'الإعفاء العام ممكن بصعوبة';
    return {
      ...base, state: 'possible', perExam: per, focus: weakest ?? extra[0] ?? null,
      headline: tone,
      detail: `خذ ${formatScore(gp.perExam)} أو أكثر في كل امتحان قادم بكل المواد`
        + (extra.length ? `، و${formatScore(extra[0].need.perExam)} في ${short(extra[0].name)} لأنها أضعف مادة` : '')
        + '.',
    };
  }

  // ---------------------------------------------------------------- الإعفاء من المواد
  if (goal === 'individual') {
    const done = rows.filter((r) => r.need.state === 'achieved');
    const can = rows.filter((r) => r.need.state === 'achieved' || r.need.state === 'possible');
    const closest = [...possible].sort((a, b) => (a.need.perExam ?? 0) - (b.need.perExam ?? 0))[0] ?? null;
    if (!can.length) {
      return {
        ...base, state: 'impossible', perExam: null, focus: null,
        headline: 'الإعفاء من المواد صعب هذه السنة',
        detail: `لا توجد مادة تستطيع الوصول إلى ${arDigits(rules.individualExempt)}. ركّز على النجاح بدرجات عالية في النهائي.`,
      };
    }
    return {
      ...base,
      state: can.length === done.length ? 'achieved' : 'possible',
      perExam: closest?.need.perExam ?? null,
      focus: closest,
      headline: `تستطيع الإعفاء من ${countOf(can.length, 'مادة', 'مادتين', 'مواد', 'مادة واحدة')}`,
      detail: closest
        ? `أقربها ${short(closest.name)}: يكفيك ${formatScore(closest.need.perExam)} في ${exams(closest.need.remaining.length)}.`
        : `معفى من ${arDigits(done.length)} — حافظ على مستواك.`,
    };
  }

  // ---------------------------------------------------------------- النجاح
  const risky = rows.filter((r) => r.need.state === 'impossible' || r.need.state === 'missed');
  if (risky.length) {
    return {
      ...base, state: 'impossible', perExam: null, focus: risky[0],
      headline: `انتبه: ${countOf(risky.length, 'مادة', 'مادتان', 'مواد')} في خطر`,
      detail: `${risky.slice(0, 2).map((r) => short(r.name)).join(' و')} لا ${risky.length > 1 ? 'تصلان' : 'تصل'} إلى ${arDigits(rules.pass)} في السعي. ستحتاج درجة عالية في النهائي — اسأل مدرّسك عن خطة.`,
    };
  }
  if (!possible.length) {
    return { ...base, state: 'achieved', perExam: 0, focus: null, headline: 'النجاح مضمون في كل المواد', detail: 'ارفع هدفك: جرّب هدف الإعفاء من المواد.' };
  }
  return {
    ...base, state: 'possible', perExam: hardest?.need.perExam ?? null, focus: weakest ?? null,
    headline: hardest && (hardest.need.perExam ?? 0) <= applyRounding(hardest.value ?? 0, rules) ? 'على طريق النجاح' : 'النجاح يحتاج جهداً',
    detail: hardest ? `أصعب مادة ${short(hardest.name)}: تحتاج ${formatScore(hardest.need.perExam)} في ${exams(hardest.need.remaining.length)}.` : '',
  };
}
