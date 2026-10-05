import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from '@/components/icon';
import { Button, T } from '@/components/ui';
import { authRedirectUrl, useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function Welcome() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      Alert.alert('تعذّر الدخول', e instanceof Error ? e.message : 'حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 28 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <LogoMark size={96} ink={c.ink} dot={c.accent} />
          <T display size={96} style={{ lineHeight: 110 }}>سعي</T>
        </View>
        <View style={{ gap: 10 }}>
          <T display size={36} style={{ lineHeight: 46 }}>
            اسعَ <T display size={36} color={c.accent}>تُعفَ.</T>
          </T>
          <T dim size={17} style={{ lineHeight: 30 }}>
            المحاضرات، الملازم، الأسئلة، ودرجاتك محسوبة بدقة نحو الإعفاء — في مكان واحد لطلاب الخامس العلمي.
          </T>
        </View>
      </View>
      <View style={{ gap: 12 }}>
        <Button title="الدخول بحساب Google" icon="user" onPress={signIn} loading={busy} />
        <T dim size={12} center>إعدادية الشهاب للبنين · يدخل الطالب بعد موافقة الإدارة</T>
        {__DEV__ ? (
          // وضع التجربة فقط: رابط العودة الذي يجب إضافته في Supabase → Redirect URLs
          <Pressable onPress={() => { Clipboard.setStringAsync(authRedirectUrl()); Alert.alert('نُسخ الرابط', authRedirectUrl()); }}
            style={{ marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: c.soft }}>
            <T size={11} color={c.softInk} center>رابط العودة (اضغط للنسخ):</T>
            <T size={12} weight="bold" color={c.softInk} center selectable>{authRedirectUrl()}</T>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
