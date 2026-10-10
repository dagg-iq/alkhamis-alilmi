import type { Attachment } from '@saey/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { markdownPage, needsHtml, splitTokens, type Token } from '@/lib/markdown';
import { supabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { AttachmentCard } from './attachment-card';
import { HtmlView } from './html-view';
import { Icon, LogoMark, type IconName } from './icon';
import { T } from './ui';

/**
 * يعرض Markdown مع معادلات LaTeX، وبطاقات داخل الإجابة (محاضرة، ملزمة، التواصل مع المطور).
 * النص البسيط يُعرض كنص أصلي (أسرع)، وما فيه معادلات أو جداول أو شعر أو آيات يُعرض كصفحة HTML جاهزة.
 */
export function RichText({ text, size = 16, color, serif, renderToken }: {
  text: string; size?: number; color?: string; serif?: boolean;
  /** رموز يعرضها المستدعي بنفسه (مثل بطاقة PDF في المساعد) */
  renderToken?: (t: Token) => ReactNode;
}) {
  const tokens = useMemo(() => splitTokens(text), [text]);
  return (
    <View style={{ gap: 10 }}>
      {tokens.map((t, i) => {
        if (t.kind === 'md') {
          return needsHtml(t.text)
            ? <MathWebView key={i} text={t.text} size={size} color={color} />
            : <NativeMarkdown key={i} text={t.text} size={size} color={color} serif={serif} />;
        }
        if (t.kind === 'item') return <LinkedItem key={i} type={t.type} id={t.id} start={t.start} />;
        if (t.kind === 'developer') return <DeveloperCard key={i} />;
        return <View key={i}>{renderToken?.(t) ?? null}</View>;
      })}
    </View>
  );
}

// أول حرف قوي في السطر: لاتيني ← السطر من اليسار (جمل الإنكليزية)
const isLtr = (s: string) => {
  const m = s.replace(/\*\*|==|\[|\]\([^)]*\)/g, '').match(/[A-Za-z؀-ۿ]/);
  return !!m && /[A-Za-z]/.test(m[0]);
};

/** Markdown مبسط: عناوين، نقاط، ترقيم، عريض، تظليل، روابط، صناديق */
function NativeMarkdown({ text, size, color, serif }: { text: string; size: number; color?: string; serif?: boolean }) {
  const { c } = useTheme();
  const blocks = text.split('\n');
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={i} style={{ height: 4 }} />;
        const ltr = isLtr(trimmed);
        const dir = ltr ? { writingDirection: 'ltr' as const, textAlign: 'left' as const } : null;
        const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: i ? 8 : 0 }}>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: c.accent }} />
              <T display size={size + Math.max(0, 4 - h[1].length) * 2} color={color} style={[{ flex: 1 }, dir]}>{inline(h[2], c)}</T>
            </View>
          );
        }
        const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
        const num = trimmed.match(/^(\d+|[٠-٩]+)[.)-]\s+(.*)$/);
        if (bullet || num) {
          return (
            <View key={i} style={{ flexDirection: ltr ? 'row-reverse' : 'row', gap: 10, alignItems: 'flex-start' }}>
              {bullet ? (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color ?? c.accent, marginTop: size * 0.75 }} />
              ) : (
                <View style={{ minWidth: size * 1.4, height: size * 1.4, borderRadius: size * 0.7, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center', marginTop: size * 0.2, paddingHorizontal: 4 }}>
                  <T size={size - 4} weight="bold" color={c.softInk}>{arNum(num![1])}</T>
                </View>
              )}
              <T size={size} color={color} serif={serif} style={[{ flex: 1 }, dir]} selectable>{inline((bullet ?? num)![bullet ? 1 : 2], c)}</T>
            </View>
          );
        }
        if (trimmed.startsWith('>')) {
          return (
            <View key={i} style={{ backgroundColor: c.soft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, borderRightWidth: 4, borderRightColor: c.accent }}>
              <T size={size} color={c.softInk} style={dir} selectable>{inline(trimmed.replace(/^>\s?/, ''), c)}</T>
            </View>
          );
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return <View key={i} style={{ height: 1, backgroundColor: c.line, marginVertical: 6 }} />;
        return <T key={i} size={size} color={color} serif={serif} style={dir} selectable>{inline(trimmed, c)}</T>;
      })}
    </View>
  );
}

const arNum = (n: string) => n.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** عريض **…**، تظليل ==…== (مثل قلم التحديد في الملزمة)، وروابط [نص](رابط) */
function inline(s: string, c: { highlight: string; accent: string }) {
  const parts = s.split(/(\*\*[^*]+\*\*|==[^=]+==|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <Text key={i} style={{ fontFamily: fonts.bold }}>{p.slice(2, -2)}</Text>;
    if (p.startsWith('==') && p.endsWith('==') && p.length > 4) return <Text key={i} style={{ fontFamily: fonts.bold, backgroundColor: c.highlight }}>{p.slice(2, -2)}</Text>;
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) {
      return (
        <Text key={i} onPress={() => Linking.openURL(link[2]).catch(() => {})} style={{ color: c.accent, textDecorationLine: 'underline' }}>{link[1]}</Text>
      );
    }
    return p;
  });
}

/** HTML كامل لطباعة Markdown + LaTeX إلى PDF (بلا JavaScript) */
export function markdownHtml(text: string, opts: { color: string; bg: string; accent: string; size: number; title?: string; footer?: string }) {
  const md = splitTokens(text).map((t) => (t.kind === 'md' ? t.text : '')).filter(Boolean).join('\n\n');
  return markdownPage(md, { ...opts, meta: opts.footer, print: true });
}

function MathWebView({ text, size, color }: { text: string; size: number; color?: string }) {
  const { c } = useTheme();
  const html = useMemo(
    () => markdownPage(text, { color: color ?? c.ink, bg: 'transparent', accent: c.accent, soft: c.soft, size, highlight: c.highlight, reportHeight: true }),
    [text, color, c.ink, c.accent, c.soft, c.highlight, size],
  );
  return <HtmlView html={html} />;
}

// ---------------------------------------------------------------- البطاقات داخل الإجابة
type Linked = Exclude<Attachment, { type: 'image' | 'answer' | 'file' }>;

/** محاضرة أو ملزمة أو أسئلة من فهرس التطبيق: تُجلب تفاصيلها وتظهر كبطاقة تُفتح بضغطة */
function LinkedItem({ type, id, start }: { type: Linked['type']; id: string; start?: number }) {
  const { c } = useTheme();
  const [item, setItem] = useState<Linked | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    (async () => {
      let a: Linked | null = null;
      if (type === 'lecture') {
        const { data } = await supabase.from('lectures').select('id, title, youtube_id, teachers(name), chapters(number, title)').eq('id', id).maybeSingle();
        const d = data as { title: string; youtube_id: string | null; teachers: { name: string } | null; chapters: { number: number; title: string } | null } | null;
        if (d) {
          a = {
            type, id, title: d.title, thumb: d.youtube_id ?? undefined, start,
            subtitle: [
              start ? `من الدقيقة ${arNum(clock(start))}` : null,
              d.teachers?.name ? `الأستاذ ${d.teachers.name}` : null,
              !start && d.chapters ? `الفصل ${arNum(String(d.chapters.number))} · ${d.chapters.title}` : null,
            ].filter(Boolean).join(' · '),
          };
        }
      } else if (type === 'document') {
        const { data } = await supabase.from('documents').select('id, title, pages, subjects(name)').eq('id', id).maybeSingle();
        const d = data as { title: string; pages: number | null; subjects: { name: string } | null } | null;
        if (d) a = { type, id, title: d.title, start, subtitle: [start ? `افتح عند صفحة ${arNum(String(start))}` : null, d.subjects?.name, !start && d.pages ? `${arNum(String(d.pages))} صفحة` : null].filter(Boolean).join(' · ') };
      } else {
        const { data } = await supabase.from('question_sets').select('id, title, subjects(name)').eq('id', id).maybeSingle();
        const d = data as { title: string; subjects: { name: string } | null } | null;
        if (d) a = { type, id, title: d.title, subtitle: d.subjects?.name };
      }
      if (alive) setItem(a);
    })().catch(() => alive && setItem(null));
    return () => { alive = false; };
  }, [type, id, start]);

  if (item === undefined) return <View style={{ width: 248, height: type === 'lecture' ? 196 : 74, borderRadius: 16, backgroundColor: c.soft }} />;
  if (!item) return <T dim size={13}>(هذا المحتوى لم يعد موجوداً)</T>;
  return <AttachmentCard a={item} mine={false} />;
}

const DEVELOPER_LINKS: { icon: IconName; label: string; url: string; color: string }[] = [
  { icon: 'whatsapp', label: 'واتساب', url: 'https://wa.me/9647771821250', color: '#25D366' },
  { icon: 'telegram', label: 'تلغرام', url: 'https://t.me/dagg_iq', color: '#229ED9' },
  { icon: 'instagram', label: 'إنستغرام', url: 'https://instagram.com/tiipf', color: '#E1306C' },
  { icon: 'facebook', label: 'فيسبوك', url: 'https://www.facebook.com/mohammed.al.ahmed.23957', color: '#1877F2' },
];

// حساب المطوّر داخل التطبيق (أدمن باسم «محمد حازم…»): للانتقال إلى ملفه من البطاقة ولعرض البطاقة في ملفه
let devId: Promise<string | null> | null = null;
export function developerProfileId(): Promise<string | null> {
  devId ??= Promise.resolve(supabase.from('profiles').select('id').eq('role', 'admin').ilike('full_name', 'محمد حازم%').order('created_at').limit(1))
    .then(({ data }) => (data?.[0]?.id as string | undefined) ?? null)
    .catch(() => { devId = null; return null; });
  return devId;
}
export function useDeveloperId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { developerProfileId().then(setId); }, []);
  return id;
}

/** بطاقة المطوّر: ترويسة بلون سعي، الاسم والصف، وروابط التواصل بألوان كل منصة. linkName: الضغط على الاسم يفتح ملفه في التطبيق */
export function DeveloperCard({ linkName = true }: { linkName?: boolean } = {}) {
  const { c } = useTheme();
  const dev = useDeveloperId();
  const openProfile = linkName && dev ? () => router.push(`/profile/${dev}`) : undefined;
  return (
    <View style={{ borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: c.line, backgroundColor: c.card, maxWidth: 380 }}>
      <View style={{ backgroundColor: c.heroBg, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable style={{ flex: 1 }} onPress={openProfile} disabled={!openProfile} accessibilityRole={openProfile ? 'link' : undefined} accessibilityLabel="ملف محمد حازم احمد في سعي">
          <T size={12} color={c.heroInk2}>صانع التطبيق</T>
          <T display size={22} color={c.heroInk} style={openProfile ? { textDecorationLine: 'underline' } : undefined}>محمد حازم احمد</T>
          {openProfile ? <T size={11} color={c.heroInk2}>اضغط على الاسم لفتح ملفه في سعي</T> : null}
        </Pressable>
        <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <LogoMark size={32} ink={c.heroInk} dot={c.heroInk2} />
        </View>
      </View>
      <View style={{ marginTop: -14, marginHorizontal: 12, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="book" size={16} color={c.accent} />
        <T size={12} weight="bold" style={{ flex: 1 }}>طالب في الخامس العلمي · إعدادية الشهاب للبنين</T>
      </View>
      <View style={{ padding: 12, gap: 8 }}>
        <T dim size={12}>عندك فكرة أو وجدت خطأ؟ راسلني مباشرة:</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DEVELOPER_LINKS.map((l) => (
            <Pressable key={l.url} onPress={() => Linking.openURL(l.url).catch(() => {})} accessibilityRole="link" accessibilityLabel={l.label}
              style={({ pressed }) => ({ flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 12, borderRadius: 14,
                backgroundColor: `${l.color}1A`, borderWidth: 1, borderColor: `${l.color}40`, opacity: pressed ? 0.7 : 1 })}>
              <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: l.color, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={l.icon} size={16} color="#FFFFFF" />
              </View>
              <T size={14} weight="bold">{l.label}</T>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
