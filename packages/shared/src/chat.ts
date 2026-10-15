import { arDigits, formatDate, formatTime } from './format';

/** حالة الرسالة لمرسلها: أُرسلت ✓ · وصلت ✓✓ · قُرئت ✓✓ (مثل تطبيقات المراسلة) */
export type MessageStatus = 'sent' | 'delivered' | 'read';

/** ما يعرفه الخادم عن كل عضو: آخر قراءة وآخر وصول ووقت الانضمام */
export interface Receipt {
  user_id: string;
  last_read_at: string;
  last_delivered_at: string | null;
  joined_at: string;
}

/** وقت من Postgres أو Realtime («2026-10-15 15:04:03.12+00» أو ISO) ← ميلي ثانية */
export function toMs(t: string | null | undefined): number {
  if (!t) return -Infinity;
  const iso = t.includes('T') ? t : t.replace(' ', 'T');
  const ms = Date.parse(/[+-]\d\d$/.test(iso) ? `${iso}:00` : iso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** من قرأ الرسالة ومن وصلته ومن لم تصله (بلا المرسل، وبلا من انضم بعدها) */
export function messageReaders(createdAt: string, senderId: string, receipts: Receipt[]) {
  const at = toMs(createdAt);
  const read: string[] = [];
  const delivered: string[] = [];
  const waiting: string[] = [];
  for (const r of receipts) {
    if (r.user_id === senderId || toMs(r.joined_at) > at) continue;
    if (toMs(r.last_read_at) >= at) read.push(r.user_id);
    else if (toMs(r.last_delivered_at) >= at) delivered.push(r.user_id);
    else waiting.push(r.user_id);
  }
  return { read, delivered, waiting };
}

/** قُرئت = قرأها كل من كان في المحادثة · وصلت = وصلت للجميع (أو قرأها بعضهم ووصلت للبقية) */
export function messageStatus(createdAt: string, senderId: string, receipts: Receipt[]): MessageStatus {
  const { read, delivered, waiting } = messageReaders(createdAt, senderId, receipts);
  if (!read.length && !delivered.length && !waiting.length) return 'sent';
  if (!delivered.length && !waiting.length) return 'read';
  if (!waiting.length) return 'delivered';
  return 'sent';
}

/** «يكتب…» · «أحمد يكتب…» · «أحمد وعلي يكتبان…» · «أحمد و٣ آخرون يكتبون…» */
export function typingLabel(names: string[], group: boolean): string | null {
  if (!names.length) return null;
  if (!group) return 'يكتب…';
  const first = (n: string) => n.split(' ')[0];
  if (names.length === 1) return `${first(names[0])} يكتب…`;
  if (names.length === 2) return `${first(names[0])} و${first(names[1])} يكتبان…`;
  return `${first(names[0])} و${arDigits(names.length - 1)} آخرون يكتبون…`;
}

/** «متصل الآن» · «آخر ظهور اليوم ١٠:٣٠ م» · «آخر ظهور أمس…» · «آخر ظهور ٥ تشرين الأول» */
export function lastSeenLabel(online: boolean, lastSeen: string | null | undefined, now: Date = new Date()): string | null {
  if (online) return 'متصل الآن';
  if (!lastSeen) return null;
  const d = new Date(toMs(lastSeen));
  if (Number.isNaN(d.getTime())) return null;
  if (now.getTime() - d.getTime() < 60000) return 'آخر ظهور قبل لحظات';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `آخر ظهور اليوم ${formatTime(d)}`;
  if (diff === 1) return `آخر ظهور أمس ${formatTime(d)}`;
  return `آخر ظهور ${formatDate(d)}`;
}
