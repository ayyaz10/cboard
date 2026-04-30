import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, requireSupabase, supabase } from '../lib/supabaseClient';
import { normalizeUsername, resolveLoginEmail } from '../services/profileService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      setAuthError('Supabase environment variables are missing.');
      return undefined;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setAuthError(error.message);
      }

      setSession(data.session);
      setUser(data.session?.user ?? null);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        setIsLoading(false);
        setAuthError('');
      },
    );

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      authError,
      isConfigured: isSupabaseConfigured,
      async signIn(identifier, password) {
        setAuthError('');
        const client = requireSupabase();
        const email = await resolveLoginEmail(identifier);
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setAuthError(error.message);
          throw error;
        }
      },
      async signUp(email, password, username) {
        setAuthError('');
        const client = requireSupabase();
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: normalizeUsername(username),
            },
          },
        });

        if (error) {
          setAuthError(error.message);
          throw error;
        }

        return {
          session: data.session,
          user: data.user,
          needsEmailConfirmation: Boolean(data.user && !data.session),
        };
      },
      async signOut() {
        setAuthError('');
        const client = requireSupabase();
        const { error } = await client.auth.signOut();

        if (error) {
          setAuthError(error.message);
          throw error;
        }
      },
    }),
    [authError, isLoading, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
