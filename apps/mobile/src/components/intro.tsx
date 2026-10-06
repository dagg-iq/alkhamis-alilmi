import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { fonts, useTheme } from '@/lib/theme';

const ARect = Animated.createAnimatedComponent(Rect);
const ACircle = Animated.createAnimatedComponent(Circle);

const FEATHER = 56; // حافة ناعمة للكشف (بدل خط حاد)
const smooth = Easing.bezier(0.33, 0, 0.15, 1);

/**
 * مقدمة التطبيق (~٢٫٢ ثانية):
 * ١. القاعدة تمتد  ٢. الأسنان الثلاث تصعد بالتتابع (الفصل الأول، نصف السنة، الفصل الثاني)
 * ٣. نقطة الإعفاء تسقط بارتداد خفيف  ٤. «سعي» يُكتب من اليمين لليسار بحافة ناعمة
 * ٥. «اسعَ تُعفَ.» يظهر تحته  ٦. خروج ناعم إلى التطبيق
 *
 * كل الحركة على خيط الواجهة (لا تتقطع إذا انشغل التطبيق بالتحميل)، ولا تبدأ إلا بعد أن تختفي
 * شاشة البداية الأصلية فعلاً — حتى لا يفوت الطالب أولها.
 */
export function Intro({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { c } = useTheme();
  const base = useSharedValue(0);
  const h1 = useSharedValue(0);
  const h2 = useSharedValue(0);
  const h3 = useSharedValue(0);
  const dotY = useSharedValue(-24);
  const dotR = useSharedValue(0);
  const write = useSharedValue(0);
  const nameY = useSharedValue(10);
  const tag = useSharedValue(0);
  const exit = useSharedValue(0);
  const [wordW, setWordW] = useState(0);
  const [animDone, setAnimDone] = useState(false);
  const started = useRef(false);
  const leaving = useRef(false);

  const start = () => {
    if (started.current) return;
    started.current = true;
    const out = Easing.out(Easing.cubic);
    const tooth = { damping: 15, stiffness: 170, mass: 0.7 };
    base.value = withTiming(80, { duration: 360, easing: out });
    h1.value = withDelay(200, withSpring(42, tooth));
    h2.value = withDelay(330, withSpring(60, tooth));
    h3.value = withDelay(460, withSpring(74, tooth));
    dotR.value = withDelay(680, withTiming(10, { duration: 120 }));
    dotY.value = withDelay(680, withSpring(12, { damping: 11, stiffness: 190, mass: 0.6 }));
    write.value = withDelay(820, withTiming(1, { duration: 720, easing: smooth }));
    nameY.value = withDelay(820, withTiming(0, { duration: 720, easing: smooth }));
    tag.value = withDelay(1380, withTiming(1, { duration: 420, easing: out }, (fin) => {
      if (fin) runOnJS(setAnimDone)(true);
    }));
  };

  // نخفي شاشة البداية الأصلية عندما ترسم المقدمة أول إطار، ثم نبدأ بعد أن تختفي فعلاً
  const onFirstLayout = () => {
    SplashScreen.hideAsync().catch(() => {}).finally(() => setTimeout(start, 140));
  };
  useEffect(() => {
    // شبكة أمان: إن لم يصل حدث الرسم لأي سبب
    const t = setTimeout(start, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // الخروج عندما تنتهي الحركة (مع وقفة قصيرة للتأمل) ويكون التطبيق جاهزاً
  useEffect(() => {
    if (!animDone || !ready || leaving.current) return;
    leaving.current = true;
    exit.value = withDelay(260, withTiming(1, { duration: 340, easing: Easing.inOut(Easing.cubic) }, (fin) => {
      if (fin) runOnJS(onDone)();
    }));
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
  const nameStyle = useAnimatedStyle(() => ({ transform: [{ translateY: nameY.value }] }));
  const maskStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -write.value * (wordW + FEATHER) }] }));
  const tagStyle = useAnimatedStyle(() => ({ opacity: tag.value, transform: [{ translateY: (1 - tag.value) * 6 }] }));
  const rootStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ scale: 1 + exit.value * 0.04 }],
  }));

  const onWord = (e: LayoutChangeEvent) => setWordW(Math.ceil(e.nativeEvent.layout.width));

  return (
    <Animated.View onLayout={onFirstLayout}
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100 }, rootStyle]}>
      <Pressable onPress={() => { start(); setAnimDone(true); }} style={{ alignItems: 'center' }} accessibilityLabel="تخطي المقدمة">
        <Svg width={124} height={124} viewBox="0 0 120 120">
          <ARect animatedProps={baseProps} y={84} height={20} rx={10} fill={c.ink} />
          <ARect animatedProps={b1} x={80} width={20} rx={10} fill={c.ink} />
          <ARect animatedProps={b2} x={50} width={20} rx={10} fill={c.ink} />
          <ARect animatedProps={b3} x={20} width={20} rx={10} fill={c.ink} />
          <ACircle animatedProps={dot} cx={30} fill={c.accent} />
        </Svg>

        {/* الاسم: يُكتب من اليمين لليسار — قناع بلون الخلفية ينسحب بحافة متدرجة */}
        {/* direction ثابت ltr داخل هذه الحاوية فقط: حتى لا يقلب وضع RTL موضع القناع واتجاه حركته */}
        <Animated.View style={[{ overflow: 'hidden', marginTop: 2, direction: 'ltr' }, nameStyle]} onLayout={onWord}>
          <Text style={{ fontFamily: fonts.display, fontSize: 66, lineHeight: 118, paddingHorizontal: 30, paddingBottom: 6, color: c.ink, writingDirection: 'rtl', textAlign: 'center', opacity: wordW ? 1 : 0 }}>
            سعي
          </Text>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: wordW + FEATHER, flexDirection: 'row' }, maskStyle]}>
            <View style={{ width: wordW, backgroundColor: c.bg }} />
            <Svg width={FEATHER} height="100%" style={{ marginLeft: -1 }}>
              <Defs>
                <LinearGradient id="feather" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={c.bg} stopOpacity={1} />
                  <Stop offset="1" stopColor={c.bg} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width={FEATHER} height="100%" fill="url(#feather)" />
            </Svg>
          </Animated.View>
        </Animated.View>

        <Animated.View style={[{ marginTop: 6 }, tagStyle]}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 17, lineHeight: 30, color: c.ink2, writingDirection: 'rtl' }}>
            اسعَ تُعفَ<Text style={{ color: c.accent }}>.</Text>
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
