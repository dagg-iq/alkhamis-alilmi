import katex from 'katex';
import { callFunction } from './supabase';

/**
 * تحويل صور ورقة أسئلة إلى PDF بنفس تنسيقها (نفس ما يفعله التطبيق):
 * صور ← الذكاء الاصطناعي يعيد HTML بنفس المواضع ← قصّ الأشكال من الأصل + حساب المعادلات ← صفحات ← PDF.
 */
export interface Prepared { canvas: HTMLCanvasElement; b64: string }

/** صورة مصغّرة (عرض ≤ ١٦٠٠) تحترم اتجاه الكاميرا، ومعها JPEG للإرسال */
export async function prepareImage(file: File): Promise<Prepared> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return { canvas, b64: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] };
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** يحسب $...$ و $$...$$ في نصوص HTML فقط (لا داخل الوسوم) */
export function renderMath(html: string): string {
  const tex = (src: string, display: boolean) => {
    try { return katex.renderToString(decode(src), { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch { return src; }
  };
  return html.split(/(<[^>]*>)/).map((part) => (part.startsWith('<') ? part : part
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => tex(t, true))
    .replace(/\$([^$\n]+?)\$/g, (_, t) => tex(t, false)))).join('');
}

function crop(p: Prepared, ymin: number, xmin: number, ymax: number, xmax: number): string | null {
  const c = (n: number) => Math.max(0, Math.min(1000, n));
  const x0 = Math.round((c(xmin) / 1000) * p.canvas.width);
  const y0 = Math.round((c(ymin) / 1000) * p.canvas.height);
  const w = Math.round(((c(xmax) - c(xmin)) / 1000) * p.canvas.width);
  const h = Math.round(((c(ymax) - c(ymin)) / 1000) * p.canvas.height);
  if (w < 12 || h < 12) return null;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(p.canvas, x0, y0, w, h, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.88);
}

/** الأشكال: <img data-page data-box> ← صورة مقصوصة من الأصل (وتُحذف إن تعذّر القص) */
export function fillFigures(html: string, pages: Prepared[]): string {
  let out = html;
  for (const tag of new Set(html.match(/<img\b[^>]*>/gi) ?? [])) {
    const page = Number(tag.match(/data-page\s*=\s*["']?(\d+)/i)?.[1]);
    const box = tag.match(/data-box\s*=\s*["']([^"']+)["']/i)?.[1]?.split(/[\s,]+/).map(Number);
    let rep = '';
    if (page >= 1 && page <= pages.length && box && box.length === 4 && box.every(Number.isFinite)) {
      const src = crop(pages[page - 1], box[0], box[1], box[2], box[3]);
      const style = tag.match(/style\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
      if (src) rep = `<img src="${src}" style="max-width:100%;${style}">`;
    }
    out = out.split(tag).join(rep);
  }
  return out;
}

/** أنماط صفحات الورقة (A4 بعرض ٧٩٤ بكسل) مقيَّدة بالحاوية .sc-pages */
export const PAGE_CSS = `
.sc-pages{background:#fff;color:#111;font-family:'Sans',sans-serif;font-size:15px;line-height:1.75;direction:rtl}
.sc-pages *{box-sizing:border-box}
.sc-pages .page{width:794px;min-height:1123px;padding:36px 40px;background:#fff;overflow:hidden}
.sc-pages p{margin:.3em 0}.sc-pages table{border-collapse:collapse}.sc-pages td,.sc-pages th{vertical-align:top}
.sc-pages .line{border-bottom:1px solid #555;height:30px}
.sc-pages .dots{display:inline-block;min-width:120px;border-bottom:1.5px dotted #555}
.sc-pages .katex{font-size:1.05em;direction:ltr;unicode-bidi:isolate}
.sc-pages img{display:inline-block}`;

/** استدعاء الدالة وتجهيز HTML النهائي للصفحات */
export async function convertImages(files: File[], onStep: (s: string) => void): Promise<{ html: string; pages: Prepared[] }> {
  onStep('تجهيز الصور…');
  const pages: Prepared[] = [];
  for (const f of files) pages.push(await prepareImage(f));
  onStep('الذكاء الاصطناعي يعيد بناء الورقة بنفس تنسيقها… (قد يستغرق دقيقة)');
  const { html } = await callFunction<{ html: string }>('scan-convert', { images: pages.map((p) => p.b64) });
  onStep('تجهيز الأشكال والمعادلات…');
  return { html: renderMath(fillFigures(html, pages)), pages };
}

/** كل عنصر .page ← صورة ← صفحة PDF (بنسبة الصفحة نفسها) */
export async function pagesToPdf(root: HTMLElement): Promise<{ blob: Blob; previews: string[] }> {
  const [{ default: html2canvas }, { PDFDocument }] = await Promise.all([import('html2canvas'), import('pdf-lib')]);
  if ((document as Document & { fonts?: { ready: Promise<unknown> } }).fonts) await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready;
  const pdf = await PDFDocument.create();
  const previews: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.page'))) {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const jpg = canvas.toDataURL('image/jpeg', 0.9);
    previews.push(jpg);
    const img = await pdf.embedJpg(Uint8Array.from(atob(jpg.split(',')[1]), (c) => c.charCodeAt(0)));
    const w = 595;
    const h = Math.round((canvas.height / canvas.width) * w);
    pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  if (!previews.length) throw new Error('لا توجد صفحات');
  return { blob: new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' }), previews };
}

/** بدون ذكاء اصطناعي: كل صورة صفحة PDF كما هي (بنسبتها الأصلية، عرض ٥٩٥) */
export async function imagesToPdf(files: File[], onStep?: (s: string) => void): Promise<{ blob: Blob; previews: string[] }> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const previews: string[] = [];
  for (let i = 0; i < files.length; i++) {
    onStep?.(`تجهيز الصورة ${i + 1} من ${files.length}…`);
    const p = await prepareImage(files[i]);
    const jpg = p.canvas.toDataURL('image/jpeg', 0.88);
    previews.push(jpg);
    const img = await pdf.embedJpg(Uint8Array.from(atob(jpg.split(',')[1]), (c) => c.charCodeAt(0)));
    const w = 595;
    const h = Math.round((p.canvas.height / p.canvas.width) * w);
    pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  if (!previews.length) throw new Error('لا توجد صور');
  return { blob: new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' }), previews };
}
