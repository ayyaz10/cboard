import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../../supabase/migrations/202611060001_notes_lifecycle_search.sql', import.meta.url);

test('Notes lifecycle/search migration is additive and user scoped', async () => {
  const sql = (await readFile(migrationUrl, 'utf8')).toLowerCase();
  assert.match(sql, /add column if not exists lifecycle_state/);
  assert.match(sql, /add column if not exists state_before_trash/);
  assert.match(sql, /add column if not exists pinned_at/);
  assert.match(sql, /function public\.enforce_note_size_limits/);
  assert.match(sql, /create trigger notes_enforce_size_limits/);
  assert.match(sql, /octet_length\(new\.content_html\) > 52428800/);
  assert.match(sql, /octet_length\(new\.content_text\) > 5242880/);
  assert.match(sql, /create index if not exists notes_search_vector_idx/);
  assert.match(sql, /create or replace function public\.search_notes/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /n\.user_id = auth\.uid\(\)/);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 41\), 1\), 101\)/);
  assert.match(sql, /revoke all on function public\.search_notes/);
  assert.match(sql, /to authenticated/);
  assert.doesNotMatch(sql, /\b(drop table|truncate table|delete from public\.notes)\b/);
});
