import * as Haptics from 'expo-haptics';
import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeInDown, ReduceMotion, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** نبضة لمس خفيفة (أندرويد/آيفون فقط) */
export function tap(kind: 'light' | 'medium' | 'select' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  if (kind === 'select') Haptics.selectionAsync().catch(() => {});
  else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

const PRESS = { damping: 18, stiffness: 420, mass: 0.6 };

/** زر ينكمش بنعومة عند اللمس ويرتد بنابض */
export function PressScale({
  children, style, scaleTo = 0.96, haptic, onPress, onPressIn, onPressOut, ...rest
}: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean; children?: ReactNode }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { s.value = withSpring(scaleTo, PRESS); onPressIn?.(e); }}
      onPressOut={(e) => { s.value = withSpring(1, PRESS); onPressOut?.(e); }}
      onPress={onPress ? (e) => { if (haptic) tap(); onPress(e); } : undefined}
      style={[style, anim]}>
      {children}
    </AnimatedPressable>
  );
}

/** دخول متتابع للعناصر: كل عنصر يصعد ويظهر بعد الذي قبله */
export function enter(i: number) {
  return FadeInDown.delay(Math.min(i, 4) * 25)
    .duration(220)
    .easing(Easing.out(Easing.quad))
    .withInitialValues({ transform: [{ translateY: 6 }] })
    .reduceMotion(ReduceMotion.System);
}

export function Stagger({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Animated.View key={isValidElement(child) && child.key != null ? child.key : i} entering={enter(i)}>
          {child}
        </Animated.View>
      ))}
    </>
  );
}

/** رقم يعدّ تصاعدياً حتى قيمته (لمعدل الإعفاء وغيره) */
export function useCountUp(target: number | null | undefined, duration = 600) {
  const [v, setV] = useState(target ?? 0);
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return;
    let raf = 0;
    const from = 0;
    const t0 = Date.now();
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return target == null ? target : v;
}

/** هيكل تحميل نابض بدل الدائرة الدوّارة */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  const { c } = useTheme();
  const o = useSharedValue(0.45);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.45, { duration: 700 })), -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={[{ gap: 12, paddingVertical: 8 }, pulse]} accessibilityLabel="جارٍ التحميل">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.line, padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.soft }} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={{ height: 12, borderRadius: 6, backgroundColor: c.soft, width: i % 2 ? '55%' : '70%' }} />
              <View style={{ height: 10, borderRadius: 5, backgroundColor: c.soft, width: i % 2 ? '35%' : '45%' }} />
            </View>
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** نبضة تكبير صغيرة عند تغيّر قيمة (للأيقونات والشارات) */
export function usePop(dep: unknown) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withSequence(withTiming(1.18, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 260 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
  return useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
}

/** يعرض رقماً يعدّ تصاعدياً */
export function CountUp({ value, children }: { value: number | null; children: (v: number | null) => ReactNode }) {
  const v = useCountUp(value);
  return <>{children(value == null ? null : v ?? value)}</>;
}

/**
 * حاوية تصعد مع لوحة المفاتيح بنفس سرعتها (أندرويد بوضع ملء الشاشة لا يرفع المحتوى تلقائياً).
 * تُستخدم في الدردشة والمساعد وكل الشاشات التي فيها حقول كتابة.
 */
export function KeyboardView({ children, style, bottomInset = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; bottomInset?: number }) {
  const kb = useAnimatedKeyboard();
  const pad = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, kb.height.value - bottomInset) }));
  return <Animated.View style={[{ flex: 1 }, style, pad]}>{children}</Animated.View>;
}
