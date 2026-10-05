import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Logo } from './components/ui';
import { useAuth } from './lib/auth';
import { useLoad } from './lib/hooks';
import { isConfigured, supabase } from './lib/supabase';
import Audit from './pages/Audit';
import Chat from './pages/Chat';
import Content from './pages/Content';
import Dashboard from './pages/Dashboard';
import Documents from './pages/Documents';
import Lectures from './pages/Lectures';
import Login from './pages/Login';
import News from './pages/News';
import Questions from './pages/Questions';
import Settings from './pages/Settings';
import Students from './pages/Students';
import Tasks from './pages/Tasks';

const NAV = [
  { to: '/', label: 'نظرة عامة', end: true },
  { to: '/students', label: 'الطلاب', badge: true },
  { to: '/content', label: 'المواد والفصول' },
  { to: '/lectures', label: 'المحاضرات' },
  { to: '/documents', label: 'الملازم' },
  { to: '/questions', label: 'الأسئلة' },
  { to: '/news', label: 'الأخبار' },
  { to: '/tasks', label: 'الواجبات والامتحانات' },
  { to: '/chat', label: 'الدردشة' },
  { to: '/settings', label: 'الإعدادات', admin: true },
  { to: '/audit', label: 'سجل العمليات', admin: true },
];

export default function App() {
  const { ready, session, isStaff, isAdmin, profile } = useAuth();
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
      <nav className="side" aria-label="القائمة">
        <div className="brand"><Logo size={34} /><b>سعي</b><span className="pill accent">لوحة التحكم</span></div>
        {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.label}
            {n.badge && pending.data ? <span className="count">{pending.data}</span> : null}
          </NavLink>
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
          <Route path="/content" element={<Content />} />
          <Route path="/lectures" element={<Lectures />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/questions" element={<Questions />} />
          <Route path="/news" element={<News />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/chat" element={<Chat />} />
          {isAdmin ? <Route path="/settings" element={<Settings />} /> : null}
          {isAdmin ? <Route path="/audit" element={<Audit />} /> : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
