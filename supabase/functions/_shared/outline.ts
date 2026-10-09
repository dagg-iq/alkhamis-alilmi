// نسخة من packages/shared/src/outline.ts للدوال (لا تعدّلها هنا؛ انسخ الأصل: node scripts/sync-outline.js — اختبار يتأكد من تطابقهما)
/**
 * فهرس الكتب والملازم: فصول (مستوى ١) ومواضيع (مستوى ٢) بأرقام الصفحات.
 * الذكاء الاصطناعي يقرأ كل صفحة ويرجع عناوينها، ثم نبني الفهرس من هذه العناوين بقواعد صارمة
 * (إزالة ترويسات الصفحات المتكررة، ترتيب، قصّ على حدود الملف، سدّ الفجوات) حتى لا يفسده خطأ نموذج.
 */
export interface RawHeading { level: number; title: string }
export interface PageHeadings { page: number; headings: RawHeading[] }
export interface OutlineTopic { title: string; page: number }
export interface OutlineChapter { title: string; start_page: number; end_page: number; topics: OutlineTopic[] }

export interface OutlineRow {
  id: string;
  document_id: string;
  parent_id: string | null;
  level: 1 | 2;
  title: string;
  start_page: number;
  end_page: number | null;
  sort: number;
}
export interface OutlineNode extends OutlineRow { topics: OutlineRow[] }

const DIACRITICS = /[ً-ْـٰ]/g;
/** عنوان مجرد للمقارنة: بلا تشكيل ولا أرقام ولا ترقيم */
export function normTitle(s: string): string {
  return s.replace(DIACRITICS, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[0-9٠-٩۰-۹]+/g, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

const clean = (s: unknown, max = 120) => String(s ?? '').replace(/\s+/g, ' ').replace(/^[\s\-–—:.،]+|[\s\-–—:.،]+$/g, '').slice(0, max).trim();

/**
 * عناوين الصفحات الخام ← قائمة نظيفة: العنوان المتكرر في صفحات متتالية (ترويسة جارية) يُحسب مرة عند أول ظهور،
 * وما يظهر في أكثر من نصف الصفحات (اسم الكتاب مثلاً) يُحذف.
 */
export function collapseHeadings(pages: PageHeadings[], total: number): { page: number; level: 1 | 2; title: string }[] {
  const entries: { page: number; level: 1 | 2; title: string; key: string; i: number }[] = [];
  let i = 0;
  for (const p of pages) {
    for (const h of p.headings ?? []) {
      const title = clean(h?.title);
      const key = normTitle(title);
      if (!title || key.length < 2) continue;
      entries.push({ page: p.page, level: Number(h.level) <= 1 ? 1 : 2, title, key, i: i++ });
    }
  }
  const byKey = new Map<string, number[]>();
  for (const e of entries) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e.page]);
  const keep = new Set<number>();
  for (const [key, list] of byKey) {
    const distinct = [...new Set(list)].sort((a, b) => a - b);
    if (total >= 6 && distinct.length / total > 0.5) continue; // ضجيج
    let prev = -10;
    for (const pg of distinct) {
      if (pg - prev > 1) for (const e of entries) if (e.key === key && e.page === pg) { keep.add(e.i); break; }
      prev = pg;
    }
  }
  return entries.filter((e) => keep.has(e.i)).sort((a, b) => a.page - b.page || a.i - b.i)
    .map(({ page, level, title }) => ({ page, level, title }));
}

/** أسطر مضغوطة تُرسل للنموذج: «ص١٢ | م١ | عنوان» */
export function headingLines(h: { page: number; level: number; title: string }[]): string {
  return h.map((x) => `ص${x.page} | م${x.level} | ${x.title}`).join('\n');
}

const int = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : NaN; };

/** خطة احتياطية إن فشل كل شيء: فصول بطول ثابت (لا تخطئ أبداً لكنها أقل فائدة) */
export function fallbackOutline(total: number, step = 20): OutlineChapter[] {
  if (!Number.isFinite(total) || total < 1) return [];
  const out: OutlineChapter[] = [];
  for (let s = 1; s <= total; s += step) {
    const e = Math.min(total, s + step - 1);
    out.push({ title: s === e ? `صفحة ${s}` : `الصفحات ${s}–${e}`, start_page: s, end_page: e, topics: [] });
  }
  return out;
}

/** ناتج النموذج (أي شكل) ← فهرس سليم: مرتب، محصور بصفحات الملف، بلا فجوات ولا تكرار */
export function normalizeOutline(raw: unknown, total: number): OutlineChapter[] {
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as { chapters?: unknown[] })?.chapters) ? (raw as { chapters: unknown[] }).chapters : [];
  const max = Math.max(1, Math.round(total) || 1);
  type C = { title: string; start: number; topics: OutlineTopic[] };
  let chapters: C[] = [];
  for (const c of list) {
    const o = c as { title?: unknown; start_page?: unknown; page?: unknown; topics?: unknown };
    const title = clean(o?.title);
    const start = int(o?.start_page ?? o?.page);
    if (!title || !Number.isFinite(start) || start < 1 || start > max) continue;
    const topics: OutlineTopic[] = [];
    for (const t of Array.isArray(o.topics) ? o.topics : []) {
      const tt = t as { title?: unknown; page?: unknown; start_page?: unknown };
      const tp = int(tt?.page ?? tt?.start_page);
      const ttl = clean(tt?.title);
      // صفحة خارج الملف خطأ من النموذج: نحذف الموضوع بدل أن نخترع له مكاناً
      if (ttl && Number.isFinite(tp) && tp >= 1 && tp <= max) topics.push({ title: ttl, page: tp });
    }
    chapters.push({ title, start, topics });
  }
  if (!chapters.length) return fallbackOutline(max);
  chapters = chapters.map((c, i) => ({ ...c, i })).sort((a, b) => a.start - b.start || a.i - b.i);
  // نفس الصفحة ونفس العنوان ← دمج
  const merged: C[] = [];
  for (const c of chapters) {
    const last = merged[merged.length - 1];
    if (last && last.start === c.start && normTitle(last.title) === normTitle(c.title)) last.topics.push(...c.topics);
    else merged.push({ title: c.title, start: c.start, topics: c.topics });
  }
  // فصلان ببداية واحدة ← الثاني يبدأ بعده بصفحة إن أمكن وإلا يُحذف
  const uniq: C[] = [];
  for (const c of merged) {
    const last = uniq[uniq.length - 1];
    if (last && last.start === c.start) {
      if (c.start < max) uniq.push({ ...c, start: c.start + 1 }); // يبقى ترتيبهما
      continue;
    }
    uniq.push(c);
  }
  const out: OutlineChapter[] = [];
  // مقدمة الملف قبل أول فصل
  if (uniq[0].start > 3) out.push({ title: 'مقدمة الملف', start_page: 1, end_page: uniq[0].start - 1, topics: [] });
  else uniq[0].start = 1;
  uniq.forEach((c, i) => {
    const end = i + 1 < uniq.length ? Math.max(c.start, uniq[i + 1].start - 1) : max;
    const seen = new Set<string>();
    const topics = c.topics
      .filter((t) => t.page >= c.start && t.page <= end)
      .sort((a, b) => a.page - b.page)
      .filter((t) => { const k = normTitle(t.title); if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 60);
    out.push({ title: c.title, start_page: c.start, end_page: end, topics });
  });
  return out;
}

/** فهرس ← صفوف قاعدة البيانات (الترتيب sort يخدم الفصول ومواضيعها معاً) */
export function flattenOutline(chapters: OutlineChapter[]): { level: 1 | 2; chapter: number; title: string; start_page: number; end_page: number | null; sort: number }[] {
  const rows: { level: 1 | 2; chapter: number; title: string; start_page: number; end_page: number | null; sort: number }[] = [];
  let sort = 0;
  chapters.forEach((c, ci) => {
    rows.push({ level: 1, chapter: ci, title: c.title, start_page: c.start_page, end_page: c.end_page, sort: sort++ });
    c.topics.forEach((t, ti) => {
      const next = c.topics[ti + 1]?.page;
      rows.push({ level: 2, chapter: ci, title: t.title, start_page: t.page, end_page: next && next > t.page ? next - 1 : c.end_page, sort: sort++ });
    });
  });
  return rows;
}

/** صفوف القاعدة ← شجرة فصول بمواضيعها */
export function buildTree(rows: OutlineRow[]): OutlineNode[] {
  const sorted = [...rows].sort((a, b) => a.sort - b.sort || a.start_page - b.start_page);
  const chapters = sorted.filter((r) => r.level === 1).map((r) => ({ ...r, topics: [] as OutlineRow[] }));
  const byId = new Map(chapters.map((c) => [c.id, c]));
  for (const r of sorted) if (r.level === 2 && r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id)!.topics.push(r);
  return chapters;
}

/** أين تقع صفحة في الفهرس؟ (لذكر الفصل والموضوع بجانب رقم الصفحة) */
export function locate(tree: OutlineNode[], page: number): { chapter: OutlineNode | null; topic: OutlineRow | null } {
  const chapter = tree.find((c) => page >= c.start_page && page <= (c.end_page ?? Infinity)) ?? null;
  let topic: OutlineRow | null = null;
  for (const t of chapter?.topics ?? []) if (t.start_page <= page) topic = t;
  return { chapter, topic };
}

/** «صفحة ٥٢» أو «صفحة ٥٢ (المطبوعة ٤٨)» إن اختلف الرقم المطبوع عن ترتيب الملف */
export function pageLabel(page: number, printed?: string | null): string {
  const p = (printed ?? '').trim();
  return p && p !== String(page) ? `صفحة ${page} (المطبوعة ${p})` : `صفحة ${page}`;
}

/** فهرس بلا ذكاء اصطناعي من العناوين المنظَّفة (احتياط): م١ فصول، م٢ مواضيعها (وإن لم توجد فصول فالمواضيع هي الفصول) */
export function outlineFromHeadings(h: { page: number; level: number; title: string }[], total: number): OutlineChapter[] {
  const level1 = h.filter((x) => x.level === 1);
  const chaptersSrc = level1.length ? level1 : h.filter((x) => x.level === 2);
  if (!chaptersSrc.length) return fallbackOutline(total);
  const topicsSrc = level1.length ? h.filter((x) => x.level === 2) : [];
  const raw = chaptersSrc.map((c, i) => {
    const next = chaptersSrc[i + 1]?.page ?? Infinity;
    return { title: c.title, start_page: c.page, topics: topicsSrc.filter((t) => t.page >= c.page && t.page < next).map((t) => ({ title: t.title, page: t.page })) };
  });
  return normalizeOutline(raw, total);
}

// ───────────── فهم طلبات الطالب عن صفحة أو فصل ─────────────
const ORDINALS: [RegExp, number][] = [
  [/(?:^|\s)(?:ال)?(?:اول|أول|الاول|الأول|اولى|الأولى)(?:\s|$|[.،؟?])/, 1], [/(?:ال)?(?:ثاني|ثانيه|ثانية|الثاني|الثانية)/, 2], [/(?:ال)?(?:ثالث|ثالثه|ثالثة)/, 3],
  [/(?:ال)?(?:رابع|رابعه|رابعة)/, 4], [/(?:ال)?(?:خامس|خامسه|خامسة)/, 5], [/(?:ال)?(?:سادس|سادسه|سادسة)/, 6], [/(?:ال)?(?:سابع|سابعه|سابعة)/, 7],
  [/(?:ال)?(?:ثامن|ثامنه|ثامنة)/, 8], [/(?:ال)?(?:تاسع|تاسعه|تاسعة)/, 9], [/(?:ال)?(?:عاشر|عاشره|عاشرة)/, 10],
];
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

/** «صفحة ٥٢» أو «ص 52» أو «page 52» ← 52 (أول إشارة معقولة) */
export function parsePageRef(text: string): number | null {
  const m = toLatin(text).match(/(?<![\p{L}])(?:صفحة|صفحه|ص|page|p)\s*[:.]?\s*(\d{1,4})(?!\d)/iu);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 2000 ? n : null;
}

/** «الفصل الثالث» أو «فصل 3» أو «الباب الأول» ← الرقم، مع نوع الوحدة */
export function parseChapterRef(text: string): { n: number | null; word: string } | null {
  const t = toLatin(text.replace(DIACRITICS, ''));
  const kind = t.match(/(فصل|الفصل|باب|الباب|وحدة|الوحدة|chapter)/i);
  if (!kind) return null;
  const after = t.slice(t.indexOf(kind[0]) + kind[0].length, t.indexOf(kind[0]) + kind[0].length + 40);
  const digits = after.match(/^\s*[:.]?\s*(\d{1,3})(?!\d)/);
  if (digits) return { n: Number(digits[1]), word: kind[1] };
  for (const [re, n] of ORDINALS) if (re.test(` ${after}`)) return { n, word: kind[1] };
  return { n: null, word: kind[1] };
}

/** أنسب فصل للطلب: رقمه في عنوانه، وإلا ترتيبه بين الفصول المسماة، وإلا تطابق الكلمات */
export function pickChapter(tree: OutlineNode[], question: string): OutlineNode | null {
  if (!tree.length) return null;
  const ref = parseChapterRef(question);
  if (ref?.n) {
    const numbered = tree.find((c) => {
      const t = toLatin(c.title.replace(DIACRITICS, ''));
      const d = t.match(/(?:فصل|الفصل|باب|الباب|وحدة|الوحدة)\s*[:.]?\s*(\d{1,3})/);
      if (d) return Number(d[1]) === ref.n;
      return ORDINALS.some(([re, n]) => n === ref.n && /(فصل|باب|وحدة)/.test(t) && re.test(` ${t.split(/[:\-–]/)[0]}`));
    });
    if (numbered) return numbered;
    const named = tree.filter((c) => !/^(مقدمة|الصفحات)/.test(c.title));
    if (named[ref.n - 1]) return named[ref.n - 1];
  }
  // كلمات المحتوى فقط (بلا «الفصل» وترتيبه الكلامي)
  const GENERIC = /^(ال)?(فصل|باب|وحده|درس|اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|اولي|ثانيه|ثالثه|رابعه|خامسه)$/;
  const content = (t: string) => normTitle(t).split(' ').filter((w) => w.length > 2 && !GENERIC.test(w));
  const q = new Set(content(question));
  let best: OutlineNode | null = null;
  let bestScore = 0;
  for (const c of tree) {
    const words = content(c.title);
    const score = words.filter((w) => q.has(w)).length / Math.max(1, words.length);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.6 ? best : null;
}
