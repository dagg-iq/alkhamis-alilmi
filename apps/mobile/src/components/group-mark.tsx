import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { fonts, useTheme } from '@/lib/theme';
import { Icon, LogoMark } from './icon';
import { T } from './ui';

/** لون مميز لكل شعبة (ثابت حسب الحرف) */
const SECTION_COLORS: Record<string, [string, string]> = {
  'أ': ['#2346F5', '#0F1E8C'],
  'ب': ['#0E9F6E', '#05553A'],
  'ج': ['#F2701B', '#9A3A05'],
  'د': ['#8B3DF0', '#46128F'],
  'هـ': ['#E0245E', '#7E0B30'],
  'و': ['#0891B2', '#08455A'],
  'ز': ['#CA8A04', '#6B4703'],
  'ح': ['#4F46E5', '#231E7A'],
};
const FALLBACK: [string, string][] = Object.values(SECTION_COLORS);

/** «شعبة أ» ← «أ» */
export function sectionLetter(title: string) {
  const t = title.replace(/^شعبة\s*/, '').trim();
  return t || '؟';
}

export function sectionColors(letter: string): [string, string] {
  if (SECTION_COLORS[letter]) return SECTION_COLORS[letter];
  let h = 0;
  for (const ch of letter) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

/**
 * شعار الشعبة: مربع بزوايا ناعمة بتدرج لون الشعبة، حرفها كبير بخط العناوين،
 * وأسنان «سعي» الثلاث خفيفة في الزاوية — كل شعبة لها هوية واضحة.
 */
export function SectionMark({ name, size = 52 }: { name: string; size?: number }) {
  const letter = sectionLetter(name);
  const [from, to] = sectionColors(letter);
  const id = `g${letter.charCodeAt(0)}`;
  const r = size * 0.32;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`شعبة ${letter}`}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" rx={(r / size) * 100} fill={`url(#${id})`} />
        <Circle cx="92" cy="8" r="34" fill="#FFFFFF" opacity={0.1} />
        <Circle cx="92" cy="8" r="20" fill="#FFFFFF" opacity={0.08} />
        {/* أسنان سعي (تختفي في الأحجام الصغيرة حتى يبقى الحرف واضحاً) */}
        {size >= 40 ? <>
        <Rect x="12" y="68" width="6" height="20" rx="3" fill="#FFFFFF" opacity={0.35} />
        <Rect x="21" y="62" width="6" height="26" rx="3" fill="#FFFFFF" opacity={0.35} />
        <Rect x="30" y="56" width="6" height="32" rx="3" fill="#FFFFFF" opacity={0.35} />
        </> : null}
      </Svg>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <T display color="#FFFFFF" size={size * (letter.length > 1 ? 0.42 : 0.52)} style={{ fontFamily: fonts.display, lineHeight: size * 0.8, marginTop: size * 0.1 }}>
          {letter}
        </T>
      </View>
    </View>
  );
}

/** شعار المدرسة */
export function SchoolMark({ size = 52 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: c.heroBg, alignItems: 'center', justifyContent: 'center' }}>
      <LogoMark size={size * 0.56} ink="#FFFFFF" dot={c.accent === '#2346F5' ? '#7B92FF' : '#FFFFFF'} />
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
