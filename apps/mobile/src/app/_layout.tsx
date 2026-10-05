import { ThemeProvider, DarkTheme, DefaultTheme, Stack, router, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { I18nManager, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { registerPush } from '@/lib/push';
import { isConfigured } from '@/lib/supabase';
import { AppThemeProvider, fontAssets, useTheme } from '@/lib/theme';
import { NotConfigured } from '@/components/not-configured';

// التطبيق عربي بالكامل: من اليمين لليسار
if (Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
  I18nManager.swapLeftAndRightInRTL(true);
} else if (typeof document !== 'undefined') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'ar';
}

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts(fontAssets);
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppThemeProvider>
          {isConfigured ? (
            <AuthProvider>
              <Navigator />
            </AuthProvider>
          ) : (
            <NotConfigured />
          )}
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Navigator() {
  const { ready, session, profile } = useAuth();
  const { c, dark } = useTheme();
  const segments = useSegments();

  // بوابة الدخول: إلى أين يذهب المستخدم حسب حالته
  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    const segs = segments as string[];
    const group = segs[0];
    const page = segs[1];
    if (group === 'auth-callback') return;
    if (!session) {
      if (group !== '(auth)' || page !== 'welcome') router.replace('/welcome');
    } else if (!profile) {
      // ننتظر تحميل الملف الشخصي
    } else if (!profile.onboarded) {
      if (page !== 'onboarding') router.replace('/onboarding');
    } else if (profile.status !== 'approved') {
      if (page !== 'pending') router.replace('/pending');
    } else if (group === '(auth)') {
      router.replace('/');
    }
  }, [ready, session, profile, segments]);

  // تسجيل الإشعارات بعد الموافقة
  const approvedId = profile?.status === 'approved' ? profile.id : null;
  useEffect(() => {
    if (approvedId) registerPush(approvedId);
  }, [approvedId]);

  // فتح الشاشة المناسبة عند الضغط على إشعار
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const d = res.notification.request.content.data as Record<string, string> | undefined;
      if (!d) return;
      if (d.conversation_id) router.push(`/chat/${d.conversation_id}`);
      else if (d.post_id) router.push(`/news/${d.post_id}`);
      else if (d.task_id) router.push('/planner');
      else router.push('/notifications');
    });
    return () => sub.remove();
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: { ...(dark ? DarkTheme : DefaultTheme).colors, background: c.bg, card: c.card, text: c.ink, border: c.line, primary: c.accent },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_left' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="grades/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="planner/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </ThemeProvider>
  );
}
