import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StatusBar, View, useWindowDimensions } from 'react-native';
import { Alert } from '@/lib/dialog';
import { Portal } from './portal';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icon';
import { T } from './ui';

const SPRING = { damping: 22, stiffness: 260 };

/**
 * عرض صورة بملء الشاشة: تكبير بالإصبعين، نقرتان للتكبير/الإرجاع، سحب للأسفل للإغلاق،
 * وزر حفظ/مشاركة (يفتح قائمة الهاتف: حفظ في المعرض، إرسال، …).
 */
export function ImageViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const bg = useSharedValue(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!url) return;
    scale.value = 1; saved.value = 1; tx.value = 0; ty.value = 0; bg.value = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const reset = () => {
    'worklet';
    scale.value = withSpring(1, SPRING); saved.value = 1;
    tx.value = withSpring(0, SPRING); ty.value = withSpring(0, SPRING);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(0.8, Math.min(5, saved.value * e.scale)); })
    .onEnd(() => {
      if (scale.value < 1) reset();
      else saved.value = scale.value;
    });

  const pan = Gesture.Pan()
    .onStart(() => { startX.value = tx.value; startY.value = ty.value; })
    .onUpdate((e) => {
      if (scale.value > 1.01) {
        tx.value = startX.value + e.translationX;
        ty.value = startY.value + e.translationY;
      } else {
        // بدون تكبير: السحب للأسفل يغلق
        ty.value = Math.max(0, e.translationY);
        bg.value = 1 - Math.min(0.7, ty.value / 400);
      }
    })
    .onEnd((e) => {
      if (scale.value <= 1.01) {
        if (ty.value > 140 || e.velocityY > 1200) {
          ty.value = withTiming(height, { duration: 180 }, () => runOnJS(onClose)());
        } else {
          ty.value = withSpring(0, SPRING);
          bg.value = withTiming(1, { duration: 150 });
        }
      }
    });

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd((e) => {
    if (scale.value > 1.01) reset();
    else {
      scale.value = withSpring(2.5, SPRING); saved.value = 2.5;
      tx.value = withSpring((width / 2 - e.x) * 1.5, SPRING);
      ty.value = withSpring((height / 2 - e.y) * 1.5, SPRING);
    }
  });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));
  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));

  const share = async () => {
    if (!url) return;
    setBusy(true);
    try {
      const file = await File.downloadFileAsync(url, new File(Paths.cache, `saey-${Date.now()}.jpg`), { idempotent: true });
      await Sharing.shareAsync(file.uri, { mimeType: 'image/jpeg', dialogTitle: 'حفظ أو مشاركة الصورة' });
    } catch (e) {
      Alert.alert('تعذّر حفظ الصورة', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!url || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [url, onClose]);

  if (!url) return null;
  return (
    <Portal>
      <StatusBar barStyle="light-content" />
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, bgStyle]} />
        <GestureDetector gesture={gesture}>
          <Animated.View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, imgStyle]}>
            {url ? <Image source={{ uri: url }} style={{ width, height }} contentFit="contain" transition={120} /> : null}
          </Animated.View>
        </GestureDetector>
        <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Pressable onPress={onClose} accessibilityLabel="إغلاق" hitSlop={8}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={22} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={share} disabled={busy} accessibilityLabel="حفظ أو مشاركة"
            style={{ height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="download" size={20} color="#FFFFFF" />}
            <T size={14} weight="bold" color="#FFFFFF">حفظ / مشاركة</T>
          </Pressable>
        </View>
        <View style={{ position: 'absolute', bottom: insets.bottom + 16, left: 0, right: 0, alignItems: 'center' }} pointerEvents="none">
          <T size={12} color="rgba(255,255,255,0.6)">كبّر بإصبعين أو بنقرتين · اسحب للأسفل للإغلاق</T>
        </View>
      </GestureHandlerRootView>
    </Portal>
  );
}
