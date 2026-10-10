// ينسخ كل ملفات حاوية Supabase "files" إلى تخزين S3 (سيرفر Oracle) بنفس المسارات.
// آمن لإعادة التشغيل: يتخطى الملف الموجود بنفس الحجم. لا يحذف شيئاً من Supabase.
// يُشغَّل من migrate-storage.yml، ويقرأ من البيئة:
//   SUPABASE_URL، SUPABASE_SERVICE_KEY، S3_ENDPOINT، S3_REGION، R2_ACCESS_KEY_ID، R2_SECRET_ACCESS_KEY، R2_BUCKET
import { AwsClient } from 'aws4fetch';

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const SB = `${env('SUPABASE_URL')}/storage/v1`;
const SB_H = { apikey: env('SUPABASE_SERVICE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_KEY')}` };
const SRC_BUCKET = 'files';
const s3 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: env('S3_REGION'),
});
const objectUrl = (key) => `${env('S3_ENDPOINT')}/${env('R2_BUCKET')}/${key.split('/').map(encodeURIComponent).join('/')}`;
const sbPath = (key) => key.split('/').map(encodeURIComponent).join('/');

async function retry(what, fn) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === 4) throw e;
      console.warn(`retry ${what}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

// قائمة كل الملفات (المجلدات لها id = null فننزل داخلها)
async function list(prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await retry(`list ${prefix}`, async () => {
      const r = await fetch(`${SB}/object/list/${SRC_BUCKET}`, {
        method: 'POST',
        headers: { ...SB_H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!r.ok) throw new Error(`list ${r.status}: ${await r.text()}`);
      return r.json();
    });
    for (const it of res) {
      const key = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) out.push(...(await list(key)));
      else out.push({ key, size: it.metadata?.size ?? null, type: it.metadata?.mimetype ?? 'application/octet-stream' });
    }
    if (res.length < 1000) return out;
  }
}

const files = await list();
const total = files.reduce((n, f) => n + (f.size ?? 0), 0);
console.log(`Supabase: ${files.length} ملف، ${(total / 1048576).toFixed(1)} MB`);

let copied = 0, skipped = 0, failed = 0;
for (const f of files) {
  try {
    const head = await s3.fetch(objectUrl(f.key), { method: 'HEAD' });
    if (head.ok && f.size !== null && Number(head.headers.get('content-length')) === f.size) {
      skipped++;
      continue;
    }
    await retry(f.key, async () => {
      const src = await fetch(`${SB}/object/${SRC_BUCKET}/${sbPath(f.key)}`, { headers: SB_H });
      if (!src.ok) throw new Error(`download ${src.status}`);
      const body = new Uint8Array(await src.arrayBuffer());
      const put = await s3.fetch(objectUrl(f.key), { method: 'PUT', body, headers: { 'Content-Type': f.type } });
      if (!put.ok) throw new Error(`upload ${put.status}: ${await put.text()}`);
    });
    copied++;
    console.log(`✓ ${f.key}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${f.key}: ${e.message}`);
  }
}

console.log(`\nنُسخ ${copied}، موجود مسبقاً ${skipped}، فشل ${failed} — من أصل ${files.length}`);
if (failed) process.exit(1);
