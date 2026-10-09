import { File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import { KATEX_CSS, PAGE_FONTS, renderMath } from './markdown';
import { pdfName } from './pdf';
import { callFunction } from './supabase';

/**
 * تحويل صور ورقة إلى PDF بنفس تنسيقها:
 *  ١) الصور تُصغَّر وتُرسل للذكاء الاصطناعي ← يعيد HTML بنفس مواضع النصوص والجداول.
 *  ٢) الأشكال تُقصّ من الصورة الأصلية وتوضع في مكانها، والمعادلات تُحسب هنا (KaTeX).
 *  ٣) HTML ← PDF على الهاتف.
 */
interface Prepared { uri: string; width: number; height: number; base64: string }

async function prepare(uri: string): Promise<Prepared> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  ctx.resize({ width: 1600 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return { uri: out.uri, width: out.width, height: out.height, base64: out.base64 ?? '' };
}

async function crop(p: Prepared, ymin: number, xmin: number, ymax: number, xmax: number): Promise<string | null> {
  const c = (n: number) => Math.max(0, Math.min(1000, n));
  const x0 = Math.round((c(xmin) / 1000) * p.width);
  const y0 = Math.round((c(ymin) / 1000) * p.height);
  const w = Math.round(((c(xmax) - c(xmin)) / 1000) * p.width);
  const h = Math.round(((c(ymax) - c(ymin)) / 1000) * p.height);
  if (w < 12 || h < 12) return null;
  const ctx = ImageManipulator.ImageManipulator.manipulate(p.uri);
  ctx.crop({ originX: x0, originY: y0, width: Math.min(w, p.width - x0), height: Math.min(h, p.height - y0) });
  const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** الأشكال: <img data-page data-box> ← صورة مقصوصة من الأصل (وتُحذف إن فشل القص) */
async function fillFigures(html: string, pages: Prepared[]): Promise<string> {
  const tags = [...new Set(html.match(/<img\b[^>]*>/gi) ?? [])];
  let out = html;
  for (const tag of tags) {
    const page = Number(tag.match(/data-page\s*=\s*["']?(\d+)/i)?.[1]);
    const box = tag.match(/data-box\s*=\s*["']([^"']+)["']/i)?.[1]?.split(/[\s,]+/).map(Number);
    let replacement = '';
    if (page >= 1 && page <= pages.length && box && box.length === 4 && box.every(Number.isFinite)) {
      const src = await crop(pages[page - 1], box[0], box[1], box[2], box[3]).catch(() => null);
      const style = tag.match(/style\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
      if (src) replacement = `<img src="${src}" style="max-width:100%;${style}">`;
    }
    out = out.split(tag).join(replacement);
  }
  return out;
}

const PAGE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
body{font-family:'IBM Plex Sans Arabic',sans-serif;color:#111;font-size:15px;line-height:1.75}
.page{direction:rtl;width:100%;min-height:1040px;padding:34px 38px;page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
p{margin:.3em 0} table{border-collapse:collapse} td,th{vertical-align:top}
.line{border-bottom:1px solid #555;height:30px}
.dots{display:inline-block;min-width:120px;border-bottom:1.5px dotted #555}
.katex{font-size:1.05em;direction:ltr;unicode-bidi:isolate}
.katex-display{direction:ltr;margin:.4em 0}
img{display:inline-block}
@page{size:A4;margin:0}`;

export function pageDocument(sections: string): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="${KATEX_CSS}"><link rel="stylesheet" href="${PAGE_FONTS}">
<style>${PAGE_CSS}</style></head><body>${sections}</body></html>`;
}

export interface ConvertResult { pdf: File; text: string }

export async function convertPhotos(uris: string[], title: string, onStep?: (s: string) => void): Promise<ConvertResult> {
  onStep?.('تجهيز الصور…');
  const pages: Prepared[] = [];
  for (const u of uris) pages.push(await prepare(u));

  onStep?.('الذكاء الاصطناعي يعيد بناء الورقة بنفس تنسيقها…');
  const { html } = await callFunction<{ html: string }>('scan-convert', { images: pages.map((p) => p.base64) });

  onStep?.('تجهيز الأشكال والمعادلات…');
  const withFigures = await fillFigures(html, pages);
  const finalHtml = pageDocument(renderMath(withFigures));

  onStep?.('إنشاء ملف PDF…');
  const { uri } = await Print.printToFileAsync({ html: finalHtml, width: 595, height: 842 });
  const dest = new File(Paths.cache, pdfName(title));
  if (dest.exists) dest.delete();
  await new File(uri).copy(dest);

  // نص عادي للبحث (يُحفظ مع الأسئلة)
  const text = decode(html.replace(/<\/(p|div|tr|li|h\d|section)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();
  return { pdf: dest, text };
}
