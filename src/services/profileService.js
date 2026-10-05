import { requireSupabase } from '../lib/supabaseClient.js';
import { getProfileInitials, isValidUsername, MAX_AVATAR_BYTES, normalizeUsername, validateAvatarFile } from './profileValidation.js';

const AVATAR_BUCKET = 'profile-avatars';
export { getProfileInitials, isValidUsername, MAX_AVATAR_BYTES, normalizeUsername, validateAvatarFile } from './profileValidation.js';

export async function resolveLoginEmail(identifier) {
  const client = requireSupabase();
  const trimmedIdentifier = identifier.trim();
  if (trimmedIdentifier.includes('@')) return trimmedIdentifier;
  const { data, error } = await client.rpc('resolve_login_email', { login_identifier: normalizeUsername(trimmedIdentifier) });
  if (error) throw new Error('We could not verify those sign-in details. Check your connection and try again.');
  if (!data) throw new Error('We could not sign in with those details. Check your email or username and password.');
  return data;
}

async function makeAvatar(file) {
  const validation = validateAvatarFile(file);
  if (validation) throw new Error(validation);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    let scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    for (const quality of [0.84, 0.76, 0.68, 0.6, 0.52]) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not process this picture.')), 'image/webp', quality));
      if (blob.size <= 500000) return blob;
      scale *= 0.85;
    }
    throw new Error('The picture could not be compressed enough. Choose a smaller image.');
  } catch (error) {
    if (error.message === 'The picture could not be compressed enough. Choose a smaller image.') throw error;
    throw new Error('This picture could not be opened. Try another JPEG, PNG, or WEBP image.');
  } finally {
    bitmap?.close();
  }
}

async function withAvatarUrl(profile) {
  if (!profile?.avatar_path) return { ...profile, avatarUrl: '' };
  const { data, error } = await requireSupabase().storage.from(AVATAR_BUCKET).createSignedUrl(profile.avatar_path, 60 * 60);
  if (error) return { ...profile, avatarUrl: '' };
  return { ...profile, avatarUrl: data.signedUrl };
}

export async function getCurrentProfile() {
  const { data, error } = await requireSupabase().from('profiles').select('username, display_name, avatar_path, created_at').maybeSingle();
  if (error) throw error;
  return data ? withAvatarUrl(data) : null;
}

export async function saveCurrentProfile({ username, displayName, avatarFile, removeAvatar = false }) {
  const client = requireSupabase();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw new Error('Your session expired. Please sign in again.');
  const user = authData.user;
  const { data: previous, error: previousError } = await client.from('profiles').select('avatar_path').eq('user_id', user.id).maybeSingle();
  if (previousError || !previous) throw new Error('Your profile could not be loaded. Please try again.');
  const oldPath = previous.avatar_path || '';
  let avatarPath = oldPath;
  if (avatarFile) {
    const blob = await makeAvatar(avatarFile);
    avatarPath = `${user.id}/${crypto.randomUUID()}.webp`;
    const { error } = await client.storage.from(AVATAR_BUCKET).upload(avatarPath, blob, { contentType: 'image/webp', upsert: false, cacheControl: '3600' });
    if (error) throw new Error('The profile picture could not be uploaded. Please try again.');
  } else if (removeAvatar) avatarPath = null;

  const { data, error } = await client.from('profiles').update({
    username: normalizeUsername(username),
    display_name: displayName.trim(),
    avatar_path: avatarPath,
    updated_at: new Date().toISOString(),
  }).eq('user_id', user.id).select('username, display_name, avatar_path, created_at').single();
  if (error) {
    if (avatarFile && avatarPath && avatarPath !== oldPath) await client.storage.from(AVATAR_BUCKET).remove([avatarPath]).catch(() => {});
    if (error.code === '23505') throw new Error('That username is already in use. Choose another one.');
    if (error.code === '23514') throw new Error('Use a username with 3-24 letters, numbers, or underscores.');
    throw new Error('Your profile could not be saved. Please try again.');
  }
  if ((removeAvatar || (avatarFile && oldPath && oldPath !== avatarPath)) && oldPath) await client.storage.from(AVATAR_BUCKET).remove([oldPath]).catch(() => {});
  return withAvatarUrl(data);
}
