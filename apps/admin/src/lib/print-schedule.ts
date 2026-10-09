import {
  SCHEDULE_KIND_LABELS, WEEKDAYS, arDigits, dateParts, weekdayOf,
  type Schedule, type ScheduleItem, type ScheduleSettings, type Section, type Subject,
} from '@saey/shared';

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t12 = (t: string | null) => (t ? arDigits(t.replace(/^0/, '')) : '');
const range = (it: ScheduleItem) => (it.start_time ? `${t12(it.start_time)}${it.end_time ? ` – ${t12(it.end_time)}` : ''}` : '');

/** ألوان المواد: خلفية فاتحة، لون الحافة والعنوان */
const TONES = [
  { bg: '#EAF0FF', bd: '#2346F5', tx: '#1B2FA8' },
  { bg: '#E4F6EC', bd: '#12805C', tx: '#0B5A40' },
  { bg: '#FFF0DC', bd: '#E58A00', tx: '#8A4F00' },
  { bg: '#F1E9FE', bd: '#7A4FE0', tx: '#4B2A9E' },
  { bg: '#DFF5F6', bd: '#0E8F95', tx: '#0A5F63' },
  { bg: '#FFE6EE', bd: '#D6336C', tx: '#8E1E48' },
  { bg: '#FBF3C9', bd: '#B58900', tx: '#6E5200' },
  { bg: '#E9ECF2', bd: '#5A6275', tx: '#363D4D' },
];
const NEUTRAL = TONES[7];

const LOGO = (ink: string, dot: string, size = 30) => `<svg width="${size}" height="${size}" viewBox="0 0 120 120"><rect x="80" y="62" width="20" height="42" rx="10" fill="${ink}"/><rect x="50" y="44" width="20" height="60" rx="10" fill="${ink}"/><rect x="20" y="30" width="20" height="74" rx="10" fill="${ink}"/><rect x="20" y="84" width="80" height="20" rx="10" fill="${ink}"/><circle cx="30" cy="12" r="10" fill="${dot}"/></svg>`;

interface Ctx { schedule: Schedule; items: ScheduleItem[]; subjects: Subject[]; sections: Section[]; settings: ScheduleSettings; school: string }

const nameOf = (it: ScheduleItem, subjects: Subject[]) =>
  (it.title?.trim() || subjects.find((s) => s.id === it.subject_id)?.name || '').trim();

/** لون ثابت لكل مادة (حسب ترتيبها)، وللعناوين الحرة لون محايد */
function toneOf(it: ScheduleItem, subjects: Subject[]) {
  const i = it.subject_id ? subjects.findIndex((s) => s.id === it.subject_id) : -1;
  return i >= 0 && !it.title?.trim() ? TONES[i % 7] : NEUTRAL;
}

function legend(ctx: Ctx): string {
  const used = new Map<string, { name: string; tone: (typeof TONES)[number] }>();
  for (const it of ctx.items) {
    const n = nameOf(it, ctx.subjects);
    if (n && !used.has(n)) used.set(n, { name: n, tone: toneOf(it, ctx.subjects) });
  }
  return [...used.values()].map((u) => `<span class="lg"><i style="background:${u.tone.bd}"></i>${esc(u.name)}</span>`).join('');
}

function weeklyTable(ctx: Ctx): string {
  const { items, subjects, settings } = ctx;
  const days = settings.school_days;
  const rows = Math.max(1, ...days.map((d) => items.filter((i) => i.day === d).length), ...items.map((i) => i.sort || 0));
  const cell = (d: number, r: number) => {
    const list = items.filter((i) => i.day === d).sort((a, b) => a.sort - b.sort);
    return list.find((i) => i.sort === r + 1) ?? list[r];
  };
  const timeOf = (r: number) => {
    const it = days.map((d) => cell(d, r)).find((x) => x?.start_time);
    return it ? range(it) : '';
  };
  const head = days.map((d) => `<th><span>${WEEKDAYS[d]}</span></th>`).join('');
  const body = Array.from({ length: rows }, (_, r) => `<tr><td class="no"><b>${arDigits(r + 1)}</b><small>${timeOf(r)}</small></td>${days.map((d) => {
    const it = cell(d, r);
    if (!it) return '<td class="gap"><span>—</span></td>';
    const t = toneOf(it, subjects);
    return `<td class="lesson"><div style="background:${t.bg};border-color:${t.bd}"><b style="color:${t.tx}">${esc(nameOf(it, subjects))}</b>${it.teacher ? `<small>${esc(it.teacher)}</small>` : ''}${it.place ? `<small>${esc(it.place)}</small>` : ''}</div></td>`;
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
.top{position:relative;height:34mm;padding:0 13mm;display:flex;align-items:center;gap:7mm;color:#fff;overflow:hidden;
  background:linear-gradient(115deg,#1631B8 0%,#2346F5 48%,#6F8BFF 100%)}
.top::before{content:'';position:absolute;width:120mm;height:120mm;border-radius:50%;left:-30mm;top:-70mm;background:rgba(255,255,255,.10)}
.top::after{content:'';position:absolute;width:80mm;height:80mm;border-radius:50%;left:55mm;top:12mm;background:rgba(255,255,255,.07)}
.top>*{position:relative;z-index:1}
.brand{display:flex;align-items:center;gap:4mm}
.brand .mark{width:17mm;height:17mm;border-radius:5mm;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2mm 5mm rgba(10,20,90,.28)}
.brand b{display:block;font-family:'Display',serif;font-size:30px;font-weight:900;line-height:1}
.brand small{display:block;font-size:11.5px;opacity:.88;margin-top:3px}
.title{flex:1;text-align:center}
.title h1{margin:0;font-family:'Display',serif;font-weight:900;font-size:${dense ? 34 : 40}px;line-height:1.2;letter-spacing:.2px}
.title p{margin:4px 0 0;font-size:14px;opacity:.92}
.chips{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.chip{display:inline-flex;align-items:center;gap:6px;height:25px;padding:0 13px;border-radius:99px;background:rgba(255,255,255,.2);font-size:12.5px;font-weight:700;border:1px solid rgba(255,255,255,.35)}
.chip.solid{background:#fff;color:#1B38D4;border-color:#fff}

/* الجسم */
.body{flex:1;min-height:0;padding:6mm 11mm 3mm;display:flex;flex-direction:column;gap:3.5mm}
.wrap{flex:1;min-height:0;display:flex}
table{width:100%;border-collapse:separate;table-layout:fixed}
th span{display:flex;align-items:center;justify-content:center;height:100%;min-height:28px;border-radius:10px;background:linear-gradient(180deg,#2346F5,#1B38D4);color:#fff;font-size:15.5px;font-weight:700;box-shadow:0 1px 0 rgba(0,0,0,.12)}

/* جدول الحصص: بطاقات ملوّنة */
.grid{border-spacing:5px;height:100%}
.grid thead th{height:30px;padding:0}
.grid th.no span{background:linear-gradient(180deg,#111,#2B2B33)}
.grid td{padding:0;vertical-align:stretch}
.grid td.no{width:24mm}
.grid td.no{background:#F2F4FF;border-radius:10px;text-align:center;border:1.5px solid #DCE2FF}
.grid td.no b{display:block;font-family:'Display',serif;font-size:26px;line-height:1.05;color:#2346F5}
.grid td.no small{display:block;font-size:10.5px;color:#4B5278;font-weight:500;margin-top:2px}
.lesson>div{height:100%;min-height:15mm;border-radius:10px;border:0;border-inline-start:5px solid;padding:6px 9px;display:flex;flex-direction:column;justify-content:center;gap:1px;text-align:right}
.lesson b{font-size:${dense ? 15 : 17}px;font-weight:900;line-height:1.3}
.lesson small{font-size:10.5px;color:#4a4f66;font-weight:500}
.gap{text-align:center;color:#C5C8DA;border-radius:10px;border:1.5px dashed #E2E5F2}

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
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:10.5px;color:#4B5278;min-height:5mm}
.lg{display:inline-flex;align-items:center;gap:5px;font-weight:500}
.lg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.foot{display:flex;justify-content:space-between;align-items:center;height:10mm;padding:0 13mm;background:#F2F4FF;color:#5B6285;font-size:11px;border-top:1.5px solid #DCE2FF}
.foot .tag{display:flex;align-items:center;gap:6px;font-family:'Display',serif;font-weight:900;color:#2346F5;font-size:15px}
</style></head><body>
<div class="page">
  <div class="top">
    <div class="brand"><div class="mark">${LOGO('#111111', '#2346F5', 36)}</div><div><b>سعي</b><small>${esc(school)}</small></div></div>
    <div class="title"><h1>${esc(schedule.title)}</h1><p>${esc(schedule.subtitle || SCHEDULE_KIND_LABELS[schedule.kind])}</p></div>
    <div class="chips"><span class="chip solid">${esc(section)}</span><span class="chip"><bdi dir="ltr">${arDigits(today)}</bdi></span></div>
  </div>
  <div class="body">
    <div class="wrap">${table}</div>
    <div class="legend">${legend(ctx)}</div>
  </div>
  <div class="foot">
    <span>${weekly ? `أيام الدوام: ${ctx.settings.school_days.map((d) => WEEKDAYS[d]).join('، ')} · الدوام ${t12(ctx.settings.start)} – ${t12(ctx.settings.end)}` : `${arDigits(count)} موعد`}</span>
    <span class="tag">اسعَ تُعفَ.</span>
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
