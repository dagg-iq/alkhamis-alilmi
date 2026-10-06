'use no memo'; // الويدجتات دوال خام: مترجم React يكسرها (Invalid hook call)
import { arDigits, formatScore, palette, POST_KIND_LABELS, relativeDays, TASK_TYPE_LABELS, timeAgo } from '@saey/shared';
import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
import type { WidgetSnapshot } from './data';

/**
 * تصاميم ويدجتات الشاشة الرئيسية — نفس هوية «سعي»: خط ثمانية، أسود/أزرق، زوايا دائرية.
 * كل ويدجت له نسخة فاتحة وغامقة تتبع وضع الهاتف.
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

function colors(mode: Mode) {
  const p = palette[mode];
  return {
    bg: col(p.card), ink: col(p.ink), ink2: col(p.ink2), ink3: col(p.ink3), line: col(p.line),
    accent: col(p.accent), soft: col(p.soft), hero: col(p.heroBg), heroInk: col(p.heroInk), heroInk2: col(p.heroInk2),
    track: col(mode === 'dark' ? '#5A73FF' : '#333333'),
    good: col(mode === 'dark' ? '#6FD3A8' : '#0B6B4B'), goodBg: col(mode === 'dark' ? '#123327' : '#E5F3EC'),
    bad: col('#C8312B'),
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
    <FlexWidget {...URI('')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 24, padding: 16, justifyContent: 'center', alignItems: 'center', flexGap: 6 }}>
      {logo(c.ink, c.accent, 28)}
      <TextWidget text={title} style={{ fontFamily: F.bold, fontSize: 14, color: c.ink, textAlign: 'center' }} />
      <TextWidget text="افتح سعي وسجّل دخولك" style={{ fontFamily: F.regular, fontSize: 12, color: c.ink2, textAlign: 'center' }} />
    </FlexWidget>
  );
}

// ---------------------------------------------------------------- ١. طريق الإعفاء
export function ExemptionWidget({ s, mode, width }: { s: WidgetSnapshot; mode: Mode; width: number }) {
  const c = colors(mode);
  if (!s.signedIn) return <SignedOut mode={mode} title="طريقك إلى الإعفاء" />;
  const barW = Math.max(80, width - 36);
  const pct = s.average == null ? 0 : Math.max(0, Math.min(1, s.average / 100));
  const status = s.exempt ? (s.final ? 'معفى' : 'على الطريق') : 'تحتاج جهداً';
  return (
    <FlexWidget {...URI('grades')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.hero, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 14, justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextWidget text="طريقك إلى الإعفاء العام" style={{ fontFamily: F.medium, fontSize: 13, color: c.heroInk2 }} />
        {s.average != null ? (
          <FlexWidget style={{ backgroundColor: s.exempt ? c.accent : c.bad, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
            <TextWidget text={status} style={{ fontFamily: F.bold, fontSize: 11, color: col('#FFFFFF') }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>
      {s.average == null ? (
        <FlexWidget style={{ width: 'match_parent', alignItems: 'flex-start', flexGap: 2 }}>
          <TextWidget text="أضف أول درجة" style={{ fontFamily: F.display, fontSize: 26, color: c.heroInk }} />
          <TextWidget text="وسعي يحسب لك الإعفاء وكم تحتاج" style={{ fontFamily: F.regular, fontSize: 12, color: c.heroInk2 }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexGap: 8 }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', flexGap: 8 }}>
            <TextWidget text={formatScore(s.average)} style={{ fontFamily: F.display, fontSize: 40, color: c.heroInk }} />
            <TextWidget text={`الهدف ${arDigits(s.target)}`} style={{ fontFamily: F.regular, fontSize: 12, color: c.heroInk2, marginBottom: 8 }} />
          </FlexWidget>
          <FlexWidget style={{ width: barW, height: 6, borderRadius: 3, backgroundColor: c.track }}>
            <FlexWidget style={{ width: Math.max(6, Math.round(barW * pct)), height: 6, borderRadius: 3, backgroundColor: mode === 'dark' ? col('#FFFFFF') : c.accent }} />
          </FlexWidget>
          <TextWidget
            text={`${s.minSubject ? `أقل مادة: ${s.minSubject} ${formatScore(s.min)}` : ''}${s.individual ? ` · إعفاء فردي ${arDigits(s.individual)}` : ''}`}
            maxLines={1}
            truncate="END"
            style={{ fontFamily: F.regular, fontSize: 11, color: c.heroInk2 }}
          />
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
      <FlexWidget {...URI('planner')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 24, padding: 16, justifyContent: 'center', alignItems: 'center', flexGap: 4 }}>
        {logo(c.ink, c.accent, 30)}
        <TextWidget text="لا امتحانات قريبة" style={{ fontFamily: F.bold, fontSize: 14, color: c.ink, textAlign: 'center' }} />
      </FlexWidget>
    );
  }
  const days = daysUntil(exam.due_at);
  const urgent = days <= 1;
  return (
    <FlexWidget {...URI('planner')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: urgent ? c.accent : c.bg, borderRadius: 24, padding: 16, justifyContent: 'space-between' }}>
      <TextWidget text="الامتحان القادم" style={{ fontFamily: F.bold, fontSize: 12, color: urgent ? col('#FFFFFF') : c.accent }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', flexGap: 6 }}>
        <TextWidget
          text={days === 0 ? 'اليوم' : days === 1 ? 'غداً' : arDigits(days)}
          style={{ fontFamily: F.display, fontSize: days > 1 ? 46 : 34, color: urgent ? col('#FFFFFF') : c.ink }}
        />
        {days > 1 ? <TextWidget text={days <= 10 ? 'أيام' : 'يوماً'} style={{ fontFamily: F.bold, fontSize: 14, color: c.ink2, marginBottom: 10 }} /> : null}
      </FlexWidget>
      <TextWidget text={exam.title} maxLines={2} truncate="END" style={{ fontFamily: F.bold, fontSize: 13, color: urgent ? col('#FFFFFF') : c.ink }} />
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
    <FlexWidget {...URI('planner')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, flexGap: 6 }}>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          {logo(c.ink, c.accent, 16)}
          <TextWidget text="مهامي القادمة" style={{ fontFamily: F.bold, fontSize: 14, color: c.ink }} />
        </FlexWidget>
        <FlexWidget {...URI('planner/new')} style={{ backgroundColor: c.soft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
          <TextWidget text="+ مهمة" style={{ fontFamily: F.bold, fontSize: 12, color: c.accent }} />
        </FlexWidget>
      </FlexWidget>
      {list.length === 0 ? (
        <FlexWidget style={{ width: 'match_parent', height: 'match_parent', justifyContent: 'center', alignItems: 'center' }}>
          <TextWidget text="لا مهام — أحسنت ✓" style={{ fontFamily: F.medium, fontSize: 13, color: c.ink2 }} />
        </FlexWidget>
      ) : list.map((t) => {
        const when = t.due_at ? relativeDays(new Date(t.due_at)) : '';
        const today = when === 'اليوم';
        return (
          <FlexWidget key={t.id} style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', flexGap: 8, paddingVertical: 2 }}>
            <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: today ? c.bad : c.accent }} />
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget text={t.title} maxLines={1} truncate="END" style={{ fontFamily: F.bold, fontSize: 13, color: c.ink }} />
            </FlexWidget>
            <TextWidget text={`${TASK_TYPE_LABELS[t.type] ?? ''} · ${when}`} style={{ fontFamily: F.regular, fontSize: 11, color: today ? c.bad : c.ink3 }} />
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
  const cell = (label: string, value: string, path: string, accent?: boolean) => (
    <FlexWidget {...URI(path)} style={{ flex: 1, height: 'match_parent', justifyContent: 'center', alignItems: 'center' }}>
      <TextWidget text={value} maxLines={1} style={{ fontFamily: F.display, fontSize: 20, color: accent ? c.accent : c.ink }} />
      <TextWidget text={label} maxLines={1} style={{ fontFamily: F.regular, fontSize: 11, color: c.ink2 }} />
    </FlexWidget>
  );
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 24, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', flexGap: 1, flexGapColor: c.line }}>
      {cell('معدلي', s.average == null ? '—' : formatScore(s.average), 'grades', s.exempt)}
      {cell('الامتحان', exam?.due_at ? relativeDays(new Date(exam.due_at)).replace('بعد ', '') : '—', 'planner')}
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
      <FlexWidget {...URI('news')} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 24, padding: 14, justifyContent: 'center', alignItems: 'center' }}>
        <TextWidget text="لا أخبار بعد" style={{ fontFamily: F.medium, fontSize: 13, color: c.ink2 }} />
      </FlexWidget>
    );
  }
  const urgent = s.post.kind === 'urgent';
  return (
    <FlexWidget {...URI(`news/${s.post.id}`)} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: urgent ? c.bad : c.soft, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center', flexGap: 2 }}>
      <TextWidget
        text={`${POST_KIND_LABELS[s.post.kind] ?? 'خبر'} · ${timeAgo(new Date(s.post.published_at))}`}
        style={{ fontFamily: F.bold, fontSize: 11, color: urgent ? col('#FFFFFF') : c.accent }}
      />
      <TextWidget text={s.post.title} maxLines={2} truncate="END" style={{ fontFamily: F.bold, fontSize: 15, color: urgent ? col('#FFFFFF') : c.ink }} />
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
  const btn = (icon: string, label: string, path: string, main?: boolean) => (
    <FlexWidget {...URI(path)} style={{ flex: 1, height: 'match_parent', borderRadius: 18, backgroundColor: main ? c.accent : c.soft, justifyContent: 'center', alignItems: 'center', flexGap: 2 }}>
      <SvgWidget style={{ width: 22, height: 22 }} svg={iconSvg(icon, main ? '#FFFFFF' : palette[mode].accent)} />
      <TextWidget text={label} maxLines={1} style={{ fontFamily: F.bold, fontSize: 11, color: main ? col('#FFFFFF') : c.ink }} />
    </FlexWidget>
  );
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 24, padding: 8, flexDirection: 'row', flexGap: 6 }}>
      {btn('ai', 'اسأل سعي', 'ai', true)}
      {btn('scan', 'صوّر سؤال', 'scan')}
      {btn('timer', 'المؤقت', 'timer')}
      {btn('grade', 'درجة', 'grades/edit')}
    </FlexWidget>
  );
}
