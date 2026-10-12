import katex from 'katex';
import { KATEX_INLINE_CSS } from './katex-css';
import 'katex/contrib/mhchem';
import { Marked } from 'marked';
import { isSafeUrl, sanitizeHtml } from '@saey/shared';

/**
 * تحويل إجابات المساعد والأسئلة (Markdown + LaTeX) إلى HTML جاهز داخل التطبيق نفسه.
 * لا نعتمد على JavaScript داخل الصفحة: طباعة PDF في أندرويد تعمل بلا JavaScript،
 * فكانت الصفحة تخرج فارغة إلا العنوان. الآن المعادلات والتنسيق محسوبة مسبقاً.
 */

export type Token =
  | { kind: 'md'; text: string }
  | { kind: 'item'; type: 'lecture' | 'document' | 'question_set'; id: string; start?: number }
  | { kind: 'developer' }
  | { kind: 'pdf'; of: string };

const TOKEN = /^\s*\[\[(lecture|document|question_set|developer|pdf)(?::([\w-]+))?(?:@(\d+))?\]\]\s*$/;

/** يفصل الرموز الخاصة (بطاقة محاضرة، بطاقة المطور…) عن النص، كل رمز في سطر مستقل */
export function splitTokens(text: string): Token[] {
  const out: Token[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join('\n').trim();
    if (t) out.push({ kind: 'md', text: t });
    buf = [];
  };
  for (const line of text.split('\n')) {
    const m = line.match(TOKEN);
    if (!m) { buf.push(line); continue; }
    flush();
    if (m[1] === 'developer') out.push({ kind: 'developer' });
    else if (m[1] === 'pdf' && m[2]) out.push({ kind: 'pdf', of: m[2] });
    else if (m[2]) out.push({ kind: 'item', type: m[1] as 'lecture' | 'document' | 'question_set', id: m[2], start: m[3] ? Number(m[3]) : undefined });
  }
  flush();
  return out;
}

/** هل يحتاج النص عرض HTML (معادلات، جداول، شعر، آيات…) أم يكفيه العرض الأصلي الأسرع؟ */
export function needsHtml(text: string): boolean {
  return /\$|\\\(|\\\[|^\s*\|.*\|\s*$|```/m.test(text);
}

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Markdown آمن: النص قد يكتبه طالب آخر (إجابة مشاركة في الدردشة)، فلا يمر HTML خام إلا وسوم التنسيق
 * (التظليل <mark> وأمثاله)، والروابط والصور بمخطط ويب فقط — وإلا يُعرض النص وحده.
 */
const md = new Marked({
  breaks: true,
  async: false,
  renderer: {
    html: (html) => sanitizeHtml(html),
    link: (href, _title, text) => (isSafeUrl(href) ? false : text),
    image: (href, _title, text) => (isSafeUrl(href) ? false : esc(text)),
  },
});

const decodeEntities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** يحسب المعادلات $...$ و $$...$$ في نصوص HTML جاهز فقط (لا داخل الوسوم) */
export function renderMath(html: string): string {
  return html.split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith('<')) return part;
    return part
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => tex(decodeEntities(t), true))
      .replace(/\$([^$\n]+?)\$/g, (_, t) => tex(decodeEntities(t), false));
  }).join('');
}

export function tex(src: string, display: boolean) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
  } catch {
    return `<code>${esc(src)}</code>`;
  }
}

const POEM = /^(شعر|poem|أبيات|ابيات)$/;
const QURAN = /^(قرآن|قران|quran|آية|اية)$/;
const HADITH = /^(حديث|hadith)$/;

function poemHtml(body: string) {
  const rows = body.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [a, b] = l.split(/\s*(?:\/\/|\||…|\.\.\.)\s*/);
    return b !== undefined
      ? `<div class="bait"><span class="shatr">${esc(a)}</span><span class="shatr">${esc(b)}</span></div>`
      : `<div class="bait one"><span class="shatr">${esc(a)}</span></div>`;
  });
  return `<div class="poem">${rows.join('')}</div>`;
}

function quranHtml(body: string) {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  let basmala = '';
  if (lines[0] && /بسم\s*الله|بِسْمِ/.test(lines[0]) && lines[0].length < 60) basmala = lines.shift()!;
  let ref = '';
  const last = lines[lines.length - 1];
  if (last && /^[([﴿]?.{2,30}[:：]\s*[\d٠-٩]+.*[)\]﴾]?$/.test(last) && last.length < 40) ref = lines.pop()!.replace(/^[([]|[)\]]$/g, '');
  return `<div class="quran">${basmala ? `<div class="basmala">${esc(basmala)}</div>` : ''}`
    + `<div class="ayat">﴿ ${lines.map(esc).join(' ')} ﴾</div>`
    + `${ref ? `<div class="ref">${esc(ref)}</div>` : ''}<div class="sadaq">صدق الله العظيم</div></div>`;
}

function hadithHtml(body: string) {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const narrator = lines.length > 1 && lines[lines.length - 1].length < 50 ? lines.pop() : '';
  return `<div class="hadith"><div class="h-text">${lines.map(esc).join('<br>')}</div>${narrator ? `<div class="ref">${esc(narrator)}</div>` : ''}</div>`;
}

/** Markdown + LaTeX ← HTML (جسم الصفحة فقط) */
export function renderMarkdown(src: string): string {
  const keep: string[] = [];
  const hold = (html: string) => `\uE000${keep.push(html) - 1}\uE001`;
  let s = src.replace(/\r/g, '');

  // كتل خاصة: الشعر، الآيات، الأحاديث (وبقية الكتل البرمجية كما هي)
  s = s.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, lang: string, body: string) => {
    const l = lang.trim();
    if (POEM.test(l)) return `\n\n${hold(poemHtml(body))}\n\n`;
    if (QURAN.test(l)) return `\n\n${hold(quranHtml(body))}\n\n`;
    if (HADITH.test(l)) return `\n\n${hold(hadithHtml(body))}\n\n`;
    return `\n\n${hold(`<pre dir="ltr"><code>${esc(body)}</code></pre>`)}\n\n`;
  });
  // المعادلات قبل Markdown حتى لا يعبث بها
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => hold(tex(m.trim(), true)));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => hold(tex(m.trim(), true)));
  s = s.replace(/\\\((.+?)\\\)/g, (_, m: string) => hold(tex(m, false)));
  s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre: string, m: string) => pre + hold(tex(m, false)));
  // التظليل ==نص==
  s = s.replace(/==([^=\n]+)==/g, (_, m: string) => `<mark>${m}</mark>`);

  let html = md.parse(s) as string;
  // اتجاه كل فقرة حسب أول حرف فيها: الجمل الإنكليزية من اليسار
  html = html.replace(/<(p|li|h[1-6]|td|th)>/g, '<$1 dir="auto">');
  // روابط تفتح خارج الصفحة
  html = html.replace(/<a href=/g, '<a target="_blank" rel="noopener" href=');
  // كتلة وحدها داخل فقرة: نزيل الفقرة
  html = html.replace(/<p dir="auto">\uE000(\d+)\uE001<\/p>/g, (_, i: string) => keep[+i]);
  return html.replace(/\uE000(\d+)\uE001/g, (_, i: string) => keep[+i]);
}

export interface PageOptions {
  color: string;
  bg: string;
  accent: string;
  soft?: string;
  highlight?: string;
  size: number;
  title?: string;
  meta?: string;
  /** يرسل ارتفاع الصفحة للتطبيق (للعرض داخل المحادثة) */
  reportHeight?: boolean;
  print?: boolean;
}

export const PAGE_FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&family=Amiri:wght@400;700&family=Amiri+Quran&display=swap';

/** صفحة HTML كاملة: للعرض داخل التطبيق وللتصدير PDF */
export function markdownPage(text: string, o: PageOptions): string {
  const mark = o.highlight ?? '#FFE58A';
  const soft = o.soft ?? `${o.accent}12`;
  const body = renderMarkdown(text);
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>${KATEX_INLINE_CSS}</style>
<link rel="stylesheet" href="${PAGE_FONTS}">
<style>
*{box-sizing:border-box}
html,body{margin:0;background:${o.bg}}
body{padding:${o.print ? '0' : '0 1px'};color:${o.color};font-family:'IBM Plex Sans Arabic',sans-serif;font-size:${o.size}px;line-height:1.85;word-wrap:break-word;-webkit-text-size-adjust:100%}
h1,h2,h3,h4{line-height:1.4;margin:.9em 0 .35em;font-weight:700} h1{font-size:1.4em} h2{font-size:1.22em} h3{font-size:1.08em}
h1,h2{border-right:5px solid ${o.accent};padding-right:.5em}
body>:first-child{margin-top:0}
p{margin:.35em 0} ul,ol{padding-right:1.4em;margin:.3em 0} ol{list-style-type:arabic-indic} li{margin:.25em 0} li::marker{color:${o.accent};font-weight:700}
[dir=ltr],li[dir=ltr]{text-align:left}
strong{font-weight:700}
a{color:${o.accent}}
mark{background:${mark};color:inherit;padding:0 .2em;border-radius:4px;font-weight:700;-webkit-box-decoration-break:clone;box-decoration-break:clone}
table{border-collapse:collapse;width:100%;margin:.6em 0;font-size:.95em} td,th{border:1px solid ${o.accent}33;padding:6px 8px;vertical-align:top} th{background:${soft}}
code{background:${soft};padding:1px 5px;border-radius:5px;font-size:.92em}
pre{background:${soft};padding:10px;border-radius:10px;overflow-x:auto;text-align:left}
pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding:.55em 1em;background:${soft};border-right:4px solid ${o.accent};border-radius:12px;page-break-inside:avoid}
blockquote p{margin:.2em 0}
hr{border:0;border-top:1px solid ${o.accent}33;margin:1em 0}
.katex{font-size:1.06em;direction:ltr;unicode-bidi:isolate}
.katex-display{overflow-x:auto;overflow-y:hidden;direction:ltr;padding:8px 6px;margin:.5em 0;background:${soft};border-radius:12px;page-break-inside:avoid}
.poem{margin:.8em 0;padding:.8em .6em;background:${soft};border-radius:14px;font-family:'Amiri',serif;font-size:1.12em;page-break-inside:avoid}
.bait{display:flex;justify-content:space-between;gap:1.2em;padding:.25em .3em}
.bait+.bait{border-top:1px dashed ${o.accent}33}
.shatr{flex:1;text-align:center}
.bait.one .shatr{text-align:center}
.quran{margin:.9em 0;padding:1em .9em .7em;border:1.5px solid ${o.accent}55;border-radius:16px;text-align:center;page-break-inside:avoid}
.basmala{font-family:'Amiri Quran','Amiri',serif;font-size:1.3em;margin-bottom:.4em}
.ayat{font-family:'Amiri Quran','Amiri',serif;font-size:1.3em;line-height:2.3}
.ref{font-size:.8em;opacity:.7;margin-top:.4em}
.sadaq{font-size:.72em;opacity:.6;margin-top:.5em}
.hadith{margin:.8em 0;padding:.8em 1em;background:${soft};border-radius:14px;font-family:'Amiri',serif;font-size:1.1em;page-break-inside:avoid}
.hadith .ref{font-family:'IBM Plex Sans Arabic',sans-serif}
.title{font-size:1.45em;font-weight:700;line-height:1.45;margin:0 0 .15em}
.meta{opacity:.55;font-size:.82em;margin-bottom:1.1em;padding-bottom:.8em;border-bottom:2px solid ${o.accent}}
@page{margin:16mm 14mm}
</style></head><body>
${o.title ? `<div class="title">${esc(o.title)}</div><div class="meta">${esc(o.meta ?? 'سعي')}</div>` : ''}
<div id="c">${body}</div>
${o.reportHeight ? `<script>function post(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(String(document.getElementById('c').getBoundingClientRect().bottom+4));}
post();window.addEventListener('load',post);setTimeout(post,400);setTimeout(post,1500);
if(document.fonts)document.fonts.ready.then(post);
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(a){e.preventDefault();window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('link:'+a.href);}});</script>` : ''}
</body></html>`;
}
