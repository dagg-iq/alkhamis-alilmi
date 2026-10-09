import { arDigits } from '@saey/shared';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Alert } from '@/lib/dialog';
import { cancelDownload, checkForUpdate, installDownloaded, progressText, skipUpdate, startDownload, useDownload, type UpdateInfo } from '@/lib/updater';
import { useTheme } from '@/lib/theme';
import { LogoMark } from './icon';
import { Sheet } from './sheet';
import { Button, ProgressBar, T } from './ui';

/** يظهر مرة عند فتح التطبيق إذا نُشرت نسخة أحدث */
export function UpdateSheet({ enabled }: { enabled: boolean }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => { checkForUpdate().then(setInfo).catch(() => {}); }, 4000);
    return () => clearTimeout(t);
  }, [enabled]);
  return <UpdatePrompt info={info} onClose={() => { if (info) skipUpdate(info.version); setInfo(null); }} />;
}

/** شريط تقدم التحميل + زر التثبيت (يُستعمل في النافذة وفي شاشة «عن التطبيق») */
export function DownloadStatus({ info }: { info: UpdateInfo | null }) {
  const { c } = useTheme();
  const d = useDownload();
  const install = async () => {
    try {
      await installDownloaded(d.version || info?.version);
    } catch (e) {
      Alert.alert('تعذّر فتح التثبيت', `${e instanceof Error ? e.message : ''}\nيمكنك التحديث من موقع سعي: saeyiq.web.app`);
    }
  };
  if (d.status === 'idle') return null;
  if (d.status === 'downloading') {
    return (
      <View style={{ gap: 8 }}>
        <ProgressBar value={d.total ? d.received / d.total : 0} height={10} />
        <T dim center size={13}>{arDigits(progressText(d.received, d.total))}</T>
        <T dim center size={12}>يمكنك إخفاء النافذة وإكمال استخدام التطبيق؛ سيستمر التحميل ويظهر تقدمه في الإشعارات.</T>
        <Button title="إلغاء التحميل" variant="ghost" onPress={cancelDownload} />
      </View>
    );
  }
  if (d.status === 'ready') {
    return (
      <View style={{ gap: 8 }}>
        <T center weight="bold" color={c.accent}>اكتمل التحميل</T>
        <Button title="تثبيت الآن" icon="check" onPress={install} />
        <T dim center size={12}>أول مرة قد يطلب الهاتف السماح بالتثبيت من «سعي».</T>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <T center color="#C8312B">{d.error ?? 'تعذّر التحميل'}</T>
      {info ? <Button title="إعادة المحاولة" icon="refresh" onPress={() => startDownload(info)} /> : null}
    </View>
  );
}

export function UpdatePrompt({ info, onClose }: { info: UpdateInfo | null; onClose: () => void }) {
  const { c } = useTheme();
  const d = useDownload();
  const asked = useRef(false);
  // عند اكتمال التحميل والنافذة مفتوحة نفتح شاشة التثبيت مباشرة
  useEffect(() => {
    if (info && d.status === 'ready' && d.version === info.version && !asked.current) {
      asked.current = true;
      installDownloaded(info.version).catch(() => {});
    }
    if (d.status !== 'ready') asked.current = false;
  }, [info, d.status, d.version]);
  const active = d.status === 'downloading' && !!info && d.version === info.version;
  return (
    <Sheet visible={!!info} onClose={onClose}>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 6 }}>
        <LogoMark size={52} ink={c.ink} dot={c.accent} />
        <T display size={24} center>تحديث جديد متاح</T>
        <T dim center size={14}>
          النسخة {arDigits(info?.version ?? 0)}{info?.sizeMb ? ` · ${arDigits(info.sizeMb)} ميغا` : ''}.{'\n'}
          يُثبَّت فوق النسخة الحالية، وتبقى بياناتك كما هي.
        </T>
      </View>
      {d.status === 'idle' && info ? <Button title="حدّث الآن" icon="download" onPress={() => startDownload(info)} /> : <DownloadStatus info={info} />}
      <Button title={active ? 'إخفاء (يكمل التحميل)' : 'لاحقاً'} variant="ghost" onPress={onClose} />
    </Sheet>
  );
}
