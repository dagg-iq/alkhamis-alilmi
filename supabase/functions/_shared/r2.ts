import { AwsClient } from 'npm:aws4fetch@1.0.20';

const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
const bucket = Deno.env.get('R2_BUCKET') ?? 'saey';
const client = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  service: 's3',
  region: 'auto',
});

function objectUrl(key: string): URL {
  const path = key.split('/').map(encodeURIComponent).join('/');
  return new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path}`);
}

/** رابط مؤقت موقّع للرفع (PUT) أو التحميل (GET) مباشرة من/إلى R2 */
export async function presign(method: 'GET' | 'PUT', key: string, expiresSec = 3600, contentType?: string): Promise<string> {
  const url = objectUrl(key);
  url.searchParams.set('X-Amz-Expires', String(expiresSec));
  const headers: Record<string, string> = {};
  if (method === 'PUT' && contentType) headers['Content-Type'] = contentType;
  const signed = await client.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
  return signed.url;
}

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await client.fetch(objectUrl(key));
  if (!res.ok) throw new Error(`R2 GET ${key} → ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const res = await client.fetch(objectUrl(key), { method: 'PUT', body: body as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': contentType } });
  if (!res.ok) throw new Error(`R2 PUT ${key} → ${res.status}`);
}

export async function deleteObject(key: string): Promise<void> {
  await client.fetch(objectUrl(key), { method: 'DELETE' });
}
