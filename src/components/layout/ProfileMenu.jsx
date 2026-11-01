import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, RefreshCw } from 'lucide-react';
import { getAppHref } from '../../app/useRoute';
import { useAuth } from '../../contexts/AuthContext';
import { getProfileInitials } from '../../services/profileService';
import { hasPwaUpdateAvailable, openPwaUpdatePanel, PWA_UPDATE_AVAILABLE_EVENT } from '../../pwa/updateCheckEvents.js';

export function ProfileMenu() {
  const { displayName, user, profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(hasPwaUpdateAvailable);
  const root = useRef(null);
  useEffect(() => {
    const syncUpdateAvailability = () => setUpdateAvailable(hasPwaUpdateAvailable());
    window.addEventListener(PWA_UPDATE_AVAILABLE_EVENT, syncUpdateAvailability);
    return () => window.removeEventListener(PWA_UPDATE_AVAILABLE_EVENT, syncUpdateAvailability);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') setOpen(false); };
    const onPointerDown = event => { if (root.current && !root.current.contains(event.target)) setOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (!user) return null;
  return <div className="profile-menu" ref={root}>
    <button type="button" className="profile-menu-trigger" aria-label={`Account menu for ${displayName}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(value => !value)}>
      <span className="account-avatar-small">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : getProfileInitials(displayName, user.email)}</span>
      <span className="profile-menu-name">{displayName}</span>
      <ChevronDown className="profile-menu-chevron" size={14} aria-hidden="true" />
    </button>
    {open && <div className="profile-menu-popover" role="region" aria-label="Account">
      <div className="profile-menu-account"><strong>{displayName}</strong><small>{user.email}</small></div>
      <a href={getAppHref('/account')} onClick={() => setOpen(false)}>View profile</a>
      <button type="button" aria-label={updateAvailable ? 'Check for updates. A new CBoard update is available.' : 'Check for updates'} onClick={() => { setOpen(false); openPwaUpdatePanel(); }}><span className="profile-menu-update-icon"><RefreshCw size={15} aria-hidden="true" />{updateAvailable && <span className="profile-menu-update-dot" aria-hidden="true" />}</span>Check for updates</button>
      <div className="profile-menu-divider" />
      <button type="button" onClick={() => { setOpen(false); void signOut(); }}><LogOut size={15} aria-hidden="true" />Log out</button>
    </div>}
  </div>;
}
