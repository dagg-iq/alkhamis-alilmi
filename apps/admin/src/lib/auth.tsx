import type { Session } from '@supabase/supabase-js';
import type { Profile } from '@saey/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

interface AuthValue { ready: boolean; session: Session | null; profile: Profile | null; isAdmin: boolean; isStaff: boolean }
const Ctx = createContext<AuthValue>({ ready: false, session: null, profile: null, isAdmin: false, isStaff: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const load = async (s: Session | null) => {
      setSession(s);
      if (s) {
        const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
        setProfile(data as Profile | null);
      } else setProfile(null);
      setReady(true);
    };
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => load(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const approved = profile?.status === 'approved';
  return (
    <Ctx.Provider value={{
      ready, session, profile,
      isAdmin: approved && profile?.role === 'admin',
      isStaff: approved && (profile?.role === 'admin' || profile?.role === 'moderator'),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
