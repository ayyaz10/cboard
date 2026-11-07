import { requireSupabase } from '../lib/supabaseClient';
import {
  assertSupabaseResult,
  getUserScopedClient,
  normalizeLegacyUuid,
} from './supabaseCrud';
import { getNoteLifecycleChanges, getNoteSizeIssue, getTextFromHtml, sanitizeNoteHtml } from '../features/notebook/noteContent';
import { parseNotesRows } from './noteQueryResult';
import { isMissingLifecycleSchema, isMissingSearchFunction } from './notesCompatibility';

const noteSelect = `
  id,
  user_id,
  title,
  content_html,
  content_text,
  linked_goal_id,
  app_key,
  tags,
  media,
  lifecycle_state,
  state_before_trash,
  pinned_at,
  created_at,
  updated_at
`;
const legacyNoteSelect = `
  id,
  user_id,
  title,
  content_html,
  content_text,
  linked_goal_id,
  app_key,
  tags,
  media,
  created_at,
  updated_at
`;

function stripLifecycleFields(payload) {
  const { lifecycle_state: _lifecycleState, state_before_trash: _stateBeforeTrash, pinned_at: _pinnedAt, ...legacyPayload } = payload;
  return legacyPayload;
}

function toLegacySummary(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title || 'Untitled note',
    contentPreview: '',
    contentSnippet: '',
    linkedGoalId: row.linked_goal_id || '',
    appKey: row.app_key || null,
    tags: normalizeTags(row.tags).slice(0, 12),
    lifecycleState: 'active',
    stateBeforeTrash: 'active',
    pinnedAt: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dispatchNotesChanged(noteId) {
  window.dispatchEvent(new CustomEvent('notes-changed', { detail: noteId ? { noteId } : {} }));
}

function isMissingNotesTable(error) {
  const errorText = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return errorText.includes('notes')
    && (
      errorText.includes('schema cache')
      || errorText.includes('relation')
      || errorText.includes('table')
      || errorText.includes('42p01')
      || errorText.includes('pgrst205')
    );
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag).trim())
      .filter(Boolean);
  }

  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeMedia(media) {
  return Array.isArray(media)
    ? media
      .filter((item) => item?.name && item?.type && item?.dataUrl)
    : [];
}

export function toNote(row) {
  return {
    id: row.id,
    appKey: row.app_key || null,
    userId: row.user_id,
    title: row.title ?? 'Untitled note',
    contentHtml: row.content_html ?? '',
    contentText: row.content_text ?? '',
    linkedGoalId: row.linked_goal_id ?? '',
    tags: normalizeTags(row.tags),
    media: normalizeMedia(row.media),
    lifecycleState: row.lifecycle_state || 'active',
    stateBeforeTrash: row.state_before_trash || 'active',
    pinnedAt: row.pinned_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNotePayload(note, userId) {
  const id = normalizeLegacyUuid(note.id, 'note');
  const now = new Date().toISOString();
  const contentHtml = sanitizeNoteHtml(note.contentHtml ?? note.content_html ?? '');
  const contentText = getTextFromHtml(contentHtml);
  const title = String(note.title ?? 'Untitled note').trim();
  const tags = normalizeTags(note.tags);
  const media = normalizeMedia(note.media);
  const sizeIssue = getNoteSizeIssue({ title, contentHtml, contentText, tags, media });
  if (sizeIssue) throw new Error(sizeIssue);

  return {
    ...(id ? { id } : {}),
    user_id: userId,
    title,
    content_html: contentHtml,
    content_text: contentText,
    linked_goal_id: note.linkedGoalId || note.linked_goal_id || null,
    tags,
    media,
    lifecycle_state: note.lifecycleState || 'active',
    state_before_trash: note.stateBeforeTrash || 'active',
    pinned_at: note.pinnedAt || null,
    created_at: note.createdAt ?? note.created_at ?? now,
    updated_at: now,
  };
}

export async function getNotes({ linkedGoalId } = {}) {
  const { client, userId } = await getUserScopedClient();
  let query = client
    .from('notes')
    .select(noteSelect)
    .eq('lifecycle_state', 'active')
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (linkedGoalId) query = query.eq('linked_goal_id', linkedGoalId);
  let result = await query;

  if (isMissingLifecycleSchema(result.error)) {
    let legacyQuery = client.from('notes').select(legacyNoteSelect).eq('user_id', userId)
      .order('updated_at', { ascending: false }).order('created_at', { ascending: false });
    if (linkedGoalId) legacyQuery = legacyQuery.eq('linked_goal_id', linkedGoalId);
    result = await legacyQuery;
  }

  return parseNotesRows(result, toNote);
}

export async function getNoteLibrary({ view = 'active', query = '', limit = 40, offset = 0, sortBy = 'updated' } = {}) {
  const { client, userId } = await getUserScopedClient();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeQuery = String(query).trim().slice(0, 160);
  const result = await client.rpc('search_notes', {
    p_view: ['active', 'pinned', 'archived', 'trash'].includes(view) ? view : 'active',
    p_query: safeQuery,
    p_limit: safeLimit + 1,
    p_offset: safeOffset,
    p_sort: ['title', 'created'].includes(sortBy) ? sortBy : 'updated',
  });
  if (isMissingSearchFunction(result.error) || isMissingLifecycleSchema(result.error)) {
    let lifecycleAvailable = false;
    if (isMissingSearchFunction(result.error)) {
      const schemaProbe = await client.from('notes').select('lifecycle_state,state_before_trash,pinned_at')
        .eq('user_id', userId).limit(0);
      if (schemaProbe.error && !isMissingLifecycleSchema(schemaProbe.error)) assertSupabaseResult(schemaProbe);
      lifecycleAvailable = !schemaProbe.error;
    }
    if (!lifecycleAvailable && view !== 'active') {
      return { notes: [], hasMore: false, lifecycleAvailable: false, compatibilityMode: true };
    }
    if (lifecycleAvailable && view !== 'active' && view !== 'pinned') {
      return { notes: [], hasMore: false, lifecycleAvailable: true, compatibilityMode: true };
    }
    let legacyQuery = client.from('notes')
      .select(lifecycleAvailable ? `${legacyNoteSelect},lifecycle_state,state_before_trash,pinned_at` : legacyNoteSelect)
      .eq('user_id', userId);
    if (lifecycleAvailable) {
      legacyQuery = legacyQuery.eq('lifecycle_state', 'active');
      if (view === 'pinned') legacyQuery = legacyQuery.not('pinned_at', 'is', null);
    }
    if (safeQuery) {
      const safeTitleSearch = safeQuery.replace(/[,%()\\"']/g, ' ').replace(/\s+/g, ' ').trim();
      if (safeTitleSearch) legacyQuery = legacyQuery.ilike('title', `%${safeTitleSearch}%`);
    }
    if (sortBy === 'title') legacyQuery = legacyQuery.order('title', { ascending: true });
    else legacyQuery = legacyQuery.order(sortBy === 'created' ? 'created_at' : 'updated_at', { ascending: false });
    legacyQuery = legacyQuery.order('id', { ascending: false }).range(safeOffset, safeOffset + safeLimit);
    const legacyResult = await legacyQuery;
    const legacyRows = parseNotesRows(legacyResult);
    return {
      notes: legacyRows.slice(0, safeLimit).map(toLegacySummary),
      hasMore: legacyRows.length > safeLimit,
      lifecycleAvailable,
      compatibilityMode: true,
    };
  }
  assertSupabaseResult(result);
  const rows = parseNotesRows(result);
  return {
    notes: rows.slice(0, safeLimit).map((row) => ({
      id: row.id,
      userId: row.user_id,
      title: row.title || 'Untitled note',
      contentPreview: row.content_preview || '',
      contentSnippet: row.content_snippet || row.content_preview || '',
      linkedGoalId: row.linked_goal_id || '',
      appKey: row.app_key || null,
      tags: normalizeTags(row.tags).slice(0, 12),
      lifecycleState: row.lifecycle_state || 'active',
      stateBeforeTrash: row.state_before_trash || 'active',
      pinnedAt: row.pinned_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    hasMore: rows.length > safeLimit,
    lifecycleAvailable: true,
    compatibilityMode: false,
  };
}

export async function getNoteById(noteId) {
  const { client, userId } = await getUserScopedClient();
  let result = await client.from('notes').select(noteSelect).eq('id', noteId).eq('user_id', userId).maybeSingle();
  if (isMissingLifecycleSchema(result.error)) {
    result = await client.from('notes').select(legacyNoteSelect).eq('id', noteId).eq('user_id', userId).maybeSingle();
  }
  assertSupabaseResult(result);
  return result.data ? toNote(result.data) : null;
}

async function transitionNote(noteId, transition) {
  const { client, userId } = await getUserScopedClient();
  const currentResult = await client.from('notes')
    .select('lifecycle_state,state_before_trash,pinned_at,updated_at')
    .eq('id', noteId).eq('user_id', userId).maybeSingle();
  assertSupabaseResult(currentResult);
  const current = currentResult.data;
  if (!current) throw new Error('This note is no longer available. Refresh your notes.');
  const changes = transition(current);
  if (!changes) return null;

  const result = await client.from('notes').update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', noteId).eq('user_id', userId).eq('updated_at', current.updated_at)
    .select(noteSelect).maybeSingle();
  if (result.error) assertSupabaseResult(result);
  if (!result.data) throw new Error('This note changed elsewhere. Refresh before trying again.');
  dispatchNotesChanged(noteId);
  return toNote(result.data);
}

export const archiveNote = (noteId) => transitionNote(noteId, (current) => getNoteLifecycleChanges(current, 'archive'));

export const unarchiveNote = (noteId) => transitionNote(noteId, (current) => getNoteLifecycleChanges(current, 'unarchive'));

export const trashNote = (noteId) => transitionNote(noteId, (current) => getNoteLifecycleChanges(current, 'trash'));

export const restoreNote = (noteId) => transitionNote(noteId, (current) => getNoteLifecycleChanges(current, 'restore'));

export const setNotePinned = (noteId, pinned) => transitionNote(noteId, (current) => {
  if (current.lifecycle_state !== 'active' || Boolean(current.pinned_at) === Boolean(pinned)) return null;
  return { pinned_at: pinned ? new Date().toISOString() : null };
});

export async function permanentlyDeleteNote(noteId) {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('notes').delete().eq('id', noteId).eq('user_id', userId).eq('lifecycle_state', 'trashed').select('id').maybeSingle();
  assertSupabaseResult(result);
  if (!result.data) throw new Error('Move the note to Trash before deleting it permanently.');
  dispatchNotesChanged(noteId);
}

export async function emptyNotesTrash() {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('notes').delete().eq('user_id', userId).eq('lifecycle_state', 'trashed');
  assertSupabaseResult(result);
  dispatchNotesChanged();
}

export async function createNote(note, expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reopen your app note before saving.');
  const payload = toNotePayload(note, userId);
  let result = await client
    .from('notes')
    .insert(payload)
    .select(noteSelect)
    .single();

  if (isMissingLifecycleSchema(result.error) || (String(result.error?.code || '').toUpperCase() === 'PGRST204' && /lifecycle_state|state_before_trash|pinned_at/.test(result.error?.message || ''))) {
    result = await client.from('notes').insert(stripLifecycleFields(payload)).select(legacyNoteSelect).single();
  }

  if (result.error?.code === '23505' && payload.id) {
    const existing = await client.from('notes').select(legacyNoteSelect).eq('id', payload.id).eq('user_id', userId).maybeSingle();
    assertSupabaseResult(existing);
    if (existing.data
      && existing.data.title === payload.title
      && existing.data.content_html === payload.content_html
      && existing.data.linked_goal_id === payload.linked_goal_id
      && JSON.stringify(existing.data.tags) === JSON.stringify(payload.tags)
      && JSON.stringify(existing.data.media) === JSON.stringify(payload.media)) {
      dispatchNotesChanged(existing.data.id);
      return toNote(existing.data);
    }
  }

  if (isMissingNotesTable(result.error)) {
    throw result.error;
  }

  assertSupabaseResult(result);
  dispatchNotesChanged(result.data.id);
  return toNote(result.data);
}

export async function updateNote(noteId, updates) {
  const { client, userId } = await getUserScopedClient();
  if (updates.userId && updates.userId !== userId) throw new Error('Your account changed. Reopen this note.');
  const { user_id: _userId, created_at: _createdAt, id: _id, ...payload } = toNotePayload(
    updates,
    userId,
  );

  let query = client.from('notes').update(payload).eq('id', noteId).eq('user_id', userId);
  if (updates.updatedAt) query = query.eq('updated_at', updates.updatedAt);
  let result = await query.select(noteSelect).maybeSingle();
  if (isMissingLifecycleSchema(result.error) || (String(result.error?.code || '').toUpperCase() === 'PGRST204' && /lifecycle_state|state_before_trash|pinned_at/.test(result.error?.message || ''))) {
    let legacyQuery = client.from('notes').update(stripLifecycleFields(payload)).eq('id', noteId).eq('user_id', userId);
    if (updates.updatedAt) legacyQuery = legacyQuery.eq('updated_at', updates.updatedAt);
    result = await legacyQuery.select(legacyNoteSelect).maybeSingle();
  }
  if (!result.error && !result.data) throw new Error('This note changed elsewhere. Reopen it before saving; your edits have not been applied.');

  if (isMissingNotesTable(result.error)) {
    throw result.error;
  }

  assertSupabaseResult(result);
  dispatchNotesChanged(noteId);
  return toNote(result.data);
}

export async function deleteNote(noteId) {
  return trashNote(noteId);
}

export function subscribeToNotes(userId, onChange) {
  const client = requireSupabase();

  return client
    .channel(`notes:user:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notes',
        filter: `user_id=eq.${userId}`,
      },
      onChange,
    )
    .subscribe();
}

export async function getAppNote(appKey, expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error('Your account changed. Reopen the note.');
  let result = await client.from('notes').select(noteSelect).eq('user_id', userId).eq('app_key', appKey).maybeSingle();
  if (isMissingLifecycleSchema(result.error)) {
    result = await client.from('notes').select(legacyNoteSelect).eq('user_id', userId).eq('app_key', appKey).maybeSingle();
  }
  assertSupabaseResult(result);
  return result.data ? toNote(result.data) : null;
}
export async function appendAppNote(appKey, note, expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error('Your account changed. Reopen the note.');
  const result = await client.rpc('append_app_note', { p_app: appKey, p_title: note.title, p_text: note.contentText, p_html: note.contentHtml });
  assertSupabaseResult(result);
  return result.data;
}
