// اختبار حارس التخزين (Oracle وهمي). التشغيل من supabase/functions:
//   deno run -A --node-modules-dir=none --config deno.json ../tests/storage_watchdog_test.ts
Deno.env.set('SUPABASE_URL', 'http://x.local'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's');
// مفتاح اختبار يُولَّد هنا (PKCS#8 مثل مفتاح Oracle)؛ PKCS#1 يُختبر فقط إن مُرِّر من openssl (TEST_KEY_PKCS1 + TEST_PUB)
const toPem = (label: string, buf: ArrayBuffer) => `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/.{64}/g, '$&\n')}\n-----END ${label}-----`;
const gen = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pem1 = Deno.env.get('TEST_KEY_PKCS1') ?? '';
const pem8 = pem1 ? '' : toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', gen.privateKey));
const pub = Deno.env.get('TEST_PUB') ?? toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', gen.publicKey));
for (const [k, v] of Object.entries({ S3_ENDPOINT: 'https://storage.test', OCI_TENANCY: 'ocid1.tenancy.x', OCI_USER: 'ocid1.user.x', OCI_FINGERPRINT: 'aa:bb', OCI_REGION: 'me-jeddah-1', OCI_INSTANCE_ID: 'ocid1.instance.x' })) Deno.env.set(k, v);
// الأسرار تصل بلا أسطر جديدة (سير النشر يحذفها)
Deno.env.set('OCI_PRIVATE_KEY', (pem1 || pem8).replace(/\n/g, ''));

// قاعدة بيانات وهمية: سجل الحارس
const logs: { at: string; up: boolean; state?: string; action?: string | null }[] = [];
const { admin } = await import('../functions/_shared/supabase.ts');
(admin as any).from = () => {
  const q: any = {
    _f: {} as any,
    insert: async (row: any) => { logs.push({ at: new Date().toISOString(), ...row }); return { error: null }; },
    select: () => q, eq: (c: string, v: any) => { q._f[c] = v; return q; }, in: (c: string, v: any) => { q._f[c] = v; return q; },
    order: () => q, limit: () => q,
    maybeSingle: async () => {
      const r = logs.filter((l) => (q._f.up === undefined || l.up === q._f.up) && (!q._f.action || q._f.action.includes(l.action))).sort((a, b) => b.at.localeCompare(a.at))[0];
      return { data: r ?? null };
    },
  };
  return q;
};

// Oracle وخادم التخزين وهميان
let storageUp = false;
let instance = 'STOPPED';
const calls: string[] = [];
let sigOk = true;
const publicKey = await crypto.subtle.importKey('spki', Uint8Array.from(atob(pub.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://storage.test')) { if (storageUp) return new Response('', { status: 403 }); throw new TypeError('connect timeout'); }
  const u = new URL(url);
  const h = new Headers(init?.headers);
  const auth = h.get('authorization') ?? '';
  const names = auth.match(/headers="([^"]+)"/)![1].split(' ');
  const signing = names.map((n) => (n === '(request-target)' ? `(request-target): ${init!.method!.toLowerCase()} ${u.pathname}${u.search}` : `${n}: ${n === 'host' ? u.host : h.get(n)}`)).join('\n');
  const sig = Uint8Array.from(atob(auth.match(/signature="([^"]+)"/)![1]), (c) => c.charCodeAt(0));
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, new TextEncoder().encode(signing)))) sigOk = false;
  if (!auth.includes('keyId="ocid1.tenancy.x/ocid1.user.x/aa:bb"')) sigOk = false;
  calls.push(`${init!.method} ${u.search || 'get'}`);
  if (u.search === '?action=START') instance = 'STARTING';
  return new Response(JSON.stringify({ lifecycleState: instance }), { status: 200 });
}) as typeof fetch;

const wd = await import('../functions/storage-watchdog/index.ts');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };

if (pem8) check('مفتاح PKCS#8 بلا أسطر يُقرأ', !!(await wd.importKey(pem8.replace(/\n/g, ''))));
if (pem1) check('مفتاح PKCS#1 بلا أسطر يُقرأ', !!(await wd.importKey(pem1.replace(/\n/g, ''))));

let r: any = await wd.check();
check('متوقف ← START', r.action === 'START' && calls.includes('POST ?action=START'));
check('التوقيع صحيح ويتحقق بالمفتاح العام', sigOk);

instance = 'RUNNING'; calls.length = 0;
r = await wd.check();
check('يعمل ولا يرد لأول مرة (وبعد START مباشرة) ← لا إعادة تشغيل', !r.action && !calls.some((c) => c.includes('SOFTRESET')));

// آخر «يرد» قبل ٢٠ دقيقة وآخر إجراء قبل ساعة ← SOFTRESET
logs.length = 0;
logs.push({ at: new Date(Date.now() - 20 * 60_000).toISOString(), up: true });
logs.push({ at: new Date(Date.now() - 60 * 60_000).toISOString(), up: false, action: 'START' });
r = await wd.check();
check('يعمل ولا يرد ٢٠ دقيقة ← SOFTRESET', r.action === 'SOFTRESET');
r = await wd.check();
check('لا إعادة تشغيل ثانية خلال ٣٠ دقيقة', !r.action);

storageUp = true; calls.length = 0;
r = await wd.check();
check('الخادم يرد ← لا طلبات لـ Oracle', r.up === true && calls.length === 0);

if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
console.log('كل اختبارات حارس التخزين نجحت');
