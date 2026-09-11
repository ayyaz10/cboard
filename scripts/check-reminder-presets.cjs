const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Isolate this UI check from real accounts and data.
    await page.route('**/src/contexts/AuthContext.jsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export const useAuth = () => ({user: {id: 'preset-browser-test'}, isAuthenticated: true, isLoading: false, displayName: 'Test'}); export const AuthProvider = ({children}) => children;`,
    }));
    await page.route('**/src/services/dataMigrationService.js*', route => route.fulfill({
      contentType: 'application/javascript', body: 'export async function migrateLocalStorageData() {}',
    }));
    await page.goto('http://localhost:5173/cboard/focus-timer');
    const presets = page.getByRole('region', { name: 'Saved presets', exact: true });
    const save = presets.getByRole('button', { name: 'Save current settings as preset', exact: true });
    const title = page.getByRole('textbox', { name: 'Remind me to', exact: true });
    await save.click();
    await presets.getByRole('alert').waitFor();
    await title.fill('Tea');
    await save.click();
    await presets.getByRole('button', { name: 'Start preset Tea', exact: true }).waitFor();
    await title.fill('Stretch');
    await page.getByRole('button', { name: 'Repeat', exact: true }).click();
    await page.getByRole('button', { name: '45 min', exact: true }).click();
    await save.click();
    await page.reload();
    await presets.getByRole('button', { name: 'Start preset Tea', exact: true }).click();
    await presets.getByRole('button', { name: 'Start preset Stretch', exact: true }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cboard:reminders:preset-browser-test')));
    assert.equal(stored.reminders.length, 2);
    assert.equal(stored.reminders[0].repeatMs, 0);
    assert.equal(stored.reminders[1].repeatMs, 2700000);
    assert.equal(stored.history.filter(event => event.type === 'created').length, 2);
    await presets.getByRole('button', { name: 'Edit preset Tea', exact: true }).click();
    await title.fill('Check tea');
    await presets.getByRole('button', { name: 'Save preset changes', exact: true }).click();
    await presets.getByRole('button', { name: 'Delete preset Check tea', exact: true }).click();
    await presets.getByRole('button', { name: 'Undo delete', exact: true }).click();
    await page.reload();
    await presets.getByRole('button', { name: 'Start preset Check tea', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS: validation, save both types, refresh, start both with history, edit, delete/undo, mobile width; no browser errors.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
