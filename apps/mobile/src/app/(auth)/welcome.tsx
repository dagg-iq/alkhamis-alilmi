import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { LogoMark } from '@/components/icon';
import { enter } from '@/components/motion';
import { Button, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
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
        <Animated.View entering={enter(0)} style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <LogoMark size={96} ink={c.ink} dot={c.accent} />
          <T display size={96} style={{ lineHeight: 110 }}>سعي</T>
        </Animated.View>
        <Animated.View entering={enter(2)} style={{ gap: 10 }}>
          <T display size={36} style={{ lineHeight: 46 }}>
            اسعَ <T display size={36} color={c.accent}>تُعفَ.</T>
          </T>
          <T dim size={17} style={{ lineHeight: 30 }}>
            المحاضرات، الملازم، الأسئلة، ودرجاتك محسوبة بدقة نحو الإعفاء — في مكان واحد لطلاب الخامس العلمي.
          </T>
        </Animated.View>
      </View>
      <Animated.View entering={enter(4)} style={{ gap: 12 }}>
        <Button title="الدخول بحساب Google" icon="user" onPress={signIn} loading={busy} />
        <T dim size={12} center>إعدادية الشهاب للبنين · يدخل الطالب بعد موافقة الإدارة</T>
      </Animated.View>
    </View>
  );
}
