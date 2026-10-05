import { useState } from 'react';
import { View } from 'react-native';
import { LogoMark } from '@/components/icon';
import { Avatar, Button, Card, Screen, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function Pending() {
  const { c } = useTheme();
  const { profile, refreshProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const rejected = profile?.status === 'rejected';
  const banned = profile?.status === 'banned';

  const retry = async () => {
    setBusy(true);
    // يعيد الطالب المرفوض إلى شاشة البيانات ليعدلها ويرسلها من جديد
    await supabase.from('profiles').update({ onboarded: false }).eq('id', profile!.id);
    await refreshProfile();
    setBusy(false);
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 24 }}>
        <LogoMark size={72} ink={c.ink} dot={banned || rejected ? '#C8312B' : c.accent} />
        <View style={{ gap: 8 }}>
          <T display size={32}>
            {banned ? 'الحساب موقوف' : rejected ? 'لم يُقبل طلبك' : 'طلبك بانتظار الموافقة'}
          </T>
          <T dim size={16}>
            {banned
              ? 'تم إيقاف حسابك من قبل الإدارة. راجع الأدمن إذا كان هناك خطأ.'
              : rejected
                ? 'تأكد أن اسمك الثلاثي وشعبتك صحيحة، ثم أرسل الطلب من جديد.'
                : 'سيراجع الأدمن طلبك قريباً، وستُفتح لك كل الأقسام تلقائياً فور الموافقة.'}
          </T>
        </View>
        {profile ? (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={profile.full_name} url={profile.avatar_url} />
            <View style={{ flex: 1 }}>
              <T weight="bold">{profile.full_name}</T>
              <T dim size={13}>{banned ? 'موقوف' : rejected ? 'مرفوض' : 'قيد المراجعة'}</T>
            </View>
          </Card>
        ) : null}
      </View>
      <View style={{ gap: 10 }}>
        {rejected ? <Button title="تعديل البيانات وإعادة الإرسال" onPress={retry} loading={busy} /> : null}
        {!rejected && !banned ? <Button title="تحديث" variant="secondary" icon="refresh" onPress={refreshProfile} /> : null}
        <Button title="تسجيل الخروج" variant="ghost" onPress={signOut} />
      </View>
    </Screen>
  );
}
