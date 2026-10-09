/**
 * يجعل قراءات قاعدة البيانات تعمل بلا إنترنت: كل استعلام قراءة ناجح يُحفظ، وعند انقطاع الاتصال
 * (أو بطئه الشديد) يُعاد آخر ما حُفظ. هكذا تظهر الدرجات والحصص والمواد والأخبار والمهام… بدون إنترنت،
 * ولا تحتاج أي شاشة إلى تعديل. الكتابة بلا إنترنت تفشل برسالة واضحة (لا نخدع الطالب بحفظ لم يحدث).
 */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface OfflineFetchOptions {
  base: typeof fetch;
  store: KV;
  /** مفتاح anon: الطلبات به (بلا جلسة) لا تُحفظ حتى لا تحل ردود فارغة محل بيانات الطالب */
  anonKey: string;
  onState?: (offline: boolean) => void;
  maxEntries?: number;
  maxBytes?: number;
  /** مهلة الانتظار قبل اللجوء للنسخة المحفوظة */
  timeoutMs?: number;
}

const PREFIX = 'saey.c1.';
const INDEX = `${PREFIX}index`;
// جداول لا نحفظها: ضخمة أو حساسة أو لا فائدة منها بلا إنترنت
const SKIP_TABLES = new Set(['messages', 'ai_messages', 'content_chunks', 'push_tokens', 'audit_log', 'ai_cache', 'ai_usage']);
// دوال قراءة فقط يمكن حفظ نتيجتها
const READ_RPC = new Set(['my_conversations']);

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const headerOf = (init: RequestInit | undefined, name: string): string => {
  const h = init?.headers as unknown;
  if (!h) return '';
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name) ?? '';
  const rec = h as Record<string, string>;
  const k = Object.keys(rec).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? rec[k] : '';
};

const isNetworkError = (e: unknown) => e instanceof TypeError || (e as { name?: string })?.name === 'AbortError';

interface Entry { s: number; ct: string; cr: string; b: string }
type Index = [string, number, number][]; // [المفتاح، الحجم، الوقت]

export function createCachingFetch(o: OfflineFetchOptions): typeof fetch {
  const maxEntries = o.maxEntries ?? 150;
  const maxBytes = o.maxBytes ?? 3_000_000;
  const timeoutMs = o.timeoutMs ?? 15000;
  let offline = false;
  const setOffline = (v: boolean) => { if (v !== offline) { offline = v; o.onState?.(v); } };

  async function readIndex(): Promise<Index> {
    try { return JSON.parse((await o.store.get(INDEX)) ?? '[]') as Index; } catch { return []; }
  }
  async function remember(key: string, entry: Entry) {
    const raw = JSON.stringify(entry);
    if (raw.length > 400_000) return; // أكبر من اللازم
    await o.store.set(key, raw);
    let idx = (await readIndex()).filter((x) => x[0] !== key);
    idx.push([key, raw.length, Date.now()]);
    let total = idx.reduce((a, x) => a + x[1], 0);
    const drop: string[] = [];
    idx.sort((a, b) => a[2] - b[2]);
    while (idx.length > maxEntries || total > maxBytes) {
      const old = idx.shift();
      if (!old) break;
      total -= old[1];
      drop.push(old[0]);
    }
    if (drop.length) await o.store.remove(drop);
    await o.store.set(INDEX, JSON.stringify(idx));
  }

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();
    let path = '';
    try { path = new URL(url).pathname; } catch { /* رابط غير معتاد */ }
    const table = path.startsWith('/rest/v1/') ? path.slice(9).split('/')[0] : '';
    const rpc = path.startsWith('/rest/v1/rpc/') ? path.slice(13) : '';
    const token = headerOf(init, 'authorization').replace(/^Bearer\s+/i, '');
    const cacheable = !!table && token !== '' && token !== o.anonKey && (
      ((method === 'GET' || method === 'HEAD') && !SKIP_TABLES.has(table)) ||
      (method === 'POST' && !!rpc && READ_RPC.has(rpc))
    );

    if (!cacheable) {
      try {
        const res = await o.base(input, init);
        setOffline(false);
        return res;
      } catch (e) {
        if (isNetworkError(e)) setOffline(true);
        throw e;
      }
    }

    const body = method === 'POST' && typeof init?.body === 'string' ? init.body : '';
    const key = `${PREFIX}${hash(`${method}|${url}|${headerOf(init, 'accept')}|${body}`)}`;

    // مهلة: إن تأخر الخادم كثيراً نعرض المحفوظ (إلا إذا طلب المتصل إلغاءً بنفسه)
    let ctl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reqInit = init;
    if (!init?.signal && typeof AbortController !== 'undefined') {
      ctl = new AbortController();
      timer = setTimeout(() => ctl?.abort(), timeoutMs);
      reqInit = { ...init, signal: ctl.signal };
    }
    try {
      const res = await o.base(input, reqInit);
      if (timer) clearTimeout(timer);
      setOffline(false);
      if (res.ok && res.status !== 204 && method !== 'HEAD') {
        res.clone().text().then((b) => remember(key, {
          s: res.status, ct: res.headers.get('content-type') ?? 'application/json', cr: res.headers.get('content-range') ?? '', b,
        })).catch(() => {});
      } else if (res.ok && method === 'HEAD') {
        remember(key, { s: res.status, ct: '', cr: res.headers.get('content-range') ?? '', b: '' }).catch(() => {});
      }
      return res;
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (!isNetworkError(e)) throw e;
      setOffline(true);
      let hit: Entry | null = null;
      try { const raw = await o.store.get(key); hit = raw ? (JSON.parse(raw) as Entry) : null; } catch { hit = null; }
      if (!hit) throw e;
      const headers: Record<string, string> = { 'x-saey-cache': '1' };
      if (hit.ct) headers['content-type'] = hit.ct;
      if (hit.cr) headers['content-range'] = hit.cr;
      return new Response(method === 'HEAD' ? null : hit.b, { status: hit.s, headers });
    }
  };
  return impl as typeof fetch;
}

/** يمسح كل المحفوظ (عند تسجيل الخروج: لا يرى حساب آخر بيانات هذا الحساب) */
export async function clearOfflineEntries(store: KV): Promise<void> {
  let idx: Index = [];
  try { idx = JSON.parse((await store.get(INDEX)) ?? '[]') as Index; } catch { /* لا شيء */ }
  await store.remove([...idx.map((x) => x[0]), INDEX]);
}
