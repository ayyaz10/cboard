import { test, expect } from '@playwright/test';

const widths = [360, 390, 430, 768, 1024, 1366, 1920];
const longTitle = `Credit payment coming up: Admiral Platinum Tier ${'comprehensive purchase reminder '.repeat(8)}`;

for (const width of widths) {
  test(`Reminder and live timer panels fit and behave at ${width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width <= 430, hasTouch: width <= 430 });
    const page = await context.newPage();
    await page.route('**/rest/v1/**', route => route.fulfill({ status: 401, body: '{}' }));
    await page.addInitScript(({ title }) => {
      const now = Date.now();
      const reminders = Array.from({ length: 16 }, (_, index) => ({
        id: `reminder-${index}`,
        title: index === 0 ? title : `Reminder ${index + 1}: ${'Long reminder description '.repeat(4)}`,
        dueAt: now - 10_000,
        alertAt: now - 10_000,
        durationMs: 60_000,
        repeatMs: 0,
        status: 'ringing',
      }));
      localStorage.setItem('cboard:reminders:qa-user', JSON.stringify({ reminders, history: [] }));
    }, { title: longTitle });
    await page.goto('/cboard/tests/ui/fixtures/reminder.html');

    const liveDock = page.locator('.live-timer-dock');
    await expect(liveDock).toBeVisible();
    const liveDockBox = await liveDock.boundingBox();
    expect(liveDockBox.x).toBeGreaterThanOrEqual(0);
    expect(liveDockBox.y).toBeGreaterThanOrEqual(0);
    expect(liveDockBox.x + liveDockBox.width).toBeLessThanOrEqual(width);
    expect(liveDockBox.y + liveDockBox.height).toBeLessThanOrEqual(900);

    const toggle = page.locator('.reminder-toggle');
    await toggle.click();
    const panel = page.getByRole('dialog', { name: 'Reminders' });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close reminders' })).toBeFocused();
    const panelBox = await panel.boundingBox();
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await panel.locator('#reminder-widget-title').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reminders-${width}.png`) });

    await panel.locator('#reminder-widget-title').click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(panel).toBeVisible();
    await toggle.click();
    await expect(panel).toBeHidden();

    if (width === 390) {
      await toggle.click();
      await page.getByRole('button', { name: 'Open sample modal' }).click();
      const modal = page.getByRole('dialog', { name: 'Sample modal' });
      await expect(modal).toBeVisible();
      const isTopLayer = await page.evaluate(() => {
        const dialog = document.querySelector('#root dialog[open]');
        const panelElement = document.querySelector('.reminder-widget');
        const panelRect = panelElement.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();
        const x = Math.max(panelRect.left, dialogRect.left) + 5;
        const y = Math.max(panelRect.top, dialogRect.top) + 5;
        return panelRect.left < dialogRect.right && panelRect.right > dialogRect.left
          && panelRect.top < dialogRect.bottom && panelRect.bottom > dialogRect.top
          && document.elementFromPoint(x, y)?.closest('dialog') === dialog;
      });
      expect(isTopLayer).toBe(true);
      await page.getByRole('button', { name: 'Close sample modal' }).click();
      await expect(modal).toBeHidden();
      await expect(panel).toBeVisible();
    }

    await context.close();
  });
}
