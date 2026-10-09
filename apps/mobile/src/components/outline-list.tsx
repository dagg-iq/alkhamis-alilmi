import { arDigits, type OutlineNode, type OutlineRow } from '@saey/shared';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { loadRelated, openDocumentAt, type RelatedTopic } from '@/lib/outline';
import { useTheme } from '@/lib/theme';
import { Icon } from './icon';
import { PressScale } from './motion';
import { T } from './ui';

const pages = (a: number, b: number | null) => (b && b !== a ? `ص ${arDigits(a)}–${arDigits(b)}` : `ص ${arDigits(a)}`);

/**
 * فهرس الفصول والمواضيع: الضغط على فصل يفتحه مباشرة، وعلى موضوع يفتحه داخل فصله،
 * وزر الربط يعرض الموضوع نفسه في الكتب والملازم الأخرى.
 */
export function OutlineList({ nodes, onChapter, onTopic, currentPage, compact }: {
  nodes: OutlineNode[];
  onChapter: (c: OutlineNode) => void;
  onTopic: (t: OutlineRow, c: OutlineNode) => void;
  currentPage?: number;
  compact?: boolean;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [rel, setRel] = useState<Record<string, RelatedTopic[] | 'loading' | 'none'>>({});

  const toggleRel = async (id: string) => {
    if (rel[id] && rel[id] !== 'loading') { setRel((r) => { const n = { ...r }; delete n[id]; return n; }); return; }
    setRel((r) => ({ ...r, [id]: 'loading' }));
    try {
      const list = await loadRelated(id);
      setRel((r) => ({ ...r, [id]: list.length ? list : 'none' }));
    } catch {
      setRel((r) => ({ ...r, [id]: 'none' }));
    }
  };

  // فتح الموضوع في ملف آخر (قد يحتاج تحميل الملف أول مرة)
  const [opening, setOpening] = useState<string | null>(null);
  const openRelated = async (x: RelatedTopic) => {
    if (opening) return;
    setOpening(x.outline_id);
    try { await openDocumentAt(x.document_id, { page: x.start_page }); } catch (e) { Alert.alert('تعذّر فتح الملف', e instanceof Error ? e.message : 'تأكد من الإنترنت وحاول مرة أخرى.'); }
    setOpening(null);
  };

  const inChapter = (n: OutlineNode) => currentPage !== undefined && currentPage >= n.start_page && currentPage <= (n.end_page ?? Infinity);

  return (
    <View style={{ gap: 10 }}>
      {nodes.map((ch, i) => {
        const expanded = open[ch.id] ?? (compact ? inChapter(ch) : false);
        const active = inChapter(ch);
        return (
          <View key={ch.id} style={{ borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: active ? c.accent : c.line, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <PressScale onPress={() => onChapter(ch)} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`فتح الفصل: ${ch.title}`}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: active ? c.accent : c.soft, alignItems: 'center', justifyContent: 'center' }}>
                  <T display size={18} color={active ? '#FFFFFF' : c.accent}>{arDigits(i + 1)}</T>
                </View>
                <View style={{ flex: 1 }}>
                  <T weight="bold" size={15} lines={2}>{ch.title}</T>
                  <T dim size={12}>{pages(ch.start_page, ch.end_page)}{ch.topics.length ? ` · ${arDigits(ch.topics.length)} موضوع` : ''}</T>
                </View>
              </PressScale>
              {ch.topics.length ? (
                <Pressable onPress={() => setOpen((o) => ({ ...o, [ch.id]: !expanded }))} accessibilityLabel={expanded ? 'إخفاء المواضيع' : 'عرض المواضيع'} hitSlop={8}
                  style={{ width: 48, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={expanded ? 'up' : 'down'} size={20} color={c.ink2} />
                </Pressable>
              ) : null}
            </View>
            {expanded ? (
              <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 4 }}>
                {ch.topics.map((t) => {
                  const here = currentPage !== undefined && currentPage >= t.start_page && currentPage <= (t.end_page ?? t.start_page);
                  const r = rel[t.id];
                  return (
                    <View key={t.id}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingStart: 14 }}>
                        <PressScale onPress={() => onTopic(t, ch)} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`فتح الموضوع: ${t.title}`}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: here ? c.accent : c.ink3 }} />
                          <T size={14} weight={here ? 'bold' : 'medium'} color={here ? c.accent : c.ink} lines={2} style={{ flex: 1 }}>{t.title}</T>
                          <T dim size={12}>{arDigits(t.start_page)}</T>
                        </PressScale>
                        <Pressable onPress={() => toggleRel(t.id)} accessibilityLabel="نفس الموضوع في الكتب والملازم الأخرى" hitSlop={6}
                          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="link" size={17} color={r ? c.accent : c.ink3} />
                        </Pressable>
                      </View>
                      {r === 'loading' ? <ActivityIndicator color={c.accent} style={{ paddingVertical: 8 }} /> : null}
                      {r === 'none' ? <T dim size={12} style={{ paddingHorizontal: 30, paddingBottom: 8 }}>لا يوجد هذا الموضوع في ملف آخر مفهرس لهذه المادة.</T> : null}
                      {Array.isArray(r) ? (
                        <View style={{ paddingHorizontal: 22, paddingBottom: 8, gap: 6 }}>
                          {r.map((x) => (
                            <PressScale key={x.outline_id} onPress={() => openRelated(x)} scaleTo={0.97}
                              accessibilityRole="button" accessibilityLabel={`${x.document_title} صفحة ${x.start_page}`}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: c.soft }}>
                              <Icon name="file" size={18} color={c.accent} />
                              <View style={{ flex: 1 }}>
                                <T size={13} weight="bold" color={c.softInk} lines={1}>{x.document_title}</T>
                                <T size={12} color={c.softInk} lines={1}>{x.title} · ص {arDigits(x.start_page)}</T>
                              </View>
                              {opening === x.outline_id ? <ActivityIndicator color={c.accent} /> : <Icon name="forward" size={16} color={c.softInk} />}
                            </PressScale>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
