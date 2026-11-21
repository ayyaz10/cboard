import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required for the authenticated browser fixture.');
const userId = '5d72505b-8f2b-4d3c-8fe8-7f2a9b1e0001';
const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'today-dashboard@example.invalid', user_metadata: { username: 'Today Dashboard QA' }, app_metadata: { provider: 'email', providers: ['email'] }, created_at: new Date().toISOString() };

async function prepare(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ key, sessionUser }) => localStorage.setItem(key, JSON.stringify({
    access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ZDcyNTA1Yi04ZjJiLTRkM2MtOGZlOC03ZjJhOWIxZTAwMDEiLCJleHAiOjk5OTk5OTk5OTl9.signature',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'today-test-token', user: sessionUser,
  })), { key: authStorageKey, sessionUser: user });
  const records = new Map();
  const tasks = new Map();
  let listCalls = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== new URL(supabaseUrl).hostname) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/auth/v1/user')) return json(user);
    if (url.pathname.includes('/rest/v1/rpc/create_user_reminder')) {
      const args = route.request().postDataJSON();
      const row = records.get(args.p_id) || { id: args.p_id, title: args.p_title, due_at: args.p_due_at, completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      records.set(row.id, row);
      return json([row]);
    }
    if (url.pathname.includes('/rest/v1/rpc/create_user_task')) {
      const a=route.request().postDataJSON(),row=tasks.get(a.p_id)||{id:a.p_id,title:a.p_title,description:a.p_description,due_at:a.p_due_at,priority:a.p_priority,completed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};tasks.set(row.id,row);return json([row]);
    }
    if (url.pathname.includes('/rest/v1/rpc/list_user_tasks')) {
      const a=route.request().postDataJSON(),rows=[...tasks.values()].filter(row=>(row.due_at&&row.due_at>=a.p_start_at&&row.due_at<a.p_end_at)||(!row.due_at&&a.p_include_undated));return json(rows.slice(0,a.p_limit+1));
    }
    if (url.pathname.includes('/rest/v1/rpc/complete_user_task')) { const {p_id}=route.request().postDataJSON(),row=tasks.get(p_id);if(row&&!row.completed_at){row.completed_at=new Date().toISOString();row.updated_at=row.completed_at;}return json(row?[row]:[]); }
    if (url.pathname.includes('/rest/v1/rpc/list_user_reminders')) {
      listCalls += 1;
      const args = route.request().postDataJSON();
      const rows = [...records.values()].filter(row => row.due_at >= args.p_start_at && row.due_at < args.p_end_at
        && (!args.p_after_due_at || row.due_at > args.p_after_due_at || (row.due_at === args.p_after_due_at && row.id > args.p_after_id)))
        .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.id.localeCompare(b.id)).slice(0, args.p_limit + 1);
      return json(rows);
    }
    if (url.pathname.includes('/rest/v1/rpc/complete_user_reminder')) {
      const { p_id } = route.request().postDataJSON();
      const row = records.get(p_id);
      if (row && !row.completed_at) { row.completed_at = new Date().toISOString(); row.updated_at = row.completed_at; }
      return json(row ? [row] : []);
    }
    if (url.pathname.includes('/rest/v1/')) return json([]);
    return route.continue();
  });
  return { records, listCalls: () => listCalls };
}

async function fillLocalDueDate(page, offsetMinutes = 90) {
  const fields = await page.evaluate(minutes => {
    const due = new Date(Date.now() + minutes * 60_000);
    const pad = value => String(value).padStart(2, '0');
    return { date: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`, time: `${pad(due.getHours())}:${pad(due.getMinutes())}` };
  }, offsetMinutes);
  await page.locator('#quick-capture-reminder-date').fill(fields.date);
  await page.locator('#quick-capture-reminder-time').fill(fields.time);
}

test('Today shows Quick Capture reminder, completes it, and preserves module navigation', async ({ page }) => {
  const fixture = await prepare(page);
  await page.goto('/cboard/board');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Timeline/ })).toBeVisible();
  await page.getByRole('button', { name: 'Quick Capture', exact: true }).click();
  await page.getByRole('button', { name: 'Reminder', exact: true }).click();
  await page.locator('#quick-capture-reminder-title').fill('Review project notes');
  await fillLocalDueDate(page);
  const readsBeforeSave = fixture.listCalls();
  await page.getByRole('button', { name: 'Save reminder' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reminder saved' })).toBeVisible();
  await expect(page.getByText('Review project notes', { exact: true }).first()).toBeVisible();
  expect(fixture.listCalls()).toBeGreaterThan(readsBeforeSave);
  await page.getByRole('button', { name: 'Mark Complete' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reminder completed.' })).toBeVisible();
  await expect(page.locator('.today-reminder-list').getByText(/Reminder \\| Completed/)).toBeVisible();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await expect(page.getByRole('list', { name: 'CBoard workspaces' })).toBeVisible();
  expect(fixture.records.size).toBe(1);
});

test('overdue reminders take priority and dashboard refreshes on return to focus', async ({ page }) => {
  const fixture = await prepare(page);
  await page.goto('/cboard/board');
  const rows = await page.evaluate(() => {
    const now = new Date();
    return { overdue: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 8).toISOString(), today: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22).toISOString() };
  });
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  fixture.records.set(ids[0], { id: ids[0], title: 'Past due task', due_at: rows.overdue, completed_at: null });
  fixture.records.set(ids[1], { id: ids[1], title: 'Later today task', due_at: rows.today, completed_at: null });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Past due task', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bring this back on track' })).toBeVisible();
  const before = fixture.listCalls();
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => fixture.listCalls()).toBeGreaterThan(before);
});

test('Quick Capture creates an undated title-only task', async ({ page }) => {
  const fixture=await prepare(page);
  await page.goto('/cboard/board');
  await page.getByRole('button',{name:'Quick Capture',exact:true}).click();
  await page.locator('#quick-capture-reminder-title').fill('Clean the car');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Task saved'})).toBeVisible();
  await page.getByRole('button',{name:'All Tasks',exact:true}).click();
  await expect(page.getByText('Clean the car',{exact:true})).toBeVisible();
  expect(fixture.records.size).toBe(0);
});
test('Today layout remains usable on desktop width', async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/cboard/board');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quick Capture', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});




test('My Life presents connected module summaries and remains usable on mobile and desktop', async ({ page }) => {
  await prepare(page);
  await page.goto('/cboard/board');
  await page.getByRole('button', { name: 'My Life', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Life' })).toBeVisible();
  for (const name of ['Finance', 'Health & Food', 'Weight', 'Training', 'Goals & Habits', 'Groceries']) {
    await expect(page.getByRole('region', { name })).toBeVisible();
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
