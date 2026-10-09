import { View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOffline } from '@/lib/offline';
import { useTheme } from '@/lib/theme';
import { Icon } from './icon';
import { T } from './ui';

/** شريط صغير يظهر عند انقطاع الإنترنت: يعرض التطبيق آخر ما حفظه */
export function OfflineBanner() {
  const offline = useOffline();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} pointerEvents="none"
      style={{ position: 'absolute', bottom: insets.bottom + 88, left: 0, right: 0, alignItems: 'center', zIndex: 50 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: c.ink }}>
        <Icon name="info" size={15} color={c.bg} />
        <T size={12} weight="bold" color={c.bg}>بدون إنترنت — تعرض آخر ما حُفظ</T>
      </View>
    </Animated.View>
  );
}
