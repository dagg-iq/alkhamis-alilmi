import { useSyncExternalStore } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useEffect } from 'react';
import { PressScale } from '@/components/motion';
import { Portal } from '@/components/portal';
import { T } from '@/components/ui';
import { useTheme } from './theme';

/**
 * نوافذ التنبيه بتصميم سعي بدل نافذة النظام الرمادية.
 * نفس توقيع Alert.alert في React Native حتى يكفي تغيير الاستيراد.
 */
export interface DialogButton { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }
interface DialogState { id: number; title: string; message?: string; buttons: DialogButton[] }

let current: DialogState | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  if (current?.id === id) { current = null; emit(); }
}

export const Alert = {
  alert(title: string, message?: string, buttons?: DialogButton[]) {
    current = { id: ++counter, title, message: message || undefined, buttons: buttons?.length ? buttons : [{ text: 'حسناً' }] };
    emit();
  },
};

/** يوضع مرة واحدة في جذر التطبيق */
export function DialogHost() {
  const d = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => current);
  return d ? <DialogView key={d.id} d={d} /> : null;
}

function DialogView({ d }: { d: DialogState }) {
  const { c, dark } = useTheme();
  // زر الرجوع يغلق النافذة (كزر الإلغاء إن وُجد)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const cancel = d.buttons.find((b) => b.style === 'cancel');
      dismiss(d.id);
      cancel?.onPress?.();
      return true;
    });
    return () => sub.remove();
  }, [d]);

  const press = (b: DialogButton) => { dismiss(d.id); b.onPress?.(); };
  const row = d.buttons.length === 2;
  const ordered = row ? [...d.buttons].sort((a, b) => (a.style === 'cancel' ? 1 : 0) - (b.style === 'cancel' ? 1 : 0)) : d.buttons;
  const danger = '#C8312B';
  return (
    <Portal>
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Pressable accessibilityLabel="إغلاق" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
          onPress={() => { const cancel = d.buttons.find((b) => b.style === 'cancel'); if (cancel || d.buttons.length === 1) press(cancel ?? d.buttons[0]); }} />
        <Animated.View entering={ZoomIn.duration(180).easing(Easing.out(Easing.cubic))}
          style={{ width: '100%', maxWidth: 380, backgroundColor: c.card, borderRadius: 28, padding: 22, gap: 8, borderWidth: 1, borderColor: c.line }}>
          <T display size={22} center>{d.title}</T>
          {d.message ? <T dim center size={14} style={{ lineHeight: 23 }}>{d.message}</T> : null}
          <View style={{ flexDirection: row ? 'row' : 'column', gap: 8, marginTop: 14 }}>
            {ordered.map((b, i) => {
              const primary = b.style !== 'cancel';
              const bad = b.style === 'destructive';
              return (
                <PressScale key={`${b.text}-${i}`} onPress={() => press(b)} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={b.text}
                  style={{
                    flex: row ? 1 : undefined, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: bad ? (dark ? '#3A1715' : '#FBE6E4') : primary ? c.accent : c.soft,
                  }}>
                  <T weight="bold" size={15} color={bad ? danger : primary ? '#FFFFFF' : c.softInk}>{b.text ?? 'حسناً'}</T>
                </PressScale>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Portal>
  );
}
