import type { Attachment, GroupRole, MessageStatus } from '@saey/shared';
import { router } from 'expo-router';
import { openDocumentAt } from './outline';
import { must, supabase } from './supabase';

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
  // من my_conversations_v2 (تبقى فارغة إن كان الخادم أقدم)
  description?: string | null;
  my_role?: GroupRole | null;
  admins_only?: boolean;
  members_can_add?: boolean;
  pinned_message_id?: string | null;
  member_count?: number;
  last_sender_id?: string | null;
  last_kind?: 'text' | 'system' | null;
  /** حالة آخر رسالة إن كانت مني (خاصة ومجموعات) */
  last_status?: MessageStatus | null;
  created_by?: string | null;
}

/** قائمة محادثاتي (النسخة ٢ بالأدوار و«قُرئت»، أو الأولى إن لم يُحدَّث الخادم بعد) */
export async function fetchConversations(): Promise<ConversationRow[]> {
  const v2 = await supabase.rpc('my_conversations_v2');
  if (!v2.error) return (v2.data ?? []) as ConversationRow[];
  if (v2.error.code !== 'PGRST202' && !/my_conversations_v2/.test(v2.error.message)) throw new Error(v2.error.message);
  return must(supabase.rpc('my_conversations')) as Promise<ConversationRow[]>;
}

/** مدير المجموعة: مالكها أو مشرفها (والأدمن والمشرفون العامون للإشراف) */
export const canManage = (c: ConversationRow | null | undefined, isStaff: boolean) =>
  !!c && c.type === 'group' && (isStaff || c.my_role === 'owner' || c.my_role === 'admin');

/** يستطيع الكتابة: قناة الإعلانات للإدارة، و«للمشرفين فقط» لمشرفي المجموعة */
export const canPostIn = (c: ConversationRow | null | undefined, isStaff: boolean) =>
  !c || isStaff || (!c.only_staff_can_post && (!c.admins_only || c.my_role === 'owner' || c.my_role === 'admin'));

/** رابط الدعوة: يفتح التطبيق مباشرة، والموقع يحوّل إليه (أو يعرض الرمز لمن لا يملك التطبيق) */
export const inviteLink = (code: string) => `https://saeyiq.web.app/join/?c=${code}`;

export function conversationTitle(c: ConversationRow) {
  return c.type === 'direct' ? c.peer_name ?? 'محادثة' : c.title ?? 'مجموعة';
}

export const REACTIONS = ['❤️', '👍', '😂', '😮', '🙏'];

/** مرفق من المنهج (محاضرة، ملزمة، أسئلة) */
export type CurriculumAttachment = Extract<Attachment, { type: 'lecture' | 'document' | 'question_set' }>;

/** فتح مرفق: المنهج في شاشته، والإجابة المشاركة وملف PDF داخل التطبيق */
export function openAttachment(a: Attachment, messageId?: string) {
  if (a.type === 'lecture') router.push(a.start ? { pathname: '/lecture/[id]', params: { id: a.id, t: String(a.start) } } : `/lecture/${a.id}`);
  else if (a.type === 'question_set') router.push(`/questions/${a.id}`);
  // الملزمة من المساعد قد تحمل رقم صفحة (start): تُفتح عندها مباشرة في العارض، وإلا شاشتها بفهرسها
  else if (a.type === 'document') { if (a.start) openDocumentAt(a.id, { page: a.start }).catch(() => router.push({ pathname: '/document/[id]', params: { id: a.id } })); else router.push({ pathname: '/document/[id]', params: { id: a.id } }); }
  else if (a.type === 'answer' && messageId) router.push({ pathname: '/answer/[id]', params: { id: messageId } });
  else if (a.type === 'file') router.push({ pathname: '/pdf', params: { key: a.key, title: a.title } });
}

export const ATTACHMENT_LABELS = { lecture: 'محاضرة', document: 'ملزمة', question_set: 'أسئلة', answer: 'من مساعد سعي', file: 'ملف PDF' } as const;

/** البحث يتجاهل الحركات والهمزات والتاء المربوطة والألف المقصورة (أحمد = احمد) */
export const normalizeArabic = (t: string) => t.replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
