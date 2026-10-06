import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { fetchSnapshot, readSnapshot, writeSnapshot } from './data';
import { renderWidgetFor } from './registry';

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * يعمل في الخلفية (حتى والتطبيق مغلق): عند إضافة الويدجت، وكل ٣٠ دقيقة، وعند تغيير حجمه.
 * يرسم آخر نسخة محفوظة فوراً، ثم يحاول جلب الجديد من الخادم ويعيد الرسم.
 */
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  const cached = await readSnapshot();
  const first = renderWidgetFor(widgetInfo.widgetName, cached, widgetInfo);
  if (!first) return;
  renderWidget(first);
  if (widgetAction === 'WIDGET_RESIZED' || widgetInfo.widgetName === 'Quick') return;
  // لا نجلب أكثر من مرة كل ١٠ دقائق (عدة ويدجتات تتحدث معاً)
  if (Date.now() - new Date(cached.updatedAt).getTime() < 10 * 60 * 1000) return;
  try {
    const fresh = await withTimeout(fetchSnapshot(), 15000);
    await writeSnapshot(fresh);
    const next = renderWidgetFor(widgetInfo.widgetName, fresh, widgetInfo);
    if (next) renderWidget(next);
  } catch {
    // بدون إنترنت: تبقى النسخة المحفوظة
  }
}
