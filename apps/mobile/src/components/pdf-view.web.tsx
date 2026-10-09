import { forwardRef, useImperativeHandle } from 'react';
import { T } from './ui';
import type { PdfViewHandle, PdfViewProps } from './pdf-view';

/** المتصفح: عرض بسيط (التطبيق الحقيقي يستخدم pdf.js داخل WebView) */
export const PdfView = forwardRef<PdfViewHandle, PdfViewProps>(function PdfView({ base64, url, goto }, handle) {
  useImperativeHandle(handle, () => ({ exportImages: () => Promise.reject(new Error('غير متاح في المتصفح')), scrollToPage: () => {} }), []);
  const src = base64 ? `data:application/pdf;base64,${base64}${goto ? `#page=${goto}` : ''}` : url;
  if (!src) return <T dim center>يجهّز الملف…</T>;
  return <iframe title="PDF" src={src} style={{ border: 0, width: '100%', height: '100%' }} />;
});
