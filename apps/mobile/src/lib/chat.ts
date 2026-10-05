import type { Attachment } from '@saey/shared';
import { router } from 'expo-router';

export interface ConversationRow {
  id: string;
  type: 'school' | 'section' | 'group' | 'direct';
  title: string | null;
  only_staff_can_post: boolean;
  last_message_at: string | null;
  last_body: string | null;
  last_sender: string | null;
  unread: number;
  muted: boolean;
  peer_id: string | null;
  peer_name: string | null;
  peer_avatar: string | null;
  peer_verified: boolean | null;
}

export function conversationTitle(c: ConversationRow) {
  return c.type === 'direct' ? c.peer_name ?? 'محادثة' : c.title ?? 'مجموعة';
}

export const REACTIONS = ['❤️', '👍', '😂', '😮', '🙏'];

/** فتح مرفق من المنهج */
export function openAttachment(a: Attachment) {
  if (a.type === 'lecture') router.push(`/lecture/${a.id}`);
  else if (a.type === 'question_set') router.push(`/questions/${a.id}`);
  else if (a.type === 'document') router.push({ pathname: '/document/[id]', params: { id: a.id } });
}

export const ATTACHMENT_LABELS = { lecture: 'محاضرة', document: 'ملزمة', question_set: 'أسئلة' } as const;
