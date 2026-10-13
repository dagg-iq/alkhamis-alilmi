// اختبار طبقة الحفظ بلا إنترنت (offline-fetch). التشغيل: node apps/mobile/e2e/offline-test.cjs
const path = require('path');
const out = path.join(require('os').tmpdir(), 'saey-of.cjs');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src/lib/offline-fetch.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'warning' });
const { createCachingFetch, clearOfflineEntries, cacheUrl } = require(out);
const assert = require('assert');
const mem = new Map();
const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { await new Promise((r) => setTimeout(r, Math.random() * 5)); mem.set(k, v); }, remove: async (ks) => ks.forEach((k) => mem.delete(k)), keys: async () => [...mem.keys()] };
let online = true, slow = 0;
const base = async (url, init) => {
  if (!online) throw new TypeError('Network request failed');
  if (slow) await new Promise((r, j) => { const t = setTimeout(r, slow); init?.signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; j(e); }); });
  if (/EXPIRED/.test(init.headers.get('Authorization'))) return new Response('{"code":"PGRST301","message":"JWT expired"}', { status: 401, headers: { 'content-type': 'application/json' } });
  const anon = /ANON/.test(init.headers.get('Authorization'));
  return new Response(JSON.stringify(anon ? [] : [{ id: 1 }]), { status: 200, headers: { 'content-type': 'application/json' } });
};
let uid = 'A';
const f = createCachingFetch({ base, store, anonKey: 'ANON', userId: () => uid, maxEntries: 50, timeoutMs: 200 });
const hdr = (t) => ({ headers: new Headers({ Authorization: `Bearer ${t}`, Accept: 'application/json' }) });
const U = (t) => `https://x.supabase.co/rest/v1/${t}?select=*`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // تزامن: ٢٠ استعلاماً معاً كلها في الفهرس
  await Promise.all(Array.from({ length: 20 }, (_, i) => f(U('t' + i), hdr('TOKEN1'))));
  await wait(300);
  assert.equal(JSON.parse(mem.get('saey.c1.index')).length, 20, 'index has all 20');
  // رمز تغيّر (تجديد): نفس المحفوظ
  online = false;
  let r = await f(U('t3'), hdr('TOKEN2'));
  assert.equal((await r.json())[0].id, 1);
  // بلا إنترنت والرمز anon (جلسة منتهية): يقرأ المحفوظ للطالب
  r = await f(U('t4'), hdr('ANON'));
  assert.equal((await r.json())[0].id, 1, 'stale anon reads cache');
  // أونلاين برمز anon: لا يحفظ الرد الفارغ فوق بيانات الطالب
  online = true;
  r = await f(U('t5'), hdr('ANON')); assert.equal((await r.json()).length, 0);
  await wait(50); online = false;
  r = await f(U('t5'), hdr('TOKEN1')); assert.equal((await r.json())[0].id, 1, 'anon response not stored');
  // حساب آخر لا يرى محفوظ الأول
  uid = 'B';
  await assert.rejects(f(U('t5'), hdr('TOKENB')));
  // بطء بلا محفوظ: لا مهلة (ينتظر)
  online = true; slow = 400;
  r = await f(U('new'), hdr('TOKENB')); assert.equal((await r.json())[0].id, 1, 'no timeout without cache');
  // بطء مع محفوظ: المهلة تعيد المحفوظ
  await wait(50);
  r = await f(U('new'), hdr('TOKENB')); assert.equal(r.headers.get('x-saey-cache'), '1', 'timeout uses cache');
  // وقت كامل في الرابط يتغير كل طلب: بلا إنترنت يطابق المحفوظ لنفس الاستعلام
  slow = 0; online = true;
  const T = (iso) => `https://x.supabase.co/rest/v1/tasks?select=*&due_at=gte.${encodeURIComponent(iso)}`;
  await f(T('2026-10-12T08:00:00.123Z'), hdr('TOKENB')); await wait(50);
  online = false;
  r = await f(T('2026-10-12T09:15:42.987Z'), hdr('TOKENB')); assert.equal(r.headers.get('x-saey-cache'), '1', 'timestamps normalized');
  assert.equal(cacheUrl('a?d=eq.2026-10-12'), 'a?d=eq.2026-10-12', 'plain dates kept');
  // رمز منتهٍ بعد عودة الإنترنت (401): يعرض المحفوظ بدل الخطأ
  online = true;
  r = await f(T('2026-10-12T10:00:00Z'), hdr('EXPIRED')); assert.equal(r.status, 200, '401 falls back to cache'); assert.equal(r.headers.get('x-saey-cache'), '1');
  // الرسائل تُحفظ الآن (آخر صفحة من المحادثة بلا إنترنت)
  await f(U('messages'), hdr('TOKENB')); await wait(50); online = false;
  r = await f(U('messages'), hdr('TOKENB')); assert.equal((await r.json())[0].id, 1, 'messages cached');
  // المسح الكامل حتى المفاتيح خارج الفهرس
  mem.set('saey.c1.orphan', '{}');
  await clearOfflineEntries(store);
  assert.equal([...mem.keys()].filter((k) => k.startsWith('saey.c1.')).length, 0);
  console.log('ALL OFFLINE TESTS PASSED');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
