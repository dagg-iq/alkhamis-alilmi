import { arDigits } from '@saey/shared';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, Share, View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { DeveloperCard } from '@/components/rich-text';
import { Icon, LogoMark, type IconName } from '@/components/icon';
import { PressScale } from '@/components/motion';
import { DownloadStatus } from '@/components/update-sheet';
import { Button, Card, Divider, Header, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { checkForUpdate, currentBuild, startDownload, useDownload, type UpdateInfo } from '@/lib/updater';

const SITE = 'https://saeyiq.web.app';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'book', title: 'المواد والمحاضرات', body: 'محاضرات يوتيوب مرتبة بالفصول، وملازم PDF، وأسئلة متوقعة لكل مادة.' },
  { icon: 'target', title: 'الدرجات والإعفاء', body: 'يحسب لك كم تحتاج في كل امتحان حسب هدفك: نجاح أو إعفاء مواد أو إعفاء عام.' },
  { icon: 'sparkle', title: 'سعي AI', body: 'مساعد ذكي يعرف منهجك ودرجاتك، يشرح ويحل ويفتح لك المحاضرة عند الدقيقة المناسبة.' },
  { icon: 'scan', title: 'تحويل الورق إلى PDF', body: 'صوّر ورقة أسئلة فيحوّلها الذكاء الاصطناعي إلى ملف PDF بنفس تنسيقها، تحفظه أو ترسله لزملائك.' },
  { icon: 'timer', title: 'مؤقت الدراسة', body: 'يرنّ والتطبيق مغلق، ويعدّ لك الوقت في ستارة الإشعارات.' },
  { icon: 'chat', title: 'الدردشة', body: 'شعبتك ومدرستك ورسائل خاصة مع زملائك.' },
  { icon: 'calendar', title: 'المنظِّم والأخبار', body: 'واجباتك وامتحاناتك وأخبار المدرسة في مكان واحد، مع ويدجتات للشاشة الرئيسية.' },
];

export default function About() {
  const { c } = useTheme();
  const d = useDownload();
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  // جاء من إشعار «تعذّر التحميل»: نجلب معلومات النسخة فيظهر زر «إعادة المحاولة» مباشرة
  useEffect(() => { if (d.status === 'error') checkForUpdate(true).then((u) => u && setInfo(u)).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const u = await checkForUpdate(true);
      if (u) setInfo(u);
      else Alert.alert('لا يوجد تحديث', 'عندك آخر نسخة من سعي.');
    } catch {
      Alert.alert('تعذّر التحقق', 'تأكد من الإنترنت وحاول مرة أخرى.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen>
      <Header title="عن التطبيق" />

      <Card tone="hero" style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
        <View style={{ width: 84, height: 84, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
          <LogoMark size={52} ink={c.heroInk} dot={c.heroInk2} />
        </View>
        <T display size={34} color={c.heroInk} center>سعي</T>
        <T size={14} color={c.heroInk2} center>اسعَ تُعفَ.</T>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pill text={`الإصدار ${arDigits(version)}`} />
          {currentBuild ? <Pill text={`البناء ${arDigits(currentBuild)}`} /> : null}
        </View>
      </Card>

      <Card style={{ gap: 8 }}>
        <T weight="bold" size={17}>ما هو سعي؟</T>
        <T dim size={14} style={{ lineHeight: 24 }}>
          تطبيق عربي صُنع لطلاب الخامس العلمي في العراق، يجمع كل ما تحتاجه للدراسة في مكان واحد بدل أن يتشتت بين مجموعات الواتساب والتلغرام والروابط. فيه المحاضرات والملازم والأسئلة، ويتابع درجاتك ويحسب لك طريقك إلى الإعفاء، ويساعدك مساعد ذكي على الفهم والمراجعة.
        </T>
      </Card>

      <SectionTitle title="ماذا يقدّم لك" />
      <Card style={{ paddingVertical: 4 }}>
        {FEATURES.map((f, i) => (
          <View key={f.title}>
            {i ? <Divider /> : null}
            <Row style={{ paddingVertical: 12, alignItems: 'flex-start' }} gap={14}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={f.icon} size={20} color={c.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T weight="bold" size={15}>{f.title}</T>
                <T dim size={13} style={{ lineHeight: 21 }}>{f.body}</T>
              </View>
            </Row>
          </View>
        ))}
      </Card>

      <SectionTitle title="التحديثات" />
      <Card style={{ gap: 12 }}>
        <Row>
          <View style={{ flex: 1 }}>
            <T weight="bold" size={15}>نسختك {currentBuild ? arDigits(currentBuild) : arDigits(version)}</T>
            <T dim size={13}>{info ? `النسخة ${arDigits(info.version)} متاحة${info.sizeMb ? ` (${arDigits(info.sizeMb)} ميغا)` : ''}` : 'التطبيق يخبرك تلقائياً عند نشر نسخة جديدة.'}</T>
          </View>
        </Row>
        {info && d.status === 'idle' ? <Button title="حمّل التحديث" icon="download" onPress={() => startDownload(info)} /> : <DownloadStatus info={info} />}
        {!info && d.status !== 'downloading' ? <Button title={checking ? 'يتحقق…' : 'التحقق من التحديثات'} variant="secondary" icon="refresh" loading={checking} onPress={check} /> : null}
      </Card>

      <SectionTitle title="المطوّر" />
      <DeveloperCard />
      <T dim size={13} style={{ lineHeight: 22 }}>
        صممه وبرمجه محمد حازم احمد، طالب في الخامس العلمي بإعدادية الشهاب للبنين، ليخدم زملاءه. عندك فكرة أو وجدت خطأ؟ راسله مباشرة من الروابط أعلاه.
      </T>

      <SectionTitle title="المزيد" />
      <Card style={{ paddingVertical: 2 }}>
        <Link icon="link" title="موقع سعي" subtitle="saeyiq.web.app" onPress={() => Linking.openURL(SITE).catch(() => {})} />
        <Divider />
        <Link icon="share" title="شارك التطبيق مع زملائك" subtitle="أرسل رابط التنزيل" onPress={() => Share.share({ message: `حمّل تطبيق سعي لطلاب الخامس العلمي:\n${SITE}` }).catch(() => {})} />
      </Card>

      <View style={{ alignItems: 'center', gap: 4, paddingVertical: 10 }}>
        <T dim size={12} center>إعدادية الشهاب للبنين · الخامس العلمي</T>
        <T dim size={12} center>العام الدراسي {arDigits('2026')} - {arDigits('2027')}</T>
      </View>
    </Screen>
  );
}

function Pill({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
      <T size={12} weight="bold" color={c.heroInk}>{text}</T>
    </View>
  );
}

function Link({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle?: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} scaleTo={0.98} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <T weight="bold" size={15}>{title}</T>
        {subtitle ? <T dim size={13}>{subtitle}</T> : null}
      </View>
      <Icon name="forward" size={18} color={c.ink3} />
    </PressScale>
  );
}
