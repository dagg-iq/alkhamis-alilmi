// اختبار ترتيب المفاتيح والنماذج وأقفال الحصة (Google وهمي). التشغيل من supabase/functions:
//   deno run -A --node-modules-dir=none --config deno.json ../tests/gemini_test.ts
Deno.env.set('SUPABASE_URL', 'http://x.local'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's');
for (const [v, k] of [['GEMINI_API_KEY', 'K1'], ['GEMINI_API_KEY_2', 'K2'], ['GEMINI_API_KEY_3', 'K3'], ['GEMINI_ADMIN_API_KEY', 'KA']]) Deno.env.set(v, k);

// قاعدة بيانات وهمية: الأقفال والعدادات
const blocksTable: Record<string, { slot: string; model: string; blocked_until: string; reason: string }> = {};
const usage: Record<string, { ok: number; err: number }> = {};
const { admin } = await import('../functions/_shared/supabase.ts');
(admin as any).from = (t: string) => {
  const q: any = {
    select: () => q, gt: () => q,
    upsert: async (row: any) => { blocksTable[`${row.slot}|${row.model}`] = row; return { error: null }; },
    then: (res: any) => res({ data: t === 'ai_key_blocks' ? Object.values(blocksTable).filter((b) => Date.parse(b.blocked_until) > Date.now()) : [], error: null }),
  };
  return q;
};
(admin as any).rpc = async (_n: string, a: any) => { const k = `${a.p_slot}|${a.p_model}`; usage[k] ??= { ok: 0, err: 0 }; a.p_ok ? usage[k].ok++ : usage[k].err++; return { error: null }; };

// Google وهمي: لكل (مفتاح، نموذج) ٢٠ طلباً، ثم 429 يومي مع retryDelay. KA محجوب (403)
const used: Record<string, number> = {};
const calls: string[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const key = init.headers['x-goog-api-key'];
  const model = String(url).match(/models\/([^:]+):/)?.[1] ?? '';
  calls.push(`${key}/${model}`);
  if (key === 'KA') return new Response(JSON.stringify({ error: { code: 403, message: 'Your project has been denied access. Please contact support.' } }), { status: 403 });
  const k = `${key}/${model}`;
  used[k] = (used[k] ?? 0) + 1;
  if (used[k] > 20) {
    return new Response(JSON.stringify({ error: { code: 429, message: `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: ${model} Please retry in 3h35m54.6s.`,
      details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12954s' }] } }), { status: 429 });
  }
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `${key}:${model}` }] } }] }), { status: 200 });
}) as typeof fetch;

const g = await import('../functions/_shared/gemini.ts');
let failed = 0;
const check = (label: string, ok: boolean, extra = '') => { if (!ok) failed++; console.log(ok ? '✅' : '❌', label, extra); };

// ١) الترتيب: المفتاح ١ بكل نماذجه، ثم ٢، ثم ٣، ثم 2.5 على الجميع
const answers: string[] = [];
for (let i = 0; i < 20 * 6 * 3 + 20 * 2 * 3 + 1; i++) {
  try { answers.push(await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }])); } catch (e) { answers.push(e instanceof g.GeminiQuotaError ? 'QUOTA' : 'ERR'); }
}
const firstOf = (s: string) => answers.indexOf(s);
check('أول ٢٠ طلباً على المفتاح ١ و3.8', answers.slice(0, 20).every((a) => a === 'K1:gemini-3.8-flash'));
check('بعد ٢٠ ينتقل إلى 3.7 على نفس المفتاح', answers[20] === 'K1:gemini-3.7-flash', answers[20]);
check('بعد كل نماذج المفتاح ١ (١٢٠) ينتقل للمفتاح ٢ و3.8', answers[120] === 'K2:gemini-3.8-flash', answers[120]);
check('بعد المفاتيح الثلاثة (٣٦٠) يبدأ الاحتياط 2.5', answers[360] === 'K1:gemini-2.5-flash', answers[360]);
check('مجموع الطلبات الناجحة = ٤٨٠ (٣ مفاتيح × ٨ نماذج × ٢٠)', answers.filter((a) => a.includes(':')).length === 480);
check('بعد انتهاء الكل: رسالة «مشغول» لا خطأ غامض', answers[answers.length - 1] === 'QUOTA');
// كل (مفتاح، نموذج) استُهلك بالضبط ٢١ مرة كحد أقصى (٢٠ ناجحة + 429 واحدة) — القفل يمنع تكرار الطلبات الفاشلة
check('لا طلبات ضائعة بعد القفل', Object.values(used).every((n) => n <= 21), JSON.stringify(Object.values(used).filter((n) => n > 21)));
check('القفل اليومي حتى ٣:٠٠ فجراً بتوقيت العراق (منتصف الليل UTC)', Object.values(blocksTable).every((b) => { const d = new Date(Date.parse(b.blocked_until) - 30_000); return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && Date.parse(b.blocked_until) > Date.now(); }));
check('العدادات تُسجَّل', usage['GEMINI_API_KEY|gemini-3.8-flash']?.ok === 20 && usage['GEMINI_API_KEY|gemini-3.8-flash']?.err === 1);

// ٢) مفتاح اللوحة المحجوب يُقفل كله من أول محاولة ثم يُستخدم الاحتياط
for (const k of Object.keys(blocksTable)) delete blocksTable[k];
for (const k of Object.keys(used)) delete used[k];
await g.refreshBlocks(true);
calls.length = 0;
const a1 = await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }], { pool: 'admin' });
const a2 = await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }], { pool: 'admin' });
check('مفتاح اللوحة المحجوب: ينتقل لمفاتيح الطلاب', a1 === 'K1:gemini-3.8-flash' && a2 === 'K1:gemini-3.8-flash', `${a1} ${a2}`);
check('المحجوب جُرّب مرة واحدة فقط (لا ٦ مرات)', calls.filter((c) => c.startsWith('KA/')).length === 1, String(calls.filter((c) => c.startsWith('KA/')).length));
check('القفل على المفتاح كله (*)', !!blocksTable['GEMINI_ADMIN_API_KEY|*']);

// ٣) مفتاح محدد (ملف الفهرسة): عند انتهاء نماذجه ← GeminiQuotaError (فينقل ingest الملف لمفتاح آخر)
for (const m of [...g.MAIN_MODELS, ...g.FALLBACK_MODELS]) used[`K2/${m}`] = 20;
let err = '';
try { await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }], { pool: 'admin', slot: 'GEMINI_API_KEY_2' }); } catch (e) { err = e instanceof g.GeminiQuotaError ? 'QUOTA' : String(e); }
check('مفتاح الملف انتهت حصته ← خطأ حصة', err === 'QUOTA', err);
check('أول مفتاح متاح غير المنتهي', (await g.firstAvailableSlot('admin', g.MAIN_MODELS, ['GEMINI_API_KEY_2'])) === 'GEMINI_API_KEY', String(await g.firstAvailableSlot('admin', g.MAIN_MODELS, ['GEMINI_API_KEY_2'])));

// ٤) تحليل مدة الانتظار
check('retryDelay', g.retryAfterMs('"retryDelay": "12954s"') === 12954000);
check('Please retry in 3h35m54.6s', Math.round(g.retryAfterMs('Please retry in 3h35m54.6s')! / 1000) === 12955);
check('retry in 41s', g.retryAfterMs('Please retry in 41.2s') === 41200);
check('رسالة صاحب المشروع (limit: 20) = يومي', g.isDailyQuota('Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash Please retry in 2h43m41.58s.'));
check('حد الدقيقة (limit: 5, retry 30s) ليس يومياً', !g.isDailyQuota('Quota exceeded for metric: generate_content_free_tier_requests, limit: 5, model: gemini-3.8-flash Please retry in 31s'));
// الساعة ١٢:١٦ ظهراً بتوقيت العراق (09:16 UTC) ← التجدد ٣:٠٠ فجراً = 00:00 UTC اليوم التالي
check('موعد التجدد من ١٢:١٦ ظهراً', new Date(g.nextIraqReset(Date.UTC(2026, 9, 10, 9, 16))).toISOString() === '2026-10-11T00:00:00.000Z');
check('موعد التجدد من ٢:٥٠ فجراً (23:50 UTC) بعد ١٠ دقائق', g.nextIraqReset(Date.UTC(2026, 9, 10, 23, 50)) - Date.UTC(2026, 9, 10, 23, 50) === 600_000);
check('fileRef الجديد والقديم', g.fileRef('s:GEMINI_API_KEY_3|https://x/f').slot === 'GEMINI_API_KEY_3' && g.fileRef('k1|https://x/f').keyIndex === 1);

if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
console.log('ALL GEMINI TESTS PASSED');
