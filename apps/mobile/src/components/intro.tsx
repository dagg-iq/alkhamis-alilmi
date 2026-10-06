import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Rect } from 'react-native-svg';
import { fonts, useTheme } from '@/lib/theme';

const ARect = Animated.createAnimatedComponent(Rect);
const ACircle = Animated.createAnimatedComponent(Circle);

// مراحل المدّ (الكشيدة) للاسم: سعي ← سـعــــي ← سعي
const KASHIDA: [number, number][] = [
  [0, 0], [1, 1], [1, 2], [2, 3], [2, 4], [2, 5], [2, 5], [2, 5], [2, 4], [1, 3], [1, 2], [1, 1], [0, 0],
];
const TATWEEL = 'ـ';
const word = ([a, b]: [number, number]) => `س${TATWEEL.repeat(a)}ع${TATWEEL.repeat(b)}ي`;

/**
 * مقدمة التطبيق (موشن جرافك):
 * ١. القاعدة تمتد  ٢. الأسنان الثلاث تصعد بالتتابع (الفصل الأول، نصف السنة، الفصل الثاني)
 * ٣. نقطة الإعفاء تسقط وترتد  ٤. يظهر الاسم ويتمدد بالكشيدة ثم ينكمش  ٥. خروج ناعم إلى التطبيق
 */
export function Intro({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { c } = useTheme();
  const base = useSharedValue(0);
  const h1 = useSharedValue(0);
  const h2 = useSharedValue(0);
  const h3 = useSharedValue(0);
  const dotY = useSharedValue(-30);
  const dotR = useSharedValue(0);
  const nameOpacity = useSharedValue(0);
  const nameY = useSharedValue(18);
  const nameScale = useSharedValue(1);
  const exit = useSharedValue(0);
  const [step, setStep] = useState(0);
  const [animDone, setAnimDone] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    const ease = Easing.out(Easing.cubic);
    const spring = { damping: 11, stiffness: 140, mass: 0.7 };
    base.value = withTiming(80, { duration: 380, easing: ease });
    h1.value = withDelay(260, withSpring(42, spring));
    h2.value = withDelay(400, withSpring(60, spring));
    h3.value = withDelay(540, withSpring(74, spring));
    dotR.value = withDelay(820, withTiming(10, { duration: 120 }));
    dotY.value = withDelay(820, withSpring(12, { damping: 7, stiffness: 160, mass: 0.6 }));
    nameOpacity.value = withDelay(1050, withTiming(1, { duration: 320 }));
    nameY.value = withDelay(1050, withSpring(0, { damping: 14, stiffness: 120 }));

    // المدّ: يبدأ بعد ظهور الاسم
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        if (i >= KASHIDA.length) {
          if (interval) clearInterval(interval);
          nameScale.value = withSequence(withTiming(1.06, { duration: 140 }), withSpring(1, { damping: 8 }));
          setTimeout(() => setAnimDone(true), 380);
          return;
        }
        setStep(i);
      }, 70);
    }, 1350);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // الخروج عندما تنتهي الحركة ويكون التطبيق جاهزاً
  useEffect(() => {
    if (animDone && ready && !leaving.current) {
      leaving.current = true;
      exit.value = withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }, (fin) => {
        if (fin) runOnJS(onDone)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animDone, ready]);

  const baseProps = useAnimatedProps(() => {
    const w = Math.max(0, base.value);
    return { x: 100 - w, width: w };
  });
  const bar = (h: number) => {
    'worklet';
    const v = Math.max(0, h);
    return { y: 104 - v, height: v };
  };
  const b1 = useAnimatedProps(() => bar(h1.value));
  const b2 = useAnimatedProps(() => bar(h2.value));
  const b3 = useAnimatedProps(() => bar(h3.value));
  const dot = useAnimatedProps(() => ({ cy: dotY.value, r: Math.max(0, dotR.value) }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameY.value }, { scale: nameScale.value }],
  }));
  const rootStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ scale: 1 + exit.value * 0.08 }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100 }, rootStyle]}>
      <Pressable onPress={() => setAnimDone(true)} style={{ alignItems: 'center', gap: 6 }} accessibilityLabel="تخطي المقدمة">
        <Svg width={132} height={132} viewBox="0 0 120 120">
          <ARect animatedProps={baseProps} y={84} height={20} rx={10} fill={c.ink} />
          <ARect animatedProps={b1} x={80} width={20} rx={10} fill={c.ink} />
          <ARect animatedProps={b2} x={50} width={20} rx={10} fill={c.ink} />
          <ARect animatedProps={b3} x={20} width={20} rx={10} fill={c.ink} />
          <ACircle animatedProps={dot} cx={30} fill={c.accent} />
        </Svg>
        <Animated.View style={nameStyle}>
          <Text style={{ fontFamily: fonts.display, fontSize: 64, lineHeight: 92, color: c.ink, writingDirection: 'rtl' }}>
            {word(KASHIDA[step])}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
