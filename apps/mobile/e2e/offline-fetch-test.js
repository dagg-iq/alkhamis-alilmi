// اختبار طبقة الحفظ للعمل بلا إنترنت (Node): npx esbuild src/lib/offline-fetch.ts --bundle --platform=node --format=cjs --outfile=/tmp/of.cjs && node e2e/offline-fetch-test.js
const { createCachingFetch, clearOfflineEntries } = require('/tmp/of.cjs');
const assert = require('assert');
const mem = new Map();
const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, remove: async (ks) => ks.forEach((k) => mem.delete(k)) };
let online = true, calls = 0;
const base = async (url, init) => { calls++; if (!online) throw new TypeError('Network request failed');
  return new Response(JSON.stringify([{ id: 1, url: String(url).slice(-12) }]), { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } }); };
const states = [];
const f = createCachingFetch({ base, store, anonKey: 'ANON', onState: (v) => states.push(v), maxEntries: 3 });
const hdr = (t) => ({ headers: new Headers({ Authorization: `Bearer ${t}`, Accept: 'application/json' }) });
const U = (t, q = '') => `https://x.supabase.co/rest/v1/${t}?select=*${q}`;
(async () => {
  // ١. اتصال: يعيد الرد ويحفظه
  let r = await f(U('grades'), hdr('USER'));
  assert.equal((await r.json())[0].id, 1);
  await new Promise((r) => setTimeout(r, 20));
  // ٢. انقطاع: يعيد المحفوظ مع الرؤوس
  online = false;
  r = await f(U('grades'), hdr('USER'));
  assert.equal(r.headers.get('x-saey-cache'), '1'); assert.equal(r.headers.get('content-range'), '0-0/1');
  assert.equal((await r.json())[0].id, 1);
  assert.deepEqual(states, [true]);
  // ٣. لا محفوظ ← خطأ الشبكة كما هو
  await assert.rejects(() => f(U('tasks'), hdr('USER')), TypeError);
  // ٤. الكتابة بلا إنترنت تفشل ولا تُخدع
  await assert.rejects(() => f(U('grades'), { ...hdr('USER'), method: 'POST', body: '{}' }), TypeError);
  // ٥. رد بمفتاح anon (بلا جلسة) لا يُحفظ
  online = true; await f(U('profiles'), hdr('ANON')); await new Promise((r) => setTimeout(r, 20));
  online = false; await assert.rejects(() => f(U('profiles'), hdr('ANON')), TypeError);
  // ٦. جداول مستثناة
  online = true; await f(U('messages'), hdr('USER')); await new Promise((r) => setTimeout(r, 20));
  online = false; await assert.rejects(() => f(U('messages'), hdr('USER')), TypeError);
  // ٧. rpc للقراءة فقط يُحفظ، وغيره لا
  online = true;
  await f('https://x.supabase.co/rest/v1/rpc/my_conversations', { ...hdr('USER'), method: 'POST', body: '{}' });
  await f('https://x.supabase.co/rest/v1/rpc/start_direct', { ...hdr('USER'), method: 'POST', body: '{"p_other":"a"}' });
  await new Promise((r) => setTimeout(r, 20)); online = false;
  r = await f('https://x.supabase.co/rest/v1/rpc/my_conversations', { ...hdr('USER'), method: 'POST', body: '{}' }); assert.equal(r.headers.get('x-saey-cache'), '1');
  await assert.rejects(() => f('https://x.supabase.co/rest/v1/rpc/start_direct', { ...hdr('USER'), method: 'POST', body: '{"p_other":"a"}' }), TypeError);
  // ٨. الحد الأقصى للعناصر: الأقدم يُحذف
  online = true;
  for (const t of ['a', 'b', 'c', 'd']) { await f(U('subjects', `&k=${t}`), hdr('USER')); await new Promise((r) => setTimeout(r, 15)); }
  online = false;
  await assert.rejects(() => f(U('subjects', '&k=a'), hdr('USER')), TypeError);
  r = await f(U('subjects', '&k=d'), hdr('USER')); assert.equal(r.headers.get('x-saey-cache'), '1');
  // ٩. المسح عند الخروج
  await clearOfflineEntries(store);
  await assert.rejects(() => f(U('subjects', '&k=d'), hdr('USER')), TypeError);
  console.log('OFFLINE FETCH TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
