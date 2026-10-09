import { describe, expect, it } from 'vitest';
import { buildTree, collapseHeadings, fallbackOutline, flattenOutline, locate, normalizeOutline, normTitle, pageLabel } from './outline';

describe('عناوين الصفحات', () => {
  it('الترويسة المتكررة في صفحات متتالية تُحسب مرة واحدة', () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({
      page: i + 1,
      headings: [
        ...(i + 1 >= 3 && i + 1 <= 8 ? [{ level: 1, title: 'الفصل الأول: الكهربائية الساكنة' }] : []),
        ...(i + 1 === 5 ? [{ level: 2, title: '١-٢ قانون كولوم' }] : []),
      ],
    }));
    const h = collapseHeadings(pages, 12);
    expect(h).toEqual([{ page: 3, level: 1, title: 'الفصل الأول: الكهربائية الساكنة' }, { page: 5, level: 2, title: '١-٢ قانون كولوم' }]);
  });
  it('اسم الكتاب في أغلب الصفحات ضجيج يُحذف، وعنوان يتكرر في فصلين منفصلين يبقى', () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      page: i + 1,
      headings: [{ level: 1, title: 'فيزياء الخامس العلمي' }, ...(i === 1 || i === 7 ? [{ level: 2, title: 'تمارين' }] : [])],
    }));
    const h = collapseHeadings(pages, 10);
    expect(h.map((x) => x.title)).toEqual(['تمارين', 'تمارين']);
  });
  it('يتجاهل العناوين الفارغة والقصيرة ويحوّل المستويات الزائدة إلى ٢', () => {
    const h = collapseHeadings([{ page: 1, headings: [{ level: 3, title: 'قوانين مهمة' }, { level: 1, title: ' ' }, { level: 1, title: '٥' }] }], 3);
    expect(h).toEqual([{ page: 1, level: 2, title: 'قوانين مهمة' }]);
  });
  it('تجريد العنوان للمقارنة', () => {
    expect(normTitle('الفَصْلُ ١: المتّسعات')).toBe(normTitle('الفصل 2 المتسعات'));
  });
});

describe('تطبيع الفهرس', () => {
  it('يرتب ويقصّ ويسدّ الفجوات ويحصر المواضيع داخل فصلها', () => {
    const out = normalizeOutline({
      chapters: [
        { title: 'الفصل الثاني', start_page: 30, topics: [{ title: 'ب', page: 35 }, { title: 'خارج', page: 99 }, { title: 'أ', page: 31 }] },
        { title: 'الفصل الأول', start_page: 2, topics: [{ title: 'س', page: 5 }, { title: 'س', page: 6 }] },
      ],
    }, 60);
    expect(out.map((c) => [c.title, c.start_page, c.end_page])).toEqual([['الفصل الأول', 1, 29], ['الفصل الثاني', 30, 60]]);
    expect(out[0].topics).toEqual([{ title: 'س', page: 5 }]); // المكرر يُحذف
    expect(out[1].topics.map((t) => t.page)).toEqual([31, 35]); // خارج الملف حُذف ورُتّب
  });
  it('مقدمة قبل أول فصل بعيد، وبدون مقدمة إن كان قريباً', () => {
    const far = normalizeOutline([{ title: 'الفصل ١', start_page: 9 }], 40);
    expect(far[0]).toMatchObject({ title: 'مقدمة الملف', start_page: 1, end_page: 8 });
    expect(normalizeOutline([{ title: 'الفصل ١', start_page: 3 }], 40)[0].start_page).toBe(1);
  });
  it('فصلان ببداية واحدة لا يتداخلان، وأرقام نصية أو خاطئة لا تكسر شيئاً', () => {
    const out = normalizeOutline([{ title: 'أ', start_page: '5' }, { title: 'ب', start_page: 5 }, { title: 'ج', start_page: 'x' }, null, 7], 20);
    expect(out.map((c) => c.start_page)).toEqual([1, 5, 6]); // مقدمة + أ + ب
    expect(out.at(-1)!.end_page).toBe(20);
    out.forEach((c) => expect(c.end_page).toBeGreaterThanOrEqual(c.start_page));
  });
  it('ناتج فارغ أو غير صالح ← فهرس احتياطي يغطي كل الصفحات', () => {
    for (const bad of [null, {}, [], 'x', { chapters: 'x' }]) {
      const out = normalizeOutline(bad, 45);
      expect(out.map((c) => [c.start_page, c.end_page])).toEqual([[1, 20], [21, 40], [41, 45]]);
    }
    expect(fallbackOutline(0)).toEqual([]);
    expect(fallbackOutline(1)[0].title).toBe('صفحة 1');
  });
  it('الفهرس الناتج يغطي الملف كاملاً بلا فجوات', () => {
    const out = normalizeOutline([{ title: 'أ', start_page: 4 }, { title: 'ب', start_page: 20 }, { title: 'ج', start_page: 20 }, { title: 'د', start_page: 33 }], 50);
    expect(out[0].start_page).toBe(1);
    for (let i = 1; i < out.length; i++) expect(out[i].start_page).toBe(out[i - 1].end_page + 1);
    expect(out.at(-1)!.end_page).toBe(50);
  });
});

describe('الشجرة والتحديد', () => {
  const chapters = normalizeOutline([
    { title: 'الفصل الأول', start_page: 1, topics: [{ title: 'أ', page: 2 }, { title: 'ب', page: 10 }] },
    { title: 'الفصل الثاني', start_page: 21, topics: [{ title: 'ج', page: 25 }] },
  ], 40);
  const flat = flattenOutline(chapters);
  const ids = new Map<number, string>();
  const rows = flat.map((r, i) => {
    if (r.level === 1) ids.set(r.chapter, `c${r.chapter}`);
    return { id: `r${i}`, document_id: 'd', parent_id: r.level === 2 ? ids.get(r.chapter)! : null, level: r.level, title: r.title, start_page: r.start_page, end_page: r.end_page, sort: r.sort };
  });
  // نجعل معرّف الفصل هو نفسه المستخدم كأب
  rows.forEach((r) => { if (r.level === 1) r.id = ids.get(Number(flat[rows.indexOf(r)].chapter))!; });
  const tree = buildTree(rows);
  it('صفوف مسطّحة بنهايات المواضيع الصحيحة', () => {
    expect(flat.filter((r) => r.level === 2).map((r) => [r.title, r.start_page, r.end_page])).toEqual([['أ', 2, 9], ['ب', 10, 20], ['ج', 25, 40]]);
  });
  it('شجرة فصول بمواضيعها وتحديد صفحة', () => {
    expect(tree.map((c) => c.topics.length)).toEqual([2, 1]);
    expect(locate(tree, 12)).toMatchObject({ chapter: { title: 'الفصل الأول' }, topic: { title: 'ب' } });
    expect(locate(tree, 22).topic).toBeNull();
    expect(locate(tree, 999).chapter).toBeNull();
  });
  it('تسمية الصفحة', () => {
    expect(pageLabel(52, '48')).toBe('صفحة 52 (المطبوعة 48)');
    expect(pageLabel(5, '5')).toBe('صفحة 5');
    expect(pageLabel(5, null)).toBe('صفحة 5');
  });
});

import { outlineFromHeadings } from './outline';
describe('فهرس من العناوين مباشرة (احتياط)', () => {
  it('م١ فصول ومواضيعها بينها', () => {
    const out = outlineFromHeadings([
      { page: 1, level: 1, title: 'الفصل الأول' }, { page: 3, level: 2, title: 'أ' }, { page: 10, level: 1, title: 'الفصل الثاني' }, { page: 12, level: 2, title: 'ب' },
    ], 20);
    expect(out.map((c) => [c.title, c.start_page, c.end_page, c.topics.map((t) => t.title)])).toEqual([['الفصل الأول', 1, 9, ['أ']], ['الفصل الثاني', 10, 20, ['ب']]]);
  });
  it('بلا م١ تصير م٢ فصولاً، وبلا عناوين يرجع الاحتياطي الثابت', () => {
    expect(outlineFromHeadings([{ page: 1, level: 2, title: 'س' }, { page: 8, level: 2, title: 'ص' }], 15).map((c) => c.title)).toEqual(['س', 'ص']);
    expect(outlineFromHeadings([], 25).length).toBe(2);
  });
});

import { readFileSync } from 'node:fs';
describe('نسخة الدوال من منطق الفهرس', () => {
  it('مطابقة للأصل (شغّل node scripts/sync-outline.js إن فشل)', () => {
    const src = readFileSync(new URL('./outline.ts', import.meta.url), 'utf8');
    const copy = readFileSync(new URL('../../../supabase/functions/_shared/outline.ts', import.meta.url), 'utf8');
    expect(copy.split('\n').slice(1).join('\n')).toBe(src);
  });
});

import { parseChapterRef, parsePageRef, pickChapter } from './outline';
describe('فهم الطلب: صفحة وفصل', () => {
  it('رقم الصفحة', () => {
    expect(parsePageRef('اشرح لي ما في صفحة ٥٢ من الملزمة')).toBe(52);
    expect(parsePageRef('وش في ص 7؟')).toBe(7);
    expect(parsePageRef('page 120')).toBe(120);
    expect(parsePageRef('step 3 of the proof')).toBeNull();
    expect(parsePageRef('اشرح الفصل 3')).toBeNull();
    expect(parsePageRef('اشرح قانون كولوم')).toBeNull();
    expect(parsePageRef('صفحة 99999')).toBeNull();
  });
  it('رقم الفصل بالكلمة أو الرقم', () => {
    expect(parseChapterRef('لخص الفصل الثالث')).toEqual({ n: 3, word: 'الفصل' });
    expect(parseChapterRef('اشرح فصل ٥ كامل')?.n).toBe(5);
    expect(parseChapterRef('الباب الأول')?.n).toBe(1);
    expect(parseChapterRef('اشرح الفصل الأول')?.n).toBe(1);
    expect(parseChapterRef('اشرح الفصل الحادي')?.n).toBeNull();
    expect(parseChapterRef('اشرح قانون كولوم')).toBeNull();
  });
  const mk = (title: string, s: number, e: number, i: number) => ({ id: `c${i}`, document_id: 'd', parent_id: null, level: 1 as const, title, start_page: s, end_page: e, sort: i, topics: [] });
  const tree = [mk('مقدمة الملف', 1, 5, 0), mk('الفصل الأول: الكهربائية الساكنة', 6, 30, 1), mk('الفصل الثاني: المتسعات', 31, 60, 2), mk('الفصل الثالث: التيار', 61, 90, 3)];
  it('اختيار الفصل من الطلب', () => {
    expect(pickChapter(tree, 'اشرح الفصل الثاني')?.title).toContain('المتسعات');
    expect(pickChapter(tree, 'لخص فصل 3')?.title).toContain('التيار');
    expect(pickChapter(tree, 'اشرح المتسعات كاملة')?.title).toContain('المتسعات');
    expect(pickChapter(tree, 'شنو الجو اليوم')).toBeNull();
  });
  it('فصول بلا رقم في عناوينها: الرقم بترتيبها بعد تخطي المقدمة', () => {
    const t2 = [mk('مقدمة الملف', 1, 5, 0), mk('الكهربائية الساكنة', 6, 30, 1), mk('المتسعات', 31, 60, 2)];
    expect(pickChapter(t2, 'اشرح الفصل الثاني')?.title).toBe('المتسعات');
  });
});
