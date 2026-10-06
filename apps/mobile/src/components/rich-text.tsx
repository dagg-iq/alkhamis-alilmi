import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { fonts, useTheme } from '@/lib/theme';
import { HtmlView } from './html-view';
import { T } from './ui';

/**
 * يعرض Markdown مع معادلات LaTeX. النص البسيط يُعرض كنص أصلي (أسرع)،
 * وما فيه معادلات أو جداول يُعرض داخل WebView بخط ثمانية و KaTeX.
 */
export function RichText({ text, size = 16, color, serif }: { text: string; size?: number; color?: string; serif?: boolean }) {
  const needsWeb = /\$|\\\(|\\\[|^\|.*\|$|```/m.test(text);
  if (!needsWeb) return <NativeMarkdown text={text} size={size} color={color} serif={serif} />;
  return <MathWebView text={text} size={size} color={color} />;
}

/** Markdown مبسط: عناوين، نقاط، ترقيم، عريض */
function NativeMarkdown({ text, size, color, serif }: { text: string; size: number; color?: string; serif?: boolean }) {
  const { c } = useTheme();
  const blocks = text.split('\n');
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={i} style={{ height: 4 }} />;
        const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: i ? 8 : 0 }}>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: c.accent }} />
              <T display size={size + (4 - h[1].length) * 2} color={color} style={{ flex: 1 }}>{inline(h[2], c)}</T>
            </View>
          );
        }
        const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
        const num = trimmed.match(/^(\d+|[٠-٩]+)[.)-]\s+(.*)$/);
        if (bullet || num) {
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              {bullet ? (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color ?? c.accent, marginTop: size * 0.75 }} />
              ) : (
                <View style={{ minWidth: size * 1.4, height: size * 1.4, borderRadius: size * 0.7, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center', marginTop: size * 0.2, paddingHorizontal: 4 }}>
                  <T size={size - 4} weight="bold" color={c.softInk}>{arNum(num![1])}</T>
                </View>
              )}
              <T size={size} color={color} serif={serif} style={{ flex: 1 }} selectable>{inline((bullet ?? num)![bullet ? 1 : 2], c)}</T>
            </View>
          );
        }
        if (trimmed.startsWith('>')) {
          return (
            <View key={i} style={{ backgroundColor: c.soft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, borderRightWidth: 4, borderRightColor: c.accent }}>
              <T size={size} color={c.softInk} selectable>{inline(trimmed.replace(/^>\s?/, ''), c)}</T>
            </View>
          );
        }
        if (/^(-{3,}|\*{3,})$/.test(trimmed)) return <View key={i} style={{ height: 1, backgroundColor: c.line, marginVertical: 6 }} />;
        return <T key={i} size={size} color={color} serif={serif} selectable>{inline(trimmed, c)}</T>;
      })}
    </View>
  );
}

const arNum = (n: string) => n.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);

/** عريض **…** وتظليل ==…== (مثل قلم التحديد في الملزمة) */
function inline(s: string, c: { highlight: string }) {
  const parts = s.split(/(\*\*[^*]+\*\*|==[^=]+==)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <Text key={i} style={{ fontFamily: fonts.bold }}>{p.slice(2, -2)}</Text>;
    if (p.startsWith('==') && p.endsWith('==') && p.length > 4) return <Text key={i} style={{ fontFamily: fonts.bold, backgroundColor: c.highlight }}>{p.slice(2, -2)}</Text>;
    return p;
  });
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML كامل لعرض/طباعة Markdown + LaTeX (يُستخدم أيضاً لتصدير PDF) */
export function markdownHtml(text: string, opts: { color: string; bg: string; accent: string; size: number; title?: string; footer?: string; highlight?: string }) {
  const mark = opts.highlight ?? '#FFE58A';
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap">
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<style>
body{margin:0;padding:${opts.title ? '32px' : '0'};background:${opts.bg};color:${opts.color};font-family:'Sans','IBM Plex Sans Arabic',sans-serif;font-size:${opts.size}px;line-height:1.85;word-wrap:break-word}
h1,h2,h3{line-height:1.35;margin:.9em 0 .35em;font-weight:700} h1{font-size:1.45em} h2{font-size:1.25em} h3{font-size:1.1em}
h1,h2{border-right:5px solid ${opts.accent};padding-right:.5em}
p{margin:.35em 0} ul,ol{padding-right:1.4em;margin:.3em 0} ol{list-style-type:arabic-indic} li{margin:.25em 0} li::marker{color:${opts.accent};font-weight:700}
strong{font-weight:700}
mark{background:${mark};color:inherit;padding:0 .2em;border-radius:4px;font-weight:700}
table{border-collapse:collapse;width:100%;margin:.6em 0;font-size:.95em} td,th{border:1px solid ${opts.accent}33;padding:6px 8px} th{background:${opts.accent}14}
code{background:${opts.accent}14;padding:1px 5px;border-radius:5px}
blockquote{margin:.6em 0;padding:.55em 1em;background:${opts.accent}12;border-right:4px solid ${opts.accent};border-radius:12px;page-break-inside:avoid}
blockquote p{margin:.2em 0}
hr{border:0;border-top:1px solid ${opts.accent}33;margin:1em 0}
.katex{font-size:1.08em;direction:ltr;unicode-bidi:isolate} .katex-display{overflow-x:auto;overflow-y:hidden;direction:ltr;padding:8px 6px;margin:.5em 0;background:${opts.accent}0d;border-radius:12px}
.title{font-size:1.5em;font-weight:700;margin-bottom:.2em;line-height:1.4}
.meta{opacity:.55;font-size:.85em;margin-bottom:1.2em;padding-bottom:.8em;border-bottom:2px solid ${opts.accent}}
@page{margin:16mm 14mm}
</style></head><body>
${opts.title ? `<div class="title">${escapeHtml(opts.title)}</div><div class="meta">${escapeHtml(opts.footer ?? 'سعي')}</div>` : ''}
<div id="c"></div>
<script>
var src=${JSON.stringify(text).replace(/</g, '\\u003c')};
// بدون إنترنت (لم تُحمّل المكتبات): نعرض النص كما هو بدل صفحة فارغة
if(typeof marked==='undefined'){var el=document.getElementById('c');el.style.whiteSpace='pre-wrap';el.textContent=src;}else{
// نحمي المعادلات من معالج Markdown
var maths=[];src=src.replace(/\\$\\$[\\s\\S]+?\\$\\$|\\$[^$\\n]+?\\$/g,function(m){maths.push(m);return '@@M'+(maths.length-1)+'@@';});
src=src.replace(/==([^=\\n]+)==/g,'<mark>$1</mark>');
var html=marked.parse(src,{breaks:true});
html=html.replace(/@@M(\\d+)@@/g,function(_,i){return maths[+i].replace(/&/g,'&amp;').replace(/</g,'&lt;');});
document.getElementById('c').innerHTML=html;
if(typeof renderMathInElement!=='undefined')renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\\\(',right:'\\\\)',display:false},{left:'\\\\[',right:'\\\\]',display:true}],throwOnError:false});
}
function post(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight));}
post();setTimeout(post,300);setTimeout(post,1200);
</script></body></html>`;
}

function MathWebView({ text, size, color }: { text: string; size: number; color?: string }) {
  const { c } = useTheme();
  const html = useMemo(
    () => markdownHtml(text, { color: color ?? c.ink, bg: 'transparent', accent: c.accent, size, highlight: c.highlight }),
    [text, color, c.ink, c.accent, c.highlight, size],
  );
  return <HtmlView html={html} />;
}
