import { arDigits } from '@saey/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { RichText } from '@/components/rich-text';
import { Button, Card, Empty, Header, Loading, ProgressBar, Row, Screen, T } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { callFunction, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

interface Q { id: string; question: string; choices: string[]; answer: number; explanation: string | null }

export default function Quiz() {
  const { chapterId } = useLocalSearchParams<{ chapterId: string }>();
  const { c, verdict } = useTheme();
  const me = useMe();
  const { isStaff } = useAuth();
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [regen, setRegen] = useState(0);

  const q = useLoad(async () => {
    const res = await callFunction<{ questions: Q[] }>('quiz', { chapterId, regenerate: regen > 0 });
    // ترتيب عشوائي للأسئلة في كل مرة
    return [...res.questions].sort(() => Math.random() - 0.5);
  }, [chapterId, regen]);

  const qs = q.data ?? [];
  const cur = qs[i];

  const choose = (k: number) => {
    if (picked !== null) return;
    setPicked(k);
    if (k === cur.answer) setScore((s) => s + 1);
  };

  const next = async () => {
    if (i + 1 >= qs.length) {
      setFinished(true);
      await supabase.from('quiz_attempts').insert({ user_id: me.id, chapter_id: chapterId, score, total: qs.length });
      return;
    }
    setI(i + 1);
    setPicked(null);
  };

  const restart = () => {
    setI(0); setPicked(null); setScore(0); setFinished(false); q.reload();
  };

  if (q.loading) {
    return (
      <Screen>
        <Header title="اختبر نفسك" />
        <Loading />
        <T dim center>يجهّز المساعد الأسئلة… (أول مرة قد تأخذ نصف دقيقة)</T>
      </Screen>
    );
  }
  if (q.error) return <Screen><Header title="اختبر نفسك" /><Empty icon="quiz" title="تعذّر تجهيز الاختبار" body={q.error} action="إعادة المحاولة" onAction={q.reload} /></Screen>;

  if (finished) {
    const pct = qs.length ? score / qs.length : 0;
    return (
      <Screen>
        <Header title="النتيجة" />
        <Card tone="hero" style={{ alignItems: 'center', gap: 8, padding: 28 }}>
          <T display size={64} color={c.heroInk} style={{ lineHeight: 76 }}>{arDigits(score)}/{arDigits(qs.length)}</T>
          <T color={c.heroInk2}>{pct >= 0.9 ? 'ممتاز! هذا مستوى إعفاء' : pct >= 0.7 ? 'جيد جداً، راجع أخطاءك' : 'تحتاج مراجعة الفصل مرة أخرى'}</T>
        </Card>
        <Button title="إعادة الاختبار" icon="refresh" onPress={restart} />
        <Button title="رجوع للمادة" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!cur) return <Screen><Header title="اختبر نفسك" /><Empty icon="quiz" title="لا توجد أسئلة" /></Screen>;

  return (
    <Screen>
      <Header title="اختبر نفسك" right={isStaff ? <Button small variant="ghost" title="توليد جديد" onPress={() => setRegen(regen + 1)} /> : undefined} />
      <Row style={{ justifyContent: 'space-between' }}>
        <T dim>السؤال {arDigits(i + 1)} من {arDigits(qs.length)}</T>
        <T weight="bold" color={c.accent}>{arDigits(score)} صحيحة</T>
      </Row>
      <ProgressBar value={(i + (picked !== null ? 1 : 0)) / qs.length} />
      <Card style={{ padding: 18 }}>
        <RichText text={cur.question} size={18} />
      </Card>
      <View style={{ gap: 10 }}>
        {cur.choices.map((ch, k) => {
          const isRight = picked !== null && k === cur.answer;
          const isWrong = picked === k && k !== cur.answer;
          const col = isRight ? verdict.exempt : isWrong ? verdict.risk : null;
          return (
            <Pressable key={k} onPress={() => choose(k)} accessibilityRole="button"
              style={{ borderRadius: 18, borderWidth: 1.5, borderColor: col ? col.ink : c.line, backgroundColor: col ? col.bg : c.card, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: col ? col.ink : c.soft, alignItems: 'center', justifyContent: 'center' }}>
                <T weight="bold" size={14} color={col ? '#FFFFFF' : c.accent}>{['أ', 'ب', 'ج', 'د'][k]}</T>
              </View>
              <View style={{ flex: 1 }}><RichText text={ch} size={15} /></View>
            </Pressable>
          );
        })}
      </View>
      {picked !== null && cur.explanation ? (
        <Card tone="soft"><RichText text={cur.explanation} size={14} color={c.softInk} /></Card>
      ) : null}
      {picked !== null ? <Button title={i + 1 >= qs.length ? 'النتيجة' : 'التالي'} onPress={next} /> : null}
    </Screen>
  );
}
