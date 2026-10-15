// إضافة ملازم من الإنترنت (Google Drive) إلى «الكتب والملازم» ووضعها في طابور الفهرسة — مثل زر «فهرسة» في اللوحة تماماً.
// يعمل في malazem-import.yml. "apply": false ← يحمّل ويفحص ويطبع فقط.
//   ١) تحميل الملف من Drive والتأكد أنه PDF وحجمه ضمن حد التخزين (Supabase المجاني ٥٠ ميغا للملف)
//   ٢) رفعه إلى التخزين (materials/<uuid>.pdf) وإنشاء صف documents (ملزمة، المادة، العنوان باسم الأستاذ)
//   ٣) تقطيعه أجزاء ٤–٨ صفحات (كما تفعل اللوحة) ورفعها، ثم ingest_chunks و queued_at ← يقرؤها ingest-worker وحده
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

const PROJECT = process.env.PROJECT_REF;
const MGMT = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` };
const catalog = JSON.parse(fs.readFileSync(process.env.CATALOG, 'utf8'));
const MAX_BYTES = 49 * 1024 * 1024;

async function driveDownload(id) {
  let res = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, { redirect: 'follow' });
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== '%PDF-') {
    // صفحة «لا يمكن فحص الملف من الفيروسات»: نقرأ النموذج ونرسله
    const html = buf.toString('utf8');
    const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1];
    if (!action) throw new Error(`ليس PDF (${res.status} ${res.headers.get('content-type')}): ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
    const params = new URLSearchParams([...html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    res = await fetch(`${action.replace(/&amp;/g, '&')}?${params}`, { redirect: 'follow' });
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error(`ليس PDF بعد التأكيد (${res.status})`);
  }
  return buf;
}

/** ملف أكبر من حد التخزين: ضغط الصور داخله (Ghostscript، ١٥٠ نقطة/إنش — يكفي للقراءة على الهاتف) */
function compress(buf) {
  fs.writeFileSync('in.pdf', buf);
  execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook',
    '-dColorImageResolution=150', '-dGrayImageResolution=150', '-dMonoImageResolution=300', '-sOutputFile=out.pdf', 'in.pdf'], { timeout: 15 * 60_000 });
  return fs.readFileSync('out.pdf');
}

let SB = null;
async function supabase() {
  if (SB) return SB;
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/api-keys?reveal=true`, { headers: MGMT })).json();
  const key = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('service_role key not found');
  SB = { url: `https://${PROJECT}.supabase.co`, h: { apikey: key, Authorization: `Bearer ${key}` } };
  return SB;
}
async function rest(method, path, body, prefer = 'return=representation') {
  const sb = await supabase();
  const res = await fetch(`${sb.url}/rest/v1/${path}`, { method, headers: { ...sb.h, 'Content-Type': 'application/json', Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
async function upload(bytes) {
  const sb = await supabase();
  const key = `materials/${randomUUID()}.pdf`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${sb.url}/storage/v1/object/files/${key}`, { method: 'POST', headers: { ...sb.h, 'Content-Type': 'application/pdf' }, body: bytes });
    if (res.ok) return key;
    if (attempt >= 2) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// أين تُحفظ ملفات التطبيق؟ الدوال تقرأ من S3 إن ضُبطت أسراره، وإلا من Supabase Storage.
// نرفع إلى Supabase فقط إن كانت الكتب الحالية فيه فعلاً (وإلا لن يجد التطبيق الملزمة).
{
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST', headers: { ...MGMT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ read_only: true, query: "select count(*)::int total, count(*) filter (where exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = d.file_key))::int in_supabase from documents d" }),
  });
  const [r] = await res.json();
  console.log(`الكتب الحالية: ${r.total}، منها في Supabase Storage: ${r.in_supabase}`);
  const sec = await (await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/secrets`, { headers: MGMT })).json();
  console.log(`أسرار التخزين في الدوال: ${(Array.isArray(sec) ? sec : []).map((x) => x.name).filter((n) => /R2_|S3_/.test(n)).join('، ') || 'لا شيء (Supabase Storage)'}`);
  const miss = await (await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST', headers: { ...MGMT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ read_only: true, query: "select left(title,60) t, file_key, created_at from documents d where not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = d.file_key)" }),
  })).json();
  for (const m of miss) console.log(`  ليس في Supabase: ${m.t} | ${m.file_key} | ${m.created_at}`);
  if (r.total && r.in_supabase < r.total) {
    console.log('✗ ملفات التطبيق ليست في Supabase Storage (التخزين الخارجي S3 مفعّل) — لا رفع من هنا. ارفع الملازم من اللوحة.');
    process.exit(1);
  }
}

for (const s of catalog.subjects) {
  console.log(`\n################ ${s.name}`);
  for (const c of s.candidates) {
    const title = c.title ?? `ملزمة ${s.name} — الأستاذ ${c.teacher}${c.part ? ` — ${c.part}` : ''} (${c.year})`;
    try {
      if (catalog.apply) {
        const existing = await rest('GET', `documents?select=id&title=eq.${encodeURIComponent(title)}`);
        if (existing.length) { console.log(`  ✓ موجودة سابقاً: ${title}`); break; }
      }
      let buf = await driveDownload(c.drive);
      if (buf.length > MAX_BYTES) {
        const before = (buf.length / 1048576).toFixed(1);
        buf = compress(buf);
        console.log(`  ~ ${c.teacher}: ضُغط من ${before} إلى ${(buf.length / 1048576).toFixed(1)} ميغا`);
      }
      const mb = (buf.length / 1048576).toFixed(1);
      if (buf.length > MAX_BYTES) { console.log(`  ✗ ${c.teacher}: ${mb} ميغا بعد الضغط — أكبر من حد التخزين، التالي`); continue; }
      const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
      const total = src.getPageCount();
      const avgPage = buf.length / Math.max(1, total);
      const size = avgPage > 400_000 ? 4 : avgPage > 150_000 ? 6 : 8;
      const scanned = avgPage > 60_000;
      console.log(`  ● ${title}: ${total} صفحة، ${mb} ميغا، ${scanned ? 'مصوّرة' : 'نصية'}، أجزاء من ${size} صفحات`);
      if (!catalog.apply) break;

      const { data: subj } = { data: await rest('GET', `subjects?select=id&slug=eq.${s.subject}`) };
      const fileKey = await upload(buf);
      const [doc] = await rest('POST', 'documents', {
        subject_id: subj[0].id, kind: 'malzama', title, file_key: fileKey, size_bytes: buf.length, pages: total, sort: 10, is_published: true,
      });
      const rows = [];
      for (let from = 1; from <= total; from += size) {
        const to = Math.min(total, from + size - 1);
        const sub = await PDFDocument.create();
        (await sub.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))).forEach((p) => sub.addPage(p));
        rows.push({ document_id: doc.id, from_page: from, to_page: to, total_pages: total, file_key: await upload(Buffer.from(await sub.save())), scanned });
      }
      for (let i = 0; i < rows.length; i += 100) await rest('POST', 'ingest_chunks', rows.slice(i, i + 100), 'return=minimal');
      await rest('PATCH', `documents?id=eq.${doc.id}`, { queued_at: new Date().toISOString(), ingest_status: 'running', ingest_error: null }, 'return=minimal');
      console.log(`  ✓ أُضيفت ودخلت طابور الفهرسة: ${rows.length} جزءاً`);
      break;
    } catch (e) {
      console.log(`  ✗ ${c.teacher}: ${e.message}`);
    }
  }
}
