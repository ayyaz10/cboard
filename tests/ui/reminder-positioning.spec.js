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
    const toggleBox = await page.locator('.reminder-toggle').boundingBox();
    expect(liveDockBox.y + liveDockBox.height).toBeLessThanOrEqual(toggleBox.y);
    if (width > 768) {
      const controlsBox = await page.locator('.global-scroll-controls').boundingBox();
      expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(liveDockBox.x);
      await expect(page.getByRole('button', { name: 'Go to top' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go to bottom' })).toBeVisible();
      await page.getByRole('button', { name: 'Go to bottom' }).click();
      await page.getByRole('button', { name: 'Go to top' }).click();
    }

    const title = liveDock.locator('.live-timer-item-title').first();
    await expect(title).toBeVisible();
    expect(await title.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); return element.scrollWidth <= element.clientWidth && range.getClientRects().length > 1; })).toBe(true);
    expect(await liveDock.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const dockThemeContrast = await page.evaluate(() => {
      const root = document.documentElement;
      const original = root.dataset.theme;
      const luminance = (rgb) => {
        const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const result = {};
      for (const theme of ['default', 'matrix', 'midnight']) {
        if (theme === 'default') delete root.dataset.theme;
        else root.dataset.theme = theme;
        const dock = document.querySelector('.live-timer-dock');
        const titleStyle = getComputedStyle(dock.querySelector('.live-timer-item-title'));
        const itemSurface = getComputedStyle(dock.querySelector('.live-timer-item'));
        const foreground = luminance(titleStyle.color);
        const background = luminance(itemSurface.backgroundColor);
        result[theme] = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      }
      if (original) root.dataset.theme = original;
      else delete root.dataset.theme;
      return result;
    });
    for (const contrast of Object.values(dockThemeContrast)) expect(contrast).toBeGreaterThanOrEqual(4.5);
    await expect(liveDock.getByRole('button', { name: 'View all 16' })).toBeVisible();

    const toggle = page.locator('.reminder-toggle');
    await liveDock.getByRole('button', { name: 'View all 16' }).click();
    const panel = page.getByRole('dialog', { name: 'Reminders' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(longTitle)).toBeVisible();
    await toggle.click();
    await expect(panel).toBeHidden();
    await toggle.click();
    const fullPanel = page.getByRole('dialog', { name: 'Reminders' });
    await expect(fullPanel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close reminders' })).toBeFocused();
    const panelBox = await fullPanel.boundingBox();
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await fullPanel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await fullPanel.locator('#reminder-widget-title').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reminders-${width}.png`) });

    await fullPanel.locator('#reminder-widget-title').click();
    await expect(fullPanel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fullPanel).toBeHidden();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(fullPanel).toBeVisible();
    await toggle.click();
    await expect(fullPanel).toBeHidden();

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
      await expect(fullPanel).toBeVisible();
    }

    await context.close();
  });
}
