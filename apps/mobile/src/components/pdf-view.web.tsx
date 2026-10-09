import { forwardRef, useImperativeHandle } from 'react';
import { T } from './ui';
import type { PdfViewHandle } from './pdf-view';

/** المتصفح: عرض بسيط (التطبيق الحقيقي يستخدم pdf.js داخل WebView) */
export const PdfView = forwardRef<PdfViewHandle, { base64?: string; url?: string }>(function PdfView({ base64, url }, handle) {
  useImperativeHandle(handle, () => ({ exportImages: () => Promise.reject(new Error('غير متاح في المتصفح')) }), []);
  const src = base64 ? `data:application/pdf;base64,${base64}` : url;
  if (!src) return <T dim center>يجهّز الملف…</T>;
  return <iframe title="PDF" src={src} style={{ border: 0, width: '100%', height: '100%' }} />;
});
