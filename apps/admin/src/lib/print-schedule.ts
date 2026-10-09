import {
  SCHEDULE_KIND_LABELS, WEEKDAYS, arDigits, dateParts, weekdayOf,
  type Schedule, type ScheduleItem, type ScheduleSettings, type Section, type Subject,
} from '@saey/shared';

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t12 = (t: string | null) => (t ? arDigits(t.replace(/^0/, '')) : '');
const range = (it: ScheduleItem) => (it.start_time ? `${t12(it.start_time)}${it.end_time ? ` – ${t12(it.end_time)}` : ''}` : '');

/** لون ثابت ومميز لكل مادة (لا يتكرر لونان)، بخلفية فاتحة ولون للحافة والعنوان */
type Tone = { bg: string; bd: string; tx: string };
const tone = (bd: string, bg: string, tx: string): Tone => ({ bd, bg, tx });
const BY_SLUG: Record<string, Tone> = {
  math: tone('#2346F5', '#EAF0FF', '#1B2FA8'),
  physics: tone('#7A4FE0', '#F1E9FE', '#4B2A9E'),
  chemistry: tone('#E58A00', '#FFF2DE', '#8A4F00'),
  biology: tone('#12805C', '#E4F6EC', '#0B5A40'),
  arabic: tone('#B58900', '#FBF3C9', '#6E5200'),
  english: tone('#D6336C', '#FFE6EE', '#8E1E48'),
  islamic: tone('#0E8F95', '#DFF5F6', '#0A5F63'),
  computer: tone('#334155', '#E8ECF3', '#1E293B'),
  kurdish: tone('#C2410C', '#FFEDE3', '#7C2D12'),
};
const EXTRA: Tone[] = [tone('#A21CAF', '#FAE8FB', '#701A75'), tone('#0369A1', '#E0F2FE', '#0C4A6E'), tone('#4D7C0F', '#ECFCCB', '#365314'), tone('#9F1239', '#FFE4E6', '#881337')];
const NEUTRAL = tone('#6B7280', '#F1F2F6', '#374151');

const LOGO = (ink: string, dot: string, size = 30) => `<svg width="${size}" height="${size}" viewBox="0 0 120 120"><rect x="80" y="62" width="20" height="42" rx="10" fill="${ink}"/><rect x="50" y="44" width="20" height="60" rx="10" fill="${ink}"/><rect x="20" y="30" width="20" height="74" rx="10" fill="${ink}"/><rect x="20" y="84" width="80" height="20" rx="10" fill="${ink}"/><circle cx="30" cy="12" r="10" fill="${dot}"/></svg>`;

interface Ctx { schedule: Schedule; items: ScheduleItem[]; subjects: Subject[]; sections: Section[]; settings: ScheduleSettings; school: string }

const nameOf = (it: ScheduleItem, subjects: Subject[]) =>
  (it.title?.trim() || subjects.find((s) => s.id === it.subject_id)?.name || '').trim();

/** لون المادة من رمزها، وللعناوين الحرة (الفنية، الرياضية…) لون ثابت من اسمها */
function toneOf(it: ScheduleItem, subjects: Subject[]): Tone {
  const sub = it.subject_id ? subjects.find((s) => s.id === it.subject_id) : undefined;
  if (sub && !it.title?.trim()) return BY_SLUG[(sub as Subject & { slug?: string }).slug ?? ''] ?? EXTRA[subjects.indexOf(sub) % EXTRA.length];
  const n = nameOf(it, subjects);
  if (!n) return NEUTRAL;
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length];
}

/** دليل الألوان مع عدد حصص كل مادة في الأسبوع */
function legend(ctx: Ctx): string {
  const used = new Map<string, { name: string; tone: Tone; n: number }>();
  for (const it of ctx.items) {
    const n = nameOf(it, ctx.subjects);
    if (!n) continue;
    const u = used.get(n) ?? { name: n, tone: toneOf(it, ctx.subjects), n: 0 };
    u.n++;
    used.set(n, u);
  }
  const weekly = ctx.schedule.kind === 'weekly';
  return [...used.values()].sort((a, b) => b.n - a.n)
    .map((u) => `<span class="lg" style="--c:${u.tone.bd};--b:${u.tone.bg}"><i></i>${esc(u.name)}${weekly ? `<em>${arDigits(u.n)}</em>` : ''}</span>`).join('');
}

const ORD = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'];

function weeklyTable(ctx: Ctx): string {
  const { items, subjects, settings } = ctx;
  const days = settings.school_days;
  const rows = Math.max(1, ...days.map((d) => items.filter((i) => i.day === d).length), ...items.map((i) => i.sort || 0));
  const cell = (d: number, r: number) => {
    const list = items.filter((i) => i.day === d).sort((a, b) => a.sort - b.sort);
    return list.find((i) => i.sort === r + 1) ?? (list.some((i) => i.sort) ? undefined : list[r]); // حصة فارغة تبقى فارغة
  };
  const timeOf = (r: number) => {
    const it = days.map((d) => cell(d, r)).find((x) => x?.start_time);
    return it ? range(it) : '';
  };
  const head = days.map((d) => `<th><span>${WEEKDAYS[d]}</span></th>`).join('');
  const body = Array.from({ length: rows }, (_, r) => `<tr><td class="no"><b>${arDigits(r + 1)}</b><small>${timeOf(r) ? `<bdi dir="ltr">${timeOf(r)}</bdi>` : ORD[r] ?? ''}</small></td>${days.map((d) => {
    const it = cell(d, r);
    if (!it) return '<td class="gap"><span>فراغ</span></td>';
    const t = toneOf(it, subjects);
    const name = nameOf(it, subjects).replace(/^(اللغة|التربية)\s+/, '<span class="pre">$1</span> ');
    return `<td class="lesson"><div style="--c:${t.bd};--b:${t.bg};--t:${t.tx}"><b>${name}</b>${it.teacher ? `<small>${esc(it.teacher)}</small>` : ''}${it.place ? `<small>${esc(it.place)}</small>` : ''}</div></td>`;
  }).join('')}</tr>`).join('');
  return `<table class="grid"><thead><tr><th class="no"><span>الحصة</span></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function datedTable(ctx: Ctx): string {
  const sorted = [...ctx.items].sort((a, b) => (a.on_date ?? '9').localeCompare(b.on_date ?? '9') || a.sort - b.sort);
  const body = sorted.map((it, i) => {
    const dp = it.on_date ? dateParts(it.on_date) : null;
    const t = toneOf(it, ctx.subjects);
    return `<tr>
<td class="no"><b>${arDigits(i + 1)}</b></td>
<td class="date">${dp ? `<div><b><bdi dir="ltr">${arDigits(dp.dm)}</bdi></b><small>${arDigits(dp.year)}</small></div>` : '<div><b>—</b></div>'}</td>
<td class="day">${it.on_date ? WEEKDAYS[weekdayOf(it.on_date)] : ''}</td>
<td class="main" style="--c:${t.bd}"><b style="color:${t.tx}">${esc(nameOf(it, ctx.subjects))}</b>${it.teacher ? `<small>${esc(it.teacher)}</small>` : ''}</td>
<td class="time">${range(it)}</td>
<td class="place">${esc(it.place)}</td>
<td class="note">${esc(it.note)}</td></tr>`;
  }).join('');
  return `<table class="list"><thead><tr><th class="no"><span>#</span></th><th><span>التاريخ</span></th><th><span>اليوم</span></th><th class="main"><span>المادة / الموضوع</span></th><th><span>الوقت</span></th><th><span>المكان</span></th><th class="note"><span>ملاحظات</span></th></tr></thead><tbody>${body}</tbody></table>`;
}

/** صفحة A4 عرضية بتصميم سعي */
export function schedulePrintHtml(ctx: Ctx, base: string): string {
  const { schedule, sections, school } = ctx;
  const section = schedule.section_id ? `شعبة ${sections.find((s) => s.id === schedule.section_id)?.name ?? ''}` : 'كل الشعب';
  const today = dateParts(new Date().toISOString().slice(0, 10)).full;
  const weekly = schedule.kind === 'weekly';
  const table = weekly ? weeklyTable(ctx) : datedTable(ctx);
  const count = ctx.items.length;
  const dense = weekly ? Math.max(...ctx.settings.school_days.map((d) => ctx.items.filter((i) => i.day === d).length), 1) > 7 : count > 9;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(schedule.title)}</title>
<style>
@font-face{font-family:'Sans';src:url('${base}fonts/thmanyahsans-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Sans';src:url('${base}fonts/thmanyahsans-Medium.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Sans';src:url('${base}fonts/thmanyahsans-Bold.woff2') format('woff2');font-weight:700}
@font-face{font-family:'Sans';src:url('${base}fonts/thmanyahsans-Black.woff2') format('woff2');font-weight:900}
@font-face{font-family:'Display';src:url('${base}fonts/thmanyahserifdisplay-Black.woff2') format('woff2');font-weight:900}
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;background:#fff;color:#111;font-family:'Sans',system-ui,sans-serif}
.page{width:297mm;height:209.5mm;display:flex;flex-direction:column;overflow:hidden;position:relative;background:#fff}

/* الترويسة */
.top{position:relative;height:30mm;padding:0 12mm;display:flex;align-items:center;gap:6mm;color:#fff;overflow:hidden;
  background:radial-gradient(120% 160% at 100% 0%,#3B5BFF 0%,#2346F5 35%,#1630B5 70%,#0F1F78 100%)}
.top::before{content:'';position:absolute;inset:0;background:
  repeating-linear-gradient(135deg,rgba(255,255,255,.05) 0 2px,transparent 2px 14px)}
.top::after{content:'';position:absolute;width:90mm;height:90mm;border-radius:50%;left:-22mm;top:-48mm;border:14mm solid rgba(255,255,255,.07)}
.top>*{position:relative;z-index:1}
.brand{display:flex;align-items:center;gap:3.5mm;min-width:52mm}
.brand .mark{width:15mm;height:15mm;border-radius:4.5mm;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2mm 5mm rgba(10,20,90,.3)}
.brand b{display:block;font-family:'Display',serif;font-size:27px;font-weight:900;line-height:1}
.brand small{display:block;font-size:11px;opacity:.9;margin-top:3px;white-space:nowrap}
.title{flex:1;text-align:center}
.title h1{margin:0;font-family:'Display',serif;font-weight:900;font-size:${dense ? 32 : 37}px;line-height:1.15}
.title p{margin:5px 0 0;font-size:13px;opacity:.9}
.chips{display:flex;flex-direction:column;gap:5px;align-items:flex-end;min-width:52mm}
.chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 12px;border-radius:99px;background:rgba(255,255,255,.16);font-size:12px;font-weight:700;border:1px solid rgba(255,255,255,.3)}
.chip.solid{background:#fff;color:#1B38D4;border-color:#fff;font-size:14px;height:28px;padding:0 16px}

/* الجسم */
.body{flex:1;min-height:0;padding:5mm 10mm 2.5mm;display:flex;flex-direction:column;gap:3mm}
.wrap{flex:1;min-height:0;display:flex}
table{width:100%;border-collapse:separate;table-layout:fixed}
th span{display:flex;align-items:center;justify-content:center;height:100%;min-height:28px;border-radius:9px;background:#111827;color:#fff;font-size:15px;font-weight:700;letter-spacing:.3px}

/* جدول الحصص: بطاقات ملوّنة */
.grid{border-spacing:4px;height:100%}
.grid thead th{height:30px;padding:0}
.grid th.no span{background:#2346F5}
.grid td{padding:0;vertical-align:stretch}
.grid td.no{width:21mm;background:#F3F5FF;border-radius:10px;text-align:center;border:1.5px solid #DFE5FF}
.grid td.no b{display:block;font-family:'Display',serif;font-size:27px;line-height:1;color:#2346F5}
.grid td.no small{display:block;font-size:10px;color:#5B6285;font-weight:700;margin-top:3px}
.lesson>div{position:relative;height:100%;min-height:14mm;border-radius:10px;padding:5px 10px 5px 8px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:1px;text-align:center;
  background:linear-gradient(160deg,var(--b) 0%,#fff 140%);border:1.5px solid color-mix(in srgb,var(--c) 28%,transparent);overflow:hidden}
.lesson>div::before{content:'';position:absolute;inset-inline-start:0;top:0;bottom:0;width:5px;background:var(--c)}
.lesson>div::after{content:'';position:absolute;width:16mm;height:16mm;border-radius:50%;left:-6mm;bottom:-8mm;background:var(--c);opacity:.07}
.lesson b{font-size:${dense ? 15.5 : 18}px;font-weight:900;line-height:1.25;color:var(--t)}
.lesson b .pre{display:block;font-size:.62em;font-weight:700;opacity:.75;line-height:1.1}
.lesson small{font-size:10.5px;color:#4a4f66;font-weight:500}
.gap{text-align:center;border-radius:10px;border:1.5px dashed #E1E4F0;vertical-align:middle!important}
.gap span{font-size:11px;color:#B8BCCD;font-weight:700}

/* جدول المواعيد: صفوف بطاقات */
.list{border-spacing:0 6px;align-self:flex-start}
.list.fill{height:100%;align-self:stretch}
.list thead th{padding:0 3px 2px}
.list th.no{width:15mm}
.list td{background:#F8F9FF;text-align:center;vertical-align:middle;padding:8px 8px;font-size:14.5px;border-top:1.5px solid #E6E9FA;border-bottom:1.5px solid #E6E9FA}
.list tr:nth-child(even) td{background:#fff}
.list td:first-child{border-radius:0 13px 13px 0;border-right:1.5px solid #E6E9FA}
.list td:last-child{border-radius:13px 0 0 13px;border-left:1.5px solid #E6E9FA}
.list td.no b{font-family:'Display',serif;font-size:21px;color:#2346F5}
.list td.date{width:31mm}
.list td.date div{display:inline-block;min-width:25mm;padding:5px 8px 4px;border-radius:12px;background:linear-gradient(135deg,#2346F5,#5C7BFF);color:#fff;box-shadow:0 2px 6px rgba(35,70,245,.3)}
.list td.date b{display:block;font-family:'Display',serif;font-size:25px;line-height:1.1}
.list td.date small{display:block;font-size:12px;font-weight:700;opacity:.92;margin-top:1px}
.list td.day{font-weight:700;font-size:15.5px}
.list td.main{text-align:right;border-inline-start:5px solid var(--c)}
.list td.main b{display:block;font-size:19px;font-weight:900}
.list td.main small{display:block;font-size:11.5px;color:#5C6178}
.list td.time{font-weight:700;direction:rtl}
.list td.place,.list td.note{font-size:12.5px;color:#454a63}
.list td.note{text-align:right}

/* التذييل */
.legend{display:flex;flex-wrap:wrap;justify-content:center;gap:5px 7px;min-height:5mm}
.lg{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 9px 0 4px;border-radius:99px;background:var(--b);font-size:10.5px;font-weight:700;color:#2A2F45}
.lg i{width:12px;height:12px;border-radius:50%;background:var(--c);display:inline-block}
.lg em{font-style:normal;font-family:'Display',serif;font-size:12px;color:var(--c);margin-inline-start:2px}
.foot{display:flex;justify-content:space-between;align-items:center;height:10mm;padding:0 12mm;background:#0F172A;color:#CBD5E1;font-size:10.5px}
.foot .tag{display:flex;align-items:center;gap:6px;font-family:'Display',serif;font-weight:900;color:#fff;font-size:15px}
.foot .tag i{width:7px;height:7px;border-radius:50%;background:#5C7BFF;display:inline-block}
</style></head><body>
<div class="page">
  <div class="top">
    <div class="brand"><div class="mark">${LOGO('#111111', '#2346F5', 36)}</div><div><b>سعي</b><small>${esc(school)}</small></div></div>
    <div class="title"><h1>${esc(schedule.title)}</h1><p>${esc(schedule.subtitle || SCHEDULE_KIND_LABELS[schedule.kind])}</p></div>
    <div class="chips"><span class="chip solid">${esc(section)}</span><span class="chip">طُبع <bdi dir="ltr">${arDigits(today)}</bdi></span></div>
  </div>
  <div class="body">
    <div class="wrap">${table}</div>
    <div class="legend">${legend(ctx)}</div>
  </div>
  <div class="foot">
    <span>${weekly ? `أيام الدوام: ${ctx.settings.school_days.map((d) => WEEKDAYS[d]).join('، ')} · الدوام من <bdi>${t12(ctx.settings.start)}</bdi> إلى <bdi>${t12(ctx.settings.end)}</bdi> · ${arDigits(count)} حصة أسبوعياً` : `${arDigits(count)} موعد`}</span>
    <span class="tag"><i></i>اسعَ تُعفَ.</span>
    <span>saeyiq.web.app</span>
  </div>
</div></body></html>`;
}

export function printSchedule(ctx: Ctx) {
  const w = window.open('', '_blank', 'width=1200,height=850');
  if (!w) throw new Error('المتصفح منع النافذة المنبثقة. اسمح بها ثم أعد المحاولة.');
  const base = `${location.origin}${import.meta.env.BASE_URL}`;
  w.document.open();
  w.document.write(schedulePrintHtml(ctx, base));
  w.document.close();
  const go = () => setTimeout(() => { w.focus(); w.print(); }, 250);
  // ننتظر الخطوط ثم نطبع
  const fonts = (w.document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) fonts.ready.then(go).catch(go); else w.onload = go;
}
