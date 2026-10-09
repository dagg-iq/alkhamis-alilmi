// اختبار منطق بحث المساعد (الصفحة/الفصل/الموضوع/الرقم المطبوع) بقاعدة وهمية. التشغيل من supabase/functions:
//   deno run -A --node-modules-dir=none --config deno.json ../tests/retrieve_test.ts
Deno.env.set('SUPABASE_URL', 'http://x.local'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's'); Deno.env.set('GEMINI_API_KEY', 'k');
globalThis.fetch = (async () => new Response(JSON.stringify({ embeddings: [{ values: new Array(768).fill(0.1) }] }), { status: 200 })) as typeof fetch;
const { admin } = await import('../functions/_shared/supabase.ts');
const { retrieveItems } = await import('../functions/ai-chat/retrieve.ts');
const D = '11111111-1111-1111-1111-111111111111', D2 = '22222222-2222-2222-2222-222222222222';
const db: Record<string, any[]> = {
  documents: [{ id: D, title: 'ملزمة الأستاذ أحمد السوداني', subject_id: 's', pages: 60, is_published: true }, { id: D2, title: 'كتاب الفيزياء', subject_id: 's', pages: 200, is_published: true }],
  document_pages: Array.from({ length: 60 }, (_, i) => ({ document_id: D, page: i + 1, printed: i >= 4 ? String(i - 3) : null, text: `نص صفحة ${i + 1}` })),
  document_outline: [
    { id: 'c1', document_id: D, parent_id: null, level: 1, title: 'الفصل الأول: الكهربائية الساكنة', start_page: 5, end_page: 30, sort: 0 },
    { id: 't1', document_id: D, parent_id: 'c1', level: 2, title: 'قانون كولوم', start_page: 6, end_page: 10, sort: 1 },
    { id: 'c2', document_id: D, parent_id: null, level: 1, title: 'الفصل الثاني: المتسعات', start_page: 31, end_page: 60, sort: 2 },
  ],
  question_sets: [], lectures: [], subjects: [{ id: 's', name: 'الفيزياء' }],
};
function q(table: string) {
  let rows = [...(db[table] ?? [])];
  const b: any = {
    select: () => b, order: () => b, limit: (n: number) => { rows = rows.slice(0, n); return b; },
    eq: (c: string, v: any) => { rows = rows.filter((r) => r[c] === v); return b; },
    in: (c: string, v: any[]) => { rows = rows.filter((r) => v.includes(r[c])); return b; },
    gte: (c: string, v: any) => { rows = rows.filter((r) => r[c] >= v); return b; },
    lte: (c: string, v: any) => { rows = rows.filter((r) => r[c] <= v); return b; },
    then: (res: any) => res({ data: rows.sort((a, z) => (a.page ?? 0) - (z.page ?? 0)), error: null }),
  };
  return b;
}
(admin as any).from = q;
(admin as any).rpc = async () => ({ data: [], error: null });
let failed = 0;
const check = async (label: string, text: string, ctx: any, expect: number[]) => {
  const pages = (await retrieveItems(text, 's', ctx)).map((x) => x.page ?? 0);
  const ok = expect.every((n, k) => pages[k] === n);
  if (!ok) failed++;
  console.log(ok ? '✅' : '❌', label, '→', pages.join(','));
};
await check('رقم مطبوع + اسم الملزمة: الصفحة ٢٠ من الملف والمطبوعة ٢٠ (ص٢٤)', 'اشرح صفحة 20 من ملزمة الأستاذ أحمد السوداني', undefined, [20, 24]);
await check('سؤال من العارض: الصفحة الحالية أولاً', 'ما معنى هذا', { documentId: D, page: 8 }, [8, 7, 9]);
await check('الفصل المعروض كاملاً (بحد ١٤ صفحة)', 'اشرح الفصل كامل', { documentId: D, page: 8, from: 5, to: 30 }, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
await check('موضوع باسمه', 'اشرح قانون كولوم كامل', { documentId: D }, [6, 7, 8, 9, 10]);
await check('الفصل الثاني باسم الملزمة', 'اشرح الفصل الثاني من ملزمة الأستاذ أحمد السوداني', undefined, [31, 32]);
await check('الفصل الحالي والملف معروض كاملاً', 'اشرح لي هذا الفصل كاملاً بالتفصيل.', { documentId: D, page: 33 }, [31, 32]);
await check('الموضوع الحالي', 'اشرح هذا الموضوع', { documentId: D, page: 8 }, [6, 7, 8, 9, 10]);
await check('يعرض الفصل الأول ويسأل عن الثاني', 'اشرح الفصل الثاني', { documentId: D, page: 8, from: 5, to: 30 }, [31]);
await check('هذه الصفحة داخل فصل', 'اشرح هذه الصفحة', { documentId: D, page: 40, from: 31, to: 60 }, [40, 39, 41]);
await check('تكملة فصل طويل من صفحة', 'اشرح من صفحة 45', { documentId: D, page: 31, from: 31, to: 60 }, [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
