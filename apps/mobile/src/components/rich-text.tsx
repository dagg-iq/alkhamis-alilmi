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
        if (h) return <T key={i} display size={size + (4 - h[1].length) * 3} color={color}>{inline(h[2])}</T>;
        const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
        const num = trimmed.match(/^(\d+|[٠-٩]+)[.)-]\s+(.*)$/);
        if (bullet || num) {
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <T size={size} color={color ?? c.accent} weight="bold">{bullet ? '•' : `${num![1]}.`}</T>
              <T size={size} color={color} serif={serif} style={{ flex: 1 }} selectable>{inline((bullet ?? num)![bullet ? 1 : 2])}</T>
            </View>
          );
        }
        if (trimmed.startsWith('>')) {
          return (
            <View key={i} style={{ backgroundColor: c.soft, borderRadius: 12, padding: 10 }}>
              <T size={size - 1} color={c.softInk}>{inline(trimmed.replace(/^>\s?/, ''))}</T>
            </View>
          );
        }
        return <T key={i} size={size} color={color} serif={serif} selectable>{inline(trimmed)}</T>;
      })}
    </View>
  );
}

function inline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <Text key={i} style={{ fontFamily: fonts.bold }}>{p.slice(2, -2)}</Text> : p,
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML كامل لعرض/طباعة Markdown + LaTeX (يُستخدم أيضاً لتصدير PDF) */
export function markdownHtml(text: string, opts: { color: string; bg: string; accent: string; size: number; title?: string }) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap">
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<style>
body{margin:0;padding:${opts.title ? '32px' : '0'};background:${opts.bg};color:${opts.color};font-family:'Sans','IBM Plex Sans Arabic',sans-serif;font-size:${opts.size}px;line-height:1.85;word-wrap:break-word}
h1,h2,h3{line-height:1.3;margin:.6em 0 .3em} h1{font-size:1.5em} h2{font-size:1.3em} h3{font-size:1.1em}
p{margin:.35em 0} ul,ol{padding-right:1.3em;margin:.3em 0} li{margin:.2em 0}
table{border-collapse:collapse;width:100%;margin:.5em 0} td,th{border:1px solid ${opts.accent}33;padding:6px}
code{background:${opts.accent}14;padding:1px 5px;border-radius:5px}
blockquote{margin:.5em 0;padding:.5em .9em;background:${opts.accent}14;border-radius:10px}
.katex{font-size:1.08em} .katex-display{overflow-x:auto;overflow-y:hidden;direction:ltr;padding:4px 0}
.title{font-size:1.6em;font-weight:700;margin-bottom:.6em}
</style></head><body>
${opts.title ? `<div class="title">${escapeHtml(opts.title)}</div>` : ''}
<div id="c"></div>
<script>
var src=${JSON.stringify(text).replace(/</g, '\\u003c')};
// نحمي المعادلات من معالج Markdown
var maths=[];src=src.replace(/\\$\\$[\\s\\S]+?\\$\\$|\\$[^$\\n]+?\\$/g,function(m){maths.push(m);return '@@M'+(maths.length-1)+'@@';});
var html=marked.parse(src,{breaks:true});
html=html.replace(/@@M(\\d+)@@/g,function(_,i){return maths[+i].replace(/&/g,'&amp;').replace(/</g,'&lt;');});
document.getElementById('c').innerHTML=html;
renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\\\(',right:'\\\\)',display:false},{left:'\\\\[',right:'\\\\]',display:true}],throwOnError:false});
function post(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight));}
post();setTimeout(post,300);setTimeout(post,1200);
</script></body></html>`;
}

function MathWebView({ text, size, color }: { text: string; size: number; color?: string }) {
  const { c } = useTheme();
  const html = useMemo(
    () => markdownHtml(text, { color: color ?? c.ink, bg: 'transparent', accent: c.accent, size }),
    [text, color, c.ink, c.accent, size],
  );
  return <HtmlView html={html} />;
}
