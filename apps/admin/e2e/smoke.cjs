// اختبار دخان للوحة التحكم (Supabase وهمي) على عرض هاتف وحاسوب — يحفظ لقطات في shots/
// الاستخدام: npm run build && npx serve -s dist -l 4176 & BASE=http://localhost:4176 W=390 node e2e/smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const UID = '11111111-1111-1111-1111-111111111111';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: now + 36000, aud: 'authenticated' })}.sig`;
const session = { access_token: jwt, refresh_token: 'r', expires_in: 36000, expires_at: now + 36000, token_type: 'bearer',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 't@x.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const t = new Date().toISOString();
const profile = { id: UID, full_name: 'علي حسين كاظم', avatar_url: null, section_id: 'sec1', role: 'admin', status: 'approved', is_verified: true, onboarded: true, created_at: t, sections: { name: 'أ' } };
const data = {
  profiles: [profile, { ...profile, id: 'p2', full_name: 'محمد جاسم علي', role: 'student', status: 'pending', is_verified: false }],
  subjects: [{ id: 's0', name: 'الفيزياء', sort: 1 }, { id: 's1', name: 'الكيمياء', sort: 2 }],
  sections: [{ id: 'sec1', name: 'أ', sort: 1 }], books: [{ id: 'b0', subject_id: 's0', name: 'الكتاب', sort: 1 }],
  chapters: [{ id: 'c1', book_id: 'b0', number: 1, title: 'المتسعات', sort: 1 }],
  teachers: [{ id: 't1', name: 'أحمد', subject_id: 's0', channel_url: null }],
  lectures: [{ id: 'l1', chapter_id: 'c1', teacher_id: 't1', title: 'المحاضرة ١', youtube_id: 'x', sort: 1, is_published: true }],
  documents: [{ id: 'd1', subject_id: 's0', chapter_id: null, teacher_id: 't1', kind: 'malzama', title: 'ملزمة الفيزياء', file_key: 'k', size_bytes: 1000000, pages: 40, sort: 1, is_published: true, ingested_pages: 0, ingest_status: 'none' }],
  question_sets: [{ id: 'q1', subject_id: 's0', kind: 'expected', period: 'month1', title: 'أسئلة الشهر الأول', source: 'ملزمة', content_md: 'س١', status: 'published', created_at: t }],
  posts: [{ id: 'p1', author_id: UID, kind: 'holiday', title: 'عطلة غداً', body: 'غداً عطلة رسمية', section_id: null, is_pinned: true, published_at: t }],
  tasks: [{ id: 'tk1', scope: 'school', type: 'exam', title: 'امتحان الفيزياء', due_at: t, section_id: null, subject_id: 's0', created_at: t }],
  audit_log: [{ id: 'a1', action: 'insert', target_type: 'posts', meta: { title: 'عطلة' }, created_at: t, profiles: { full_name: 'علي' } }],
  conversations: [{ id: 'cv1', type: 'school', title: 'المدرسة', only_staff_can_post: false }],
  messages: [], app_settings: [{ key: 'grading', value: { individual_exempt: 90 } }], grades: [],
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) } });
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-yjxhprmtyuqnbgraocar-auth-token', s), [JSON.stringify(session)]);
  await ctx.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const m = url.pathname.match(/\/rest\/v1\/(rpc\/)?([a-z_]+)/);
    let body = m ? (m[1] ? null : (data[m[2]] ?? [])) : [];
    // فلترة بسيطة: ?col=eq.value
    if (Array.isArray(body)) {
      for (const [k, v] of url.searchParams) {
        if (v.startsWith('eq.') && !['select', 'order', 'limit'].includes(k)) body = body.filter((row) => !(k in row) || String(row[k]) === v.slice(3));
      }
    }
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: session.user }) });
    if (single && Array.isArray(body)) body = body[0] ?? null;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-1/2' }, body: JSON.stringify(body) });
  });
  const routes = (process.env.ROUTES || '/,/students,/content,/lectures,/documents,/questions,/news,/tasks,/chat,/settings,/audit').split(',');
  for (const r of routes) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto((process.env.BASE || 'http://localhost:4176') + r, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `shots/admin${r.replace(/\//g, '_')}.png`, fullPage: true });
    console.log(`${errs.length || overflow > 1 ? '❌' : '✅'} ${r} overflow=${overflow} ${errs.join(' | ')}`);
    await page.close();
  }
  if (process.env.MENU) {
    const page = await ctx.newPage();
    await page.goto((process.env.BASE || 'http://localhost:4176') + '/', { waitUntil: 'networkidle' });
    await page.click('button[aria-label="فتح القائمة"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'shots/admin_menu.png' });
  }
  await browser.close();
})();
