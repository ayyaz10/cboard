import { useState } from 'react';
import { getAppHref, navigateTo } from '../../app/useRoute';
import { useAuth } from '../../contexts/AuthContext';
import { isValidUsername, normalizeUsername } from '../../services/profileService';
import { BrandBadge } from '../layout/BrandBadge';
import { ThemeToggle } from '../layout/ThemeToggle';

const safeReturnPath = (path) => path?.startsWith('/') && !path.startsWith('//') && !['/login','/forgot-password','/reset-password'].includes(path) ? path : '/board';

export function AuthPage({ route = '/login', returnTo = '/board' }) {
  const { authError, isConfigured, isAuthenticated, isPasswordRecovery, signIn, signUp, requestPasswordReset, updatePassword } = useAuth();
  const [mode, setMode] = useState(route === '/reset-password' ? 'reset' : route === '/forgot-password' ? 'forgot' : 'login');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(''); setSuccessMessage('');
    if (!isConfigured) { setFormError('CBoard account services are not configured.'); return; }
    const emailValue = email.trim();
    if (mode === 'signup') {
      if (!displayName.trim() || !emailValue || !username.trim() || !password) { setFormError('Complete each field to create your account.'); return; }
      if (displayName.trim().length > 80) { setFormError('Display name must be 80 characters or fewer.'); return; }
      if (!isValidUsername(username)) { setFormError('Use a username with 3–24 letters, numbers, or underscores.'); return; }
      if (password.length < 6) { setFormError('Choose a password with at least 6 characters.'); return; }
      if (password !== confirmPassword) { setFormError('The passwords do not match.'); return; }
    }
    if (mode === 'login' && (!identifier.trim() || !password)) { setFormError('Enter your email or username and password.'); return; }
    if (mode === 'forgot' && !emailValue) { setFormError('Enter the email address for your account.'); return; }
    if (mode === 'reset' && (!password || password.length < 6)) { setFormError('Choose a new password with at least 6 characters.'); return; }
    if (mode === 'reset' && password !== confirmPassword) { setFormError('The passwords do not match.'); return; }
    if (mode === 'reset' && (!isAuthenticated || !isPasswordRecovery)) { setFormError('This reset link has expired or is invalid. Request a new password reset email.'); return; }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        const result = await signUp(emailValue, password, username, displayName);
        if (result?.needsEmailConfirmation) {
          setMode('login'); setIdentifier(emailValue); setPassword(''); setConfirmPassword('');
          setSuccessMessage('Account created. Check your email to confirm it, then sign in.');
        } else navigateTo(safeReturnPath(returnTo), { replace: true });
      } else if (mode === 'login') {
        await signIn(identifier.trim(), password);
        navigateTo(safeReturnPath(returnTo), { replace: true });
      } else if (mode === 'forgot') {
        await requestPasswordReset(emailValue);
        setSuccessMessage('If an account exists for this email, a reset link has been sent. Check your inbox and spam folder.');
      } else {
        await updatePassword(password);
        setPassword(''); setConfirmPassword('');
        setSuccessMessage('Your password has been updated. You can continue to CBoard.');
      }
    } catch (error) {
      const message = error.message || '';
      setFormError(/already registered|already exists|duplicate key/i.test(message)
        ? 'An account may already use that email or username. Try signing in instead.'
        : message || authError || 'We could not complete that request. Please try again.');
    } finally { setSubmitting(false); }
  }

  const isPasswordMode = ['login','signup','reset'].includes(mode);
  const titles = { login:'Welcome back', signup:'Create your account', forgot:'Reset your password', reset:'Choose a new password' };
  return <main className="auth-screen min-h-screen px-4 py-5 sm:px-6 sm:py-8" style={{paddingBottom:'max(1.25rem, env(safe-area-inset-bottom))'}}>
    <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><BrandBadge /><ThemeToggle /></div>
      <section className="panel mx-auto w-full max-w-xl p-5 sm:p-8">
        <span className="pill">CBoard account</span>
        <h1 className="auth-title mt-5 text-3xl font-bold tracking-[-0.05em] text-black sm:text-4xl">{titles[mode]}</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-black/65">{mode==='login'?'Sign in to continue to your workspace.':mode==='signup'?'One account keeps your CBoard workspace together.':mode==='forgot'?'We’ll send a secure password reset link if an account matches.':isPasswordRecovery?'Set a new password for your CBoard account.':'Open the password reset link from your email to continue.'}</p>
        {mode==='reset'&&(!isAuthenticated||!isPasswordRecovery) ? <div className="mt-6 grid gap-4"><p className="rounded-2xl border-2 border-black bg-[#ffe0de] px-4 py-3 text-sm font-bold">The reset link is expired or invalid. Request a new one to continue.</p><button className="auth-primary" type="button" onClick={()=>navigateTo('/forgot-password')}>Request a new reset link</button></div> : <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
          {mode==='signup'&&<>
            <label className="auth-label">Display name<input className="field-input" autoComplete="name" maxLength={80} value={displayName} onChange={e=>setDisplayName(e.target.value)} required /></label>
            <label className="auth-label">Username<input className="field-input" type="text" autoComplete="username" minLength={3} maxLength={24} value={username} onChange={e=>setUsername(normalizeUsername(e.target.value))} placeholder="letters, numbers, underscores" required /></label>
          </>}
          {['login','signup','forgot'].includes(mode)&&<label className="auth-label">{mode==='login'?'Email or username':'Email'}<input className="field-input" type={mode==='login'?'text':'email'} autoComplete={mode==='login'?'username':'email'} inputMode={mode==='login'?'text':'email'} value={mode==='login'?identifier:email} onChange={e=>mode==='login'?setIdentifier(e.target.value):setEmail(e.target.value)} placeholder={mode==='login'?'you@example.com or username':'you@example.com'} required /></label>}
          {isPasswordMode&&<>
            <label className="auth-label">{mode==='reset'?'New password':'Password'}<div className="relative"><input className="field-input pr-16" type={visible?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} minLength={6} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" required/><button type="button" className="auth-show-password" onClick={()=>setVisible(value=>!value)} aria-label={visible?'Hide password':'Show password'}>{visible?'Hide':'Show'}</button></div></label>
            {(mode==='signup'||mode==='reset')&&<label className="auth-label">Confirm password<input className="field-input" type={visible?'text':'password'} autoComplete="new-password" minLength={6} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required /></label>}
          </>}
          {mode==='login'&&<a className="justify-self-end text-sm font-bold underline underline-offset-4" href={getAppHref('/forgot-password')} onClick={e=>{e.preventDefault();setMode('forgot');setFormError('');setSuccessMessage('')}}>Forgot password?</a>}
          {(formError||authError)&&<p className="auth-message auth-error" role="alert">{formError||authError}</p>}
          {successMessage&&<p className="auth-message auth-success" role="status">{successMessage}</p>}
          <button type="submit" disabled={submitting} className="auth-primary">{submitting?(mode==='login'?'Logging in…':mode==='signup'?'Creating account…':mode==='forgot'?'Sending reset link…':'Updating password…'):mode==='login'?'Log in':mode==='signup'?'Create account':mode==='forgot'?'Send reset link':'Update password'}</button>
        </form>}
        <div className="mt-5 flex flex-wrap gap-x-2 gap-y-1 text-sm font-semibold">{mode==='login'?<>New to CBoard?<button type="button" className="underline underline-offset-4" onClick={()=>{setMode('signup');setFormError('');setSuccessMessage('')}}>Create account</button></>:mode==='signup'?<>Already have an account?<button type="button" className="underline underline-offset-4" onClick={()=>{setMode('login');setFormError('');setSuccessMessage('')}}>Log in</button></>:<button type="button" className="underline underline-offset-4" onClick={()=>{setMode('login');setFormError('');setSuccessMessage('');setPassword('');setConfirmPassword('')}}>Back to login</button>}</div>
      </section>
    </div>
  </main>;
}
