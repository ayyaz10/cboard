import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required for the authenticated browser fixture.');
const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const userId = '5d72505b-8f2b-4d3c-8fe8-7f2a9b1e0001';
const dueAt = '2031-06-12T14:30:00.000Z';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'quick-capture@example.invalid', user_metadata: { username: 'Quick Capture QA' }, app_metadata: { provider: 'email', providers: ['email'] }, created_at: new Date().toISOString() };

async function prepare(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ key, id, sessionUser }) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ZDcyNTA1Yi04ZjJiLTRkM2MtOGZlOC03ZjJhOWIxZTAwMDEiLCJleHAiOjk5OTk5OTk5OTl9.signature',
      token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'browser-qa-token', user: { ...sessionUser, id },
    }));
  }, { key: authStorageKey, id: userId, sessionUser: user });
  const records = new Map();
  const creates = [];
  let loseFirstResponse = false;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== new URL(supabaseUrl).hostname) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/auth/v1/user')) return json(user);
    if (url.pathname.includes('/rest/v1/rpc/create_user_reminder')) {
      const args = route.request().postDataJSON();
      creates.push(args);
      let item = records.get(args.p_id);
      if (!item) {
        item = { id: args.p_id, title: args.p_title, due_at: args.p_due_at, completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        records.set(args.p_id, item);
      }
      if (loseFirstResponse) { loseFirstResponse = false; return route.abort('connectionreset'); }
      await new Promise(resolve => setTimeout(resolve, 300));
      return json([item]);
    }
    if (url.pathname.includes('/rest/v1/')) return json([]);
    return route.continue();
  });
  return { records, creates, loseResponse: () => { loseFirstResponse = true; } };
}

for (const width of [390, 1366]) {
  test(`Quick Capture saves on ${width}px layout and blocks duplicate submits`, async ({ page }) => {
    const fixture = await prepare(page, width);
    await page.goto('/cboard/board');
    await page.getByRole('button', { name: 'Quick Capture', exact: true }).click();
    const title = page.getByRole('dialog').getByLabel('Title');
    await expect(title).toBeFocused();
    await page.getByRole('button', { name: 'Reminder', exact: true }).click();
    await title.fill('Send the parcel');
    await page.locator('#quick-capture-reminder-date').fill('2031-06-12');
    await page.locator('#quick-capture-reminder-time').fill('14:30');
    const save = page.getByRole('button', { name: 'Save reminder' });
    await save.dblclick();
    await expect(page.getByRole('status').filter({ hasText: 'Reminder saved' })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Quick Capture', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('');
    expect(fixture.creates).toHaveLength(1);
    expect(fixture.records.size).toBe(1);
    const expectedDueAt = await page.evaluate(() => new Date(2031, 5, 12, 14, 30).toISOString());
    expect([...fixture.records.values()][0]).toMatchObject({ title: 'Send the parcel', due_at: expectedDueAt });
    expect(await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })).then(v => v.scroll <= v.width + 1)).toBe(true);
  });
}

test('Quick Capture reports invalid fields and retries uncertain saves with the same payload and ID', async ({ page }) => {
  const fixture = await prepare(page, 390);
  await page.goto('/cboard/board');
  await page.getByRole('button', { name: 'Quick Capture', exact: true }).click();
  await page.getByRole('button', { name: 'Reminder', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('Keep retry payload');
  await page.locator('#quick-capture-reminder-date').fill('');
  await page.getByRole('button', { name: 'Save reminder' }).click();
  await expect(page.getByRole('region', { name: 'Notifications alt+T' }).getByText('Choose both a date and time for a reminder.')).toBeVisible();
  await page.locator('#quick-capture-reminder-date').fill('2031-06-12');
  await page.locator('#quick-capture-reminder-time').fill('14:30');
  fixture.loseResponse();
  await page.getByRole('button', { name: 'Save reminder' }).click();
  await expect(page.getByRole('region', { name: 'Notifications alt+T' }).getByText(/outcome is unknown/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reminder saved' })).toBeVisible();
  expect(fixture.creates).toHaveLength(2);
  expect(fixture.creates[1]).toEqual(fixture.creates[0]);
  expect(fixture.records.size).toBe(1);
});
