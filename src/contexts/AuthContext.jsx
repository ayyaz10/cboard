import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, requireSupabase, supabase } from '../lib/supabaseClient';
import { getCurrentProfile, normalizeUsername, resolveLoginEmail, saveCurrentProfile } from '../services/profileService';

const AuthContext = createContext(null);
const AUTH_BOOT_TIMEOUT_MS = 45000;
const PROFILE_TIMEOUT_MS = 5000;

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => {
    try { const issued = Number(window.sessionStorage.getItem('cboard:password-recovery')); return issued > 0 && Date.now() - issued < 30 * 60 * 1000; }
    catch { return false; }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  function applySession(nextSession) {
    const nextUser = nextSession?.user ?? null;

    setSession(nextSession);
    setUser(nextUser);

    if (!nextUser) {
      setProfile(null);
      return;
    }

    const fallbackProfile = {
      username: nextUser.user_metadata?.username ?? nextUser.email,
      display_name: nextUser.user_metadata?.display_name ?? nextUser.user_metadata?.username ?? '',
      created_at: nextUser.created_at,
      avatarUrl: '',
    };

    setProfile(fallbackProfile);
  }

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    // Run outside onAuthStateChange: profile queries acquire the auth lock too.
    const timer = setTimeout(() => {
      withTimeout(getCurrentProfile(), PROFILE_TIMEOUT_MS, 'Profile lookup timed out.')
        .then(nextProfile => { if (!cancelled && nextProfile) setProfile(nextProfile); })
        .catch(() => { /* Keep the session's username while offline or busy. */ });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      setAuthError('App configuration is missing.');
      return undefined;
    }

    let isMounted = true;
    let receivedAuthEvent = false;

    withTimeout(
      supabase.auth.getSession(),
      AUTH_BOOT_TIMEOUT_MS,
      'Your session is taking longer to load. Please reload and try again.',
    )
      .then(({ data, error }) => {
        if (!isMounted || receivedAuthEvent) {
          return;
        }

        if (error) {
          setAuthError(error.message);
        }

        applySession(data.session);
      })
      .catch((error) => {
        if (!isMounted || receivedAuthEvent) {
          return;
        }

        setSession(null);
        setUser(null);
        setProfile(null);
        setAuthError(error.message);
        // A network/lock timeout must not delete a valid saved session.
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!isMounted) return;
        receivedAuthEvent = true;
        if (event === 'PASSWORD_RECOVERY') {
          setIsPasswordRecovery(true);
          try { window.sessionStorage.setItem('cboard:password-recovery', String(Date.now())); } catch { /* Storage can be disabled in private browsing. */ }
        }
        if (!nextSession) {
          setIsPasswordRecovery(false);
          try { window.sessionStorage.removeItem('cboard:password-recovery'); } catch { /* Storage can be disabled in private browsing. */ }
        }
        applySession(nextSession);
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
      profile,
      displayName: profile?.display_name || profile?.username || user?.user_metadata?.display_name || user?.user_metadata?.username || user?.email || '',
      isAuthenticated: Boolean(user),
      isPasswordRecovery,
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
          const friendly = error.code === 'email_not_confirmed'
            ? 'Confirm your email address before signing in. Check your inbox for the confirmation message.'
            : ['invalid_credentials', 'invalid_grant'].includes(error.code) || /invalid login credentials/i.test(error.message)
              ? 'We could not sign in with those details. Check your email or username and password.'
              : 'Sign in failed. Check your details and internet connection, then try again.';
          setAuthError(friendly);
          throw new Error(friendly);
        }
      },
      async signUp(email, password, username, displayName = username) {
        setAuthError('');
        const client = requireSupabase();
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: normalizeUsername(username),
              display_name: displayName.trim(),
            },
            emailRedirectTo: new URL(`${import.meta.env.BASE_URL || '/'}login`, window.location.origin).toString(),
          },
        });

        if (error) {
          const friendly = error.code === 'user_already_exists' || /already registered|already exists|duplicate key/i.test(error.message)
            ? 'An account may already use that email or username. Try signing in instead.'
            : /password.*(weak|short|length)/i.test(error.message)
              ? 'Choose a stronger password with at least 6 characters.'
              : /email/i.test(error.message) ? 'Enter a valid email address and try again.' : 'Your account could not be created. Check your details and try again.';
          setAuthError(friendly);
          throw new Error(friendly);
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
          setAuthError('Could not sign out right now. Please try again.');
          throw new Error('Could not sign out right now. Please try again.');
        }
      },
      async updateProfile(values) {
        const nextProfile = await saveCurrentProfile(values);
        setProfile(nextProfile);
        return nextProfile;
      },
      async requestPasswordReset(email) {
        const client = requireSupabase();
        const redirectTo = new URL(`${import.meta.env.BASE_URL || '/'}reset-password`, window.location.origin).toString();
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) throw new Error('We could not send the reset email right now. Please try again shortly.');
      },
      async updatePassword(password) {
        if (!isPasswordRecovery) throw new Error('Open the secure reset link from your email before choosing a new password.');
        const { error } = await requireSupabase().auth.updateUser({ password });
        if (error) {
          const message = /password.*(weak|short|length)/i.test(error.message)
            ? 'Choose a stronger password with at least 6 characters.'
            : 'Your password could not be updated. The reset link may have expired; request a new one and try again.';
          throw new Error(message);
        }
        setIsPasswordRecovery(false);
        try { window.sessionStorage.removeItem('cboard:password-recovery'); } catch { /* Storage can be disabled in private browsing. */ }
      },
      async changePassword(currentPassword, newPassword) {
        const client = requireSupabase();
        if (!user?.email) throw new Error('Your session has expired. Please sign in again.');
        const { error: verifyError } = await client.auth.signInWithPassword({ email: user.email, password: currentPassword });
        if (verifyError) throw new Error('Your current password is incorrect.');
        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) throw new Error(/password.*(weak|short|length)/i.test(error.message) ? 'Choose a stronger password with at least 6 characters.' : 'Your password could not be updated. Please try again.');
      },
      async resendVerification() {
        const client = requireSupabase();
        if (!user?.email) throw new Error('Your session has expired. Please sign in again.');
        const { error } = await client.auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: new URL(`${import.meta.env.BASE_URL || '/'}login`, window.location.origin).toString() } });
        if (error) throw new Error('A confirmation email could not be sent right now. Please try again later.');
      },
    }),
    [authError, isLoading, isPasswordRecovery, profile, session, user],
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
