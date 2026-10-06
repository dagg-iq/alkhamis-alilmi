import { useState } from 'react';
import { Logo } from '../components/ui';
import { supabase } from '../lib/supabase';

export default function Login({ denied }: { denied: boolean }) {
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { prompt: 'select_account' } } });
  };
  return (
    <div className="login">
      <div className="card" style={{ width: 'min(440px, 100%)', display: 'flex', flexDirection: 'column', gap: 18, padding: 32 }}>
        <div className="row"><Logo size={56} /><h1 style={{ fontSize: 56 }}>سعي</h1></div>
        <div>
          <h2>لوحة التحكم</h2>
          <p className="dim">خاصة بالأدمن والمشرفين فقط.</p>
        </div>
        {denied ? (
          <>
            <div className="pill bad" style={{ padding: '8px 12px', whiteSpace: 'normal' }}>هذا الحساب ليس أدمن أو مشرفاً معتمداً.</div>
            <button className="btn" onClick={() => supabase.auth.signOut()}>الدخول بحساب آخر</button>
          </>
        ) : (
          <button className="btn primary" style={{ height: 50, justifyContent: 'center' }} onClick={signIn} disabled={busy}>
            {busy ? 'جارٍ التحويل…' : 'الدخول بحساب Google'}
          </button>
        )}
      </div>
    </div>
  );
}
