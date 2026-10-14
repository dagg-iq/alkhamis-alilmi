import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { T } from './ui';
import type { PdfViewHandle, PdfViewProps } from './pdf-view';

/** المتصفح: عرض بسيط (التطبيق الحقيقي يستخدم pdf.js داخل WebView) */
export const PdfView = forwardRef<PdfViewHandle, PdfViewProps>(function PdfView({ base64, url, fileUri, onFallback, goto }, handle) {
  useImperativeHandle(handle, () => ({ exportImages: () => Promise.reject(new Error('غير متاح في المتصفح')), scrollToPage: () => {} }), []);
  // لا ملفات محلية في المتصفح: المستدعي يمرر base64 بدلاً منها
  useEffect(() => { if (fileUri && !base64 && !url) onFallback?.(); }, [fileUri, base64, url, onFallback]);
  const src = base64 ? `data:application/pdf;base64,${base64}${goto ? `#page=${goto}` : ''}` : url;
  if (!src) return <T dim center>يجهّز الملف…</T>;
  return <iframe title="PDF" src={src} style={{ border: 0, width: '100%', height: '100%' }} />;
});
