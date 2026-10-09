import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Logo } from './components/ui';
import { useAuth } from './lib/auth';
import { useLoad } from './lib/hooks';
import { isConfigured, supabase } from './lib/supabase';
import Assistant from './pages/Assistant';
import Audit from './pages/Audit';
import Chat from './pages/Chat';
import Content from './pages/Content';
import Dashboard from './pages/Dashboard';
import Documents from './pages/Documents';
import Lectures from './pages/Lectures';
import Login from './pages/Login';
import News from './pages/News';
import Questions from './pages/Questions';
import Schedules from './pages/Schedules';
import Settings from './pages/Settings';
import Students from './pages/Students';
import Tasks from './pages/Tasks';
import Usage from './pages/Usage';


/** أيقونات خطية للقائمة (٢٤×٢٤، بسماكة ١٫٨) */
const ICON_PATHS: Record<string, ReactNode> = {
  '/': <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  '/students': <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6" /><path d="M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></>,
  '/chat': <><path d="M4 5.5h16v11H9.5L5 20.5v-4H4z" /><path d="M8 10h8M8 13h5" /></>,
  '/assistant': <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></>,
  '/content': <><path d="M12 3L3 8l9 5 9-5z" /><path d="M3 12.5l9 5 9-5" /><path d="M3 16.5l9 5 9-5" /></>,
  '/lectures': <><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M10 9.2v5.6l4.8-2.8z" /></>,
  '/documents': <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h7" /></>,
  '/questions': <><circle cx="12" cy="12" r="9" /><path d="M9.3 9.5a2.8 2.8 0 1 1 4.3 2.4c-.9.6-1.6 1.1-1.6 2.3" /><circle cx="12" cy="17" r=".6" /></>,
  '/schedules': <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h2M14 14h2M8 17h2" /></>,
  '/tasks': <><rect x="4" y="3.5" width="16" height="17.5" rx="3" /><path d="M8.5 12l2.2 2.2L15.5 9.5" /><path d="M9 18h6" /></>,
  '/news': <><path d="M4 5h13v14H6a2 2 0 0 1-2-2z" /><path d="M17 9h3v8a2 2 0 0 1-2 2" /><path d="M7.5 9h6M7.5 12.5h6M7.5 16h3" /></>,
  '/settings': <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></>,
  '/usage': <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  '/audit': <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
};
function NavIcon({ to }: { to: string }) {
  return <svg className="nav-ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[to]}</svg>;
}

type Group = 'home' | 'people' | 'content' | 'plan' | 'system';
const GROUP_TITLES: Record<Group, string> = { home: '', people: 'الطلاب والتواصل', content: 'المحتوى التعليمي', plan: 'الجداول والمتابعة', system: 'النظام' };

// كل قسم بلون: يسهل تمييزه في القائمة
const NAV: { to: string; label: string; g: Group; end?: boolean; badge?: boolean; admin?: boolean }[] = [
  { to: '/', label: 'نظرة عامة', g: 'home', end: true },
  { to: '/students', label: 'الطلاب', g: 'people', badge: true },
  { to: '/chat', label: 'الدردشة', g: 'people' },
  { to: '/assistant', label: 'مساعد المحتوى', g: 'content' },
  { to: '/content', label: 'المواد والفصول', g: 'content' },
  { to: '/lectures', label: 'المحاضرات', g: 'content' },
  { to: '/documents', label: 'الملازم', g: 'content' },
  { to: '/questions', label: 'الأسئلة', g: 'content' },
  { to: '/schedules', label: 'الجداول', g: 'plan' },
  { to: '/tasks', label: 'الواجبات والامتحانات', g: 'plan' },
  { to: '/news', label: 'الأخبار', g: 'plan' },
  { to: '/usage', label: 'الاستخدام', g: 'system', admin: true },
  { to: '/settings', label: 'الإعدادات', g: 'system', admin: true },
  { to: '/audit', label: 'سجل العمليات', g: 'system', admin: true },
];

export default function App() {
  const { ready, session, isStaff, isAdmin, profile } = useAuth();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  // على الهاتف: القائمة تُغلق بعد اختيار صفحة
  useEffect(() => setMenu(false), [location.pathname]);
  const pending = useLoad(async () => {
    if (!isStaff) return 0;
    const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('onboarded', true);
    return count ?? 0;
  }, [isStaff]);

  if (!isConfigured) {
    return (
      <div className="login">
        <div className="card" style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Logo size={56} />
          <h1>إعداد غير مكتمل</h1>
          <p className="dim">أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في متغيرات البيئة (ملف .env.local أو إعدادات Netlify). التفاصيل في system/08-setup-guide.md</p>
        </div>
      </div>
    );
  }
  if (!ready) return null;
  if (!session || !isStaff) return <Login denied={!!session && !isStaff} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="row" style={{ gap: 8 }}><Logo size={28} /><b>سعي</b></div>
        <span className="small dim topbar-title">{NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label}</span>
        <button className="btn sm" onClick={() => setMenu(true)} aria-expanded={menu} aria-label="فتح القائمة">
          القائمة{pending.data ? <span className="count">{pending.data}</span> : null}
        </button>
      </header>
      {menu ? <div className="scrim" onClick={() => setMenu(false)} role="presentation" /> : null}
      <nav className={`side${menu ? ' open' : ''}`} aria-label="القائمة">
        <div className="brand"><Logo size={34} /><b>سعي</b><span className="pill accent">لوحة التحكم</span></div>
        {NAV.filter((n) => !n.admin || isAdmin).map((n, i, list) => (
          <div key={n.to} className="nav-item" data-g={n.g}>
            {i === 0 || list[i - 1].g !== n.g ? (GROUP_TITLES[n.g] ? <div className="nav-group">{GROUP_TITLES[n.g]}</div> : null) : null}
            <NavLink to={n.to} end={n.end}>
              <NavIcon to={n.to} />
              {n.label}
              {n.badge && pending.data ? <span className="count">{pending.data}</span> : null}
            </NavLink>
          </div>
        ))}
        <div className="foot">
          <span className="small dim">{profile?.full_name}</span>
          <button className="btn sm" onClick={() => supabase.auth.signOut()}>تسجيل الخروج</button>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/students" element={<Students onChange={pending.reload} />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/content" element={<Content />} />
          <Route path="/lectures" element={<Lectures />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/questions" element={<Questions />} />
          <Route path="/news" element={<News />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/chat" element={<Chat />} />
          {isAdmin ? <Route path="/settings" element={<Settings />} /> : null}
          {isAdmin ? <Route path="/usage" element={<Usage />} /> : null}
          {isAdmin ? <Route path="/audit" element={<Audit />} /> : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
