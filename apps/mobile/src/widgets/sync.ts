import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { onGoalChange } from '@/lib/goal';
import { EMPTY_SNAPSHOT, fetchSnapshot, readWidgetTheme, saveWidgetTheme, writeSnapshot, type WidgetSnapshot, type WidgetTheme } from './data';

/** الويدجتات تعمل في ملف APK على أندرويد فقط (لا في Expo Go ولا الويب) */
export const widgetsSupported =
  Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type Lib = typeof import('react-native-android-widget');
type Reg = typeof import('./registry');
let mods: { lib: Lib; reg: Reg } | null | undefined;
function load() {
  if (mods !== undefined) return mods;
  if (!widgetsSupported) return (mods = null);
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    mods = { lib: require('react-native-android-widget') as Lib, reg: require('./registry') as Reg };
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    mods = null;
  }
  return mods;
}

/** يعيد رسم كل الويدجتات الموجودة على الشاشة الرئيسية بالبيانات المعطاة */
export async function redrawWidgets(s: WidgetSnapshot) {
  const m = load();
  if (!m) return;
  for (const name of m.reg.WIDGET_NAMES) {
    try {
      await m.lib.requestWidgetUpdate({
        widgetName: name,
        renderWidget: (info) => m.reg.renderWidgetFor(name, s, info) ?? m.reg.renderWidgetFor('Quick', s, info)!,
      });
    } catch {
      // ويدجت غير مضاف: لا شيء
    }
  }
}

let running = false;
/** يجلب البيانات ويحدّث الويدجتات */
export async function syncWidgets() {
  if (!widgetsSupported || running) return;
  running = true;
  try {
    const s = await fetchSnapshot();
    await writeSnapshot(s);
    await redrawWidgets(s);
  } catch {
    // نحاول لاحقاً
  } finally {
    running = false;
  }
}

/** عند تسجيل الخروج: نمسح بيانات الطالب من الويدجتات */
export async function clearWidgets() {
  if (!widgetsSupported) return;
  const s = { ...EMPTY_SNAPSHOT, theme: await readWidgetTheme(), updatedAt: new Date().toISOString() };
  await writeSnapshot(s);
  await redrawWidgets(s);
}

/** مزامنة تلقائية: عند فتح التطبيق، وعند الخروج منه (ليرى الطالب آخر تحديث على الشاشة الرئيسية) */
export function useWidgetSync(userId: string | null) {
  useEffect(() => {
    if (!widgetsSupported || !userId) return;
    syncWidgets();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') syncWidgets();
    });
    const every = setInterval(syncWidgets, 10 * 60 * 1000);
    const offGoal = onGoalChange(() => { syncWidgets(); });
    return () => {
      offGoal();
      sub.remove();
      clearInterval(every);
    };
  }, [userId]);
}

/** يطلب من الهاتف إضافة ويدجت للشاشة الرئيسية (أندرويد ٨ فما فوق) */
export async function pinWidget(name: string): Promise<boolean> {
  const m = load();
  if (!m) return false;
  try {
    const ok = await m.lib.requestPinWidget({ widgetName: name });
    syncWidgets();
    return ok;
  } catch {
    return false;
  }
}

/** يغيّر مظهر الويدجتات (فاتح/غامق/حسب الهاتف) ويعيد رسمها فوراً */
export async function setWidgetTheme(t: WidgetTheme) {
  const s = await saveWidgetTheme(t);
  await redrawWidgets(s);
}
