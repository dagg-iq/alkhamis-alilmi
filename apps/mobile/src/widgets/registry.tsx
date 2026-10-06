import type { WidgetInfo, WidgetRepresentation } from 'react-native-android-widget';
import type { WidgetSnapshot } from './data';
import { ExemptionWidget, NewsWidget, NextExamWidget, OverviewWidget, QuickWidget, TasksWidget } from './views';

/** أسماء الويدجتات — يجب أن تطابق app.json */
export const WIDGET_NAMES = ['Exemption', 'NextExam', 'Tasks', 'Overview', 'News', 'Quick'] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

export function renderWidgetFor(name: string, s: WidgetSnapshot, info: Pick<WidgetInfo, 'width' | 'height'>): WidgetRepresentation | null {
  const both = (f: (mode: 'light' | 'dark') => React.JSX.Element) => ({ light: f('light'), dark: f('dark') });
  switch (name) {
    case 'Exemption': return both((mode) => <ExemptionWidget s={s} mode={mode} width={info.width} />);
    case 'NextExam': return both((mode) => <NextExamWidget s={s} mode={mode} />);
    case 'Tasks': return both((mode) => <TasksWidget s={s} mode={mode} height={info.height} />);
    case 'Overview': return both((mode) => <OverviewWidget s={s} mode={mode} />);
    case 'News': return both((mode) => <NewsWidget s={s} mode={mode} />);
    case 'Quick': return both((mode) => <QuickWidget mode={mode} />);
    default: return null;
  }
}
