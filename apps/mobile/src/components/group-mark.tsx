import { Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { fonts, useTheme } from '@/lib/theme';
import { Icon, LogoMark } from './icon';

/** «شعبة أ» ← «أ» */
export function sectionLetter(title: string) {
  const t = title.replace(/^شعبة\s*/, '').trim();
  return t || '؟';
}

/**
 * شعار الشعبة: دائرة مسطحة بلون الحبر وحرف الشعبة في وسطها، ونقطة زرقاء صغيرة
 * (نقطة الإعفاء من شعار سعي). بسيط ونظيف مثل صور المجموعات في تلغرام.
 */
export function SectionMark({ name, size = 52 }: { name: string; size?: number }) {
  const { c } = useTheme();
  const letter = sectionLetter(name);
  const fontSize = Math.round(size * (letter.length > 1 ? 0.36 : 0.46));
  const dot = Math.max(8, Math.round(size * 0.24));
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`شعبة ${letter}`}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
        {/* مسافة سطر آمنة + إزاحة بسيطة: مركز الحروف العربية بصرياً أعلى من مركز صندوق الخط */}
        <Text style={{ fontFamily: fonts.bold, fontSize, lineHeight: Math.ceil(fontSize * 1.62), color: c.bg, textAlign: 'center', marginTop: fontSize * 0.08 }}>
          {letter}
        </Text>
      </View>
      {size >= 30 ? (
        <View style={{
          position: 'absolute', top: size * 0.02, left: size * 0.02, width: dot, height: dot, borderRadius: dot / 2,
          backgroundColor: c.accent, borderWidth: Math.max(2, size * 0.04), borderColor: c.bg,
        }} />
      ) : null}
    </View>
  );
}

/** رمز إعدادية الشهاب: شهاب أبيض (رأس وذيل) على الأزرق */
export function SchoolMark({ size = 52 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#2346F5', alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel="إعدادية الشهاب">
      <Svg width={size * 0.62} height={size * 0.62} viewBox="0 0 100 100">
        <Line x1="44" y1="56" x2="84" y2="16" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" />
        <Line x1="58" y1="66" x2="86" y2="38" stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" opacity={0.6} />
        <Line x1="34" y1="42" x2="62" y2="14" stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" opacity={0.6} />
        <Circle cx="32" cy="68" r="20" fill="#FFFFFF" />
      </Svg>
    </View>
  );
}

/** مساعد سعي (الذكاء الاصطناعي) في قائمة الدردشة */
export function AssistantMark({ size = 52 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.heroBg, alignItems: 'center', justifyContent: 'center' }}>
      <LogoMark size={size * 0.54} ink="#FFFFFF" dot={c.heroBg === '#111111' ? '#7B92FF' : '#FFFFFF'} />
    </View>
  );
}

/** صورة المحادثة حسب نوعها */
export function ConversationMark({ type, title, size = 52 }: { type: 'school' | 'section' | 'group'; title: string; size?: number }) {
  const { c } = useTheme();
  if (type === 'school') return <SchoolMark size={size} />;
  if (type === 'section') return <SectionMark name={title} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="users" size={size * 0.46} color={c.accent} />
    </View>
  );
}
