import { useEffect, useRef, useState } from 'react';
import { getAppHref } from '../../app/useRoute';
import { useAuth } from '../../contexts/AuthContext';
import { getProfileInitials } from '../../services/profileService';

export function ProfileMenu() {
  const { displayName, user, profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
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
      <span className="profile-menu-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="profile-menu-popover" aria-label="Account">
      <div className="profile-menu-account"><strong>{displayName}</strong><small>{user.email}</small></div>
      <a href={getAppHref('/account')} onClick={() => setOpen(false)}>View profile</a>
      <div className="profile-menu-divider" />
      <button type="button" onClick={() => { setOpen(false); void signOut(); }}>Log out</button>
    </div>}
  </div>;
}
