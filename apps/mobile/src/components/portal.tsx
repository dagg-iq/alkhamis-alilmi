import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * طبقة فوق كل الشاشات داخل نافذة التطبيق نفسها.
 * النوافذ المنبثقة (Modal) في أندرويد نافذة منفصلة يظهر فيها شريط التنقل من جديد، فتبقى فجوة تحت اللوحة السفلية؛
 * هنا تُرسم اللوحة داخل نافذة التطبيق المخفي فيها الشريط، فتلتصق بحافة الشاشة تماماً.
 */
interface Host { set: (key: string, node: ReactNode) => void; remove: (key: string) => void }
const Ctx = createContext<Host | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<[string, ReactNode][]>([]);
  const host = useMemo<Host>(() => ({
    set: (key, node) => setItems((prev) => {
      const i = prev.findIndex(([k]) => k === key);
      if (i < 0) return [...prev, [key, node]];
      const next = prev.slice();
      next[i] = [key, node];
      return next;
    }),
    remove: (key) => setItems((prev) => prev.filter(([k]) => k !== key)),
  }), []);
  return (
    <Ctx.Provider value={host}>
      {children}
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 500, elevation: 500 }]}>
        {items.map(([k, node]) => <View key={k} pointerEvents="box-none" style={StyleSheet.absoluteFill}>{node}</View>)}
      </View>
    </Ctx.Provider>
  );
}

/** يعرض أبناءه في طبقة PortalProvider (أو في مكانه إن لم توجد) */
export function Portal({ children }: { children: ReactNode }) {
  const host = useContext(Ctx);
  const key = useId();
  useEffect(() => { host?.set(key, children); });
  useEffect(() => () => host?.remove(key), [host, key]);
  return host ? null : <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{children}</View>;
}
