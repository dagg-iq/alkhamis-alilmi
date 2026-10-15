// يفتح صفحات الملازم ويطبع روابط التحميل (قراءة فقط). يعمل في malazem-discover.yml
import fs from 'node:fs';
const pages = JSON.parse(fs.readFileSync(new URL('./pages.json', import.meta.url), 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'ar,en;q=0.8' };
const INTEREST = /drive\.google|docs\.google|\.pdf(\?|$|#)|mediafire|t\.me\/|terabox|1024tera|up\.mlazemna|download|dropbox|archive\.org|top4top|gofile|pixeldrain|mega\.nz|onedrive|sharepoint|tinyurl|bit\.ly/i;
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
async function get(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  return { status: res.status, url: res.url, type: res.headers.get('content-type') ?? '', len: res.headers.get('content-length'), body: (res.headers.get('content-type') ?? '').includes('html') ? await res.text() : '' };
}
function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = m[1].replace(/&amp;/g, '&');
    try { href = new URL(href, base).href; } catch { continue; }
    out.push({ href, label: text(m[2]).trim().slice(0, 60) });
  }
  for (const m of html.matchAll(/(https?:\/\/(?:drive\.google\.com|docs\.google\.com)[^"'\s<>]+)/g)) out.push({ href: m[1].replace(/&amp;/g, '&'), label: '(raw)' });
  return out;
}
for (const [subject, urls] of Object.entries(pages)) {
  console.log(`\n################ ${subject}`);
  for (const url of urls) {
    try {
      const p = await get(url);
      const title = (p.body.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
      console.log(`\n== ${decodeURI(url).slice(0, 110)} [${p.status}] ${title.slice(0, 90)}`);
      const facts = text(p.body).match(/(عدد الصفحات|الصفحات|حجم الملف|الحجم|تاريخ)[^|]{0,40}/g) ?? [];
      if (facts.length) console.log(`   facts: ${[...new Set(facts)].slice(0, 6).join(' | ')}`);
      const seen = new Set();
      for (const l of links(p.body, p.url)) {
        if (!INTEREST.test(l.href) || seen.has(l.href)) continue;
        seen.add(l.href);
        console.log(`   LINK ${l.href.slice(0, 200)}  «${l.label}»`);
        // صفحة تحميل وسيطة على الموقع نفسه: نفتحها مستوى واحداً
        if (/download|up\.mlazemna|\/d\//i.test(l.href) && !/drive\.google|t\.me|terabox/.test(l.href) && new URL(l.href).host.endsWith(new URL(p.url).host.replace(/^www\./, ''))) {
          try {
            const q = await get(l.href);
            console.log(`      → [${q.status}] ${q.type} ${q.len ?? ''} ${q.url.slice(0, 150)}`);
            for (const x of links(q.body, q.url)) if (INTEREST.test(x.href) && !seen.has(x.href)) { seen.add(x.href); console.log(`      SUB ${x.href.slice(0, 200)}  «${x.label}»`); }
          } catch (e) { console.log(`      → error ${e.message}`); }
        }
      }
    } catch (e) {
      console.log(`\n== ${url.slice(0, 100)} ERROR ${e.message}`);
    }
  }
}
