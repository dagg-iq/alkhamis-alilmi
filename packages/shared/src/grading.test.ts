import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES, annualEffort, effortStatus, generalExemption, isIndividuallyExempt, neededFor, parseRules,
  semester1, subjectVerdict,
} from './grading';
import { arDigits, formatScore, isTripleName, parseNumber, relativeDays, youtubeId } from './format';

const noRound = { ...DEFAULT_RULES, round: 'none' as const };

describe('السعي السنوي', () => {
  it('يحسب الفصل الأول من شهر واحد أو شهرين', () => {
    expect(semester1({ month1: 80 })).toBe(80);
    expect(semester1({ month1: 80, month2: 90 })).toBe(85);
    expect(semester1({})).toBeNull();
  });

  it('السعي = (ف١ + نصف + ف٢) ÷ ٣', () => {
    expect(annualEffort({ month1: 90, month2: 80, midyear: 90, month3: 100, month4: 90 })).toBeCloseTo((85 + 90 + 95) / 3);
    expect(annualEffort({ month1: 90, midyear: 90 })).toBeNull();
  });

  it('الفصل الأول بشهر واحد بعد نصف السنة يأخذ وزن الفصل كاملاً', () => {
    const st = effortStatus({ month1: 60, midyear: 90 });
    expect(st.current).toBeCloseTo(75);
    expect(st.remaining).toEqual(['month3', 'month4']);
  });
});

describe('المطلوب للإعفاء', () => {
  it('مثال الكيمياء: ف١ ٩١٫٥ ونصف ٩٥ ← يحتاج ٨٣٫٥ بدون جبر', () => {
    const need = neededFor({ month1: 93, month2: 90, midyear: 95 }, 90, noRound);
    expect(need.state).toBe('possible');
    expect(need.perExam).toBe(83.5);
  });

  it('جبر الكسور يخفض المطلوب', () => {
    const need = neededFor({ month1: 93, month2: 90, midyear: 95 }, 90, DEFAULT_RULES);
    expect(need.perExam).toBe(82);
  });

  it('غير ممكن عندما يتجاوز ١٠٠', () => {
    expect(neededFor({ month1: 82, month2: 88, midyear: 80 }, 90, noRound).state).toBe('impossible');
  });

  it('محقق مسبقاً', () => {
    expect(neededFor({ month1: 100, month2: 100, midyear: 100, month3: 100 }, 50).state).toBe('achieved');
  });

  it('سعي مكتمل تحت الهدف = فات', () => {
    expect(neededFor({ month1: 80, month2: 80, midyear: 80, month3: 80, month4: 80 }, 90).state).toBe('missed');
  });

  it('بدون أي درجة يحتاج الهدف نفسه', () => {
    const need = neededFor({}, 90, noRound);
    expect(need.perExam).toBe(90);
    expect(need.remaining).toHaveLength(5);
  });

  it('بعد الشهر الثالث يُحسب المطلوب في الرابع', () => {
    // ف١ = ٩٠، نصف = ٩٠، ش٣ = ٨٠ ← المطلوب ف٢ = ٩٠ ← ش٤ = ١٠٠
    const need = neededFor({ month1: 90, month2: 90, midyear: 90, month3: 80 }, 90, noRound);
    expect(need.remaining).toEqual(['month4']);
    expect(need.perExam).toBe(100);
  });
});

describe('الإعفاء', () => {
  it('الفردي مع جبر الكسور', () => {
    expect(isIndividuallyExempt(89.5)).toBe(true);
    expect(isIndividuallyExempt(89.4)).toBe(false);
    expect(isIndividuallyExempt(89.5, noRound)).toBe(false);
  });

  it('العام: معدل ٨٥ وأقل مادة ٧٥', () => {
    const ok = generalExemption({
      a: { month1: 90, month2: 90, midyear: 90, month3: 90, month4: 90 },
      b: { month1: 76, month2: 76, midyear: 76, month3: 76, month4: 76 },
      c: { month1: 95, month2: 95, midyear: 95, month3: 95, month4: 95 },
    });
    expect(ok.average).toBeCloseTo(87);
    expect(ok.exempt).toBe(true);
    expect(ok.final).toBe(true);
    expect(ok.minSubjectId).toBe('b');

    const lowMin = generalExemption({ a: { month1: 100, midyear: 100 }, b: { month1: 70, midyear: 70 } });
    expect(lowMin.meetsAverage).toBe(true);
    expect(lowMin.meetsMin).toBe(false);
    expect(lowMin.exempt).toBe(false);
  });

  it('حكم المادة', () => {
    expect(subjectVerdict({})).toBe('empty');
    expect(subjectVerdict({ month1: 95, month2: 95, midyear: 95, month3: 95, month4: 95 })).toBe('exempt');
    expect(subjectVerdict({ month1: 93, month2: 90, midyear: 95 })).toBe('near');
    expect(subjectVerdict({ month1: 60, month2: 60, midyear: 60 })).toBe('safe');
    expect(subjectVerdict({ month1: 30, month2: 30, midyear: 30 })).toBe('risk');
  });

  it('يقرأ الإعدادات من قاعدة البيانات', () => {
    expect(parseRules({ individual_exempt: 95, general_avg: 80, round: 'none' })).toMatchObject({
      individualExempt: 95, generalAvg: 80, generalMin: 75, round: 'none',
    });
    expect(parseRules(null)).toEqual(DEFAULT_RULES);
  });
});

describe('التنسيق', () => {
  it('الأرقام العربية', () => {
    expect(arDigits(89.7)).toBe('٨٩٫٧');
    expect(formatScore(83.55)).toBe('٨٣٫٦');
    expect(formatScore(null)).toBe('—');
    expect(parseNumber('٩٥٫٥')).toBe(95.5);
    expect(parseNumber('abc')).toBeNull();
  });

  it('الاسم الثلاثي', () => {
    expect(isTripleName('أحمد علي حسين')).toBe(true);
    expect(isTripleName('أحمد علي')).toBe(false);
  });

  it('يوتيوب', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://example.com')).toBeNull();
  });

  it('الأيام النسبية', () => {
    const now = new Date(2026, 9, 5);
    expect(relativeDays(new Date(2026, 9, 9), now)).toBe('بعد ٤ أيام');
    expect(relativeDays(new Date(2026, 9, 6), now)).toBe('غداً');
  });
});
