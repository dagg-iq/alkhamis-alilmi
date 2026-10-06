// اختبار دخان لكل الشاشات على نسخة الويب مع Supabase وهمي (يكشف أخطاء التشغيل قبل الهاتف)
// الاستخدام: npx expo export -p web --output-dir /tmp/web && npx serve -s /tmp/web -l 4175 & BASE=http://localhost:4175 node e2e/smoke.js
// يحفظ لقطات الشاشات في مجلد shots/
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const UID = '11111111-1111-1111-1111-111111111111';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: now + 36000, aud: 'authenticated' })}.sig`;
const session = { access_token: jwt, refresh_token: 'r', expires_in: 36000, expires_at: now + 36000, token_type: 'bearer',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 't@x.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const profile = { id: UID, full_name: 'علي حسين كاظم', avatar_url: null, section_id: 'sec1', role: 'admin', status: 'approved', is_verified: true, bio: 'هدفي الإعفاء', onboarded: true, created_at: new Date().toISOString(), last_seen_at: null, sections: { name: 'أ' } };
const subjects = ['الفيزياء', 'الكيمياء', 'اللغة العربية', 'الرياضيات', 'الأحياء', 'اللغة الإنكليزية', 'التربية الإسلامية', 'الحاسوب'].map((n, i) => ({ id: `s${i}`, name: n, slug: `x${i}`, icon: null, sort: i }));
const t = new Date(Date.now() + 3 * 86400000).toISOString();
const data = {
  profiles: [profile],
  subjects, sections: [{ id: 'sec1', school_id: 'sch', name: 'أ', sort: 1 }],
  books: [{ id: 'b0', subject_id: 's0', name: 'الكتاب', sort: 1 }, { id: 'b2a', subject_id: 's2', name: 'الجزء الأول', sort: 1 }, { id: 'b2b', subject_id: 's2', name: 'الجزء الثاني', sort: 2 }],
  chapters: [{ id: 'c1', book_id: 'b0', number: 1, title: 'المتسعات', sort: 1 }],
  teachers: [{ id: 't1', name: 'أحمد', subject_id: 's0', channel_url: null }],
  lectures: [{ id: 'l1', chapter_id: 'c1', teacher_id: 't1', title: 'المحاضرة ١', youtube_id: 'dQw4w9WgXcQ', duration_sec: null, sort: 1, is_published: true, teachers: { name: 'أحمد' }, chapters: { number: 1, title: 'المتسعات', books: { subject_id: 's0' } } }],
  documents: [{ id: 'd1', subject_id: 's0', chapter_id: null, teacher_id: 't1', kind: 'malzama', title: 'ملزمة الفيزياء', file_key: 'materials/x.pdf', size_bytes: 1000000, pages: 40, sort: 1, is_published: true, ingested_pages: 0, ingest_status: 'none', ingest_error: null, subjects: { name: 'الفيزياء' } }],
  question_sets: [{ id: 'q1', subject_id: 's0', kind: 'expected', period: 'month1', section_id: null, title: 'أسئلة الشهر الأول', source: 'ملزمة', content_md: '# س١\nاحسب $E=mc^2$\n- فرع أ\n- فرع ب', pdf_key: null, scan_keys: [], status: 'published', created_by: UID, created_at: new Date().toISOString(), subjects: { name: 'الفيزياء' } }],
  grades: [{ id: 'g1', user_id: UID, subject_id: 's0', period: 'month1', score: 93, note: null }, { id: 'g2', user_id: UID, subject_id: 's0', period: 'midyear', score: 88, note: null }, { id: 'g3', user_id: UID, subject_id: 's1', period: 'month1', score: 70, note: null },
    { id: 'g4', user_id: UID, subject_id: 's3', period: 'month1', score: 98, note: null }, { id: 'g5', user_id: UID, subject_id: 's3', period: 'month2', score: 95, note: null },
    { id: 'g6', user_id: UID, subject_id: 's4', period: 'month1', score: 85, note: null }, { id: 'g7', user_id: UID, subject_id: 's5', period: 'month1', score: 45, note: null }],
  tasks: [{ id: 'tk1', scope: 'personal', owner_id: UID, section_id: null, subject_id: 's0', type: 'exam', title: 'امتحان الفيزياء', notes: null, due_at: t, remind_at: null, created_at: t }, { id: 'tk2', scope: 'school', owner_id: 'x', section_id: null, subject_id: null, type: 'homework', title: 'واجب', notes: null, due_at: new Date().toISOString(), remind_at: null, created_at: t }],
  task_status: [], progress: [{ item_type: 'lecture', item_id: 'l1', state: 'watched' }],
  posts: [{ id: 'p1', author_id: UID, kind: 'holiday', title: 'عطلة غداً', body: 'غداً عطلة رسمية', cover_key: null, section_id: null, is_pinned: true, published_at: new Date().toISOString(), profiles: { full_name: 'الأدمن' } }],
  notifications: [{ id: 'n1', user_id: UID, type: 'post', title: 'عطلة غداً', body: 'تفاصيل', payload: { post_id: 'p1' }, read_at: null, created_at: new Date().toISOString() }],
  app_settings: [{ key: 'grading', value: { individual_exempt: 90, general_avg: 85, general_min: 75, pass: 50, round: 'half_up' } }, { key: 'ai', value: { daily_limit: 20 } }, { key: 'chat', value: { direct_messages: true } }],
  conversation_members: [{ profiles: profile }, { profiles: { id: 'u2', full_name: 'حيدر كريم جاسم', avatar_url: null, is_verified: false, role: 'student' } }],
  messages: [
    { id: 'm4', conversation_id: 'cv1', sender_id: UID, body: 'شكراً، سأراجعها الليلة @حيدر_كريم', reply_to_id: 'm3', attachment: null, mentions: [], created_at: new Date().toISOString(), edited_at: null, deleted_at: null },
    { id: 'm3', conversation_id: 'cv1', sender_id: 'u2', body: null, reply_to_id: null, attachment: { type: 'lecture', id: 'l1', title: 'المتسعات — المحاضرة الأولى' }, mentions: [], created_at: new Date(Date.now() - 60000).toISOString(), edited_at: null, deleted_at: null },
    { id: 'm2', conversation_id: 'cv1', sender_id: 'u2', body: 'هذه محاضرة المتسعات، شرحها ممتاز', reply_to_id: null, attachment: null, mentions: [], created_at: new Date(Date.now() - 120000).toISOString(), edited_at: null, deleted_at: null },
    { id: 'm1', conversation_id: 'cv1', sender_id: UID, body: 'السلام عليكم، أحد عنده شرح لفصل المتسعات؟', reply_to_id: null, attachment: null, mentions: [], created_at: new Date(Date.now() - 180000).toISOString(), edited_at: null, deleted_at: null },
  ],
  message_reactions: [{ message_id: 'm2', user_id: UID, emoji: '❤️' }],
  ai_chats: [{ id: 'a1', title: 'سؤال عن المتسعات', updated_at: new Date().toISOString() }],
  ai_messages: [{ id: 'am1', role: 'user', content: 'ما هي السعة؟', sources: null }, { id: 'am2', role: 'assistant', content: '**السعة** هي نسبة الشحنة المختزنة على أحد لوحي المتسعة إلى فرق الجهد بينهما.\n\n- السعة = الشحنة ÷ فرق الجهد\n- وحدتها **الفاراد**\n- تزداد بزيادة مساحة اللوحين\n- وتقل بزيادة البعد بينهما [١]', sources: [{ title: 'ملزمة الفيزياء — الفصل الأول', page: 3 }] }],
  ai_usage: [{ count: 3 }], quiz_attempts: [], study_sessions: [], push_tokens: [],
};
const rpc = {
  my_conversations: [{ id: 'cv1', type: 'section', title: 'شعبة أ', only_staff_can_post: false, last_message_at: new Date().toISOString(), last_body: 'شكراً، سأراجعها الليلة', last_sender: 'علي', unread: 0, muted: false, peer_id: null, peer_name: null, peer_avatar: null, peer_verified: null },
    { id: 'cv2', type: 'direct', title: null, only_staff_can_post: false, last_message_at: new Date(Date.now() - 3600000).toISOString(), last_body: 'متى امتحان الكيمياء؟', last_sender: 'حيدر', unread: 1, muted: false, peer_id: 'u2', peer_name: 'حيدر كريم جاسم', peer_avatar: null, peer_verified: false },
    { id: 'cv3', type: 'school', title: 'المدرسة', only_staff_can_post: false, last_message_at: new Date().toISOString(), last_body: 'غداً عطلة رسمية بمناسبة المولد النبوي', last_sender: 'الإدارة', unread: 2, muted: false, peer_id: null, peer_name: null, peer_avatar: null, peer_verified: null }],
  my_study_week: Array.from({ length: 7 }, (_, i) => ({ day: new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10), minutes: i * 10 })),
  mark_read: null,
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 800) }, deviceScaleFactor: Number(process.env.DSF || 1) });
  await ctx.addInitScript(([s, goal, theme]) => {
    localStorage.setItem('sb-yjxhprmtyuqnbgraocar-auth-token', s);
    if (goal) localStorage.setItem('saey.goal', goal);
    if (theme) localStorage.setItem('saey.theme', theme);
  }, [JSON.stringify(session), process.env.GOAL || 'general', process.env.THEME || '']);
  await ctx.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    let body = [];
    const m = url.pathname.match(/\/rest\/v1\/(rpc\/)?([a-z_]+)/);
    if (m) body = m[1] ? (rpc[m[2]] ?? null) : (data[m[2]] ?? []);
    if (req.method() !== 'GET' && !m?.[1]) body = single ? (Array.isArray(body) ? body[0] : body) : [];
    if (single && Array.isArray(body)) body = body[0] ?? null;
    if (url.pathname.includes('/functions/v1/')) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'اختبار' }) });
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: session.user }) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body) });
  });
  const routes = process.env.ROUTES ? process.env.ROUTES.split(',') : ['/', '/subjects', '/grades', '/chat', '/more', '/subject/s0', '/subject/s2', '/lecture/l1', '/questions/q1', '/grades/s0', '/grades/edit',
    '/planner', '/planner/new', '/news', '/news/p1', '/news/new', '/notifications', '/ai', '/ai/a1', '/quiz/c1', '/timer', '/scan',
    `/profile/${UID}`, '/settings', '/document/d1', '/chat/cv1', '/chat/new'];
  const results = [];
  for (const r of routes) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource|youtube|net::/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 200)); });
    await page.goto((process.env.BASE || 'http://localhost:4175') + r, { waitUntil: 'networkidle' }).catch((e) => errs.push('NAV ' + e.message));
    await page.waitForTimeout(Number(process.env.WAIT || 4000)); // بعد انتهاء المقدمة
    const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 90);
    const name = r.replace(/[\/]/g, '_') || 'home';
    await page.screenshot({ path: `shots/${name}.png` });
    results.push({ r, url: page.url().replace(process.env.BASE || 'http://localhost:4175', ''), errs, text });
    await page.close();
  }
  for (const x of results) console.log(`${x.errs.length ? '❌' : '✅'} ${x.r} -> ${x.url} | ${x.text}\n${x.errs.map((e) => '    ' + e).join('\n')}`);
  await browser.close();
})();
