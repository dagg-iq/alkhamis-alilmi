// حارس خادم التخزين: يوقظه pg_cron كل ٥ دقائق (migration ٣٤).
// إن لم يرد خادم S3 (سيرفر Oracle) يسأل Oracle عن حالة الجهاز عبر واجهتها الرسمية:
//   STOPPED (أوقفته Oracle لقلة الاستعمال أو توقف)  ← START فوراً
//   RUNNING لكنه لا يرد ١٥ دقيقة متواصلة (البرنامج علق)  ← SOFTRESET (إعادة تشغيل)، مرة كل ٣٠ دقيقة كحد أقصى
// كل فحص يُسجَّل في storage_watchdog_log (يظهر في سير عمل Health check).
// يحتاج أسرار Oracle: OCI_TENANCY, OCI_USER, OCI_FINGERPRINT, OCI_PRIVATE_KEY, OCI_REGION, OCI_INSTANCE_ID
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller } from '../_shared/supabase.ts';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const STUCK_MS = 15 * 60_000;
const RESET_EVERY_MS = 30 * 60_000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** PEM ← مفتاح للتوقيع. يقبل PKCS#8 (مفتاح Oracle من الموقع) و PKCS#1 («RSA PRIVATE KEY») */
export async function importKey(pem: string): Promise<CryptoKey> {
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  let pkcs8 = der;
  if (pkcs1) {
    // تغليف PKCS#1 داخل PKCS#8: SEQ { INT 0, SEQ { OID rsaEncryption, NULL }, OCTET STRING { pkcs1 } }
    const len = (n: number) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
    const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
    const octet = [0x04, ...len(der.length)];
    const body = [0x02, 0x01, 0x00, ...algo, ...octet];
    pkcs8 = new Uint8Array([0x30, ...len(body.length + der.length), ...body, ...der]);
  }
  return await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** طلب موقّع لواجهة Oracle (OCI HTTP Signature) */
async function oci(method: 'GET' | 'POST', path: string): Promise<Record<string, unknown>> {
  const host = `iaas.${env('OCI_REGION')}.oraclecloud.com`;
  const headers: Record<string, string> = { 'x-date': new Date().toUTCString(), host };
  const signed = ['(request-target)', 'host', 'x-date'];
  const body = method === 'POST' ? '' : undefined;
  if (body !== undefined) {
    headers['x-content-sha256'] = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
    headers['content-type'] = 'application/json';
    headers['content-length'] = '0';
    signed.push('x-content-sha256', 'content-type', 'content-length');
  }
  const signingString = signed.map((h) => (h === '(request-target)' ? `(request-target): ${method.toLowerCase()} ${path}` : `${h}: ${headers[h]}`)).join('\n');
  const sig = b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(env('OCI_PRIVATE_KEY')), new TextEncoder().encode(signingString)));
  const keyId = `${env('OCI_TENANCY')}/${env('OCI_USER')}/${env('OCI_FINGERPRINT')}`;
  headers.authorization = `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${signed.join(' ')}",signature="${sig}"`;
  const { host: _h, ...send } = headers;
  const res = await fetch(`https://${host}${path}`, { method, headers: send, body, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`OCI ${method} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function probe(): Promise<boolean> {
  const ep = env('S3_ENDPOINT');
  if (!ep) return true;
  try {
    await fetch(ep, { method: 'HEAD', signal: AbortSignal.timeout(6_000) });
    return true; // أي رد (حتى 403) = يعمل
  } catch {
    // محاولة ثانية بعد ثوانٍ (لا نعيد تشغيل جهاز بسبب طلب ضاع)
    await new Promise((r) => setTimeout(r, 4_000));
    try { await fetch(ep, { method: 'HEAD', signal: AbortSignal.timeout(8_000) }); return true; } catch { return false; }
  }
}

async function log(up: boolean, state: string | null, action: string | null, detail: string | null) {
  await admin.from('storage_watchdog_log').insert({ up, state, action, detail: detail?.slice(0, 300) ?? null });
}

export async function check() {
  const up = await probe();
  if (up) {
    await log(true, null, null, null);
    return { up };
  }
  const configured = ['OCI_TENANCY', 'OCI_USER', 'OCI_FINGERPRINT', 'OCI_PRIVATE_KEY', 'OCI_REGION', 'OCI_INSTANCE_ID'].every((k) => env(k));
  if (!configured) {
    await log(false, null, null, 'أسرار Oracle غير مضافة — لا يمكن تشغيل الجهاز تلقائياً');
    return { up, configured };
  }
  const path = `/20160918/instances/${env('OCI_INSTANCE_ID')}`;
  let state = '?';
  try {
    state = String((await oci('GET', path)).lifecycleState ?? '?');
    if (state === 'STOPPED') {
      await oci('POST', `${path}?action=START`);
      await log(false, state, 'START', 'الجهاز كان متوقفاً — أُرسل أمر التشغيل');
      return { up, state, action: 'START' };
    }
    if (state === 'RUNNING') {
      // منذ متى لا يرد؟ وآخر إعادة تشغيل
      const { data: lastUp } = await admin.from('storage_watchdog_log').select('at').eq('up', true).order('at', { ascending: false }).limit(1).maybeSingle();
      const { data: lastAction } = await admin.from('storage_watchdog_log').select('at').in('action', ['SOFTRESET', 'START']).order('at', { ascending: false }).limit(1).maybeSingle();
      const downFor = Date.now() - Date.parse(lastUp?.at ?? new Date(0).toISOString());
      const sinceAction = Date.now() - Date.parse(lastAction?.at ?? new Date(0).toISOString());
      if (downFor >= STUCK_MS && sinceAction >= RESET_EVERY_MS) {
        await oci('POST', `${path}?action=SOFTRESET`);
        await log(false, state, 'SOFTRESET', `يعمل لكن لا يرد منذ ${Math.round(downFor / 60_000)} دقيقة — إعادة تشغيل`);
        return { up, state, action: 'SOFTRESET' };
      }
    }
    await log(false, state, null, 'ننتظر');
    return { up, state };
  } catch (e) {
    await log(false, state, 'ERROR', String((e as Error).message ?? e));
    return { up, state, error: String((e as Error).message ?? e) };
  }
}

if (import.meta.main) Deno.serve(handler(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!(secret && req.headers.get('x-webhook-secret') === secret)) {
    try { await getCaller(req, { staff: true }); } catch { throw new HttpError(401, 'غير مصرح'); }
  }
  return json(await check());
}));
