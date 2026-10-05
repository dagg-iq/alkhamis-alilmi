import { ROLE_LABELS } from '@saey/shared';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Avatar, Card, Divider, Header, ListItem, NameLine, Row, Screen, T } from '@/components/ui';
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
  }, [me.section_id]);

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

      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="calendar" title="المنظِّم" subtitle="الواجبات والتحضيرات والامتحانات" onPress={() => router.push('/planner')} />
        <Divider />
        <ListItem icon="sparkle" title="المساعد الذكي" subtitle="اسأل عن أي شيء في المنهج" onPress={() => router.push('/ai')} />
        <Divider />
        <ListItem icon="timer" title="مؤقت الدراسة" subtitle="ركّز ٢٥ دقيقة وسجّل وقتك" onPress={() => router.push('/timer')} />
        <Divider />
        <ListItem icon="news" title="أخبار المدرسة" onPress={() => router.push('/news')} />
        <Divider />
        <ListItem icon="bell" title="الإشعارات" onPress={() => router.push('/notifications')} />
      </Card>

      {isStaff ? (
        <Card style={{ paddingVertical: 2 }}>
          <ListItem icon="scan" title="تصوير أسئلة امتحان" subtitle="صوّر ← نص واضح وPDF" onPress={() => router.push('/scan')} />
          <Divider />
          <ListItem icon="news" title="نشر خبر" onPress={() => router.push('/news/new')} />
        </Card>
      ) : null}

      <Card style={{ paddingVertical: 2 }}>
        <ListItem icon="settings" title="الإعدادات" onPress={() => router.push('/settings')} />
      </Card>
    </Screen>
  );
}
