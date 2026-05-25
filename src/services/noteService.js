import { requireSupabase } from '../lib/supabaseClient';
import {
  assertSupabaseResult,
  getUserScopedClient,
  normalizeLegacyUuid,
} from './supabaseCrud';

const noteSelect = `
  id,
  user_id,
  title,
  content_html,
  content_text,
  linked_goal_id,
  tags,
  media,
  created_at,
  updated_at
`;

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

function getMissingNotesMessage() {
  return 'Notebook storage is not ready yet. Apply the Supabase schema migration, then try again.';
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag).trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  return [];
}

function normalizeMedia(media) {
  return Array.isArray(media)
    ? media
      .filter((item) => item?.name && item?.type && item?.dataUrl)
      .slice(0, 24)
    : [];
}

export function toNote(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? 'Untitled note',
    contentHtml: row.content_html ?? '',
    contentText: row.content_text ?? '',
    linkedGoalId: row.linked_goal_id ?? '',
    tags: normalizeTags(row.tags),
    media: normalizeMedia(row.media),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNotePayload(note, userId) {
  const id = normalizeLegacyUuid(note.id, 'note');
  const now = new Date().toISOString();

  return {
    ...(id ? { id } : {}),
    user_id: userId,
    title: (note.title || 'Untitled note').trim(),
    content_html: note.contentHtml ?? note.content_html ?? '',
    content_text: note.contentText ?? note.content_text ?? '',
    linked_goal_id: note.linkedGoalId || note.linked_goal_id || null,
    tags: normalizeTags(note.tags),
    media: normalizeMedia(note.media),
    created_at: note.createdAt ?? note.created_at ?? now,
    updated_at: now,
  };
}

export async function getNotes() {
  const { client } = await getUserScopedClient();
  const result = await client
    .from('notes')
    .select(noteSelect)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (isMissingNotesTable(result.error)) {
    return [];
  }

  assertSupabaseResult(result);
  return (result.data ?? []).map(toNote);
}

export async function createNote(note) {
  const { client, userId } = await getUserScopedClient();
  const result = await client
    .from('notes')
    .insert(toNotePayload(note, userId))
    .select(noteSelect)
    .single();

  if (isMissingNotesTable(result.error)) {
    throw new Error(getMissingNotesMessage());
  }

  assertSupabaseResult(result);
  return toNote(result.data);
}

export async function updateNote(noteId, updates) {
  const { client, userId } = await getUserScopedClient();
  const { user_id: _userId, created_at: _createdAt, id: _id, ...payload } = toNotePayload(
    updates,
    userId,
  );

  const result = await client
    .from('notes')
    .update(payload)
    .eq('id', noteId)
    .select(noteSelect)
    .single();

  if (isMissingNotesTable(result.error)) {
    throw new Error(getMissingNotesMessage());
  }

  assertSupabaseResult(result);
  return toNote(result.data);
}

export async function deleteNote(noteId) {
  const { client } = await getUserScopedClient();
  const result = await client
    .from('notes')
    .delete()
    .eq('id', noteId);

  if (isMissingNotesTable(result.error)) {
    throw new Error(getMissingNotesMessage());
  }

  assertSupabaseResult(result);
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
