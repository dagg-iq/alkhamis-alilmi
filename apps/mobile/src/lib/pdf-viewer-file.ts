import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { pdfViewerHtml } from './pdf-viewer-html';

/**
 * صفحة العارض كملف على الهاتف (أندرويد): من صفحة file:// يقرأ pdf.js ملف الكتاب مباشرة من ذاكرة الهاتف.
 * سابقاً كان الكتاب كله يُحوَّل إلى نص base64 ويُمرَّر للعارض — كتاب ٥٠ ميغا يصير أكثر من ٢٠٠ ميغا في الذاكرة
 * (نسخ متعددة) فيُغلق التطبيق على الهواتف الضعيفة. الآن نسخة واحدة ثنائية داخل العارض فقط.
 */
const BUILD = Number(Constants.expoConfig?.extra?.buildNumber) || 0;
const ready = new Map<boolean, string>();

/** رابط file:// لصفحة العارض (يُكتب مرة لكل نسخة من التطبيق)، أو null إن لم يكن متاحاً */
export function viewerFile(dark: boolean): string | null {
  if (Platform.OS !== 'android') return null;
  const hit = ready.get(dark);
  if (hit) return hit;
  try {
    const f = new File(Paths.cache, `saey-pdf-viewer-${BUILD}-${dark ? 'd' : 'l'}.html`);
    if (!f.exists) f.write(pdfViewerHtml(dark));
    ready.set(dark, f.uri);
    return f.uri;
  } catch {
    return null;
  }
}

/** نفس viewerFile لكن بعد أول رسم (الكتابة ~١ ميغا لا تؤخر فتح الشاشة) */
export function useViewerFile(dark: boolean, enabled = true): string | null | undefined {
  const [uri, setUri] = useState<string | null | undefined>(() => (enabled ? ready.get(dark) : null));
  useEffect(() => {
    if (!enabled) { setUri(null); return; }
    setUri(viewerFile(dark));
  }, [dark, enabled]);
  return uri;
}

/** خصائص WebView اللازمة لقراءة ملف محلي من صفحة file:// */
export const FILE_WEBVIEW_PROPS = {
  allowFileAccess: true,
  allowFileAccessFromFileURLs: true,
  allowUniversalAccessFromFileURLs: true,
} as const;
