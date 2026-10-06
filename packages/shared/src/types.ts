import type { Period } from './grading';

export type Role = 'student' | 'moderator' | 'admin';
export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'banned';
export type DocumentKind = 'malzama' | 'summary' | 'book' | 'other';
export type QuestionKind = 'expected' | 'school_exam';
export type QuestionStatus = 'draft' | 'published';
export type TaskScope = 'personal' | 'section' | 'school';
export type TaskType = 'homework' | 'preparation' | 'exam' | 'other';
export type PostKind = 'news' | 'holiday' | 'exam' | 'urgent';
export type ConversationType = 'school' | 'section' | 'group' | 'direct';
export type ProgressState = 'watched' | 'studied' | 'reviewed';

export interface School { id: string; name: string; grade_label: string }
export interface Section { id: string; school_id: string; name: string; sort: number }
export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  section_id: string | null;
  role: Role;
  status: ProfileStatus;
  is_verified: boolean;
  bio: string | null;
  onboarded: boolean;
  created_at: string;
  last_seen_at: string | null;
}
export interface Subject { id: string; name: string; slug: string; icon: string | null; sort: number }
export interface Book { id: string; subject_id: string; name: string; sort: number }
export interface Chapter { id: string; book_id: string; number: number; title: string; sort: number }
export interface Teacher { id: string; name: string; subject_id: string | null; channel_url: string | null }
export interface Lecture {
  id: string;
  chapter_id: string;
  teacher_id: string | null;
  title: string;
  youtube_id: string;
  duration_sec: number | null;
  sort: number;
  is_published: boolean;
}
export interface DocumentRow {
  id: string;
  subject_id: string;
  chapter_id: string | null;
  teacher_id: string | null;
  kind: DocumentKind;
  title: string;
  file_key: string;
  size_bytes: number | null;
  pages: number | null;
  sort: number;
  is_published: boolean;
  ingested_pages: number;
  ingest_status: 'none' | 'running' | 'done' | 'error';
  ingest_error: string | null;
}
export interface QuestionSet {
  id: string;
  subject_id: string;
  kind: QuestionKind;
  period: Period;
  section_id: string | null;
  title: string;
  source: string | null;
  content_md: string | null;
  pdf_key: string | null;
  scan_keys: string[];
  status: QuestionStatus;
  created_by: string | null;
  created_at: string;
}
export interface Grade { id: string; user_id: string; subject_id: string; period: Period; score: number; note: string | null }
export interface Task {
  id: string;
  scope: TaskScope;
  owner_id: string;
  section_id: string | null;
  subject_id: string | null;
  type: TaskType;
  title: string;
  notes: string | null;
  due_at: string | null;
  remind_at: string | null;
  created_at: string;
}
export interface Post {
  id: string;
  author_id: string;
  kind: PostKind;
  title: string;
  body: string;
  cover_key: string | null;
  section_id: string | null;
  is_pinned: boolean;
  published_at: string;
}
export interface Conversation {
  id: string;
  type: ConversationType;
  section_id: string | null;
  title: string | null;
  only_staff_can_post: boolean;
  created_at: string;
  last_message_at: string | null;
}
export type Attachment =
  | { type: 'image'; key: string; width?: number; height?: number }
  | {
      type: 'lecture' | 'document' | 'question_set';
      id: string;
      title: string;
      /** معرّف فيديو يوتيوب (لصورة المحاضرة المصغرة) */
      thumb?: string;
      /** سطر ثانوي: المادة، الأستاذ، عدد الصفحات… */
      subtitle?: string;
    }
  /** إجابة من مساعد سعي شاركها الطالب (النص كاملاً داخل المرفق) */
  | { type: 'answer'; title: string; body: string }
  /** ملف PDF مرفوع في المحادثة */
  | { type: 'file'; key: string; title: string; size?: number };
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  reply_to_id: string | null;
  attachment: Attachment | null;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}
export interface AiSource { title: string; subject?: string; chapter?: string; page?: number }
export interface AiMessage { id: string; chat_id: string; role: 'user' | 'assistant'; content: string; sources: AiSource[] | null; created_at: string }

export const ROLE_LABELS: Record<Role, string> = { student: 'طالب', moderator: 'مشرف', admin: 'الأدمن' };
export const STATUS_LABELS: Record<ProfileStatus, string> = { pending: 'بانتظار الموافقة', approved: 'معتمد', rejected: 'مرفوض', banned: 'محظور' };
export const TASK_TYPE_LABELS: Record<TaskType, string> = { homework: 'واجب', preparation: 'تحضير', exam: 'امتحان', other: 'أخرى' };
export const POST_KIND_LABELS: Record<PostKind, string> = { news: 'خبر', holiday: 'عطلة', exam: 'امتحان', urgent: 'عاجل' };
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = { malzama: 'ملزمة', summary: 'ملخص', book: 'كتاب', other: 'ملف' };
export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = { expected: 'الأسئلة المتوقعة', school_exam: 'امتحاناتنا' };
