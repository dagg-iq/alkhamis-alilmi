// اختبار احتياط التخزين: خادم S3 لا يرد ← القراءة والرفع من Supabase Storage. التشغيل من supabase/functions:
//   deno run -A --node-modules-dir=none --config deno.json ../tests/storage_fallback_test.ts
Deno.env.set('SUPABASE_URL', 'http://x.local'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's');
Deno.env.set('R2_ACCESS_KEY_ID', 'k'); Deno.env.set('R2_SECRET_ACCESS_KEY', 's'); Deno.env.set('R2_BUCKET', 'b');
Deno.env.set('S3_ENDPOINT', 'http://127.0.0.1:9'); // منفذ مغلق = خادم متوقف

const { admin } = await import('../functions/_shared/supabase.ts');
const files = new Map<string, Uint8Array>([['materials/old.pdf', new Uint8Array([1, 2, 3])]]);
(admin as any).storage = {
  getBucket: async () => ({ data: { id: 'files' } }),
  from: () => ({
    list: async (folder: string, o: { search: string }) => ({ data: [...files.keys()].filter((k) => k === `${folder}/${o.search}`).map((k) => ({ name: k.split('/').pop() })) }),
    createSignedUrl: async (k: string) => ({ data: files.has(k) ? { signedUrl: `supabase-get:${k}` } : null, error: files.has(k) ? null : { message: 'not found' } }),
    createSignedUploadUrl: async (k: string) => ({ data: { signedUrl: `supabase-put:${k}` } }),
    download: async (k: string) => (files.has(k) ? { data: new Blob([files.get(k)!]) } : { error: { message: 'not found' } }),
    upload: async (k: string, b: Uint8Array) => { files.set(k, b); return { error: null }; },
    remove: async (ks: string[]) => { ks.forEach((k) => files.delete(k)); return { error: null }; },
  }),
};
const st = await import('../functions/_shared/storage.ts');

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };

check('كتاب قديم في Supabase: رابط Supabase', (await st.presign('GET', 'materials/old.pdf')) === 'supabase-get:materials/old.pdf');
check('رفع والخادم متوقف: رابط Supabase', (await st.presign('PUT', 'materials/new.pdf', 900, 'application/pdf')) === 'supabase-put:materials/new.pdf');
check('قراءة من Supabase', (await st.getObject('materials/old.pdf')).length === 3);
await st.putObject('generated/x.pdf', new Uint8Array([9]), 'application/pdf');
check('كتابة والخادم متوقف: إلى Supabase', files.has('generated/x.pdf'));
let err = '';
try { await st.getObject('materials/only-s3.pdf'); } catch (e) { err = String(e); }
check('ملف في S3 فقط والخادم متوقف: خطأ واضح بلا تعليق', /S3 لا يرد/.test(err));
await st.deleteObject('generated/x.pdf');
check('حذف من Supabase', !files.has('generated/x.pdf'));

if (failed) { console.error(`${failed} فشل`); Deno.exit(1); }
console.log('كل اختبارات احتياط التخزين نجحت');
