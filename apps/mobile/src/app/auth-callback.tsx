import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Loading, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/** يلتقط رابط العودة من Google إذا فتح التطبيق مباشرة */
export default function AuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  useEffect(() => {
    (async () => {
      if (code) await supabase.auth.exchangeCodeForSession(code).catch(() => {});
      router.replace('/');
    })();
  }, [code]);
  return (
    <Screen scroll={false}>
      <Loading spinner />
    </Screen>
  );
}
