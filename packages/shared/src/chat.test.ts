import { describe, expect, it } from 'vitest';
import { lastSeenLabel, messageReaders, messageStatus, toMs, typingLabel, type Receipt } from './chat';

const r = (user_id: string, read: string, delivered: string | null = null, joined = '2026-10-01T00:00:00Z'): Receipt =>
  ({ user_id, last_read_at: read, last_delivered_at: delivered, joined_at: joined });

describe('toMs', () => {
  it('يقرأ صيغة Postgres وصيغة ISO', () => {
    expect(toMs('2026-10-15 15:04:03.12+00')).toBe(Date.parse('2026-10-15T15:04:03.120Z'));
    expect(toMs('2026-10-15T15:04:03.003382+00:00')).toBe(Date.parse('2026-10-15T15:04:03.003Z'));
    expect(toMs(null)).toBe(-Infinity);
  });
});

describe('messageStatus', () => {
  const at = '2026-10-15T10:00:00Z';
  it('خاصة: أُرسلت ثم وصلت ثم قُرئت', () => {
    expect(messageStatus(at, 'me', [r('me', at), r('peer', '2026-10-15T09:00:00Z')])).toBe('sent');
    expect(messageStatus(at, 'me', [r('me', at), r('peer', '2026-10-15T09:00:00Z', '2026-10-15T10:00:05Z')])).toBe('delivered');
    expect(messageStatus(at, 'me', [r('me', at), r('peer', '2026-10-15T10:01:00Z')])).toBe('read');
  });
  it('مجموعة: قُرئت فقط إذا قرأها الجميع', () => {
    const list = [r('me', at), r('a', '2026-10-15T10:01:00Z'), r('b', '2026-10-15T09:00:00Z', '2026-10-15T10:00:30Z')];
    expect(messageStatus(at, 'me', list)).toBe('delivered');
    expect(messageReaders(at, 'me', list)).toEqual({ read: ['a'], delivered: ['b'], waiting: [] });
    expect(messageStatus(at, 'me', [...list, r('c', '2026-10-15T08:00:00Z')])).toBe('sent');
  });
  it('من انضم بعد الرسالة لا يُحسب', () => {
    expect(messageStatus(at, 'me', [r('me', at), r('a', '2026-10-15T10:01:00Z'), r('new', '2026-10-15T11:00:00Z', null, '2026-10-15T11:00:00Z')])).toBe('read');
  });
  it('وحدي في المجموعة: أُرسلت', () => {
    expect(messageStatus(at, 'me', [r('me', at)])).toBe('sent');
  });
});

describe('typingLabel', () => {
  it('خاصة ومجموعة', () => {
    expect(typingLabel([], true)).toBeNull();
    expect(typingLabel(['حيدر كريم'], false)).toBe('يكتب…');
    expect(typingLabel(['حيدر كريم'], true)).toBe('حيدر يكتب…');
    expect(typingLabel(['حيدر كريم', 'علي حسين'], true)).toBe('حيدر وعلي يكتبان…');
    expect(typingLabel(['حيدر', 'علي', 'زيد', 'حسن'], true)).toBe('حيدر و٣ آخرون يكتبون…');
  });
});

describe('lastSeenLabel', () => {
  const now = new Date(2026, 9, 15, 18, 0);
  it('متصل، اليوم، أمس، قبل ذلك', () => {
    expect(lastSeenLabel(true, null, now)).toBe('متصل الآن');
    expect(lastSeenLabel(false, null, now)).toBeNull();
    expect(lastSeenLabel(false, new Date(2026, 9, 15, 17, 59, 30).toISOString(), now)).toBe('آخر ظهور قبل لحظات');
    expect(lastSeenLabel(false, new Date(2026, 9, 15, 10, 30).toISOString(), now)).toBe('آخر ظهور اليوم ١٠:٣٠ ص');
    expect(lastSeenLabel(false, new Date(2026, 9, 14, 22, 5).toISOString(), now)).toBe('آخر ظهور أمس ١٠:٠٥ م');
    expect(lastSeenLabel(false, new Date(2026, 9, 5, 9).toISOString(), now)).toMatch(/^آخر ظهور ٥ /);
  });
});
