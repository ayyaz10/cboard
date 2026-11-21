import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required for the authenticated Life Areas browser fixture.');
const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const userId = '5d72505b-8f2b-4d3c-8fe8-7f2a9b1e0001';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'life-areas@example.invalid', user_metadata: { username: 'Life Areas QA' }, app_metadata: { provider: 'email', providers: ['email'] }, created_at: new Date().toISOString() };

async function prepare(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ key, sessionUser }) => localStorage.setItem(key, JSON.stringify({
    access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ZDcyNTA1Yi04ZjJiLTRkM2MtOGZlOC03ZjJhOWIxZTAwMDEiLCJleHAiOjk5OTk5OTk5OTl9.signature',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'life-areas-qa-token', user: sessionUser,
  })), { key: authStorageKey, sessionUser: user });
  const areas = new Map(), items = new Map(), tasks = new Map(), links = new Map(), notes = new Map(), learning = new Map();
  let loseNextAreaResponse = false, loseNextTaskResponse = false;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== new URL(supabaseUrl).hostname) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/auth/v1/user')) return json(user);
    if (url.pathname.includes('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop(), args = route.request().postDataJSON() || {};
      if (name === 'list_life_areas_overview') return json([...areas.values()].flatMap(area => [...items.values()].filter(item => item.area_id === area.id && item.status === 'active').map(item => {
        const task = [...links.values()].map(id => tasks.get(id)).find(value => value?.life_item_id === item.id && !value.completed_at);
        return { area_id: area.id, area_name: area.name, area_icon: area.icon, area_color: area.color, item_id: item.id, item_name: item.name, item_type: item.item_type, item_status: item.status, target_date: item.target_date, linked_goal_id: item.linked_goal_id, linked_goal_title: null, next_task_id: task?.id || null, next_task_title: task?.title || null, next_task_due_at: task?.due_at || null };
      })));
      if (name === 'reorder_life_areas') return json(true);
      if (name === 'list_life_item_tasks') return json([...links.entries()].filter(([, value]) => value.life_item_id === args.p_life_item_id).map(([id]) => tasks.get(id)).filter(Boolean));
      if (name === 'list_life_item_notes') return json([...learning.entries()].filter(([, value]) => value.life_item_id === args.p_life_item_id).map(([noteId, value]) => { const note = notes.get(noteId); return { note_id: noteId, title: note?.title, content_preview: note?.content_text || '', ...value }; }));
      if (name === 'create_user_task') {
        const task = tasks.get(args.p_id) || { id: args.p_id, user_id: userId, title: args.p_title, description: args.p_description, due_at: args.p_due_at, priority: args.p_priority, completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        tasks.set(args.p_id, task);
        if (loseNextTaskResponse) { loseNextTaskResponse = false; return route.abort('connectionreset'); }
        return json([task]);
      }
      if (name === 'link_life_item_task') { links.set(args.p_task_id, { life_item_id: args.p_life_item_id }); return json(true); }
      if (name === 'complete_user_task') { const task = tasks.get(args.p_id); task.completed_at ||= new Date().toISOString(); task.updated_at = new Date().toISOString(); return json([task]); }
      if (name === 'list_user_tasks') return json([...tasks.values()].filter(task => !task.deleted_at));
      if (name === 'list_user_reminders') return json([]);
      if (name === 'save_life_learning_note') { const value = { life_item_id: args.p_life_item_id, source_type: args.p_source_type, source_url: args.p_source_url, youtube_seconds: args.p_youtube_seconds, key_takeaways: args.p_key_takeaways, observations: args.p_observations, updated_at: new Date().toISOString() }; learning.set(args.p_note_id, value); return json(value.updated_at); }
      if (name === 'delete_user_task') return json(true);
      return json([]);
    }
    if (url.pathname.endsWith('/rest/v1/life_areas')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        if (areas.has(body.id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        const row = { id: body.id, user_id: userId, name: body.name, description: body.description, icon: body.icon, color: body.color, sort_order: 0, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        areas.set(row.id, row);
        if (loseNextAreaResponse) { loseNextAreaResponse = false; return route.abort('connectionreset'); }
        return json(row);
      }
      if (route.request().method() === 'PATCH') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); const row = areas.get(id); if (row) Object.assign(row, route.request().postDataJSON(), { updated_at: new Date().toISOString() }); return json(row || null); }
      return json([...areas.values()]);
    }
    if (url.pathname.endsWith('/rest/v1/life_items')) {
      if (route.request().method() === 'POST') { const body = route.request().postDataJSON(), row = { id: body.id, user_id: userId, area_id: body.area_id, name: body.name, description: body.description, item_type: body.item_type, status: body.status, target_date: body.target_date, linked_goal_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; items.set(row.id, row); return json(row); }
      if (route.request().method() === 'PATCH') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); const row = items.get(id); if (row) Object.assign(row, route.request().postDataJSON(), { updated_at: new Date().toISOString() }); return json(row || null); }
      return json([...items.values()]);
    }
    if (url.pathname.endsWith('/rest/v1/life_item_notes')) return json([...learning.entries()].filter(([noteId]) => url.searchParams.get('note_id') === `eq.${noteId}`).map(([noteId, value]) => ({ note_id: noteId, life_item_id: value.life_item_id, source_type: value.source_type, source_url: value.source_url, youtube_seconds: value.youtube_seconds, key_takeaways: value.key_takeaways, observations: value.observations, updated_at: value.updated_at })));
    if (url.pathname.endsWith('/rest/v1/notes')) {
      if (route.request().method() === 'POST') { const body = route.request().postDataJSON(), now = new Date().toISOString(), row = { ...body, user_id: userId, created_at: now, updated_at: now, lifecycle_state: 'active', state_before_trash: 'active', pinned_at: null }; notes.set(row.id, row); return json(row); }
      if (route.request().method() === 'GET') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); return json(id ? (notes.has(id) ? [notes.get(id)] : []) : [...notes.values()]); }
      return json([]);
    }
    if (url.pathname.endsWith('/rest/v1/goals')) return json([]);
    if (url.pathname.includes('/rest/v1/')) return json([]);
    return route.continue();
  });
  return { areas, items, tasks, learning, loseAreaResponse: () => { loseNextAreaResponse = true; }, loseTaskResponse: () => { loseNextTaskResponse = true; } };
}

for (const width of [390, 1366]) {
  test(`Life Area, learning note and task completion work at ${width}px`, async ({ page }) => {
    const fixture = await prepare(page, width);
    await page.goto('/cboard/life-areas');
    if (width > 600) await page.getByLabel('Select app theme').selectOption('matrix');
    await page.getByLabel('Name').first().fill('Fitness');
    await page.getByLabel('Description').first().fill('Practice and health');
    fixture.loseAreaResponse();
    await page.getByRole('button', { name: 'Create area' }).click();
    await expect(page.getByRole('region', { name: 'Notifications alt+T' }).getByText(/Retry to safely finish the same save/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(page.getByText('Life area saved.')).toBeVisible();
    expect(fixture.areas.size).toBe(1);
    await page.getByLabel('Name').fill('Career');
    await page.getByRole('button', { name: 'Create area' }).click();
    const careerCard = page.locator('.life-area-card').filter({ hasText: 'Career' });
    await careerCard.getByRole('button', { name: 'Move Career up' }).click();
    await careerCard.getByRole('button', { name: 'Rename / edit' }).click();
    await page.getByLabel('Area name').fill('Career growth');
    await page.getByRole('button', { name: 'Save area' }).click();
    await expect(page.getByText('Life area updated.')).toBeVisible();
    await page.locator('.life-area-card').filter({ hasText: 'Career growth' }).getByRole('button', { name: 'Archive area' }).click();
    await expect(page.getByText('Life area archived. Its Projects, Skills and links are preserved.')).toBeVisible();
    await page.locator('.life-area-card').filter({ hasText: 'Career growth' }).getByRole('button', { name: 'Restore area' }).click();
    await page.locator('.life-area-card').filter({ hasText: 'Fitness' }).getByRole('button', { name: 'Open area' }).click();
    await page.getByLabel('Name').fill('Handstands');
    await page.getByLabel('Type').selectOption('skill');
    await page.getByRole('button', { name: 'Add Project or Skill' }).click();
    await expect(page.getByRole('button', { name: /Handstands/ })).toBeVisible();
    const createdAreaId = [...fixture.areas.values()].find(area => area.name === 'Fitness').id;
    const createdItemId = [...fixture.items.keys()][0];
    await page.getByRole('button', { name: /Handstands/ }).click();
    await page.getByRole('link', { name: 'Create or attach a Notebook note' }).click();
    await page.getByLabel('Note title').fill('Handstand tutorial');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Project or Skill').selectOption(createdItemId);
    await page.getByLabel('Source type').selectOption('youtube');
    await page.getByLabel('Source URL').fill('https://youtu.be/example-video');
    await page.getByLabel('YouTube timestamp').fill('4:32');
    await page.getByLabel('Key takeaways').fill('Practice wall-supported balance.');
    await page.getByRole('button', { name: 'Attach learning note' }).click();
    await expect(page.getByText('Learning details saved.')).toBeVisible();
    expect(fixture.learning.size).toBe(1);

    await page.goto(`/cboard/life-areas/${createdAreaId}/${createdItemId}`);
    await expect(page.getByRole('heading', { name: 'Handstand tutorial' })).toBeVisible();
    await page.getByRole('button', { name: 'Create practice task' }).click();
    await page.getByLabel('Practice task title').fill('Practice wall handstand');
    const tomorrow = await page.evaluate(() => { const date = new Date(); date.setDate(date.getDate() + 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
    await page.getByLabel('Date (optional)').fill(tomorrow);
    await page.getByLabel('Time (optional)').fill('09:00');
    fixture.loseTaskResponse();
    await page.getByRole('button', { name: 'Save practice task' }).click();
    await expect(page.getByRole('region', { name: 'Notifications alt+T' }).getByText(/Retry to safely finish the same save/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(page.getByText('Task saved and linked.')).toBeVisible();
    await expect(page.getByText('Practice wall handstand')).toBeVisible();

    await page.goto('/cboard/board');
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await expect(page.getByText('Practice wall handstand')).toBeVisible();
    await page.getByRole('button', { name: 'Complete Practice wall handstand' }).click();
    await expect(page.getByText('Task completed.')).toBeVisible();
    await page.goto(`/cboard/life-areas/${createdAreaId}/${createdItemId}`);
    await expect(page.locator('.life-task-list li').filter({ hasText: 'Completed' })).toBeVisible();
    expect([...fixture.tasks.values()]).toHaveLength(1);
    expect([...fixture.tasks.values()][0].completed_at).toBeTruthy();
    await page.goto('/cboard/life-areas');
    await page.locator('.life-area-card').filter({ hasText: 'Fitness' }).getByRole('button', { name: 'Archive area' }).click();
    await expect(page.getByText('Life area archived. Its Projects, Skills and links are preserved.')).toBeVisible();
    await page.locator('.life-area-card').filter({ hasText: 'Fitness' }).getByRole('button', { name: 'Restore area' }).click();
    await page.locator('.life-area-card').filter({ hasText: 'Fitness' }).getByRole('button', { name: 'Open area' }).click();
    await expect(page.getByRole('button', { name: /Handstands/ })).toBeVisible();
    await page.getByRole('button', { name: /Handstands/ }).click();
    await expect(page.locator('.life-task-list li').filter({ hasText: 'Completed' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
}
