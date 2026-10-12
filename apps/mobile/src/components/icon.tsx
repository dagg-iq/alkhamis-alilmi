import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** أيقونات خطية بسماكة ١٫٨ — مرسومة لواجهة من اليمين لليسار (الرجوع ← يشير لليمين) */
const PATHS: Record<string, string[]> = {
  home: ['M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z'],
  book: ['M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h9'],
  chart: ['M6 20v-7', 'M12 20V9', 'M18 20V5'],
  chat: ['M4 5h16v11H9l-5 4z'],
  bell: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'],
  back: ['M9 6l6 6-6 6'],
  forward: ['M15 6l-6 6 6 6'],
  down: ['M6 9l6 6 6-6'],
  up: ['M6 15l6-6 6 6'],
  search: ['M16 16l4 4'],
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  play: ['M8 5v14l11-7z'],
  file: ['M7 3h7l5 5v13H7z', 'M14 3v5h5'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  share: ['M12 15V4', 'M7 9l5-5 5 5', 'M5 14v6h14v-6'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4'],
  send: ['M20 12L4 4l3 8-3 8z', 'M7 12h7'],
  reply: ['M14 8l4 4-4 4', 'M18 12H9a4 4 0 0 0-4 4v2'],
  'forward-msg': ['M10 8l-4 4 4 4', 'M6 12h9a4 4 0 0 1 4 4v2'],
  paperclip: ['M17 11l-6 6a4 4 0 0 1-6-6l7-7a3 3 0 0 1 4 4l-7 7a1.5 1.5 0 0 1-2-2l6-6'],
  sparkle: ['M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'],
  timer: ['M12 8v5l3 2', 'M9 2h6'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  table: ['M3 5h18v14H3z', 'M3 10h18', 'M3 14.5h18', 'M9 5v14', 'M15 5v14'],
  news: ['M4 5h13v14H6a2 2 0 0 1-2-2z', 'M17 9h3v8a2 2 0 0 1-2 2', 'M8 9h5', 'M8 13h5'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8'],
  user: ['M5 20a7 7 0 0 1 14 0'],
  users: ['M3 19a6 6 0 0 1 12 0', 'M16 13a5 5 0 0 1 5 5'],
  logout: ['M10 5H5v14h5', 'M14 8l-4 4 4 4', 'M10 12h10'],
  edit: ['M5 19h4L19 9l-4-4L5 15z'],
  trash: ['M5 7h14', 'M10 7V4h4v3', 'M7 7l1 13h8l1-13'],
  copy: ['M8 8h11v11H8z', 'M5 16V5h11'],
  moon: ['M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z'],
  sun: ['M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  scan: ['M4 8V4h4', 'M16 4h4v4', 'M20 16v4h-4', 'M8 20H4v-4', 'M7 12h10'],
  quiz: ['M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15', 'M12 18.5v.5'],
  pin: ['M9 4h6l-1 6 3 3H7l3-3z', 'M12 13v7'],
  lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
  at: ['M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-4 7.5'],
  more: [],
  target: [],
  info: ['M12 11v5.5', 'M12 7.6v.4'],
  minus: ['M5 12h14'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11'],
  instagram: ['M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5z'],
  telegram: ['M21 4L3 11l6 2 2 6 3-4 5 4z', 'M9 13l8-6'],
  whatsapp: ['M4 20l1.3-4A8 8 0 1 1 8 18.7z', 'M9 9.5c.5 2 2.5 4 4.5 4.5l1.2-1.2 2 1-.5 1.7c-3.5.3-7.7-3.9-7.4-7.4l1.7-.5 1 2z'],
  facebook: ['M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v7h4v-7h3l1-4h-4V8z'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  sparkles: ['M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z', 'M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z'],
};

const CIRCLES: Record<string, [number, number, number][]> = {
  search: [[11, 11, 6.5]],
  timer: [[12, 13, 8]],
  user: [[12, 8, 4]],
  users: [[9, 8, 3.5], [16.5, 8.5, 2.8]],
  camera: [[12, 13, 3.5]],
  image: [[9, 9, 1.5]],
  settings: [[16, 7, 2], [10, 17, 2]],
  quiz: [[12, 12, 9.5]],
  sun: [[12, 12, 4]],
  at: [[12, 12, 4]],
  more: [[6, 12, 1.5], [12, 12, 1.5], [18, 12, 1.5]],
  target: [[12, 12, 9], [12, 12, 5], [12, 12, 1.2]],
  info: [[12, 12, 9.5]],
  list: [[4.5, 6, 1], [4.5, 12, 1], [4.5, 18, 1]],
  instagram: [[12, 12, 4], [17.5, 6.5, 0.6]],
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, color, strokeWidth = 1.8, fill }: {
  name: IconName; size?: number; color: string; strokeWidth?: number; fill?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PATHS[name].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
          fill={name === 'play' ? color : fill ?? 'none'} />
      ))}
      {(CIRCLES[name] ?? []).map(([cx, cy, r], i) => (
        <Circle key={`c${i}`} cx={cx} cy={cy} r={r} stroke={color} strokeWidth={strokeWidth}
          fill={name === 'more' || r < 1 ? color : 'none'} />
      ))}
    </Svg>
  );
}

/** رمز «سعي»: ثلاث أسنان صاعدة ونقطة الإعفاء */
export function LogoMark({ size = 40, ink, dot }: { size?: number; ink: string; dot: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Rect x={80} y={62} width={20} height={42} rx={10} fill={ink} />
      <Rect x={50} y={44} width={20} height={60} rx={10} fill={ink} />
      <Rect x={20} y={30} width={20} height={74} rx={10} fill={ink} />
      <Rect x={20} y={84} width={80} height={20} rx={10} fill={ink} />
      <Circle cx={30} cy={12} r={10} fill={dot} />
    </Svg>
  );
}

/** شارة التوثيق */
// ختم مسنّن متناظر (١٢ نتوءاً) بعلامة صح
const BADGE = 'M12.00 2.60Q15.31 -0.36 16.70 3.86Q21.05 2.95 20.14 7.30Q24.36 8.69 21.40 12.00Q24.36 15.31 20.14 16.70Q21.05 21.05 16.70 20.14Q15.31 24.36 12.00 21.40Q8.69 24.36 7.30 20.14Q2.95 21.05 3.86 16.70Q-0.36 15.31 2.60 12.00Q-0.36 8.69 3.86 7.30Q2.95 2.95 7.30 3.86Q8.69 -0.36 12.00 2.60Z';

export function VerifiedBadge({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="موثّق">
      <Path d={BADGE} fill={color} />
      <Path d="M7.6 12.4l2.9 2.9 5.9-6.1" stroke="#FFFFFF" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
