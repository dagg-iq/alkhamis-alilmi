import { arDigits } from '@saey/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { Card, ErrorBox, Header, Loading, ProgressBar, Row, Screen, T } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { loadSubjectProgress, loadSubjects } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export default function Subjects() {
  const { c } = useTheme();
  const me = useMe();
  const q = useLoad(async () => {
    const [subjects, progress] = await Promise.all([loadSubjects(), loadSubjectProgress(me.id)]);
    return { subjects, progress };
  }, [me.id], { key: `subjects-tab:${me.id}` });
  useFocusEffect(useCallback(() => {
    q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Header back={false} title="المواد" subtitle="المحاضرات، الملازم، والأسئلة لكل مادة" />
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : (
        <View style={{ gap: 10 }}>
          {q.data!.subjects.map((s, i) => {
            const p = q.data!.progress[s.id];
            const pct = p && p.total ? p.watched / p.total : 0;
            return (
              <Card key={s.id} onPress={() => router.push(`/subject/${s.id}`)} style={{ gap: 12 }}>
                <Row>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                    <T display size={20} color={c.accent}>{arDigits(i + 1)}</T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T weight="bold" size={17}>{s.name}</T>
                    <T dim size={13}>{p ? `شاهدت ${arDigits(p.watched)} من ${arDigits(p.total)} محاضرة` : 'لا توجد محاضرات بعد'}</T>
                  </View>
                  <T weight="bold" size={15} color={c.accent}>{arDigits(Math.round(pct * 100))}٪</T>
                </Row>
                <ProgressBar value={pct} height={4} />
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
