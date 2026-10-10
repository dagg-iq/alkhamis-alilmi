// اختبار عامل الفهرسة على الخادم (الطابور): الكتب بالترتيب، الأجزاء المتوازية، بناء الفهرس، التنظيف، وانتظار الحصة.
// التشغيل من supabase/functions:
//   deno run -A --node-modules-dir=none --config deno.json ../tests/ingest_worker_test.ts
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
Deno.env.set('SUPABASE_URL', 'http://x.local'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's');
Deno.env.set('GEMINI_API_KEY', 'K1'); Deno.env.set('GEMINI_API_KEY_2', 'K2'); Deno.env.set('GEMINI_ADMIN_API_KEY', 'KA');
Deno.env.set('PUSH_WEBHOOK_SECRET', 'sec');

const old = new Date(Date.now() - 3600_000).toISOString();
const db: Record<string, any[]> = {
  profiles: [],
  documents: [
    { id: 'd1', title: 'كتاب', kind: 'book', subject_id: 's', chapter_id: null, pages: 5, ingested_pages: 0, ingest_status: 'running', queued_at: old },
    { id: 'd2', title: 'ملزمة', kind: 'malzama', subject_id: 's', chapter_id: null, pages: 2, ingested_pages: 0, ingest_status: 'running', queued_at: new Date().toISOString() },
  ],
  ingest_chunks: [
    { id: 'c2', document_id: 'd1', from_page: 4, to_page: 5, total_pages: 5, file_key: 'k/d1-4', scanned: true, status: 'pending', attempts: 0, next_at: old },
    { id: 'c1', document_id: 'd1', from_page: 1, to_page: 3, total_pages: 5, file_key: 'k/d1-1', scanned: true, status: 'pending', attempts: 0, next_at: old },
    { id: 'c3', document_id: 'd2', from_page: 1, to_page: 2, total_pages: 2, file_key: 'k/d2-1', scanned: false, status: 'pending', attempts: 0, next_at: old },
  ],
  document_pages: [], content_chunks: [], document_outline: [], ai_key_blocks: [], ai_key_usage: [],
};
function q(t: string) {
  const rows = db[t] ?? (db[t] = []);
  const filters: ((r: any) => boolean)[] = [];
  let op: 'select' | 'update' | 'delete' | 'upsert' | 'insert' = 'select';
  let payload: any = null;
  const b: any = {
    select: () => b, order: () => b, limit: () => b, single: () => { b._single = true; return b; }, maybeSingle: () => { b._single = true; return b; },
    eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return b; }, gt: () => b, gte: () => b, lte: () => b,
    is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    not: (c: string, _o: string, v: any) => { filters.push((r) => (r[c] ?? null) !== v); return b; },
    in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; }, delete: () => { op = 'delete'; return b; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return b; }, insert: (p: any) => { op = 'insert'; payload = p; return b; },
    then: (res: any) => {
      const filt = (r: any) => filters.every((f) => f(r));
      if (op === 'update') rows.filter(filt).forEach((r) => Object.assign(r, payload));
      if (op === 'delete') db[t] = rows.filter((r) => !filt(r));
      if (op === 'insert') rows.push(...(Array.isArray(payload) ? payload : [payload]));
      if (op === 'upsert') for (const p of Array.isArray(payload) ? payload : [payload]) {
        const i = rows.findIndex((r) => t === 'document_pages' ? r.document_id === p.document_id && r.page === p.page : r.slot === p.slot && r.model === p.model);
        if (i >= 0) rows[i] = p; else rows.push(p);
      }
      const data = (op === 'delete' ? [] : rows.filter(filt)).sort((a, z) => (a.page ?? 0) - (z.page ?? 0));
      return res({ data: b._single ? data[0] ?? null : data, error: null });
    },
  };
  return b;
}
// الحجز كما في claim_ingest_chunks: الكتب بترتيب الدخول ثم الصفحات
const claimed: string[] = [];
let lock = false;
const { admin } = await import('../functions/_shared/supabase.ts');
(admin as any).from = q;
(admin as any).rpc = async (fn: string) => {
  if (fn === 'ingest_worker_lock') { if (lock) return { data: false, error: null }; lock = true; return { data: true, error: null }; }
  if (fn === 'ingest_worker_unlock') { lock = false; return { data: null, error: null }; }
  if (fn === 'claim_ingest_chunks') {
    const now = Date.now();
    const doc = (id: string) => db.documents.find((d) => d.id === id);
    const c = db.ingest_chunks
      .filter((x) => doc(x.document_id)?.queued_at && new Date(x.next_at).getTime() <= now && x.status === 'pending')
      .sort((a, z) => doc(a.document_id).queued_at.localeCompare(doc(z.document_id).queued_at) || a.from_page - z.from_page)[0];
    if (!c) return { data: [], error: null };
    c.status = 'running'; c.attempts++;
    claimed.push(c.id);
    return { data: [{ ...c }], error: null };
  }
  return { data: null, error: null };
};
// التخزين: أجزاء PDF حقيقية
const parts: Record<string, Uint8Array> = {};
const mk = async (n: number) => { const p = await PDFDocument.create(); for (let i = 0; i < n; i++) p.addPage([200, 200]); return await p.save(); };
parts['k/d1-1'] = await mk(3); parts['k/d1-4'] = await mk(2); parts['k/d2-1'] = await mk(2);
const removed: string[] = [];
(admin as any).storage = {
  from: () => ({
    download: async (k: string) => parts[k] ? { data: new Blob([parts[k] as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { message: 'missing' } },
    remove: async (ks: string[]) => { removed.push(...ks); return { data: null, error: null }; },
  }),
};

let quota = false;
let strongQuota = false; // النماذج القوية فقط منتهية، و Flash-Lite متاح
const thinking: string[] = [];
const readModels = new Set<string>();
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if ((quota || (strongQuota && !/lite/.test(u))) && u.includes('generativelanguage') && !u.includes('Embed')) {
    return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20 GenerateRequestsPerDayPerProjectPerModel' } }), { status: 429 });
  }
  if (u.includes('batchEmbedContents')) {
    const n = JSON.parse(init.body).requests.length;
    return new Response(JSON.stringify({ embeddings: Array.from({ length: n }, () => ({ values: new Array(768).fill(0.1) })) }), { status: 200 });
  }
  const body = JSON.parse(init.body);
  if (body.contents[0].parts.length === 1) return new Response(JSON.stringify({ error: { code: 400, message: 'bad' } }), { status: 400 });
  thinking.push(JSON.stringify(body.generationConfig?.thinkingConfig ?? {}));
  readModels.add(u.match(/models\/([^:]+):/)?.[1] ?? '?');
  const prompt: string = body.contents[0].parts[1].text;
  const [, from, to] = prompt.match(/من (\d+) إلى (\d+)/)!.map(Number);
  const pages = [];
  for (let p = from; p <= to; p++) pages.push({ page: p, printed: String(p), headings: p === 1 ? [{ level: 1, title: 'الفصل الأول' }] : [], text: `نص صفحة ${p}` });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(pages) }] } }] }), { status: 200 });
}) as typeof fetch;

let handler: (r: Request) => Promise<Response> = async () => new Response();
(Deno as any).serve = (h: any) => { handler = h; };
await import('../functions/ingest-worker/index.ts');
const call = async (secret = 'sec') => {
  const r = await handler(new Request('http://x/ingest-worker', { method: 'POST', headers: { 'x-webhook-secret': secret, 'Content-Type': 'application/json' }, body: '{}' }));
  return { status: r.status, json: await r.json() };
};
let failed = 0;
const check = (label: string, ok: boolean, extra = '') => { if (!ok) failed++; console.log(ok ? '✅' : '❌', label, extra); };

let r = await call('wrong');
check('بلا السر الصحيح يُرفض', r.status === 401, JSON.stringify(r.json));

r = await call();
check('قُرئت كل الصفحات (٥ + ٢)', r.status === 200 && r.json.read === 7, JSON.stringify(r.json));
check('الكتاب الأول قبل الثاني، وصفحاته بالترتيب', claimed.indexOf('c1') < claimed.indexOf('c3') && claimed.indexOf('c2') < claimed.indexOf('c3'), claimed.join());
const d1 = db.documents.find((d) => d.id === 'd1')!, d2 = db.documents.find((d) => d.id === 'd2')!;
check('الكتابان مكتملان ٥/٥ و٢/٢', d1.ingest_status === 'done' && d1.ingested_pages === 5 && d2.ingest_status === 'done' && d2.ingested_pages === 2);
check('بُني الفهرس لكليهما وخرجا من الطابور', d1.outline_status === 'done' && d2.outline_status === 'done' && !d1.queued_at && !d2.queued_at, `${d1.outline_status} ${d2.outline_status}`);
check('حُذفت الأجزاء من الجدول والتخزين', db.ingest_chunks.length === 0 && removed.length === 3, removed.join());
check('المصوّر يُقرأ بتفكير أعلى من النصي', thinking.some((t) => /low/i.test(t)) && thinking.some((t) => /minimal/i.test(t)), thinking.join(' '));
check('القفل فُتح بعد الانتهاء', lock === false);
check('قراءة الصفحات بالنماذج القوية فقط (لا Flash-Lite)', readModels.size > 0 && [...readModels].every((m) => !m.includes('lite')), [...readModels].join());

// كل النماذج القوية مقفلة (حصة يومية) و Flash-Lite متاح: لا يقرأ به، بل ينتظر
{
  strongQuota = true;
  quota = false;
  db.documents.push({ id: 'd5', title: 'خامس', kind: 'book', subject_id: 's', chapter_id: null, pages: 2, ingested_pages: 0, ingest_status: 'running', queued_at: new Date().toISOString() });
  db.ingest_chunks.push({ id: 'c5', document_id: 'd5', from_page: 1, to_page: 2, total_pages: 2, file_key: 'k/d2-1', scanned: true, status: 'pending', attempts: 0, next_at: old });
  readModels.clear();
  const r5 = await call();
  const c5 = db.ingest_chunks.find((c) => c.id === 'c5')!;
  check('القوية منتهية: ينتظر ولا يقرأ بـ Flash-Lite', r5.json.quota === true && readModels.size === 0 && c5.status === 'pending' && c5.attempts === 0, JSON.stringify({ r: r5.json, models: [...readModels], c5 }));
  strongQuota = false;
  db.documents = db.documents.filter((d) => d.id !== 'd5');
  db.ingest_chunks = db.ingest_chunks.filter((c) => c.id !== 'c5');
}

// انتهاء الحصة على كل المفاتيح: الجزء يعود للطابور ولا تُحسب محاولة، والكتاب يبقى في الطابور
db.documents.push({ id: 'd3', title: 'ثالث', kind: 'book', subject_id: 's', chapter_id: null, pages: 2, ingested_pages: 0, ingest_status: 'running', queued_at: new Date().toISOString() });
db.ingest_chunks.push({ id: 'c4', document_id: 'd3', from_page: 1, to_page: 2, total_pages: 2, file_key: 'k/d2-1', scanned: false, status: 'pending', attempts: 0, next_at: old });
quota = true;
r = await call();
const c4 = db.ingest_chunks.find((c) => c.id === 'c4')!;
check('الحصة: الجزء ينتظر (لا فشل ولا محاولة محسوبة)', r.json.quota === true && c4.status === 'pending' && c4.attempts === 0 && new Date(c4.next_at).getTime() > Date.now() + 5 * 60_000 && /حصة/.test(c4.last_error), JSON.stringify(c4));
check('الحصة: الكتاب ما زال في الطابور', !!db.documents.find((d) => d.id === 'd3')!.queued_at);
check('الحصة: لا خطأ ظاهر على الكتاب', db.documents.find((d) => d.id === 'd3')!.ingest_status !== 'error');

if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
console.log('ALL INGEST WORKER TESTS PASSED');
