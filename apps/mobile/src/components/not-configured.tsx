import { View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { LogoMark } from './icon';
import { T } from './ui';

/** تظهر إذا لم تُضبط مفاتيح Supabase في ملف .env */
export function NotConfigured() {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <LogoMark size={72} ink={c.ink} dot={c.accent} />
      <T display size={28} center>إعداد غير مكتمل</T>
      <T dim center>
        أضف EXPO_PUBLIC_SUPABASE_URL و EXPO_PUBLIC_SUPABASE_ANON_KEY في ملف apps/mobile/.env ثم أعد تشغيل التطبيق.
        التفاصيل في system/08-setup-guide.md
      </T>
    </View>
  );
}
