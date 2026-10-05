export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const allowedAvatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(normalizeUsername(username));
}

export function validateAvatarFile(file) {
  if (!file) return 'Choose a profile picture first.';
  if (!allowedAvatarTypes.has(file.type)) return 'Choose a JPEG, PNG, or WEBP image.';
  if (file.size > MAX_AVATAR_BYTES) return 'Profile pictures must be 5 MB or smaller.';
  return '';
}

export function getProfileInitials(name, email = '') {
  const source = String(name || email || '').trim();
  const parts = source.includes('@') ? source.split('@')[0].split(/[._-]+/) : source.split(/\s+/);
  return parts.filter(Boolean).slice(0, 2).map(part => part[0].toLocaleUpperCase()).join('') || 'CB';
}
