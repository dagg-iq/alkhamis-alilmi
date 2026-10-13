import { arDigits, timeAgo } from '@saey/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { LogoMark } from '@/components/icon';
import { Icon } from '@/components/icon';
import { PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, Header, Loading, Row, Screen, T } from '@/components/ui';
import { loadSubjects, shortSubject } from '@/lib/queries';
import { useAuth, useMe } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import { must, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function AiHome() {
  const { c } = useTheme();
  const me = useMe();
  const { isAdmin } = useAuth();
  const params = useLocalSearchParams<{ subjectId?: string; prompt?: string }>();
  const settings = useSettings();
  // حصة الطالب الخاصة (يضعها الأدمن) وإلا الحد العام
  const limit = me.ai_daily_limit ?? (settings.ai as { daily_limit?: number } | undefined)?.daily_limit ?? 20;
  const subjects = useLoad(() => loadSubjects(), [], { key: 'subjects' });
  const openSubject = (subjectId?: string) => router.push({ pathname: '/ai/[id]', params: { id: 'new', ...(subjectId ? { subjectId } : {}) } });

  // قادم من صفحة مادة أو أسئلة: افتح محادثة جديدة مباشرة
  useEffect(() => {
    if (params.subjectId || params.prompt) {
      router.replace({ pathname: '/ai/[id]', params: { id: 'new', subjectId: params.subjectId ?? '', prompt: params.prompt ?? '' } });
    }
  }, [params.subjectId, params.prompt]);

  const q = useLoad(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [chats, usage] = await Promise.all([
      must(supabase.from('ai_chats').select('id, title, updated_at').eq('user_id', me.id).order('updated_at', { ascending: false }).limit(40)),
      supabase.from('ai_usage').select('count').eq('user_id', me.id).eq('day', today).maybeSingle(),
    ]);
    return { chats: chats as { id: string; title: string; updated_at: string }[], used: usage.data?.count ?? 0 };
  }, [me.id], { key: `ai-chats:${me.id}` });
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const remove = (chatId: string) => Alert.alert('حذف المحادثة', '', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => { await supabase.from('ai_chats').delete().eq('id', chatId); q.reload(); } },
  ]);

  const remaining = Math.max(0, limit - (q.data?.used ?? 0));
  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header />
      <Card tone="hero" style={{ gap: 12, padding: 22 }}>
        <Row>
          <LogoMark size={44} ink="#FFFFFF" dot={c.accent === '#2346F5' ? '#7B92FF' : '#FFFFFF'} />
          <View style={{ flex: 1 }}>
            <T display size={26} color={c.heroInk}>مساعد سعي</T>
            <T size={13} color={c.heroInk2}>يجيب من ملازمكم ويذكر المصدر</T>
          </View>
        </Row>
        <T size={13} color={c.heroInk2}>
          {isAdmin ? 'بلا حد يومي (أدمن)' : `رصيدك اليوم: ${arDigits(remaining)} من ${arDigits(limit)} سؤالاً`}
        </T>
        <Button title="سؤال جديد" icon="sparkle" onPress={() => openSubject()} />
      </Card>
      {subjects.data?.length ? (
        <View style={{ gap: 8 }}>
          <T weight="bold" size={15}>ناقش مادة معيّنة</T>
          <T dim size={12}>اختر المادة فيبحث المساعد في كتبها وملازمها فقط ويناقشك فيها.</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {subjects.data.map((s) => (
              <PressScale key={s.id} onPress={() => openSubject(s.id)} haptic accessibilityRole="button" accessibilityLabel={`مناقشة ${s.name}`}
                style={{ flexGrow: 1, flexBasis: '30%', minWidth: 96, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 48, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.line }}>
                <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="book" size={15} color={c.accent} />
                </View>
                <T weight="bold" size={14} lines={1} style={{ flex: 1 }}>{shortSubject(s.name)}</T>
              </PressScale>
            ))}
          </View>
        </View>
      ) : null}
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : q.data!.chats.length ? (
        <>
          <T weight="bold" size={15}>محادثاتك</T>
          {q.data!.chats.map((ch) => (
            <Pressable key={ch.id} onPress={() => router.push({ pathname: '/ai/[id]', params: { id: ch.id } })} onLongPress={() => remove(ch.id)}>
              <Card style={{ gap: 2 }}>
                <T weight="bold" lines={1}>{ch.title}</T>
                <T dim size={12}>{timeAgo(new Date(ch.updated_at))}</T>
              </Card>
            </Pressable>
          ))}
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <T weight="bold" size={15}>جرّب أن تسأل:</T>
          {['اشرح لي قانون كولوم بمثال محلول', 'ما الفرق بين التفاعل الماص والباعث للحرارة؟', 'لخص لي أهم نقاط الفصل الأول في الأحياء'].map((s) => (
            <Card key={s} onPress={() => router.push({ pathname: '/ai/[id]', params: { id: 'new', prompt: s } })}>
              <T>{s}</T>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
