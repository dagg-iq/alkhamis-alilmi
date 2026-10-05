import { ThemeProvider, DarkTheme, DefaultTheme, Stack, router, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, LogBox, Platform, ScrollView, Text, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { onNotificationTap, registerPush } from '@/lib/push';
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

// تحذيرات معروفة وغير مؤثرة
LogBox.ignoreLogs(['WebCrypto API is not supported']);

SplashScreen.preventAutoHideAsync().catch(() => {});
// شبكة أمان: لا تبقى شاشة البداية أكثر من ١٠ ثوانٍ مهما حدث
setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 10000);

/** بدل التجمد: نعرض الخطأ بوضوح مع زر إعادة المحاولة */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28, gap: 14, backgroundColor: '#F5F5F2' }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: '#111111', textAlign: 'center' }}>حدث خطأ غير متوقع</Text>
      <Text selectable style={{ fontSize: 13, color: '#5C5C5C', textAlign: 'left', writingDirection: 'ltr' }}>{error.message}</Text>
      <Text onPress={retry} style={{ fontSize: 17, fontWeight: '700', color: '#2346F5', textAlign: 'center', padding: 12 }}>إعادة المحاولة</Text>
    </ScrollView>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  // إذا فشل تحميل الخط نكمل بخط النظام بدل التجمد
  if (!fontsLoaded && !fontError) return null;
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
    // نخفي شاشة البداية بعد أن تأخذ بوابة الدخول قرارها (حتى لا تومض الرئيسية)
    const hide = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 250);
    const segs = segments as string[];
    const group = segs[0];
    const page = segs[1];
    if (group === 'auth-callback') return () => clearTimeout(hide);
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
    return () => clearTimeout(hide);
  }, [ready, session, profile, segments]);

  // تسجيل الإشعارات بعد الموافقة
  const approvedId = profile?.status === 'approved' ? profile.id : null;
  useEffect(() => {
    if (approvedId) registerPush(approvedId);
  }, [approvedId]);

  // فتح الشاشة المناسبة عند الضغط على إشعار
  useEffect(() => {
    return onNotificationTap((d) => {
      if (d.conversation_id) router.push(`/chat/${d.conversation_id}`);
      else if (d.post_id) router.push(`/news/${d.post_id}`);
      else if (d.task_id) router.push('/planner');
      else router.push('/notifications');
    });
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
