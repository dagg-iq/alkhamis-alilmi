import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { pdfViewerHtml } from '@/lib/pdf-viewer-html';
import { useTheme } from '@/lib/theme';
import { Icon } from './icon';

/**
 * معاينة أول صفحة من ملف PDF كصورة (تُرسم مرة واحدة بـ pdf.js داخل WebView مخفي).
 * تعمل بملف محلي (base64) أو برابط مؤقت (تحمّل الصفحة الأولى فقط عادةً).
 */
export function PdfThumb({ base64, url, width = 360, onPages }: { base64?: string; url?: string; width?: number; onPages?: (n: number) => void }) {
  const { c } = useTheme();
  const ref = useRef<WebView>(null);
  const [img, setImg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => pdfViewerHtml(false), []);
  useEffect(() => { setImg(null); setFailed(false); }, [base64, url]);

  const start = () => {
    if (!base64 && !url) return;
    const src = base64 ? { data: base64 } : { url };
    ref.current?.injectJavaScript(`window.thumb(${JSON.stringify(src)},${Math.round(width * 2)});true;`);
  };

  return (
    <View style={{ width, aspectRatio: 0.707, borderRadius: 14, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 }}>
      {img ? <Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} />
        : failed ? <Icon name="file" size={44} color={c.ink3} />
          : <ActivityIndicator color={c.accent} />}
      {!img && !failed && (base64 || url) ? (
        <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} pointerEvents="none">
          <WebView ref={ref} originWhitelist={['*']} source={{ html, baseUrl: 'https://saeyiq.web.app/' }} onLoadEnd={start} javaScriptEnabled
            onMessage={(e) => {
              const d = e.nativeEvent.data;
              if (d.startsWith('thumb:')) setImg(d.slice(6));
              else if (d.startsWith('pages:')) onPages?.(Number(d.slice(6)));
              else if (d.startsWith('error')) setFailed(true);
            }} />
        </View>
      ) : null}
    </View>
  );
}
