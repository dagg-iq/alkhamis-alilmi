// اختبار الفهرسة الجديدة (قراءة صفحات مقطوعة): التوازي، الصفحات الناقصة، العدّ المتتالي. التشغيل من supabase/functions:
//   deno run -A --node-modules-dir=none --config deno.json ../tests/ingest_test.ts
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
Deno.env.set('SUPABASE_URL', 'http://x.local'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's');
Deno.env.set('GEMINI_API_KEY', 'K1'); Deno.env.set('GEMINI_ADMIN_API_KEY', 'KA');

// قاعدة وهمية
const db: Record<string, any[]> = {
  profiles: [{ id: 'u1', role: 'admin', status: 'approved', section_id: null, full_name: 'أدمن' }],
  documents: [{ id: 'd1', title: 'كتاب', subject_id: 's', chapter_id: null, pages: null, ingested_pages: 0, ingest_status: 'none' }],
  document_pages: [], content_chunks: [], document_outline: [], ai_key_blocks: [], ai_key_usage: [],
};
function q(t: string) {
  let rows = db[t] ?? (db[t] = []);
  let filt = (r: any) => true;
  const filters: ((r: any) => boolean)[] = [];
  let op: 'select' | 'update' | 'delete' | 'upsert' | 'insert' = 'select';
  let payload: any = null;
  const b: any = {
    select: () => b, order: () => b, limit: () => b, single: () => { b._single = true; return b; }, maybeSingle: () => { b._single = true; return b; },
    eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return b; }, gt: () => b, gte: () => b, lte: () => b,
    is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; }, delete: () => { op = 'delete'; return b; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return b; }, insert: (p: any) => { op = 'insert'; payload = p; return b; },
    then: (res: any) => {
      filt = (r) => filters.every((f) => f(r));
      if (op === 'update') rows.filter(filt).forEach((r) => Object.assign(r, payload));
      if (op === 'delete') db[t] = rows.filter((r) => !filt(r));
      if (op === 'insert') rows.push(...(Array.isArray(payload) ? payload : [payload]));
      if (op === 'upsert') for (const p of Array.isArray(payload) ? payload : [payload]) {
        const i = rows.findIndex((r) => t === 'document_pages' ? r.document_id === p.document_id && r.page === p.page : r.slot === p.slot && r.model === p.model);
        if (i >= 0) rows[i] = p; else rows.push(p);
      }
      const data = rows.filter(filt).sort((a, z) => (a.page ?? 0) - (z.page ?? 0));
      return res({ data: b._single ? data[0] ?? null : data, error: null });
    },
  };
  return b;
}
const { admin } = await import('../functions/_shared/supabase.ts');
(admin as any).from = q;
(admin as any).rpc = async () => ({ data: null, error: null });

// Google وهمي: يقرأ الصفحات المرسلة؛ أول طلب لكل نطاق يُسقط صفحته الأخيرة (لاختبار إعادة المحاولة)
const seen = new Set<string>();
let calls = 0;
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', aud: 'authenticated' }), { status: 200 });
  if (u.includes('batchEmbedContents')) {
    const n = JSON.parse(init.body).requests.length;
    return new Response(JSON.stringify({ embeddings: Array.from({ length: n }, () => ({ values: new Array(768).fill(0.1) })) }), { status: 200 });
  }
  calls++;
  const body = JSON.parse(init.body);
  // بناء الفهرس: نجعل الذكاء الاصطناعي يفشل ← يجب أن يُبنى من عناوين الصفحات
  if (body.contents[0].parts.length === 1) return new Response(JSON.stringify({ error: { code: 400, message: 'bad' } }), { status: 400 });
  const prompt: string = body.contents[0].parts[1].text;
  const [, from, to] = prompt.match(/من (\d+) إلى (\d+)/)!.map(Number);
  const pdf = await PDFDocument.load(Uint8Array.from(atob(body.contents[0].parts[0].inline_data.data), (c) => c.charCodeAt(0)));
  if (pdf.getPageCount() !== to - from + 1) throw new Error(`الملف المقطوع ${pdf.getPageCount()} صفحة والمطلوب ${to - from + 1}`);
  const key = `${from}-${to}`;
  let last = to;
  if (!seen.has(key) && to > from) { seen.add(key); last = to - 1; }
  const pages = [];
  for (let p = from; p <= last; p++) pages.push({ page: p, printed: String(p + 2), headings: p === 1 ? [{ level: 1, title: 'الفصل الأول' }] : [], text: `نص صفحة ${p}` });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(pages) }] } }] }), { status: 200 });
}) as typeof fetch;

let handler: (r: Request) => Promise<Response> = async () => new Response();
(Deno as any).serve = (h: any) => { handler = h; };
await import('../functions/ingest/index.ts');

// كتاب من ٥ صفحات، والطلب لصفحات ٣–٥ قبل ١–٢ (كما في التوازي)
const book = await PDFDocument.create();
for (let i = 0; i < 5; i++) book.addPage([200, 200]);
const sub = async (from: number, to: number) => {
  const s = await PDFDocument.create();
  (await s.copyPages(book, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))).forEach((p) => s.addPage(p));
  const u8 = await s.save();
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin);
};
const call = async (body: any) => {
  const r = await handler(new Request('http://x/ingest', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: 'd1', ...body }) }));
  return { status: r.status, json: await r.json() };
};
let failed = 0;
const check = (label: string, ok: boolean, extra = '') => { if (!ok) failed++; console.log(ok ? '✅' : '❌', label, extra); };

let r = await call({ action: 'read', from: 3, to: 5, total: 5, pdf: await sub(3, 5) });
check('دفعة متأخرة: كل صفحاتها رغم إسقاط Gemini لصفحة (إعادة الناقصة فقط)', JSON.stringify(r.json.read) === '[3,4,5]', JSON.stringify(r.json));
check('العدّ المتتالي يبقى ٠ (الصفحتان ١–٢ لم تُقرآ بعد)', r.json.ingested === 0 && db.documents[0].ingested_pages === 0);
r = await call({ action: 'read', from: 1, to: 2, total: 5, pdf: await sub(1, 2) });
check('بعد قراءة ١–٢: مكتمل ٥/٥', r.json.ingested === 5 && r.json.done === true && db.documents[0].ingest_status === 'done', JSON.stringify(r.json));
check('الرقم المطبوع والعناوين محفوظة', db.document_pages.find((p) => p.page === 1)?.printed === '3' && db.document_pages.find((p) => p.page === 1)?.headings[0]?.title === 'الفصل الأول');
check('مقاطع البحث بأرقام الصفحات الصحيحة', db.content_chunks.map((c) => c.page).sort().join() === '1,2,3,4,5');
// إعادة قراءة نفس الصفحات لا تكرر المقاطع
await call({ action: 'read', from: 3, to: 5, total: 5, pdf: await sub(3, 5) });
check('إعادة القراءة لا تكرر', db.content_chunks.length === 5 && db.document_pages.length === 5, String(db.content_chunks.length));
r = await call({ action: 'read', from: 3, to: 99, total: 5, pdf: 'x' });
check('طلب غير صحيح يُرفض', r.status === 400);
r = await call({ action: 'outline' });
check('الفهرس يُبنى من العناوين عند فشل الذكاء الاصطناعي', r.status === 200 && db.document_outline.length >= 1 && db.document_outline[0].title === 'الفصل الأول' && db.documents[0].outline_status === 'done', JSON.stringify(r.json));
check('بلا متجهات في طلب البناء (حتى لا يتجاوز الوقت)', db.document_outline.every((o) => o.embedding === null));
r = await call({ action: 'embed_outline' });
check('الربط يُحسب بطلب منفصل', r.status === 200 && db.document_outline.every((o) => Array.isArray(o.embedding)), JSON.stringify(r.json));
r = await call({ action: 'restart' });
check('إعادة من البداية تمسح كل شيء', db.document_pages.length === 0 && db.content_chunks.length === 0 && db.documents[0].ingested_pages === 0);
if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
console.log('ALL INGEST TESTS PASSED');
