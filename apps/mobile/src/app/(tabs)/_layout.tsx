import { arDigits } from '@saey/shared';
import { Tabs } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/icon';
import { tap } from '@/components/motion';
import { T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { startPresence } from '@/lib/presence';
import { useTheme } from '@/lib/theme';
import { useUnreadCount } from '@/lib/unread';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'index', label: 'الرئيسية', icon: 'home' },
  { name: 'subjects', label: 'المواد', icon: 'book' },
  { name: 'grades', label: 'الدرجات', icon: 'chart' },
  { name: 'chat', label: 'الدردشة', icon: 'chat' },
  { name: 'more', label: 'المزيد', icon: 'more' },
];

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const approved = profile?.status === 'approved';
  const unread = useUnreadCount(approved, profile?.id);
  // «متصل الآن» للآخرين ما دام التطبيق مفتوحاً
  useEffect(() => (approved ? startPresence() : undefined), [approved]);

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}
      tabBar={({ state, navigation }) => (
        <View style={{
          flexDirection: 'row', backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line,
          paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: 6,
        }}>
          {state.routes.map((route, i) => {
            const tab = TABS.find((t) => t.name === route.name);
            if (!tab) return null;
            const focused = state.index === i;
            const color = focused ? c.accent : c.ink2;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.label}
                onPress={() => {
                  if (!focused) tap('select');
                  const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
                }}
                style={{ flex: 1, alignItems: 'center', gap: 3, minHeight: 48, justifyContent: 'center' }}>
                <TabIcon focused={focused}>
                  <Icon name={tab.icon} size={24} color={color} strokeWidth={tab.icon === 'chart' ? 2 : 1.8} />
                  {tab.name === 'chat' && unread > 0 ? (
                    <View style={{
                      position: 'absolute', top: -4, left: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
                      backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.card,
                    }}>
                      <T size={10} weight="bold" color={c.accentInk} style={{ lineHeight: 13 }}>{unread > 99 ? '+٩٩' : arDigits(unread)}</T>
                    </View>
                  ) : null}
                </TabIcon>
                <T size={12} weight={focused ? 'bold' : 'medium'} color={color} style={{ lineHeight: 20 }}>{tab.label}</T>
              </Pressable>
            );
          })}
        </View>
      )}>
      {TABS.map((t) => <Tabs.Screen key={t.name} name={t.name} />)}
    </Tabs>
  );
}

/** أيقونة التبويب: كبسولة خلفية تتمدد ونبضة عند التفعيل */
function TabIcon({ focused, children }: { focused: boolean; children: ReactNode }) {
  const { c } = useTheme();
  const v = useSharedValue(focused ? 1 : 0);
  const s = useSharedValue(1);
  useEffect(() => {
    v.value = withSpring(focused ? 1 : 0, { damping: 16, stiffness: 220 });
    if (focused) s.value = withSequence(withTiming(1.16, { duration: 120 }), withSpring(1, { damping: 8, stiffness: 240 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  const pill = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scaleX: 0.4 + v.value * 0.6 }] }));
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: s.value }, { translateY: -v.value }] }));
  return (
    <View style={{ width: 60, height: 30, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 15, backgroundColor: c.soft }, pill]} />
      <Animated.View style={icon}>{children}</Animated.View>
    </View>
  );
}
