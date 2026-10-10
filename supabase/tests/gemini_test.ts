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
check('القفل اليومي حتى منتصف ليل كاليفورنيا (لا ٣ فجراً)', Object.values(blocksTable).every((b) => Math.abs(Date.parse(b.blocked_until) - 30_000 - g.nextQuotaReset()) < 5_000 && Date.parse(b.blocked_until) > Date.now()));
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

// ٤) لوحة التحكم: أقوى نموذج على كل المفاتيح أولاً
check('اللوحة: 3.8 على كل المفاتيح قبل 3.7', JSON.stringify(g.attemptOrder(['A', 'B'], ['m1', 'm2'], ['f'], true)) === JSON.stringify([{ slot: 'A', m: 'm1' }, { slot: 'B', m: 'm1' }, { slot: 'A', m: 'm2' }, { slot: 'B', m: 'm2' }, { slot: 'A', m: 'f' }, { slot: 'B', m: 'f' }]));
check('الطلاب: المفتاح الأول بكل نماذجه أولاً', JSON.stringify(g.attemptOrder(['A', 'B'], ['m1', 'm2'], ['f'])) === JSON.stringify([{ slot: 'A', m: 'm1' }, { slot: 'A', m: 'm2' }, { slot: 'B', m: 'm1' }, { slot: 'B', m: 'm2' }, { slot: 'A', m: 'f' }, { slot: 'B', m: 'f' }]));

// ٥) تحليل مدة الانتظار
check('retryDelay', g.retryAfterMs('"retryDelay": "12954s"') === 12954000);
check('Please retry in 3h35m54.6s', Math.round(g.retryAfterMs('Please retry in 3h35m54.6s')! / 1000) === 12955);
check('retry in 41s', g.retryAfterMs('Please retry in 41.2s') === 41200);
check('رسالة صاحب المشروع (limit: 20) = يومي', g.isDailyQuota('Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash Please retry in 2h43m41.58s.'));
check('حد الدقيقة (limit: 5, retry 30s) ليس يومياً', !g.isDailyQuota('Quota exceeded for metric: generate_content_free_tier_requests, limit: 5, model: gemini-3.8-flash Please retry in 31s'));
// Google تجدد الحصة منتصف ليل كاليفورنيا: صيفاً 07:00 UTC (١٠ صباحاً بغداد)، شتاءً 08:00 UTC (١١ صباحاً)
check('بعد ٣:١٩ فجراً بغداد (00:19 UTC): المحاولة التالية ١٠:٠٠ صباحاً لا ٣ فجراً الغد', new Date(g.nextQuotaReset(Date.UTC(2026, 9, 10, 0, 19))).toISOString() === '2026-10-10T07:00:00.000Z');
check('بعد ١٠ صباحاً بغداد: التالي ١٠ صباح الغد لا ٣ فجراً', new Date(g.nextQuotaReset(Date.UTC(2026, 9, 10, 9, 0))).toISOString() === '2026-10-11T07:00:00.000Z');
check('آخر تجدد: ١٠ صباح اليوم (بعده) وأمس (قبله)', new Date(g.lastQuotaReset(Date.UTC(2026, 9, 10, 14, 48))).toISOString() === '2026-10-10T07:00:00.000Z' && new Date(g.lastQuotaReset(Date.UTC(2026, 9, 10, 6, 0))).toISOString() === '2026-10-09T07:00:00.000Z');
check('آخر تجدد بعد تغيير التوقيت', new Date(g.lastQuotaReset(Date.UTC(2026, 10, 2, 9, 0))).toISOString() === '2026-11-02T08:00:00.000Z');
check('شتاءً: منتصف ليل كاليفورنيا = 08:00 UTC', new Date(g.nextPacificMidnight(Date.UTC(2026, 11, 1, 1, 0))).toISOString() === '2026-12-01T08:00:00.000Z');
check('ليلة تغيير التوقيت (١ تشرين الثاني)', new Date(g.nextPacificMidnight(Date.UTC(2026, 10, 1, 12, 0))).toISOString() === '2026-11-02T08:00:00.000Z');
check('يوم الحصة = تاريخ كاليفورنيا', g.pacificDay(Date.UTC(2026, 9, 10, 0, 19)) === '2026-10-09' && g.pacificDay(Date.UTC(2026, 9, 10, 7, 1)) === '2026-10-10');
check('حد التوكنات في الدقيقة (limit: 250000) ليس يومياً', !g.isDailyQuota('Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000, model: gemini-3.8-flash'));
check('انتظار ٤٠ ثانية ليس يومياً ولو ذُكر limit: 20', !g.isDailyQuota('limit: 20, model: gemini-3.8-flash Please retry in 40s'));
check('قفل يومي قبل تجدد اليوم (٥ صباحاً بغداد) قديم بعد ١٠ صباحاً', g.staleDailyBlock({ slot: 'A', model: 'm', blocked_until: '2026-10-11T00:00:00Z', reason: 'انتهت الحصة اليومية', updated_at: '2026-10-10T02:00:00Z' }, Date.UTC(2026, 9, 10, 14, 0)));
check('قفل يومي بعد تجدد اليوم ساري', !g.staleDailyBlock({ slot: 'A', model: 'm', blocked_until: '2026-10-11T07:00:00Z', reason: 'انتهت الحصة اليومية', updated_at: '2026-10-10T12:00:00Z' }, Date.UTC(2026, 9, 10, 14, 0)));
check('قفل الدقيقة لا يتأثر', !g.staleDailyBlock({ slot: 'A', model: 'm', blocked_until: '2026-10-10T14:01:00Z', reason: 'حد الدقيقة (٥ طلبات)', updated_at: '2026-10-10T02:00:00Z' }, Date.UTC(2026, 9, 10, 14, 0)));
check('fileRef الجديد والقديم', g.fileRef('s:GEMINI_API_KEY_3|https://x/f').slot === 'GEMINI_API_KEY_3' && g.fileRef('k1|https://x/f').keyIndex === 1);

// ٥ب) القرّاء المتوازون: القارئ ١ يبدأ بالمفتاح الثاني، والقارئ ٢ بالثالث (لا تزاحم على مفتاح واحد)
for (const k of Object.keys(blocksTable)) delete blocksTable[k];
for (const k of Object.keys(used)) delete used[k];
await g.refreshBlocks(true);
const l1 = await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }], { lane: 1 });
const l2 = await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }], { lane: 2 });
const l4 = await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }], { lane: 4 });
check('القارئ ١ ← المفتاح ٢، القارئ ٢ ← المفتاح ٣، القارئ ٤ يدور ← المفتاح ٢', l1 === 'K2:gemini-3.8-flash' && l2 === 'K3:gemini-3.8-flash' && l4 === 'K2:gemini-3.8-flash', `${l1} ${l2} ${l4}`);

// ٦) المهلة: طلب بطيء يُقطع عند deadline ويُرمى GeminiTimeoutError
await g.refreshBlocks(true);
for (const k of Object.keys(blocksTable)) delete blocksTable[k];
await g.refreshBlocks(true);
const realFetch = globalThis.fetch;
globalThis.fetch = ((_u: string, init: any) => new Promise((_res, rej) => { init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); })) as typeof fetch;
const t0 = Date.now();
let kind = '';
try { await g.generate(g.MAIN_MODELS, [{ role: 'user', parts: [{ text: 'س' }] }], { pool: 'admin', deadline: Date.now() + 4000 }); } catch (e) { kind = e instanceof g.GeminiTimeoutError ? 'timeout' : String(e); }
globalThis.fetch = realFetch;
check('المهلة تقطع الطلب البطيء', kind === 'timeout' && Date.now() - t0 < 6000, `${kind} ${Date.now() - t0}ms`);

if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
console.log('ALL GEMINI TESTS PASSED');
