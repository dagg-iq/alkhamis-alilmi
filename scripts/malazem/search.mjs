// بحث داخل موقع الطالب العراقي (eduiiq.com، ووردبريس) عن ملازم الخامس، ويطبع روابط Google Drive لكل نتيجة (قراءة فقط)
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'ar,en;q=0.8' };
const QUERIES = ['ملزمة انكليزي الخامس', 'ملزمة احياء الخامس', 'ملزمة فيزياء الخامس', 'ملزمة رياضيات الخامس', 'ملزمة كيمياء الخامس', 'ملزمة عربي الخامس',
  'عباس الدراجي', 'ايوب احمد', 'علي الذهبي', 'علي الغرابي', 'مازن الهلالي', 'احمد الجاف'];
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#8211;/g, '–').replace(/\s+/g, ' ').trim();
const get = async (u) => (await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })).text();
const seen = new Set();
for (const q of QUERIES) {
  console.log(`\n################ ${q}`);
  let html = '';
  try { html = await get(`https://eduiiq.com/?s=${encodeURIComponent(q)}`); } catch (e) { console.log('ERR', e.message); continue; }
  const results = [...new Set([...html.matchAll(/href="(https:\/\/eduiiq\.com\/lieutenant\/[^"#]+)"/g)].map((m) => m[1]))].slice(0, 14);
  for (const u of results) {
    if (seen.has(u)) { console.log(`  (مكرر) ${decodeURI(u)}`); continue; }
    seen.add(u);
    try {
      const p = await get(u);
      const title = text(p.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
      if (!/خامس/.test(title)) continue;
      const facts = [...new Set(text(p).match(/(عدد الصفحات|الحجم|تاريخ التحديث)[^|]{0,30}/g) ?? [])].slice(0, 4).join(' | ');
      const drive = [...new Set([...p.matchAll(/href="(https:\/\/drive\.google\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => `${m[1]} «${text(m[2])}»`))];
      console.log(`\n  == ${title.slice(0, 90)}\n     ${u}\n     ${facts}`);
      for (const d of drive) console.log(`     DRIVE ${d}`);
    } catch (e) { console.log(`  ERR ${u} ${e.message}`); }
  }
}
