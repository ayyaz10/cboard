import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../../app/useRoute';
import { useAuth } from '../../contexts/AuthContext';
import { getProfileInitials, isValidUsername, normalizeUsername, validateAvatarFile } from '../../services/profileService';
import { AppNavigation } from '../layout/AppNavigation';
import { PageShell } from '../layout/PageShell';
import { BackupRestorePanel } from './BackupRestorePanel.jsx';

export function ProfilePage() {
  const { user, profile, displayName, updateProfile, changePassword, resendVerification, signOut } = useAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(()=>{setName(profile?.display_name||profile?.username||'');setUsername(profile?.username||'')},[profile?.display_name,profile?.username]);
  useEffect(()=>{if(!avatarFile){setPreview('');return undefined}const url=URL.createObjectURL(avatarFile);setPreview(url);return()=>URL.revokeObjectURL(url)},[avatarFile]);
  const avatarUrl = preview || (!removeAvatar ? profile?.avatarUrl : '') || '';
  const initials = useMemo(()=>getProfileInitials(name||displayName,user?.email),[name,displayName,user?.email]);

  async function saveProfile(event){
    event.preventDefault();setError('');setNotice('');
    if(!name.trim()||name.trim().length>80){setError('Enter a display name up to 80 characters.');return}
    if(!isValidUsername(username)){setError('Use a username with 3–24 letters, numbers, or underscores.');return}
    if(avatarFile){const validation=validateAvatarFile(avatarFile);if(validation){setError(validation);return}}
    setSaving(true);
    try{await updateProfile({displayName:name,username,avatarFile,removeAvatar});setAvatarFile(null);setRemoveAvatar(false);setNotice('Profile saved.');}
    catch(err){setError(err.message||'Your profile could not be saved. Please try again.')}
    finally{setSaving(false)}
  }

  async function savePassword(event){
    event.preventDefault();setPasswordError('');setPasswordMessage('');
    if(!currentPassword||newPassword.length<6){setPasswordError('Enter your current password and a new password with at least 6 characters.');return}
    if(newPassword!==confirmPassword){setPasswordError('The new passwords do not match.');return}
    setPasswordBusy(true);
    try{await changePassword(currentPassword,newPassword);setCurrentPassword('');setNewPassword('');setConfirmPassword('');setPasswordMessage('Password updated successfully.')}
    catch(err){setPasswordError(err.message||'Password could not be updated.')}
    finally{setPasswordBusy(false)}
  }

  async function logout(){try{await signOut();navigateTo('/login',{replace:true})}catch(err){setError(err.message||'Could not sign out. Try again.')}}
  async function resend(){setNotice('');setError('');try{await resendVerification();setNotice('If verification is still needed, a new confirmation email has been sent.')}catch(err){setError(err.message||'Could not resend the confirmation email.')}}

  return <PageShell><section className="panel p-5 sm:p-8 lg:p-10"><AppNavigation activePath="/account"/><header className="mt-6"><span className="pill">Account</span><h1 className="mt-4 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">Profile &amp; security</h1><p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-black/65">Manage the details and sign-in security for your CBoard account.</p></header>
    {(error||notice)&&<p className={`auth-message mt-5 ${error?'auth-error':'auth-success'}`} role={error?'alert':'status'}>{error||notice}</p>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]">
      <form className="account-card grid gap-5" onSubmit={saveProfile}>
        <div className="flex items-center gap-4"><div className="account-avatar" aria-label={avatarUrl?'Profile picture':`Avatar initials ${initials}`}>{avatarUrl?<img src={avatarUrl} alt="Profile"/>:<span>{initials}</span>}</div><div><h2 className="text-xl font-bold">Personal details</h2><p className="text-sm font-semibold text-black/60">Your profile is private to your account.</p></div></div>
        <label className="auth-label">Profile picture<input type="file" accept="image/jpeg,image/png,image/webp" className="field-input account-file" onChange={event=>{const file=event.target.files?.[0];if(!file)return;const message=validateAvatarFile(file);if(message){setError(message);event.target.value='';return}setError('');setAvatarFile(file);setRemoveAvatar(false)}}/><span className="account-hint">JPEG, PNG, or WEBP · up to 5 MB. Images are resized before private upload.</span></label>
        {(profile?.avatar_path||avatarFile)&&!removeAvatar&&<button type="button" className="account-text-button justify-self-start" onClick={()=>{setAvatarFile(null);setRemoveAvatar(true)}}>Remove profile picture</button>}
        {removeAvatar&&<button type="button" className="account-text-button justify-self-start" onClick={()=>setRemoveAvatar(false)}>Keep current picture</button>}
        <label className="auth-label">Display name<input className="field-input" autoComplete="name" maxLength={80} value={name} onChange={event=>setName(event.target.value)} required/></label>
        <label className="auth-label">Username<input className="field-input" autoComplete="username" minLength={3} maxLength={24} value={username} onChange={event=>setUsername(normalizeUsername(event.target.value))} required/><span className="account-hint">3–24 letters, numbers, or underscores. Usernames are used to sign in.</span></label>
        <div className="account-readonly"><span>Email</span><strong>{user?.email}</strong><small>Email changes are managed through verified account flows and are not available here.</small></div>
        {profile?.created_at&&<div className="account-readonly"><span>Account created</span><strong>{new Date(profile.created_at).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}</strong></div>}
        {user?.email&&!user.email_confirmed_at&&<div className="account-readonly"><span>Email verification</span><strong>Confirmation may still be required</strong><button type="button" className="account-text-button justify-self-start" onClick={resend}>Resend confirmation email</button></div>}
        <button type="submit" className="auth-primary" disabled={saving}>{saving?'Saving profile…':'Save profile'}</button>
      </form>
      <div className="grid content-start gap-5">
        <form className="account-card grid gap-4" onSubmit={savePassword}><div><h2 className="text-xl font-bold">Change password</h2><p className="mt-1 text-sm font-semibold leading-6 text-black/60">Confirm your current password before choosing a new one.</p></div>
          <label className="auth-label">Current password<input className="field-input" type={passwordVisible?'text':'password'} autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} required/></label>
          <label className="auth-label">New password<input className="field-input" type={passwordVisible?'text':'password'} autoComplete="new-password" minLength={6} value={newPassword} onChange={event=>setNewPassword(event.target.value)} placeholder="At least 6 characters" required/></label>
          <label className="auth-label">Confirm new password<input className="field-input" type={passwordVisible?'text':'password'} autoComplete="new-password" minLength={6} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} required/></label>
          <button type="button" className="account-text-button justify-self-start" aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(value=>!value)}>{passwordVisible?'Hide':'Show'} passwords</button>
          {(passwordError||passwordMessage)&&<p className={`auth-message ${passwordError?'auth-error':'auth-success'}`} role={passwordError?'alert':'status'}>{passwordError||passwordMessage}</p>}
          <button type="submit" className="auth-primary" disabled={passwordBusy}>{passwordBusy?'Updating password…':'Update password'}</button>
        </form>
        <section className="account-card grid gap-3"><div><h2 className="text-xl font-bold">Sign out</h2><p className="mt-1 text-sm font-semibold leading-6 text-black/60">Sign out of this device. Your saved CBoard data will remain in your account.</p></div><button type="button" className="account-secondary justify-self-start" onClick={logout}>Log out</button></section>
      </div>
    </div>
    <BackupRestorePanel />
  </section></PageShell>;
}
