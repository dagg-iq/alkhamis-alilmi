import { useEffect, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { Icon, type IconName } from './icon';
import { PressScale } from './motion';
import { Portal } from './portal';
import { T } from './ui';

/** لوحة سفلية للخيارات: تُرسم في طبقة التطبيق (لا في Modal) فتلتصق بحافة الشاشة السفلية بلا فجوة */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);
  if (!visible) return null;
  return (
    <Portal>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} onPress={onClose} accessibilityLabel="إغلاق" />
        <Animated.View entering={SlideInDown.duration(220).easing(Easing.out(Easing.cubic))} style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: Math.max(insets.bottom, 12) + 16, gap: 4, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.line, marginBottom: 8 }} />
          {children}
        </Animated.View>
      </Animated.View>
    </Portal>
  );
}

export function SheetItem({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const { c } = useTheme();
  const color = danger ? '#C8312B' : c.ink;
  return (
    <PressScale onPress={onPress} scaleTo={0.97} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
      <Icon name={icon} size={22} color={color} />
      <T weight="bold" size={16} color={color}>{label}</T>
    </PressScale>
  );
}

