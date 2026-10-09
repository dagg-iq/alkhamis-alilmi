import {
  SCHEDULE_KIND_LABELS, WEEKDAYS, arDigits, weekdayOf,
  type Schedule, type ScheduleItem, type ScheduleSettings, type Section, type Subject,
} from '@saey/shared';

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t12 = (t: string | null) => (t ? arDigits(t.replace(/^0/, '')) : '');
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const LOGO = (ink: string, dot: string) => `<svg width="46" height="46" viewBox="0 0 120 120"><rect x="80" y="62" width="20" height="42" rx="10" fill="${ink}"/><rect x="50" y="44" width="20" height="60" rx="10" fill="${ink}"/><rect x="20" y="30" width="20" height="74" rx="10" fill="${ink}"/><rect x="20" y="84" width="80" height="20" rx="10" fill="${ink}"/><circle cx="30" cy="12" r="10" fill="${dot}"/></svg>`;

interface Ctx { schedule: Schedule; items: ScheduleItem[]; subjects: Subject[]; sections: Section[]; settings: ScheduleSettings; school: string }

const nameOf = (it: ScheduleItem, subjects: Subject[]) =>
  (it.title?.trim() || subjects.find((s) => s.id === it.subject_id)?.name || '').replace(/^(ال)?(مادة )?/, '');

function weeklyTable({ items, subjects, settings }: Ctx): string {
  const days = settings.school_days;
  const rows = Math.max(1, ...days.map((d) => items.filter((i) => i.day === d).length), ...items.map((i) => i.sort || 0));
  const cell = (d: number, r: number) => {
    const list = items.filter((i) => i.day === d).sort((a, b) => a.sort - b.sort);
    return list.find((i) => i.sort === r + 1) ?? list[r];
  };
  // وقت الصف: من أول حصة لها وقت في هذا الرقم
  const timeOf = (r: number) => {
    const it = days.map((d) => cell(d, r)).find((x) => x?.start_time);
    return it ? `${t12(it.start_time)}${it.end_time ? ` – ${t12(it.end_time)}` : ''}` : '';
  };
  const head = days.map((d) => `<th>${WEEKDAYS[d]}</th>`).join('');
  const body = Array.from({ length: rows }, (_, r) => `<tr><td class="no"><b>${arDigits(r + 1)}</b><small>${timeOf(r)}</small></td>${days.map((d) => {
    const it = cell(d, r);
    if (!it) return '<td class="empty">—</td>';
    return `<td><b>${esc(nameOf(it, subjects))}</b>${it.teacher ? `<small>${esc(it.teacher)}</small>` : ''}${it.place ? `<small>${esc(it.place)}</small>` : ''}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="grid"><thead><tr><th class="no">الحصة</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function datedTable({ items, subjects }: Ctx): string {
  const sorted = [...items].sort((a, b) => (a.on_date ?? '9').localeCompare(b.on_date ?? '9') || a.sort - b.sort);
  const body = sorted.map((it, i) => {
    const [, m, d] = (it.on_date ?? '').split('-').map(Number);
    return `<tr><td class="no"><b>${arDigits(i + 1)}</b></td>
<td class="date">${it.on_date ? `<b>${arDigits(d)}</b><small>${MONTHS[m - 1]}</small>` : '—'}</td>
<td>${it.on_date ? WEEKDAYS[weekdayOf(it.on_date)] : ''}</td>
<td class="main"><b>${esc(nameOf(it, subjects))}</b>${it.teacher ? `<small>${esc(it.teacher)}</small>` : ''}</td>
<td>${t12(it.start_time)}${it.end_time ? ` – ${t12(it.end_time)}` : ''}</td>
<td>${esc(it.place)}</td><td class="note">${esc(it.note)}</td></tr>`;
  }).join('');
  return `<table class="list${items.length <= 9 ? ' fill' : ''}"><thead><tr><th class="no">#</th><th>التاريخ</th><th>اليوم</th><th>المادة / الموضوع</th><th>الوقت</th><th>المكان</th><th>ملاحظات</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** صفحة A4 عرضية بتصميم سعي، تُفتح في نافذة وتُطبع */
export function schedulePrintHtml(ctx: Ctx, base: string): string {
  const { schedule, sections, school } = ctx;
  const section = schedule.section_id ? `شعبة ${sections.find((s) => s.id === schedule.section_id)?.name ?? ''}` : 'كل الشعب';
  const today = new Date().toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' });
  const table = schedule.kind === 'weekly' ? weeklyTable(ctx) : datedTable(ctx);
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
.page{width:297mm;height:209mm;padding:10mm 12mm 8mm;display:flex;flex-direction:column;gap:6mm;position:relative;overflow:hidden}
.page::before{content:'';position:absolute;inset:0 0 auto 0;height:5mm;background:linear-gradient(90deg,#2346F5,#7B92FF)}
header{display:flex;align-items:center;gap:5mm;padding-top:3mm}
.brand{display:flex;align-items:center;gap:3mm}
.brand b{font-family:'Display',serif;font-size:26px;font-weight:900;line-height:1}
.brand small{display:block;font-size:11px;color:#5C5C5C;margin-top:2px}
.title{flex:1;text-align:center}
.title h1{margin:0;font-family:'Display',serif;font-weight:900;font-size:34px;line-height:1.25}
.title p{margin:2px 0 0;font-size:13px;color:#5C5C5C}
.meta{text-align:left;font-size:11.5px;color:#5C5C5C;line-height:1.7}
.meta b{display:inline-block;padding:2px 12px;border-radius:99px;background:#EEF1FF;color:#2346F5;font-size:12px}
.wrap{flex:1;min-height:0;display:flex}
table{width:100%;border-collapse:separate;border-spacing:0;border:1.5px solid #DADDF2;border-radius:14px;overflow:hidden;table-layout:fixed}
th{background:#2346F5;color:#fff;font-size:15px;font-weight:700;padding:9px 6px}
td{padding:6px 8px;text-align:center;vertical-align:middle;border-top:1px solid #E6E8F5;border-right:1px solid #E6E8F5;font-size:14px}
tr:nth-child(even) td{background:#F7F8FF}
td:last-child,th:last-child{border-right:0}
td b{display:block;font-weight:700}
td small{display:block;font-size:10.5px;color:#6A6F8A;margin-top:1px}
.grid td b{font-size:16px}
.no{width:22mm;background:#EEF1FF!important;color:#1A1F3D}
.no b{font-family:'Display',serif;font-size:20px}
th.no{background:#1B38D4!important;color:#fff}
.empty{color:#B8BBD0}
.list{height:auto;align-self:flex-start}
.list.fill{height:100%;align-self:stretch}
.list td{padding:9px 8px}
.list .main{text-align:right;font-size:16px}
.list .date b{font-family:'Display',serif;font-size:22px;line-height:1.1}
.list .date small{font-size:11px}
.list .note{text-align:right;font-size:12px;color:#444}
footer{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#8A8FA8;border-top:1px solid #E6E8F5;padding-top:3mm}
footer b{font-family:'Display',serif;color:#2346F5;font-size:14px}
</style></head><body>
<div class="page">
<header>
  <div class="brand">${LOGO('#111111', '#2346F5')}<div><b>سعي</b><small>${esc(school)}</small></div></div>
  <div class="title"><h1>${esc(schedule.title)}</h1><p>${esc(schedule.subtitle || SCHEDULE_KIND_LABELS[schedule.kind])}</p></div>
  <div class="meta"><b>${esc(section)}</b><br>${today}</div>
</header>
<div class="wrap">${table}</div>
<footer><span>${schedule.kind === 'weekly' ? `أيام الدوام: ${ctx.settings.school_days.map((d) => WEEKDAYS[d]).join('، ')} · الدوام ${t12(ctx.settings.start)} – ${t12(ctx.settings.end)}` : ''}</span><b>اسعَ تُعفَ.</b><span>saeyiq.web.app</span></footer>
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
