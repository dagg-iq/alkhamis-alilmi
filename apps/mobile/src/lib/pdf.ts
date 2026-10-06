import type { Attachment } from '@saey/shared';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { markdownHtml } from '@/components/rich-text';
import { supabase } from './supabase';

/** اسم ملف آمن من عنوان عربي */
export function pdfName(title: string) {
  return `${title.replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'سعي'}.pdf`;
}

/** يحوّل إجابة أو أسئلة (Markdown) إلى ملف PDF على الهاتف */
export async function markdownPdf(content: string, title: string, meta?: string): Promise<File> {
  const html = markdownHtml(content, { color: '#111111', bg: '#FFFFFF', accent: '#2346F5', size: 15, title, footer: meta ?? 'سعي' });
  // A4 بالنقاط
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const dest = new File(Paths.cache, pdfName(title));
  if (dest.exists) dest.delete();
  await new File(uri).copy(dest);
  return dest;
}

/** إرسال مرفق إلى محادثة (مجموعة أو شخص) */
export async function sendAttachment(conversationId: string, senderId: string, attachment: Attachment) {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId, sender_id: senderId, body: null, attachment, mentions: [],
  });
  if (error) throw new Error(error.message);
}
