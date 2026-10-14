/**
 * حماية عرض Markdown: النص يأتي من المساعد أو من طالب آخر (إجابة مشاركة في الدردشة، أسئلة…)،
 * و marked يمرر أي HTML خام كما هو — فكان يمكن حقن <img onerror=…> يُنفَّذ داخل WebView.
 * القاعدة: وسوم تنسيق قليلة بلا خصائص مسموحة، وكل ما عداها يُعرض نصاً كما كُتب.
 */

const ALLOWED_TAG = /^<\/?(mark|br|sub|sup|u|b|i|strong|em|small|del|s|ins)\s*\/?>$/i;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** HTML خام (وسم واحد أو كتلة) ← الوسوم المسموحة كما هي، والباقي نص */
export function sanitizeHtml(html: string): string {
  return html.split(/(<[^<>]*>)/g).map((part) => {
    if (!part) return '';
    if (part.startsWith('<') && part.endsWith('>') && ALLOWED_TAG.test(part)) return part.toLowerCase().replace(/\s+/g, '');
    return escapeHtml(part);
  }).join('');
}

/** رابط يُسمح بفتحه من محتوى المستخدمين: ويب وبريد فقط (لا intent: ولا javascript: ولا روابط التطبيق الداخلية) */
export function isSafeUrl(url: string | null | undefined): boolean {
  const u = String(url ?? '').trim();
  // مسافات أو محارف تحكم داخل المخطط (مثل java\tscript:) لا تُقبل
  return /^(https?:\/\/|mailto:)[^\s\u0000-\u001f]+$/i.test(u);
}
