import { ROLE_LABELS } from '@saey/shared';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Avatar, SectionTitle, Card, Divider, Header, ListItem, NameLine, Row, Screen, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { useLoad } from '@/lib/use-load';
import { supabase } from '@/lib/supabase';

export default function More() {
  const me = useMe();
  const { isStaff } = useAuth();
  const section = useLoad(async () => {
    if (!me.section_id) return null;
    const { data } = await supabase.from('sections').select('name').eq('id', me.section_id).single();
    return data?.name ?? null;
  }, [me.section_id], { key: `section:${me.section_id}` });

  return (
    <Screen>
      <Header back={false} title="المزيد" />
      <Card onPress={() => router.push(`/profile/${me.id}`)}>
        <Row>
          <Avatar name={me.full_name} url={me.avatar_url} size={56} verified={me.is_verified} />
          <View style={{ flex: 1 }}>
            <NameLine name={me.full_name} verified={me.is_verified} size={17} />
            <T dim size={13}>{me.role !== 'student' ? ROLE_LABELS[me.role] : 'طالب'}{section.data ? ` · شعبة ${section.data}` : ''}</T>
          </View>
        </Row>
      </Card>

      <SectionTitle title="دراستي" />
      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="table" title="الجداول" subtitle="الحصص الأسبوعية والامتحانات" onPress={() => router.push('/schedules')} />
        <Divider />
        <ListItem icon="calendar" title="المنظِّم" subtitle="الواجبات والتحضيرات والامتحانات" onPress={() => router.push('/planner')} />
        <Divider />
        <ListItem icon="timer" title="مؤقت الدراسة" subtitle="ركّز ٢٥ دقيقة وسجّل وقتك" onPress={() => router.push('/timer')} />
      </Card>

      <SectionTitle title="الأدوات الذكية" />
      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="sparkle" title="مساعد سعي" subtitle="اسأل عن أي شيء في المنهج" onPress={() => router.push('/ai')} />
        <Divider />
        <ListItem icon="scan" title="تحويل ورقة إلى PDF" subtitle="صوّر ورقة فتعود ملفاً مرتباً" onPress={() => router.push('/scan')} />
      </Card>

      <SectionTitle title="المدرسة" />
      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="news" title="أخبار المدرسة" subtitle="العطل والامتحانات والتبليغات" onPress={() => router.push('/news')} />
        <Divider />
        <ListItem icon="bell" title="الإشعارات" subtitle="كل ما وصلك من سعي" onPress={() => router.push('/notifications')} />
      </Card>

      {isStaff ? (
        <>
          <SectionTitle title="للمشرفين" />
          <Card style={{ paddingVertical: 2 }}>
            <ListItem icon="news" title="نشر خبر" subtitle="يصل إشعاراً لكل الطلاب" onPress={() => router.push('/news/new')} />
            <Divider />
            <ListItem icon="quiz" title="إضافة أسئلة" subtitle="من صور (مع تحويل ذكي اختياري)" onPress={() => router.push('/scan')} />
          </Card>
        </>
      ) : null}

      <SectionTitle title="الحساب" />
      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="settings" title="الإعدادات" subtitle="المظهر والهدف والإشعارات" onPress={() => router.push('/settings')} />
        <Divider />
        <ListItem icon="info" title="عن التطبيق" subtitle="النسخة والمطوّر وروابط التواصل" onPress={() => router.push('/about')} />
      </Card>
    </Screen>
  );
}
