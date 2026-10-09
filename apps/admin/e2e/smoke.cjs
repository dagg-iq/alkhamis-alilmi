// اختبار دخان للوحة التحكم (Supabase وهمي) على عرض هاتف وحاسوب — يحفظ لقطات في shots/
// الاستخدام: ADMIN_BASE=/ npm run build && npx serve -s dist -l 4176 & BASE=http://localhost:4176 W=390 node e2e/smoke.cjs
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
  schedules: [
    { id: 'sc1', title: 'جدول الحصص — شعبة أ', subtitle: 'الفصل الدراسي الأول', kind: 'weekly', section_id: 'sec1', is_published: true, sort: 0, created_at: t, updated_at: t },
    { id: 'sc2', title: 'امتحانات الشهر الأول', subtitle: null, kind: 'exam', section_id: null, is_published: false, sort: 1, created_at: t, updated_at: t },
  ],
  schedule_items: [
    ...[0, 1, 2, 3, 4].flatMap((d) => [1, 2, 3, 4, 5, 6].map((n) => ({ id: `i${d}${n}`, schedule_id: 'sc1', day: d, on_date: null, sort: n, start_time: `${String(8 + Math.floor(((n - 1) * 50) / 60)).padStart(2, '0')}:${String(((n - 1) * 50) % 60).padStart(2, '0')}`, end_time: `${String(8 + Math.floor(((n - 1) * 50 + 45) / 60)).padStart(2, '0')}:${String(((n - 1) * 50 + 45) % 60).padStart(2, '0')}`, subject_id: n % 2 ? 's0' : 's1', title: null, teacher: n % 2 ? 'أحمد السوداني' : 'علي كاظم', place: null, note: null }))),
    { id: 'e1', schedule_id: 'sc2', day: null, on_date: '2026-11-02', sort: 1, start_time: '09:00', end_time: '11:00', subject_id: 's0', title: null, teacher: null, place: 'القاعة ٣', note: 'يُحضر الطالب الحاسبة' },
    { id: 'e2', schedule_id: 'sc2', day: null, on_date: '2026-11-04', sort: 2, start_time: '09:00', end_time: '11:00', subject_id: 's1', title: null, teacher: null, place: null, note: null },
  ],
  messages: [], app_settings: [{ key: 'grading', value: { individual_exempt: 90 } }, { key: 'schedule', value: { school_days: [0, 1, 2, 3, 4], start: '08:00', end: '12:00', switch_after: '09:00' } }], grades: [],
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
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
    if (url.pathname.endsWith('/functions/v1/files')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'materials/test.pdf', url: 'https://yjxhprmtyuqnbgraocar.supabase.co/storage/v1/fake-put' }) });
    }
    if (url.pathname.includes('/storage/v1/fake-put')) return route.fulfill({ status: 200, body: '' });
    if (url.pathname.endsWith('/functions/v1/content-ai')) {
      const b = JSON.parse(req.postData() || '{}');
      const vids = [
        { youtube_id: 'dQw4w9WgXcQ', title: 'فيزياء الخامس العلمي المتسعات محاضرة 3 ربط التوالي', duration_sec: 2710, channel: 'الاستاذ احمد', exists: false },
        { youtube_id: 'aaaaaaaaaa2', title: 'اشترك بالقناة', duration_sec: 40, channel: 'الاستاذ احمد', exists: false },
        { youtube_id: 'aaaaaaaaaa3', title: 'المتسعات محاضرة 1', duration_sec: 1900, channel: 'الاستاذ احمد', exists: true },
      ];
      const out = b.action === 'videos' ? { videos: vids }
        : b.action === 'check_keys' ? { results: [
          { name: 'GEMINI_ADMIN_API_KEY', ok: false, detail: '403: Method doesn\'t allow unregistered callers' },
          { name: 'GEMINI_API_KEY', ok: true, detail: 'يعمل' }, { name: 'GEMINI_API_KEY_2', ok: false, detail: 'يعمل لكن حصته انتهت مؤقتاً' },
          { name: 'YOUTUBE_API_KEY', ok: true, detail: 'يعمل' }] }
        : b.action === 'classify_document' ? { subject_id: 's0', kind: 'malzama', chapter_id: 'c1', teacher_id: null, new_teacher: 'أحمد السوداني', title: 'ملزمة الفيزياء — الفصل الأول', scanned: true, pages: 48 }
        : b.action === 'classify_lectures' ? { items: [
          { youtube_id: 'dQw4w9WgXcQ', subject_id: 's0', chapter_id: 'c1', teacher_id: null, new_teacher: 'احمد السوداني', lecture_number: 3, title: 'المحاضرة ٣ — ربط التوالي', skip: false },
          { youtube_id: 'aaaaaaaaaa2', subject_id: 's0', chapter_id: null, new_chapter: { number: 2, title: 'الحث' }, skip: true, title: 'اشترك' },
        ] } : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: session.user }) });
    if (single && Array.isArray(body)) body = body[0] ?? null;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-1/2' }, body: JSON.stringify(body) });
  });
  const routes = (process.env.ROUTES || '/,/students,/schedules,/content,/lectures,/documents,/questions,/news,/tasks,/chat,/settings,/audit').split(',');
  for (const r of routes) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto((process.env.BASE || 'http://localhost:4176') + r, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // FILL="textarea=نص" ثم CLICK="نص الزر" (لتجربة نموذج في الصفحة)
    if (process.env.FILL) {
      const [sel, ...val] = process.env.FILL.split('=');
      await page.fill(sel, val.join('='));
    }
    if (process.env.TAB) await page.getByRole('tab', { name: process.env.TAB }).click();
    if (process.env.UPLOAD) {
      await page.setInputFiles('input[type=file]', process.env.UPLOAD.split(','));
      await page.waitForTimeout(2500);
    }
    if (process.env.CLICK) {
      await page.getByRole('button', { name: process.env.CLICK }).first().click();
      await page.waitForTimeout(1500);
    }
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
