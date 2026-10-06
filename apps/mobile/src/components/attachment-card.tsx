import type { Attachment } from '@saey/shared';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { openAttachment, ATTACHMENT_LABELS } from '@/lib/chat';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Icon } from './icon';
import { T } from './ui';

type Linked = Exclude<Attachment, { type: 'image' }>;

/**
 * بطاقة مرفق من المنهج داخل الدردشة:
 * المحاضرة بصورتها من يوتيوب وزر تشغيل، والملزمة والأسئلة بأيقونة واضحة وسطر تعريف.
 */
export function AttachmentCard({ a, mine }: { a: Linked; mine: boolean }) {
  const { c } = useTheme();
  const [thumb, setThumb] = useState<string | undefined>(a.thumb);

  // المرفقات القديمة لا تحمل معرّف الفيديو: نجلبه مرة واحدة
  useEffect(() => {
    if (a.type !== 'lecture' || a.thumb) return;
    let alive = true;
    supabase.from('lectures').select('youtube_id').eq('id', a.id).maybeSingle()
      .then(({ data }) => { if (alive && data?.youtube_id) setThumb(data.youtube_id); });
    return () => { alive = false; };
  }, [a.id, a.type, a.thumb]);

  const ink = mine ? '#FFFFFF' : c.ink;
  const sub = mine ? 'rgba(255,255,255,0.75)' : c.ink2;
  const panel = mine ? 'rgba(255,255,255,0.14)' : c.soft;

  if (a.type === 'lecture') {
    return (
      <Pressable onPress={() => openAttachment(a)} accessibilityRole="button" accessibilityLabel={`محاضرة: ${a.title}`}
        style={({ pressed }) => ({ width: 248, borderRadius: 16, overflow: 'hidden', backgroundColor: panel, opacity: pressed ? 0.85 : 1 })}>
        <View style={{ width: 248, height: 140, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' }}>
          {thumb ? (
            <Image source={{ uri: `https://i.ytimg.com/vi/${thumb}/hqdefault.jpg` }} contentFit="cover" transition={150}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          ) : null}
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="play" size={22} color="#FFFFFF" />
          </View>
          <View style={{ position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)' }}>
            <T size={11} weight="bold" color="#FFFFFF">محاضرة</T>
          </View>
        </View>
        <View style={{ padding: 10, gap: 1 }}>
          <T weight="bold" size={14} color={ink} lines={2}>{a.title}</T>
          {a.subtitle ? <T size={12} color={sub} lines={1}>{a.subtitle}</T> : null}
        </View>
      </Pressable>
    );
  }

  const icon = a.type === 'document' ? 'file' : 'quiz';
  return (
    <Pressable onPress={() => openAttachment(a)} accessibilityRole="button" accessibilityLabel={`${ATTACHMENT_LABELS[a.type]}: ${a.title}`}
      style={({ pressed }) => ({ width: 248, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: panel, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width: 46, height: 54, borderRadius: 10, backgroundColor: mine ? 'rgba(255,255,255,0.2)' : c.card, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={mine ? '#FFFFFF' : c.accent} />
        {a.type === 'document' ? (
          <View style={{ position: 'absolute', bottom: 4, paddingHorizontal: 4, borderRadius: 4, backgroundColor: mine ? '#FFFFFF' : c.accent }}>
            <T size={8} weight="bold" color={mine ? c.accent : c.accentInk}>PDF</T>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <T size={11} weight="bold" color={sub}>{ATTACHMENT_LABELS[a.type]}</T>
        <T weight="bold" size={14} color={ink} lines={2}>{a.title}</T>
        {a.subtitle ? <T size={12} color={sub} lines={1}>{a.subtitle}</T> : null}
      </View>
      <Icon name="forward" size={16} color={sub} />
    </Pressable>
  );
}
