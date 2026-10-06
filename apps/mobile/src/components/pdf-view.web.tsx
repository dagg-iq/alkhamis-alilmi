import { T } from './ui';

/** المتصفح: عرض بسيط (التطبيق الحقيقي يستخدم pdf.js داخل WebView) */
export function PdfView({ base64, url }: { base64?: string; url?: string }) {
  const src = base64 ? `data:application/pdf;base64,${base64}` : url;
  if (!src) return <T dim center>يجهّز الملف…</T>;
  return <iframe title="PDF" src={src} style={{ border: 0, width: '100%', height: '100%' }} />;
}
