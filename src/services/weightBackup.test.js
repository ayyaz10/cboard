import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBackupData, getBackupModule, importBackupModule } from './backupRegistry.js';

class MemoryQuery {
  constructor(client, table) { this.client = client; this.table = table; this.operation = 'select'; this.filters = []; }
  select() { this.operation = 'select'; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  in(column, values) { this.filters.push([column, values]); return this; }
  order() { return this; }
  range(from, to) { this.bounds = [from, to]; return this; }
  insert(rows) { this.operation = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this.run(); }
  matches(row) { return this.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value); }
  async run() {
    if (this.operation === 'select') {
      const rows = this.client.rows[this.table] || [];
      const [from = 0, to = Number.MAX_SAFE_INTEGER] = this.bounds || [];
      return { data: rows.filter(row => this.matches(row)).slice(from, to + 1), error: null };
    }
    if (this.operation === 'delete') {
      this.client.rows[this.table] = (this.client.rows[this.table] || []).filter(row => !this.matches(row));
      return { error: null };
    }
    this.client.rows[this.table] = [...(this.client.rows[this.table] || []), ...this.rows];
    return { error: null };
  }
  then(resolve, reject) { return this.run().then(resolve, reject); }
}
class WeightBackupClient {
  rows = { weight_entries: [] };
  files = new Map();
  from(table) { return new MemoryQuery(this, table); }
  storage = {
    from: () => ({
      download: async path => this.files.has(path) ? { data: this.files.get(path), error: null } : { data: null, error: new Error('Missing photo') },
      upload: async (path, blob) => { this.files.set(path, blob); return { data: { path }, error: null }; },
    }),
  };
}

test('Weight Progress backup keeps precise records and restores private photo media', async () => {
  const client = new WeightBackupClient();
  const photo = new Blob([new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])], { type: 'image/webp' });
  client.rows.weight_entries = [{
    id: 'weight-entry-1', user_id: 'source-user', date: '2026-11-07',
    weight_kg: 72.123456, note: 'Stored detail', photo_path: 'source-user/photo.webp',
    revision: 3, created_at: '2026-11-07T08:00:00.000Z',
  }];
  client.files.set('source-user/photo.webp', photo);

  const exported = await exportBackupData(['weightProgress'], { client, userId: 'source-user' });
  const data = exported.weightProgress.data;
  getBackupModule('weightProgress').validate(data);
  assert.equal(data.entries[0].weight_kg, 72.123456);
  assert.equal(data.entries[0].note, 'Stored detail');
  assert.equal(data.entries[0].photo_path, null);
  assert.equal(data.media['weight-entry-1'].type, 'image/webp');

  client.rows.weight_entries = [{ id: 'replace-me', user_id: 'target-user', date: '2026-01-01', weight_kg: 50, note: '', photo_path: null }];
  await importBackupModule('weightProgress', data, { client, userId: 'target-user' });
  assert.equal(client.rows.weight_entries.length, 1);
  const restored = client.rows.weight_entries[0];
  assert.equal(restored.id, 'weight-entry-1');
  assert.equal(restored.user_id, 'target-user');
  assert.equal(restored.weight_kg, 72.123456);
  assert.equal(restored.note, 'Stored detail');
  assert.match(restored.photo_path, /^target-user\/.+\.webp$/);
  assert.equal(client.files.get(restored.photo_path).type, 'image/webp');
});
