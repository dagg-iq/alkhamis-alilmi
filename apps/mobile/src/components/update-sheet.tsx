import { arDigits } from '@saey/shared';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { checkForUpdate, downloadAndInstall, skipUpdate, type UpdateInfo } from '@/lib/updater';
import { useTheme } from '@/lib/theme';
import { LogoMark } from './icon';
import { Sheet } from './sheet';
import { Button, T } from './ui';

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

export function UpdatePrompt({ info, onClose }: { info: UpdateInfo | null; onClose: () => void }) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const update = async () => {
    if (!info) return;
    setBusy(true);
    try {
      await downloadAndInstall(info);
    } catch (e) {
      Alert.alert('تعذّر التحديث', `${e instanceof Error ? e.message : ''}\nيمكنك التحديث من موقع سعي: saeyiq.web.app`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!info} onClose={busy ? () => {} : onClose}>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 6 }}>
        <LogoMark size={52} ink={c.ink} dot={c.accent} />
        <T display size={24} center>تحديث جديد متاح</T>
        <T dim center size={14}>
          النسخة {arDigits(info?.version ?? 0)}{info?.sizeMb ? ` · ${arDigits(info.sizeMb)} ميغا` : ''}.{'\n'}
          يُثبَّت فوق النسخة الحالية، وتبقى بياناتك كما هي.
        </T>
      </View>
      <Button title={busy ? 'يحمّل التحديث…' : 'حدّث الآن'} icon="download" loading={busy} onPress={update} />
      <Button title="لاحقاً" variant="ghost" onPress={onClose} disabled={busy} />
      {busy ? <T dim center size={12}>بعد التحميل اضغط «تثبيت». أول مرة قد يطلب الهاتف السماح بالتثبيت من «سعي».</T> : null}
    </Sheet>
  );
}
