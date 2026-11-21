import { getUserScopedClient, assertSupabaseResult, isUuid } from './supabaseCrud.js';
import { normalizeAreaInput, normalizeLifeItemInput, normalizeSourceUrl, parseYouTubeTimestamp, validLifeAreaId } from '../features/lifeAreas/lifeAreaModel.js';

const AREA_FIELDS = 'id,user_id,name,description,icon,color,sort_order,archived_at,created_at,updated_at';
const ITEM_FIELDS = 'id,user_id,area_id,name,description,item_type,status,target_date,linked_goal_id,created_at,updated_at';
function owner(row, userId, message) { if (!row || row.user_id !== userId) throw new Error(message); return row; }
function area(row) { return { id: row.id, name: row.name, description: row.description, icon: row.icon, color: row.color, sortOrder: row.sort_order, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at }; }
function item(row) { return { id: row.id, areaId: row.area_id, name: row.name, description: row.description, itemType: row.item_type, status: row.status, targetDate: row.target_date, linkedGoalId: row.linked_goal_id || '', createdAt: row.created_at, updatedAt: row.updated_at }; }

export async function listLifeAreasOverview() {
  const { client } = await getUserScopedClient();
  const result = await client.rpc('list_life_areas_overview');
  assertSupabaseResult(result);
  return (result.data || []).map(row => ({ areaId: row.area_id, areaName: row.area_name, areaIcon: row.area_icon,
    areaColor: row.area_color, itemId: row.item_id, itemName: row.item_name, itemType: row.item_type,
    itemStatus: row.item_status, targetDate: row.target_date, linkedGoalId: row.linked_goal_id,
    linkedGoalTitle: row.linked_goal_title, nextTaskId: row.next_task_id, nextTaskTitle: row.next_task_title,
    nextTaskDueAt: row.next_task_due_at }));
}

export async function listLifeAreas({ includeArchived = false } = {}) {
  const { client, userId } = await getUserScopedClient();
  let query = client.from('life_areas').select(AREA_FIELDS).eq('user_id', userId).order('sort_order').order('created_at').limit(100);
  if (!includeArchived) query = query.is('archived_at', null);
  const result = await query; assertSupabaseResult(result);
  return (result.data || []).map(area);
}

export async function createLifeArea(input) {
  const { client, userId } = await getUserScopedClient(), values = normalizeAreaInput(input), id = input?.id;
  if (!isUuid(id)) throw new TypeError('Life Area ID must be a UUID.');
  const result = await client.from('life_areas').insert({ id, user_id: userId, ...values }).select(AREA_FIELDS).single();
  if (result.error?.code === '23505') {
    const existing = await client.from('life_areas').select(AREA_FIELDS).eq('id', id).eq('user_id', userId).maybeSingle();
    assertSupabaseResult(existing);
    if (existing.data && existing.data.name === values.name && existing.data.description === values.description && existing.data.icon === values.icon && existing.data.color === values.color) return area(existing.data);
  }
  assertSupabaseResult(result); return area(owner(result.data, userId, 'Life area could not be confirmed.'));
}

export async function updateLifeArea(id, updates, expectedUpdatedAt) {
  const { client, userId } = await getUserScopedClient();
  if (!validLifeAreaId(id) || !expectedUpdatedAt) throw new TypeError('Life area version is required.');
  const values = normalizeAreaInput(updates);
  const result = await client.from('life_areas').update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', userId).eq('updated_at', expectedUpdatedAt).select(AREA_FIELDS).maybeSingle();
  assertSupabaseResult(result);
  if (!result.data) throw new Error('This life area changed elsewhere. Refresh before editing.');
  return area(result.data);
}

export async function setLifeAreaArchived(id, archived, expectedUpdatedAt) {
  const { client, userId } = await getUserScopedClient();
  if (!validLifeAreaId(id) || !expectedUpdatedAt) throw new TypeError('Life area ID and version are required.');
  const result = await client.from('life_areas').update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', userId).eq('updated_at', expectedUpdatedAt).select(AREA_FIELDS).maybeSingle();
  assertSupabaseResult(result); if (!result.data) throw new Error('This life area changed elsewhere. Refresh before changing its archive state.'); return area(result.data);
}

export async function reorderLifeAreas(ids) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !validLifeAreaId(id)) || new Set(ids).size !== ids.length) throw new TypeError('Life area order is invalid.');
  const { client } = await getUserScopedClient(), result = await client.rpc('reorder_life_areas', { p_ids: ids });
  assertSupabaseResult(result); if (result.data !== true) throw new Error('Life area order was not confirmed.');
}

export async function listLifeItems(areaId, { includeArchived = true } = {}) {
  if (!validLifeAreaId(areaId)) throw new TypeError('Life area ID is invalid.');
  const { client, userId } = await getUserScopedClient();
  let query = client.from('life_items').select(ITEM_FIELDS).eq('user_id', userId).eq('area_id', areaId)
    .order('status').order('target_date', { ascending: true, nullsFirst: false }).order('created_at').limit(100);
  if (!includeArchived) query = query.neq('status', 'archived');
  const result = await query; assertSupabaseResult(result); return (result.data || []).map(item);
}

export async function createLifeItem(areaId, input) {
  const { client, userId } = await getUserScopedClient(), values = normalizeLifeItemInput(input), id = input?.id;
  if (!validLifeAreaId(areaId) || !isUuid(id)) throw new TypeError('Project or Skill ID is invalid.');
  const result = await client.from('life_items').insert({ id, user_id: userId, area_id: areaId,
    name: values.name, description: values.description, item_type: values.itemType, status: values.status, target_date: values.targetDate,
  }).select(ITEM_FIELDS).single();
  if (result.error?.code === '23505') {
    const existing = await client.from('life_items').select(ITEM_FIELDS).eq('id', id).eq('user_id', userId).maybeSingle();
    assertSupabaseResult(existing);
    if (existing.data && existing.data.area_id === areaId && existing.data.name === values.name && existing.data.description === values.description && existing.data.item_type === values.itemType && existing.data.status === values.status && existing.data.target_date === values.targetDate) return item(existing.data);
  }
  assertSupabaseResult(result); return item(owner(result.data, userId, 'Project or Skill could not be confirmed.'));
}

export async function updateLifeItem(id, updates, expectedUpdatedAt) {
  if (!validLifeAreaId(id) || !expectedUpdatedAt) throw new TypeError('Project or Skill version is required.');
  const { client, userId } = await getUserScopedClient(), values = normalizeLifeItemInput(updates);
  const result = await client.from('life_items').update({ name: values.name, description: values.description,
    item_type: values.itemType, status: values.status, target_date: values.targetDate,
    linked_goal_id: updates.linkedGoalId || null, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', userId).eq('updated_at', expectedUpdatedAt).select(ITEM_FIELDS).maybeSingle();
  assertSupabaseResult(result); if (!result.data) throw new Error('This Project or Skill changed elsewhere. Refresh before editing.'); return item(result.data);
}

export async function listLifeItemChoices() {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('life_items').select('id,name,item_type,area_id').eq('user_id', userId)
    .neq('status', 'archived').order('name').limit(100);
  assertSupabaseResult(result); return result.data || [];
}

export async function listLifeItemTasks(lifeItemId) {
  if (!validLifeAreaId(lifeItemId)) throw new TypeError('Project or Skill ID is invalid.');
  const { client } = await getUserScopedClient(), result = await client.rpc('list_life_item_tasks', { p_life_item_id: lifeItemId, p_limit: 50 });
  assertSupabaseResult(result);
  return (result.data || []).map(row => ({ id: row.id, title: row.title, description: row.description, dueAt: row.due_at,
    priority: row.priority, completedAt: row.completed_at, updatedAt: row.updated_at }));
}

export async function linkLifeItemTask(lifeItemId, taskId) {
  if (!validLifeAreaId(lifeItemId) || !isUuid(taskId)) throw new TypeError('Project or task ID is invalid.');
  const { client } = await getUserScopedClient(), result = await client.rpc('link_life_item_task', { p_life_item_id: lifeItemId, p_task_id: taskId });
  assertSupabaseResult(result); if (result.data !== true) throw new Error('Task link could not be confirmed.');
}

export async function listLifeItemNotes(lifeItemId) {
  if (!validLifeAreaId(lifeItemId)) throw new TypeError('Project or Skill ID is invalid.');
  const { client } = await getUserScopedClient(), result = await client.rpc('list_life_item_notes', { p_life_item_id: lifeItemId, p_limit: 20 });
  assertSupabaseResult(result);
  return (result.data || []).map(row => ({ id: row.note_id, title: row.title, preview: row.content_preview, sourceType: row.source_type,
    sourceUrl: row.source_url, youtubeSeconds: row.youtube_seconds, keyTakeaways: row.key_takeaways, observations: row.observations, updatedAt: row.updated_at }));
}

export async function getLifeLearningNote(noteId) {
  if (!isUuid(noteId)) throw new TypeError('Note ID is invalid.');
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('life_item_notes').select('life_item_id,source_type,source_url,youtube_seconds,key_takeaways,observations,updated_at')
    .eq('note_id', noteId).eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  return result.data ? { lifeItemId: result.data.life_item_id, sourceType: result.data.source_type, sourceUrl: result.data.source_url,
    youtubeSeconds: result.data.youtube_seconds, keyTakeaways: result.data.key_takeaways, observations: result.data.observations, updatedAt: result.data.updated_at } : null;
}

export async function saveLifeLearningNote({ lifeItemId, noteId, sourceType, sourceUrl, youtubeSeconds, keyTakeaways, observations, expectedUpdatedAt = null }) {
  if (!validLifeAreaId(lifeItemId) || !isUuid(noteId)) throw new TypeError('Life Area or note ID is invalid.');
  if (!['youtube', 'article', 'book', 'course', 'other'].includes(sourceType)) throw new TypeError('Choose a valid learning source.');
  const url = normalizeSourceUrl(sourceUrl, sourceType), seconds = sourceType === 'youtube' ? parseYouTubeTimestamp(youtubeSeconds) : null;
  const takeaways = String(keyTakeaways || '').trim(), notes = String(observations || '').trim();
  if (takeaways.length > 5000 || notes.length > 5000) throw new Error('Keep learning notes under 5,000 characters each.');
  const { client, userId } = await getUserScopedClient();
  const args = { p_life_item_id: lifeItemId, p_note_id: noteId, p_source_type: sourceType, p_source_url: url,
    p_youtube_seconds: seconds, p_key_takeaways: takeaways, p_observations: notes, p_expected_updated_at: expectedUpdatedAt };
  const result = await client.rpc('save_life_learning_note', args);
  if (result.error) {
    const current = await client.from('life_item_notes').select('life_item_id,source_type,source_url,youtube_seconds,key_takeaways,observations,updated_at')
      .eq('note_id', noteId).eq('user_id', userId).maybeSingle();
    if (!current.error && current.data && current.data.life_item_id === lifeItemId && current.data.source_type === sourceType
      && current.data.source_url === url && current.data.youtube_seconds === seconds && current.data.key_takeaways === takeaways && current.data.observations === notes) return current.data.updated_at;
    throw result.error;
  }
  return result.data;
}
