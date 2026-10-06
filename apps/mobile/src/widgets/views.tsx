'use no memo'; // الويدجتات دوال خام: مترجم React يكسرها (Invalid hook call)
import {
  GOAL_TITLES, arDigits, formatDayDate, formatScore, palette, POST_KIND_LABELS, relativeDays, TASK_TYPE_LABELS, timeAgo,
} from '@saey/shared';
import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
import type { WidgetSnapshot } from './data';

/**
 * تصاميم ويدجتات الشاشة الرئيسية — نفس هوية «سعي»: خط ثمانية، أسود/أزرق، زوايا دائرية.
 * كل ويدجت له نسخة فاتحة وغامقة (تتبع الهاتف أو حسب اختيار الطالب).
 */

type Mode = 'light' | 'dark';
const F = {
  regular: 'thmanyahsans-Regular',
  medium: 'thmanyahsans-Medium',
  bold: 'thmanyahsans-Bold',
  display: 'thmanyahserifdisplay-Black',
};
const col = (s: string) => s as ColorProp;
const URI = (path: string) => ({ clickAction: 'OPEN_URI', clickActionData: { uri: `saey://${path}` } });
const R = 26; // زاوية الويدجت

/**
 * نمط النص: الياء الأخيرة (كما في «سعي») تنزل ٠٫٥٥ من حجم الخط تحت السطر، والخط يعلن ٠٫٢٥ فقط،
 * وصندوق النص في أندرويد يقص الباقي — نضيف مساحة سفلية ٠٫٣٢ من الحجم.
 */
function tx(font: string, size: number, color: ColorProp, extra?: object) {
  return { fontFamily: font, fontSize: size, color, paddingBottom: Math.ceil(size * 0.32), ...extra };
}

function colors(mode: Mode) {
  const p = palette[mode];
  return {
    bg: col(p.card), ink: col(p.ink), ink2: col(p.ink2), ink3: col(p.ink3), line: col(p.line),
    accent: col(p.accent), soft: col(p.soft), softInk: col(p.softInk), hero: col(p.heroBg), heroInk: col(p.heroInk), heroInk2: col(p.heroInk2),
    track: col(mode === 'dark' ? '#5A73FF' : '#3A3A3A'),
    good: col(mode === 'dark' ? '#6FD3A8' : '#0B6B4B'), goodBg: col(mode === 'dark' ? '#123327' : '#E5F3EC'),
    bad: col('#C8312B'),
    white: col('#FFFFFF'),
  };
}

function logo(ink: string, dot: string, size = 20) {
  return (
    <SvgWidget
      style={{ width: size, height: size }}
      svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect x="80" y="62" width="20" height="42" rx="10" fill="${ink}"/><rect x="50" y="44" width="20" height="60" rx="10" fill="${ink}"/><rect x="20" y="30" width="20" height="74" rx="10" fill="${ink}"/><rect x="20" y="84" width="80" height="20" rx="10" fill="${ink}"/><circle cx="30" cy="12" r="10" fill="${dot}"/></svg>`}
    />
  );
}

/** شريط تقدم مرسوم (يملأ من اليمين) مع خط الهدف */
function progressSvg(pct: number, target: number, fill: string, track: string, marker: string) {
  const w = 300;
  const f = Math.max(0, Math.min(1, pct)) * w;
  const m = Math.max(0, Math.min(1, target)) * w;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 16" preserveAspectRatio="none"><rect x="0" y="4" width="${w}" height="8" rx="4" fill="${track}"/><rect x="${w - f}" y="4" width="${f}" height="8" rx="4" fill="${fill}"/><rect x="${w - m - 1.5}" y="0" width="3" height="16" rx="1.5" fill="${marker}"/></svg>`;
}

const daysUntil = (iso: string) => {
  const d = new Date(iso);
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const n = new Date();
  const b = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((a - b) / 86400000);
};

/** رسالة عندما لا يكون هناك حساب */
function SignedOut({ mode, title }: { mode: Mode; title: string }) {
  const c = colors(mode);
  return (
    <FlexWidget {...URI('')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: R, padding: 16, justifyContent: 'center', alignItems: 'center', flexGap: 4 }}>
      {logo(c.ink, c.accent, 28)}
      <TextWidget text={title} style={tx(F.bold, 14, c.ink, { textAlign: 'center' })} />
      <TextWidget text="افتح سعي وسجّل دخولك" style={tx(F.regular, 12, c.ink2, { textAlign: 'center' })} />
    </FlexWidget>
  );
}

// ---------------------------------------------------------------- ١. هدفي (الدرجات)
export function ExemptionWidget({ s, mode, width, height }: { s: WidgetSnapshot; mode: Mode; width: number; height: number }) {
  const c = colors(mode);
  if (!s.signedIn) return <SignedOut mode={mode} title="هدفي" />;
  const barW = Math.max(120, width - 36);
  const pct = s.average == null ? 0 : s.average / 100;
  const headline = s.headline || (s.average == null ? 'أضف أول درجة' : '');
  return (
    <FlexWidget {...URI('grades')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.hero, borderRadius: R, paddingHorizontal: 18, paddingVertical: 14, justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          {logo('#FFFFFF', mode === 'dark' ? '#FFFFFF' : '#7B92FF', 16)}
          <TextWidget text={`هدفي: ${GOAL_TITLES[s.goal] ?? 'الإعفاء العام'}`} style={tx(F.medium, 12, c.heroInk2)} />
        </FlexWidget>
        {s.average != null && s.totalSubjects ? (
          <TextWidget text={`${arDigits(s.onTrack)} من ${arDigits(s.totalSubjects)} على الطريق`} style={tx(F.regular, 11, c.heroInk2)} />
        ) : null}
      </FlexWidget>

      {/* الجملة تظهر عندما يكون الويدجت بارتفاع كافٍ */}
      {height >= 150 || s.average == null ? <TextWidget text={headline} maxLines={1} truncate="END" style={tx(F.display, 19, c.heroInk)} /> : null}

      {s.average == null ? (
        <TextWidget text="سعي يحسب لك كم تحتاج في كل امتحان" style={tx(F.regular, 12, c.heroInk2)} />
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexGap: 4 }}>
          <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', flexGap: 6 }}>
              <TextWidget text={formatScore(s.average)} style={tx(F.display, 30, c.heroInk)} />
              <TextWidget text="معدلي" style={tx(F.regular, 11, c.heroInk2, { marginBottom: 6 })} />
            </FlexWidget>
            {s.perExam != null ? (
              <FlexWidget style={{ backgroundColor: col('#FFFFFF22'), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, marginBottom: 6 }}>
                <TextWidget text={`تحتاج ${formatScore(s.perExam)} بكل امتحان`} style={tx(F.bold, 11, c.white)} />
              </FlexWidget>
            ) : null}
          </FlexWidget>
          <SvgWidget style={{ width: barW, height: 12 }}
            svg={progressSvg(pct, s.goalTarget / 100, '#FFFFFF', mode === 'dark' ? '#5A73FF' : '#3A3A3A', mode === 'dark' ? '#111111' : '#7B92FF')} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

// ---------------------------------------------------------------- ٢. العد التنازلي للامتحان
export function NextExamWidget({ s, mode }: { s: WidgetSnapshot; mode: Mode }) {
  const c = colors(mode);
  if (!s.signedIn) return <SignedOut mode={mode} title="الامتحان القادم" />;
  const exam = s.exams.find((e) => e.due_at && daysUntil(e.due_at) >= 0);
  if (!exam?.due_at) {
    return (
      <FlexWidget {...URI('planner')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: R, padding: 16, justifyContent: 'center', alignItems: 'center', flexGap: 4 }}>
        {logo(c.ink, c.accent, 30)}
        <TextWidget text="لا امتحانات قريبة" style={tx(F.bold, 14, c.ink, { textAlign: 'center' })} />
        <TextWidget text="وقت مثالي للمراجعة" style={tx(F.regular, 11, c.ink2, { textAlign: 'center' })} />
      </FlexWidget>
    );
  }
  const days = daysUntil(exam.due_at);
  const urgent = days <= 1;
  const ink = urgent ? c.white : c.ink;
  const ink2 = urgent ? col('#FFFFFFCC') : c.ink2;
  return (
    <FlexWidget {...URI('planner')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: urgent ? c.accent : c.bg, borderRadius: R, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'space-between' }}>
      <TextWidget text="الامتحان القادم" style={tx(F.bold, 12, urgent ? c.white : c.accent)} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', flexGap: 6 }}>
        <TextWidget text={days === 0 ? 'اليوم' : days === 1 ? 'غداً' : arDigits(days)} style={tx(F.display, days > 1 ? 44 : 32, ink)} />
        {days > 1 ? <TextWidget text={days <= 10 ? 'أيام' : 'يوماً'} style={tx(F.bold, 14, ink2, { marginBottom: 12 })} /> : null}
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent' }}>
        <TextWidget text={exam.title} maxLines={2} truncate="END" style={tx(F.bold, 13, ink)} />
        <TextWidget text={formatDayDate(new Date(exam.due_at))} maxLines={1} style={tx(F.regular, 11, ink2)} />
      </FlexWidget>
    </FlexWidget>
  );
}

// ---------------------------------------------------------------- ٣. مهامي القادمة
export function TasksWidget({ s, mode, height }: { s: WidgetSnapshot; mode: Mode; height: number }) {
  const c = colors(mode);
  if (!s.signedIn) return <SignedOut mode={mode} title="مهامي" />;
  const rows = Math.max(1, Math.min(5, Math.floor((height - 56) / 34)));
  const list = s.tasks.slice(0, rows);
  return (
    <FlexWidget {...URI('planner')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: R, paddingHorizontal: 16, paddingVertical: 12, flexGap: 4 }}>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          {logo(c.ink, c.accent, 16)}
          <TextWidget text="مهامي القادمة" style={tx(F.bold, 14, c.ink)} />
        </FlexWidget>
        <FlexWidget {...URI('planner/new')} style={{ backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
          <TextWidget text="+ مهمة" style={tx(F.bold, 12, mode === 'dark' ? col('#0E0E0F') : c.white)} />
        </FlexWidget>
      </FlexWidget>
      {list.length === 0 ? (
        <FlexWidget style={{ width: 'match_parent', height: 'match_parent', justifyContent: 'center', alignItems: 'center' }}>
          <TextWidget text="لا مهام متبقية — أحسنت" style={tx(F.medium, 13, c.ink2)} />
        </FlexWidget>
      ) : list.map((t) => {
        const when = t.due_at ? relativeDays(new Date(t.due_at)) : '';
        const today = when === 'اليوم';
        return (
          <FlexWidget key={t.id} style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', flexGap: 8, backgroundColor: c.soft, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3 }}>
            <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: today ? c.bad : c.accent }} />
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget text={t.title} maxLines={1} truncate="END" style={tx(F.bold, 13, c.softInk)} />
            </FlexWidget>
            <TextWidget text={`${TASK_TYPE_LABELS[t.type] ?? ''} · ${when}`} style={tx(F.regular, 11, today ? c.bad : c.ink2)} />
          </FlexWidget>
        );
      })}
    </FlexWidget>
  );
}

// ---------------------------------------------------------------- ٤. لمحة سريعة
export function OverviewWidget({ s, mode }: { s: WidgetSnapshot; mode: Mode }) {
  const c = colors(mode);
  if (!s.signedIn) return <SignedOut mode={mode} title="سعي" />;
  const exam = s.exams.find((e) => e.due_at && daysUntil(e.due_at) >= 0);
  const examDays = exam?.due_at ? daysUntil(exam.due_at) : null;
  const cell = (label: string, value: string, path: string, accent?: boolean) => (
    <FlexWidget {...URI(path)} style={{ flex: 1, height: 'match_parent', justifyContent: 'center', alignItems: 'center' }}>
      <TextWidget text={value} maxLines={1} style={tx(F.display, 18, accent ? c.accent : c.ink)} />
      <TextWidget text={label} maxLines={1} style={tx(F.regular, 11, c.ink2)} />
    </FlexWidget>
  );
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: R, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', flexGap: 1, flexGapColor: c.line }}>
      {cell('معدلي', s.average == null ? '—' : formatScore(s.average), 'grades', s.onTrack > 0 && s.onTrack === s.totalSubjects)}
      {cell('الامتحان', examDays == null ? '—' : examDays === 0 ? 'اليوم' : examDays === 1 ? 'غداً' : `${arDigits(examDays)} ${examDays <= 10 ? 'أيام' : 'يوماً'}`, 'planner', examDays != null && examDays <= 1)}
      {cell('رسائل', arDigits(s.unreadMessages), 'chat', s.unreadMessages > 0)}
      {cell('إشعارات', arDigits(s.unreadNotifs), 'notifications', s.unreadNotifs > 0)}
    </FlexWidget>
  );
}

// ---------------------------------------------------------------- ٥. آخر خبر
export function NewsWidget({ s, mode }: { s: WidgetSnapshot; mode: Mode }) {
  const c = colors(mode);
  if (!s.signedIn) return <SignedOut mode={mode} title="أخبار المدرسة" />;
  if (!s.post) {
    return (
      <FlexWidget {...URI('news')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: R, padding: 14, justifyContent: 'center', alignItems: 'center' }}>
        <TextWidget text="لا أخبار بعد" style={tx(F.medium, 13, c.ink2)} />
      </FlexWidget>
    );
  }
  const urgent = s.post.kind === 'urgent';
  return (
    <FlexWidget {...URI(`news/${s.post.id}`)} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: urgent ? c.bad : c.soft, borderRadius: R, paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'center' }}>
      <TextWidget
        text={`${POST_KIND_LABELS[s.post.kind] ?? 'خبر'} · ${timeAgo(new Date(s.post.published_at))}`}
        style={tx(F.bold, 11, urgent ? c.white : c.accent)}
      />
      <TextWidget text={s.post.title} maxLines={2} truncate="END" style={tx(F.bold, 15, urgent ? c.white : c.softInk)} />
    </FlexWidget>
  );
}

// ---------------------------------------------------------------- ٦. اختصارات
const ICONS: Record<string, string> = {
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  grade: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
};
function iconSvg(name: string, color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

export function QuickWidget({ mode }: { mode: Mode }) {
  const c = colors(mode);
  const onAccent = mode === 'dark' ? '#0E0E0F' : '#FFFFFF';
  const btn = (icon: string, label: string, path: string, main?: boolean) => (
    <FlexWidget {...URI(path)} style={{ flex: 1, height: 'match_parent', borderRadius: 20, backgroundColor: main ? c.accent : c.soft, justifyContent: 'center', alignItems: 'center' }}>
      <SvgWidget style={{ width: 22, height: 22 }} svg={iconSvg(icon, main ? onAccent : palette[mode].accent)} />
      <TextWidget text={label} maxLines={1} style={tx(F.bold, 11, main ? col(onAccent) : c.softInk)} />
    </FlexWidget>
  );
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: R, padding: 8, flexDirection: 'row', flexGap: 6 }}>
      {btn('ai', 'اسأل سعي', 'ai', true)}
      {btn('scan', 'صوّر سؤال', 'scan')}
      {btn('timer', 'المؤقت', 'timer')}
      {btn('grade', 'درجاتي', 'grades/edit')}
    </FlexWidget>
  );
}
