// Run against the dedicated test Vite server on port 5181 (see GROCERIES.md).
// Every Supabase request is intercepted: this never reads or writes a real account.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium, expect } = require(
  process.env.GROCERY_PLAYWRIGHT_PATH || "@playwright/test",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output =
  process.env.GROCERY_QA_OUTPUT ||
  "C:/Users/Ayyaz/AppData/Local/Temp/cboard-grocery-qa/screenshots";
await fs.mkdir(output, { recursive: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
let remote = null,
  offline = false,
  errors = [];
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "training@example.test",
  user_metadata: { username: "training_test" },
  app_metadata: { provider: "email" },
  created_at: new Date().toISOString(),
};
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated" })).toString("base64url")}.test`;
await context.addInitScript(
  ({ user, token }) => {
    if (!localStorage.getItem("sb-training-qa-auth-token"))
      localStorage.setItem(
        "sb-training-qa-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test-refresh",
          expires_at: 4102444800,
          expires_in: 360000,
          token_type: "bearer",
          user,
        }),
      );
  },
  { user, token },
);


// Hold a real cross-tab browser lock beyond the SDK's former five-second timeout.
await context.route('https://training-qa.supabase.co/**', async route => {
  const url = new URL(route.request().url());
  let data = [];
  if (url.pathname.endsWith('/auth/v1/user')) data = user;
  else if (url.pathname.includes('/profiles')) data = { username: 'mobile_test' };
  else if (url.pathname.includes('/user_tool_preferences') && url.searchParams.get('key')?.startsWith('eq.')) data = null;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});
await context.addInitScript(() => {
  const request = navigator.locks.request.bind(navigator.locks);
  navigator.locks.request = (name, options, callback) => {
    if (options?.steal) throw new Error('Auth attempted to steal a lock');
    return request(name, options, callback);
  };
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5181/cboard/groceries');
  await expect(page.getByRole('button', { name: /Quick add/ })).toBeEnabled({ timeout: 20000 });
  await page.evaluate(() => new Promise(resolve => {
    window.testHeldLock = navigator.locks.request('lock:sb-training-qa-auth-token', { mode: 'exclusive' }, async () => {
      resolve();
      await new Promise(release => { window.releaseTestLock = release; });
    });
  }));
  const releaseHeldLock = new Promise(resolve => setTimeout(resolve, 6500)).then(() => page.evaluate(() => window.releaseTestLock()));
  const second = await context.newPage();
  second.setDefaultTimeout(25000);
  second.on('pageerror', error => errors.push(error.message));
  await second.goto('http://127.0.0.1:5181/cboard/groceries');
  await expect(second.getByRole('button', { name: /Quick add/ })).toBeEnabled({ timeout: 20000 });
  await expect(second.getByText(/Targets unavailable|Lock broken|session is busy/)).toHaveCount(0);
  await releaseHeldLock;
  await second.getByRole('button', { name: /Quick add/ }).click();
  await second.getByRole('dialog').locator('textarea').fill('greek');
  await expect(second.getByRole('dialog').getByRole('button', { name: /Greek yogurt/i })).toBeVisible();
  await second.screenshot({ path: output + '/mobile-auth-lock.png' });
  await second.reload();
  await expect(second.getByRole('button', { name: /Quick add/ })).toBeEnabled({ timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log('PASS: mobile groceries and targets load after 6.5s cross-tab lock contention; suggestions and reload work without stealing locks');
} finally { await browser.close(); }
