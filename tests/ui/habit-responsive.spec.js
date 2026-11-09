import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createInitialHabitData, makeBacklogItem, makeHabitArea, makeImprovementNode } from '../../src/features/drivingImprovement/drivingData.js';
import { localDateKey, recordExecution, shiftLocalDateKey } from '../../src/features/drivingImprovement/habitExecution.js';

const userId = '1b5f73a2-3ac4-4a84-9dd7-f51e3c800001';
const longTitle = 'A deliberately long improvement title that should wrap without pushing the layout wider than the screen';
const env = readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required to run local browser QA.');
const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

function workspaceFixture() {
  const data = createInitialHabitData();
  const habit = makeHabitArea({ name: 'Reading practice', description: 'A realistic browser QA habit.' }, [], userId);
  data.habits.push(habit);
  const contract = {
    action: 'Read one chapter', minimum: 'Read two pages', trigger: 'After breakfast', triggerType: 'AFTER_BEHAVIOR',
    triggerTime: '', schedule: { type: 'DAILY' }, mode: 'ADD', location: 'Quiet room', environment: 'Book ready on desk',
    obstacle: '', currentResponse: '', replacement: '', useFocusTimer: true, focusMinutes: 25, minimumFocusMinutes: 5,
  };
  let parentId = null;
  for (let index = 0; index < 24; index++) {
    const node = makeImprovementNode({
      habitId: habit.id, parentId, title: index === 0 ? longTitle : `Nested practice ${index + 1}`,
      focusNow: index < 3, priority: index === 0 ? 'HIGH' : 'MEDIUM',
      actionContract: index < 3 ? { ...structuredClone(contract), useFocusTimer: index < 2 } : null,
      description: index === 0 ? 'Root with long, realistic nested content.' : '',
    }, userId);
    data.nodes.push(node);
    if (index === 0) parentId = node.id;
    if (index === 0) data.rootId = node.id;
    if (index === 0) data.rootNodeId = node.id;
  }
  const reviewNode = data.nodes[0];
  for (const [offset, reason] of [[2, 'Forgot'], [3, 'Forgot'], [4, 'Forgot']]) {
    const next = recordExecution(reviewNode, 'MISSED', { date: shiftLocalDateKey(localDateKey(), -offset), reason });
    Object.assign(reviewNode, next);
  }
  data.backlogItems.push(makeBacklogItem({ title: 'Try a new morning routine', type: 'HABIT', priority: 'LOW', note: 'A parked idea.' }, userId));
  return { data, rootId: data.nodes[0].id, habit };
}

async function preparePage(page, fixture) {
  await page.addInitScript(({ storageKey, id }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxYjVmNzNhMi0zYWM0LTRhODQtOWRkNy1mNTFlM2M4MDAwMDEiLCJleHAiOjk5OTk5OTk5OTl9.signature',
      token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'browser-qa-token',
      user: { id, aud: 'authenticated', role: 'authenticated', email: 'browser-qa@example.invalid', user_metadata: { username: 'Browser QA' }, app_metadata: { provider: 'email', providers: ['email'] }, created_at: new Date().toISOString() },
    }));
  }, { storageKey: authStorageKey, id: userId });

  let workspace = { data: fixture.data, revision: 1, updated_at: new Date().toISOString() };
  let focusSession = null;
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== new URL(supabaseUrl).hostname) return route.continue();
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/auth/v1/user')) return json({ id: userId, aud: 'authenticated', role: 'authenticated', email: 'browser-qa@example.invalid', user_metadata: { username: 'Browser QA' }, app_metadata: { provider: 'email', providers: ['email'] }, created_at: new Date().toISOString() });
    if (url.pathname.endsWith('/rest/v1/driving_workspaces')) {
      if (request.method() === 'GET') return json([workspace]);
      if (request.method() === 'PATCH') { const body = request.postDataJSON(); workspace = { ...workspace, ...body }; return json([{ revision: workspace.revision }]); }
      return json([]);
    }
    if (url.pathname.endsWith('/rest/v1/focus_sessions')) {
      if (request.method() === 'GET') return json(focusSession ? [focusSession] : []);
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        focusSession = { id: '9cfb6510-6f49-4e73-8ed3-bb66b2deaa01', ...body };
        return json(request.headers().accept?.includes('vnd.pgrst.object') ? focusSession : [focusSession]);
      }
      if (request.method() === 'PATCH' && focusSession) { focusSession = { ...focusSession, ...request.postDataJSON() }; return json(request.headers().accept?.includes('vnd.pgrst.object') ? focusSession : [focusSession]); }
      return json([]);
    }
    if (url.pathname.endsWith('/rest/v1/break_tasks')) return json([]);
    if (url.pathname.includes('/rest/v1/')) return json([]);
    return route.continue();
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(result.content, `${label}: content width ${result.content}px exceeds viewport ${result.viewport}px`).toBeLessThanOrEqual(result.viewport + 1);
}

const viewports = [360, 390, 430, 768, 1024, 1366, 1920];
for (const width of viewports) {
  test(`Habit Improvement UI remains usable at ${width}px`, async ({ page }) => {
    const fixture = workspaceFixture();
    await page.setViewportSize({ width, height: 900 });
    await preparePage(page, fixture);
    await page.goto('habit-improvement');
    await expect(page.getByRole('heading', { name: 'What will you do now?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Read one chapter' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reminders' })).toHaveCount(0);
    await assertNoHorizontalOverflow(page, `${width}px Today`);
    await page.screenshot({ path: `test-results/habit-${width}-today.png`, fullPage: false });

    await page.getByRole('button', { name: 'Tree', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Habits and patterns' })).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Improvements' })).toBeVisible();
    await page.locator(`[data-tree-node-id="${fixture.rootId}"]`).click();
    await expect(page.getByRole('heading', { name: fixture.data.nodes[0].title })).toBeVisible();
    const inspector = page.locator('.di-inspector');
    await expect(inspector).toBeVisible();
    await assertNoHorizontalOverflow(page, `${width}px Tree and Inspector`);
    await page.screenshot({ path: `test-results/habit-${width}-inspector.png`, fullPage: false });

    await inspector.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit improvement' });
    await expect(editor).toBeVisible();
    const editorBox = await editor.boundingBox();
    expect(editorBox.y).toBeGreaterThanOrEqual(0);
    expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(901);
    await expect(editor.getByRole('button', { name: 'Save changes' })).toBeInViewport();
    await assertNoHorizontalOverflow(page, `${width}px Edit modal`);
    await page.screenshot({ path: `test-results/habit-${width}-editor.png`, fullPage: false });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toBeHidden();

    await inspector.getByRole('button', { name: 'Edit contract' }).click();
    const contractDialog = page.getByRole('dialog');
    await expect(contractDialog).toBeVisible();
    await expect(contractDialog.getByLabel('What will you do?')).toBeVisible();
    await expect(contractDialog.getByLabel('Minimum version')).toBeVisible();
    await expect(contractDialog.getByRole('button', { name: 'Save action' })).toBeInViewport();
    await assertNoHorizontalOverflow(page, `${width}px Action Contract`);
    await page.screenshot({ path: `test-results/habit-${width}-contract.png`, fullPage: false });
    await contractDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What needs adjusting?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make smaller' }).first()).toBeVisible();
    await assertNoHorizontalOverflow(page, `${width}px Review`);
    await page.screenshot({ path: `test-results/habit-${width}-review.png`, fullPage: false });
  });
}

test('Focus Timer handoff returns to Habit Improvement for an explicit outcome', async ({ page }) => {
  const fixture = workspaceFixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await preparePage(page, fixture);
  await page.goto('habit-improvement');
  await expect(page.getByRole('heading', { name: 'What will you do now?' })).toBeVisible();
  await page.getByRole('button', { name: 'Start 25 min' }).first().click();
  await expect(page).toHaveURL(/\/cboard\/focus-timer$/);
  await expect(page.getByRole('heading', { name: 'Focus Timer' })).toBeVisible();
  await expect(page.getByText('Habit session')).toBeVisible();
  await expect(page.getByRole('heading', { name: fixture.habit.name }).first()).toBeVisible();
  await expect(page.getByText(fixture.data.nodes[0].actionContract.action).first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel session' }).click();
  await expect(page).toHaveURL(/\/cboard\/habit-improvement$/);
  await expect(page.getByRole('dialog', { name: 'Focus session ended' })).toBeVisible();
  await page.getByRole('button', { name: 'Leave unresolved' }).click();
  await expect(page.getByRole('dialog', { name: 'Focus session ended' })).toBeHidden();
});
