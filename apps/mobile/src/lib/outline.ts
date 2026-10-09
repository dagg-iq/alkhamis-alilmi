import { buildTree, type OutlineNode, type OutlineRow } from '@saey/shared';
import { openPdf, type OpenOptions } from './files';
import { must, supabase } from './supabase';

/** فهرس ملزمة/كتاب: فصول بمواضيعها (فارغ إن لم يُفهرس بعد) */
export async function loadOutline(docId: string): Promise<OutlineNode[]> {
  const rows = await must(supabase.from('document_outline')
    .select('id, document_id, parent_id, level, title, start_page, end_page, sort').eq('document_id', docId)) as OutlineRow[];
  return buildTree(rows);
}

export interface RelatedTopic {
  document_id: string; document_title: string; document_kind: string; outline_id: string; title: string; start_page: number; end_page: number | null; similarity: number;
}

/** نفس الموضوع في كتب/ملازم أخرى للمادة */
export async function loadRelated(outlineId: string): Promise<RelatedTopic[]> {
  const { data, error } = await supabase.rpc('related_topics', { p_outline: outlineId });
  if (error) throw new Error(error.message);
  return (data ?? []) as RelatedTopic[];
}

/** يفتح ملزمة/كتاباً (بمعرّفه) على صفحة أو فصل */
export async function openDocumentAt(docId: string, opts: Omit<OpenOptions, 'docId'> = {}) {
  const doc = await must(supabase.from('documents').select('file_key, title').eq('id', docId).single()) as { file_key: string; title: string };
  await openPdf(doc.file_key, doc.title, { ...opts, docId });
}
