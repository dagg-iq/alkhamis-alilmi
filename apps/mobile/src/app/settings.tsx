import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { Card, Divider, Header, ListItem, Row, Screen, Segmented, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { registerPush, unregisterPush } from '@/lib/push';
import { useTheme, type ThemeMode } from '@/lib/theme';

export default function Settings() {
  const { c, mode, setMode } = useTheme();
  const me = useMe();
  const { signOut } = useAuth();
  const [push, setPush] = useState(true);

  const togglePush = async (v: boolean) => {
    setPush(v);
    if (v) {
      const ok = await registerPush(me.id);
      if (!ok) {
        setPush(false);
        Alert.alert('الإشعارات', 'اسمح لسعي بإرسال الإشعارات من إعدادات الهاتف.');
      }
    } else await unregisterPush(me.id);
  };

  return (
    <Screen>
      <Header title="الإعدادات" />
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>المظهر</T>
        <Segmented<ThemeMode> options={[{ key: 'light', label: 'فاتح' }, { key: 'dark', label: 'غامق' }, { key: 'system', label: 'تلقائي' }]} value={mode} onChange={setMode} />
      </View>
      <Card style={{ paddingVertical: 4 }}>
        <Row style={{ justifyContent: 'space-between', paddingVertical: 12 }}>
          <View style={{ flex: 1 }}>
            <T weight="bold" size={16}>الإشعارات</T>
            <T dim size={13}>الأخبار، الرسائل، والواجبات الجديدة</T>
          </View>
          <Switch value={push} onValueChange={togglePush} trackColor={{ true: c.accent, false: c.line }} />
        </Row>
      </Card>
      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="user" title="تعديل ملفي" onPress={() => router.push(`/profile/${me.id}`)} />
        <Divider />
        <ListItem icon="logout" title="تسجيل الخروج" danger onPress={() => Alert.alert('تسجيل الخروج', 'هل تريد الخروج من حسابك؟', [
          { text: 'إلغاء', style: 'cancel' },
          { text: 'خروج', style: 'destructive', onPress: () => { unregisterPush(me.id).finally(signOut); } },
        ])} />
      </Card>
      <T dim size={12} center>سعي · الإصدار {Constants.expoConfig?.version ?? '1.0.0'} · إعدادية الشهاب للبنين</T>
    </Screen>
  );
}
