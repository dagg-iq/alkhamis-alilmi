import Constants from 'expo-constants';
import { router } from 'expo-router';
import { GOALS, arDigits, type Goal } from '@saey/shared';
import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import type { IconName } from '@/components/icon';
import { Card, Divider, Header, ListItem, Row, Screen, Segmented, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { pushRegistered, registerPush, unregisterPush } from '@/lib/push';
import { UpdatePrompt } from '@/components/update-sheet';
import { checkForUpdate, currentBuild, type UpdateInfo } from '@/lib/updater';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { setGoal, useGoal } from '@/lib/goal';
import { readWidgetTheme, type WidgetTheme } from '@/widgets/data';
import { pinWidget, setWidgetTheme, widgetsSupported } from '@/widgets/sync';

const WIDGETS: { name: string; title: string; body: string; icon: IconName }[] = [
  { name: 'Exemption', title: 'هدفي', body: 'معدلك وكم تحتاج في كل امتحان', icon: 'target' },
  { name: 'NextExam', title: 'الامتحان القادم', body: 'عدّ تنازلي لأقرب امتحان', icon: 'calendar' },
  { name: 'Tasks', title: 'مهامي', body: 'الواجبات والتحضيرات القادمة', icon: 'check' },
  { name: 'Overview', title: 'لمحة سعي', body: 'المعدل والامتحان والرسائل في سطر', icon: 'home' },
  { name: 'News', title: 'أخبار المدرسة', body: 'آخر خبر من الإدارة', icon: 'news' },
  { name: 'Quick', title: 'اختصارات', body: 'اسأل سعي، صوّر سؤال، المؤقت', icon: 'sparkle' },
];

async function addWidget(name: string) {
  const ok = await pinWidget(name);
  if (!ok) Alert.alert('إضافة ويدجت', 'اضغط مطولاً على مكان فارغ في الشاشة الرئيسية ← ويدجت ← سعي، واسحب الويدجت الذي تريده.');
}

export default function Settings() {
  const { c, mode, setMode } = useTheme();
  const me = useMe();
  const { signOut } = useAuth();
  const [push, setPush] = useState(true);
  const goal = useGoal();
  const [wTheme, setWTheme] = useState<WidgetTheme>('system');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    readWidgetTheme().then(setWTheme);
    pushRegistered(me.id).then(setPush).catch(() => {});
  }, [me.id]);

  const togglePush = async (v: boolean) => {
    setPush(v);
    if (v) {
      const r = await registerPush(me.id);
      if (r !== 'ok') {
        setPush(false);
        Alert.alert('الإشعارات', {
          denied: 'اسمح لسعي بإرسال الإشعارات من إعدادات الهاتف ← التطبيقات ← سعي ← الإشعارات.',
          'not-configured': 'الإشعارات الفورية لم تُفعّل في هذه النسخة بعد (تحتاج ربط Firebase من الأدمن). ستعمل تلقائياً في النسخة القادمة بعد ربطها.',
          unsupported: 'الإشعارات تعمل في ملف APK على الهاتف فقط (ليس في Expo Go).',
          error: 'تعذّر تسجيل الجهاز. تحقق من الإنترنت وحاول مرة أخرى.',
        }[r]);
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
      <View style={{ gap: 8 }}>
        <T weight="bold" size={14}>هدفي هذه السنة</T>
        <Segmented<Goal> options={[...GOALS].reverse().map((g) => ({ key: g.key, label: g.short }))} value={goal ?? 'general'} onChange={setGoal} />
        <T dim size={12}>صفحة الدرجات والويدجت يحسبان كم تحتاج حسب هدفك.</T>
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
      {widgetsSupported ? (
        <View style={{ gap: 8 }}>
          <T weight="bold" size={14}>ويدجتات الشاشة الرئيسية</T>
          <Segmented<WidgetTheme> options={[{ key: 'light', label: 'فاتحة' }, { key: 'dark', label: 'داكنة' }, { key: 'system', label: 'حسب الهاتف' }]}
            value={wTheme} onChange={(t) => { setWTheme(t); setWidgetTheme(t); }} />
          <Card style={{ paddingVertical: 2 }}>
            {WIDGETS.map((w, i) => (
              <View key={w.name}>
                {i ? <Divider /> : null}
                <ListItem icon={w.icon} title={w.title} subtitle={w.body} onPress={() => addWidget(w.name)}
                  right={<T weight="bold" size={13} color={c.accent}>إضافة</T>} />
              </View>
            ))}
          </Card>
          <T dim size={12}>أو اضغط مطولاً على الشاشة الرئيسية ← ويدجت ← سعي. تتحدث تلقائياً كل نصف ساعة وعند خروجك من التطبيق.</T>
        </View>
      ) : null}
      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="user" title="تعديل ملفي" onPress={() => router.push(`/profile/${me.id}`)} />
        <Divider />
        <ListItem icon="download" title={checking ? 'يتحقق…' : 'التحقق من التحديثات'} subtitle={currentBuild ? `نسختك ${arDigits(currentBuild)}` : undefined}
          onPress={async () => {
            if (checking) return;
            setChecking(true);
            try {
              const u = await checkForUpdate(true);
              if (u) setUpdate(u);
              else Alert.alert('لا يوجد تحديث', 'عندك آخر نسخة من سعي.');
            } catch {
              Alert.alert('تعذّر التحقق', 'تأكد من الإنترنت وحاول مرة أخرى.');
            } finally {
              setChecking(false);
            }
          }} />
        <Divider />
        <ListItem icon="logout" title="تسجيل الخروج" danger onPress={() => Alert.alert('تسجيل الخروج', 'هل تريد الخروج من حسابك؟', [
          { text: 'إلغاء', style: 'cancel' },
          { text: 'خروج', style: 'destructive', onPress: () => { unregisterPush(me.id).finally(signOut); } },
        ])} />
      </Card>
      <UpdatePrompt info={update} onClose={() => setUpdate(null)} />
      <T dim size={12} center>سعي · الإصدار {Constants.expoConfig?.version ?? '1.0.0'} · إعدادية الشهاب للبنين</T>
    </Screen>
  );
}
