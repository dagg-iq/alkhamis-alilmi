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
  subjects: [{ id: 's0', name: 'الفيزياء', sort: 1 }, { id: 's1', name: 'الكيمياء', sort: 2 }, { id: 's2', name: 'الرياضيات', sort: 3 }],
  sections: [{ id: 'sec1', name: 'أ', sort: 1 }], books: [{ id: 'b0', subject_id: 's0', name: 'الكتاب', sort: 1 }],
  chapters: [{ id: 'c1', book_id: 'b0', number: 1, title: 'المتسعات', sort: 1 }],
  teachers: [{ id: 't1', name: 'أحمد', subject_id: 's0', channel_url: null }],
  lectures: [{ id: 'l1', chapter_id: 'c1', teacher_id: 't1', title: 'المحاضرة ١', youtube_id: 'x', sort: 1, is_published: true }],
  documents: [{ id: 'd1', subject_id: 's0', chapter_id: null, teacher_id: 't1', kind: 'malzama', title: 'ملزمة الفيزياء', file_key: 'k', size_bytes: 1000000, pages: 40, sort: 1, is_published: true, ingested_pages: 40, ingest_status: 'done', outline_status: 'done' },
    { id: 'd2', subject_id: 's0', chapter_id: null, teacher_id: null, kind: 'book', title: 'كتاب الرياضيات', file_key: 'k2', size_bytes: 9500000, pages: 258, sort: 2, is_published: true, ingested_pages: 64, ingest_status: 'running', outline_status: 'none', queued_at: new Date(Date.now() - 600e3).toISOString() },
    { id: 'd3', subject_id: 's0', chapter_id: null, teacher_id: null, kind: 'malzama', title: 'ملزمة الكيمياء', file_key: 'k3', size_bytes: 3000000, pages: 60, sort: 3, is_published: true, ingested_pages: 0, ingest_status: 'running', outline_status: 'none', queued_at: new Date().toISOString() },
    { id: 'd4', subject_id: 's0', chapter_id: null, teacher_id: null, kind: 'malzama', title: 'ملزمة جديدة', file_key: 'k4', size_bytes: 2000000, pages: null, sort: 4, is_published: false, ingested_pages: 0, ingest_status: 'none', outline_status: 'none' }],
  ingest_chunks: [
    ...Array.from({ length: 16 }, (_, i) => ({ document_id: 'd2', status: 'done', from_page: i * 4 + 1, to_page: i * 4 + 4, next_at: t, last_error: null })),
    { document_id: 'd2', status: 'running', from_page: 65, to_page: 68, next_at: t, last_error: null },
    ...Array.from({ length: 47 }, (_, i) => ({ document_id: 'd2', status: 'pending', from_page: 69 + i * 4, to_page: 72 + i * 4, next_at: t, last_error: null })),
    ...Array.from({ length: 8 }, (_, i) => ({ document_id: 'd3', status: 'pending', from_page: i * 8 + 1, to_page: i * 8 + 8, next_at: t, last_error: null })),
  ],
  document_outline: [
    { id: 'o1', document_id: 'd1', level: 1, title: 'المتسعات', start_page: 1, end_page: 20, sort: 1, parent_id: null },
    { id: 'o2', document_id: 'd1', level: 2, title: 'قانون كولوم', start_page: 3, end_page: 7, sort: 2, parent_id: 'o1' },
    { id: 'o3', document_id: 'd1', level: 2, title: 'المجال الكهربائي', start_page: 8, end_page: 20, sort: 3, parent_id: 'o1' },
    { id: 'o4', document_id: 'd1', level: 1, title: 'الحث الكهرومغناطيسي', start_page: 21, end_page: 40, sort: 4, parent_id: null },
  ],
  document_pages: [],
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
  ai_key_usage: [
    ...['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'].map((m) => ({ day: t.slice(0, 10), slot: 'GEMINI_API_KEY', model: m, requests: 20, errors: 1, last_status: 429, last_error: 'Quota exceeded', last_at: t })),
    { day: t.slice(0, 10), slot: 'GEMINI_API_KEY', model: 'gemini-3.5-flash', requests: 7, errors: 0, last_status: 200, last_error: null, last_at: t },
    { day: t.slice(0, 10), slot: 'GEMINI_API_KEY_2', model: 'gemini-3.8-flash', requests: 3, errors: 1, last_status: 429, last_error: 'per minute', last_at: t },
    { day: t.slice(0, 10), slot: 'GEMINI_API_KEY', model: 'gemini-embedding-001', requests: 40, errors: 0, last_status: 200, last_error: null, last_at: t },
  ],
  ai_key_blocks: [
    ...['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'].map((m) => ({ slot: 'GEMINI_API_KEY', model: m, blocked_until: new Date(Date.now() + 3 * 3600e3).toISOString(), reason: 'انتهت الحصة اليومية — تعود ٣:٢٩ ص' })),
    { slot: 'GEMINI_API_KEY_2', model: 'gemini-3.8-flash', blocked_until: new Date(Date.now() + 40e3).toISOString(), reason: 'حد الدقيقة' },
    { slot: 'GEMINI_ADMIN_API_KEY', model: '*', blocked_until: new Date(Date.now() + 6 * 3600e3).toISOString(), reason: 'Your project has been denied access. Please contact support.' },
  ],
  ai_usage: [
    { user_id: 'p2', day: t.slice(0, 10), count: 14, profiles: { full_name: 'محمد جاسم علي', sections: { name: 'أ' } } },
    { user_id: UID, day: t.slice(0, 10), count: 5, profiles: { full_name: 'علي حسين كاظم', sections: { name: 'أ' } } },
    { user_id: 'p2', day: '2026-10-07', count: 20, profiles: { full_name: 'محمد جاسم علي', sections: { name: 'أ' } } },
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
    let body = m ? (m[1] ? (m[2] === 'admin_stats' ? { students: 41, pending: 3, lectures: 120, documents: 14, question_sets: 22, drafts: 2, messages_today: 87, ai_today: 160, study_minutes_week: 5400 } : null) : (data[m[2]] ?? [])) : [];
    // فلترة بسيطة: ?col=eq.value
    if (Array.isArray(body)) {
      for (const [k, v] of url.searchParams) {
        if (v.startsWith('eq.') && !['select', 'order', 'limit'].includes(k)) body = body.filter((row) => !(k in row) || String(row[k]) === v.slice(3));
      }
    }
    if (req.method() === 'POST' && url.pathname.endsWith('/rest/v1/question_sets')) console.log('INSERT question_sets', req.postData());
    if (url.pathname.endsWith('/functions/v1/files')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'materials/test.pdf', url: 'https://yjxhprmtyuqnbgraocar.supabase.co/storage/v1/fake-put' }) });
    }
    if (url.pathname.includes('/storage/v1/fake-put')) return route.fulfill({ status: 200, body: '' });
    if (url.pathname.endsWith('/functions/v1/scan-convert')) {
      const html = `<section class="page"><div style="text-align:center;font-weight:700;font-size:20px;border-bottom:2px solid #111;padding-bottom:6px">امتحان الفيزياء — الشهر الأول</div>
<div style="display:flex;justify-content:space-between;margin-top:10px"><span>الزمن: ساعتان</span><span>الدرجة: ٥٠</span></div>
<p style="margin-top:16px"><b>س١:</b> احسب السعة المكافئة إذا كانت $C = \\frac{\\epsilon_0 A}{d}$ و $d = 2\\,\\text{mm}$.</p>
<table border="1" style="width:100%;margin-top:10px"><tr><th>القيمة</th><th>الرمز</th></tr><tr><td>٢٠ فاراد</td><td>C</td></tr></table>
<img data-page="1" data-box="100,100,400,500" style="width:40%">
<div class="line"></div><div class="line"></div><p><b>س٢:</b> علل: تزداد سعة المتسعة عند إدخال مادة عازلة. <span class="dots"></span></p></section>`;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html }) });
    }
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
        : b.action === 'key_slots' ? { slots: ['GEMINI_ADMIN_API_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4'], per_model: 20, models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], fallback: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] }
        : b.action === 'classify_document' ? (console.log('CLASSIFY', JSON.stringify({ name: b.name, pages: b.pages, sample: (b.sample || '').length, key: b.key || null })), { subject_id: 's2', kind: 'book', chapter_id: null, teacher_id: null, new_teacher: null, title: 'كتاب الرياضيات للصف الخامس العلمي', scanned: true, pages: b.pages })
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
    if (process.env.DBG) page.on('console', (m) => console.log('C', m.type(), m.text().slice(0, 200)));
    await page.goto((process.env.BASE || 'http://localhost:4176') + r, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // FILL="textarea=نص" ثم CLICK="نص الزر" (لتجربة نموذج في الصفحة)
    if (process.env.FILL) {
      const [sel, ...val] = process.env.FILL.split('=');
      await page.fill(sel, val.join('='));
    }
    if (process.env.TAB) await page.getByRole('tab', { name: process.env.TAB }).click();
    if (process.env.SCAN) {
      const noAi = process.env.AI === '0';
      await page.getByRole('button', { name: /إضافة أسئلة/ }).click();
      const box = page.getByRole('checkbox');
      if ((await box.isChecked()) === noAi) await box.click();
      await page.setInputFiles('input[type=file][multiple]', process.env.SCAN.split(','));
      await page.locator('input.input').first().fill('أسئلة الفيزياء — الشهر الأول');
      await page.getByRole('button', { name: noAi ? 'جهّز الملف' : 'حوّل إلى PDF' }).click();
      await page.waitForSelector('.sc-prev img', { timeout: 30000 });
      await page.waitForTimeout(500);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تنزيل PDF' }).click()]);
      await dl.saveAs(`/tmp/claude-0/converted${noAi ? '-raw' : ''}.pdf`);
      await page.screenshot({ path: `shots/admin_composer${noAi ? '_raw' : ''}.png`, fullPage: true });
      await page.getByRole('button', { name: 'حفظ ونشر للطلاب' }).click();
      await page.waitForTimeout(1200);
    }
    if (process.env.MODE_PDF) {
      await page.getByRole('button', { name: /إضافة أسئلة/ }).click();
      await page.getByRole('tab', { name: 'ملف PDF' }).click();
      await page.setInputFiles('input[type=file][accept="application/pdf"]', process.env.MODE_PDF);
      await page.locator('input.input').first().fill('ملف جاهز');
      await page.screenshot({ path: 'shots/admin_composer_pdf.png', fullPage: true });
      await page.getByRole('button', { name: 'حفظ ونشر للطلاب' }).click();
      await page.waitForTimeout(1200);
    }
    if (process.env.MODE_TEXT) {
      await page.getByRole('button', { name: /إضافة أسئلة/ }).click();
      await page.getByRole('tab', { name: 'كتابة نص' }).click();
      await page.fill('textarea', 'س١: احسب $C=\\frac{Q}{V}$');
      await page.locator('input.input').first().fill('نص تجريبي');
      await page.getByRole('button', { name: 'حفظ كمسودة' }).click();
      await page.waitForTimeout(1200);
    }
    if (process.env.UPLOAD) {
      await page.setInputFiles(process.env.UPLOAD_SEL || 'input[type=file]', process.env.UPLOAD.split(','));
      await page.waitForTimeout(Number(process.env.UPLOAD_WAIT || 2500));
      if (process.env.DBG) console.log('INPUTS', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map((i) => ({ accept: i.accept, disabled: i.disabled, files: i.files.length })))));
      if (process.env.DBG) console.log('BODY', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600));
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
