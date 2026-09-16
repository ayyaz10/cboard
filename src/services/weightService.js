import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud';
import { validateEntry } from '../features/weightProgress/weightData';
const bucket = 'weight-photos';
async function scoped(expectedUserId) {
  const context = await getUserScopedClient();
  if (expectedUserId && context.userId !== expectedUserId) throw new Error('Your account changed. Reload Weight Progress.');
  return context;
}
export async function loadWeights() {
  const {client,userId} = await scoped();
  const entries = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from('weight_entries').select('*').eq('user_id',userId).order('date',{ascending:false}).range(offset,offset+999);
    assertSupabaseResult(result);
    entries.push(...result.data);
    if (result.data.length < 1000) break;
  }
  return { entries, userId };
}
export async function weightPhotoUrl(path, userId) {
  const {client} = await scoped(userId);
  const result = await client.storage.from(bucket).createSignedUrl(path, 3600);
  assertSupabaseResult(result); return result.data.signedUrl;
}
export async function removeWeightPhoto(path, userId) {
  const {client} = await scoped(userId);
  const result = await client.storage.from(bucket).remove([path]); assertSupabaseResult(result);
}
export async function saveWeight(entry, previous, photo, userId) {
  validateEntry(entry);
  const {client} = await scoped(userId);
  let uploaded = null;
  try {
    if (photo) {
      uploaded = `${userId}/${crypto.randomUUID()}.webp`;
      const blob = await (await fetch(photo)).blob();
      const upload = await client.storage.from(bucket).upload(uploaded, blob, {contentType:'image/webp',upsert:false});
      assertSupabaseResult(upload);
    }
    const record = { date:entry.date, weight_kg:entry.weight_kg, note:entry.note,
      photo_path:uploaded || entry.photo_path || null, revision:(previous?.revision || 0)+1 };
    const query = previous
      ? client.from('weight_entries').update(record).eq('id',previous.id).eq('user_id',userId).eq('revision',previous.revision)
      : client.from('weight_entries').insert({...record,user_id:userId});
    const result = await query.select('*').maybeSingle();
    if (result.error?.code === '23505') throw new Error('There is already a weigh-in on this date. Edit that entry instead.');
    assertSupabaseResult(result);
    if (!result.data) throw new Error('This entry changed elsewhere. Reload and try again.');
    const oldPath = previous?.photo_path;
    let cleanup = null;
    if (oldPath && oldPath !== result.data.photo_path) {
      try { await removeWeightPhoto(oldPath,userId); } catch { cleanup = oldPath; }
    }
    return { entry:result.data, cleanup };
  } catch(error) {
    if (uploaded) {
      try { await removeWeightPhoto(uploaded,userId); } catch { error.cleanup = uploaded; }
    }
    throw error;
  }
}
export async function deleteWeight(entry,userId) {
  const {client} = await scoped(userId);
  const result = await client.from('weight_entries').delete().eq('id',entry.id).eq('user_id',userId).eq('revision',entry.revision).select('id').maybeSingle();
  assertSupabaseResult(result);
  if (!result.data) throw new Error('This entry changed elsewhere. Reload and try again.');
  let cleanup = null;
  if (entry.photo_path) { try { await removeWeightPhoto(entry.photo_path,userId); } catch { cleanup = entry.photo_path; } }
  return {cleanup};
}
