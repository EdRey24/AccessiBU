import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  forgotPassword as requestResetMail,
  refreshSession,
  register as registerMember,
  resetPassword as submitNewPassword,
  setSessionListener,
  signIn as signInMember,
  signOut as endSession,
  type Member,
  type Session,
} from '@/services/api';

type SessionStore = {
  ready: boolean;
  member: Member | null;
  signIn: (email: string, password: string) => Promise<Session>;
  register: (email: string, password: string) => Promise<Session>;
  forgotPassword: (email: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionStore | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSessionListener((session) => {
      setMember(session?.member ?? null);
    });
    let active = true;
    refreshSession()
      .then((session) => {
        if (active) setMember(session?.member ?? null);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      setSessionListener(null);
    };
  }, []);

  const value = useMemo<SessionStore>(
    () => ({
      ready,
      member,
      signIn: signInMember,
      register: registerMember,
      forgotPassword: requestResetMail,
      resetPassword: submitNewPassword,
      signOut: endSession,
    }),
    [ready, member]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionStore {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used within a SessionProvider');
  return session;
}
