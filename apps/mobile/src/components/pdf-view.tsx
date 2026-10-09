import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { arDigits } from '@saey/shared';
import { pdfViewerHtml } from '@/lib/pdf-viewer-html';
import { useTheme } from '@/lib/theme';
import { T } from './ui';

export interface PageImage { dataUrl: string; width: number; height: number }

export interface PdfViewHandle {
  /** كل صفحات الملف كصور JPEG (data URL) بعرض معيّن مع أبعادها */
  exportImages: (width?: number, quality?: number) => Promise<PageImage[]>;
}

/**
 * عارض PDF داخل التطبيق (pdf.js مضمّن فيعمل بلا إنترنت): الصفحات تُرسم عند الوصول إليها،
 * والتكبير بإصبعين. يقبل ملفاً محلياً (base64) أو رابطاً.
 */
export const PdfView = forwardRef<PdfViewHandle, { base64?: string; url?: string }>(function PdfView({ base64, url }, handle) {
  const { c, dark } = useTheme();
  const ref = useRef<WebView>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState(0);
  const exporting = useRef<{ images: PageImage[]; resolve: (v: PageImage[]) => void; reject: (e: Error) => void } | null>(null);

  const html = useMemo(() => pdfViewerHtml(dark), [dark]);

  useImperativeHandle(handle, () => ({
    exportImages: (width = 1240, quality = 0.9) => new Promise<PageImage[]>((resolve, reject) => {
      if (state !== 'ready') return reject(new Error('الملف لم يجهز بعد'));
      exporting.current = { images: [], resolve, reject };
      ref.current?.injectJavaScript(`window.exportImages(${width},${quality});true;`);
    }),
  }), [state]);

  const start = () => {
    const src = base64 ? { data: base64 } : { url };
    ref.current?.injectJavaScript(`window.openPdf(${JSON.stringify(src)});true;`);
  };

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://saeyiq.web.app/' }}
        onLoadEnd={start}
        onMessage={(e) => {
          const d = e.nativeEvent.data;
          if (d === 'ready') setState('ready');
          else if (d.startsWith('pages:')) setPages(Number(d.slice(6)));
          else if (d.startsWith('img:')) {
            const m = d.match(/^img:(\d+):(\d+):(\d+)x(\d+):(.*)$/s);
            if (m && exporting.current) exporting.current.images[Number(m[1]) - 1] = { dataUrl: m[5], width: Number(m[3]), height: Number(m[4]) };
          } else if (d === 'imgdone') {
            exporting.current?.resolve(exporting.current.images);
            exporting.current = null;
          } else if (d.startsWith('error')) {
            if (exporting.current) { exporting.current.reject(new Error('تعذّر تحويل الصفحات إلى صور')); exporting.current = null; } else setState('error');
          }
        }}
        javaScriptEnabled
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        style={{ backgroundColor: 'transparent' }}
      />
      {state !== 'ready' ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.bg }}>
          {state === 'loading' ? <ActivityIndicator color={c.accent} /> : null}
          <T dim center>{state === 'loading' ? 'يجهّز الملف…' : 'تعذّر عرض الملف. جرّب «مشاركة» لفتحه بتطبيق آخر.'}</T>
        </View>
      ) : null}
      {pages > 0 && state === 'ready' ? (
        <View style={{ position: 'absolute', bottom: 12, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)' }} pointerEvents="none">
          <T size={12} color="#FFFFFF">{arDigits(pages)} صفحة</T>
        </View>
      ) : null}
    </View>
  );
});
