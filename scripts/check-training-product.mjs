// Run against the dedicated test Vite server described in TRAINING.md.
// Every Supabase request is intercepted: this never reads or writes a real account.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium, expect } = require(
  process.env.TRAINING_PLAYWRIGHT_PATH || "@playwright/test",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output =
  process.env.TRAINING_QA_OUTPUT ||
  "C:/Users/Ayyaz/AppData/Local/Temp/cboard-training-qa/screenshots";
await fs.mkdir(output, { recursive: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
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
await context.route("https://training-qa.supabase.co/**", async (route) => {
  if (offline) return route.abort("internetdisconnected");
  const req = route.request(),
    url = new URL(req.url());
  let data = [];
  if (url.pathname.endsWith("/auth/v1/user")) data = user;
  else if (url.pathname.includes("/profiles"))
    data = { username: "training_test" };
  else if (url.pathname.includes("/training_workspaces")) {
    if (req.method() === "GET") data = remote;
    else {
      const record = req.postDataJSON();
      const revision = Number(
        url.searchParams.get("revision")?.replace("eq.", "") || 0,
      );
      if (remote && revision !== remote.revision)
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "null",
        });
      remote = { data: record.data, revision: record.revision };
      data = { revision: remote.revision };
    }
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
try {
  await page.clock.install({ time: new Date("2026-09-14T12:00:00") });
  await page.goto(`${process.env.TRAINING_QA_URL || 'http://127.0.0.1:5178'}/cboard/training`);
  await expect(
    page.getByRole("heading", { name: "Upper chest and push", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${output}/product-overview.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  await page.getByRole("button", { name: "+ Create exercise" }).click();
  await page.getByLabel("Exercise name", { exact: true }).fill("Test ring row");
  await page.getByLabel("Default sets", { exact: true }).fill("2");
  await page.getByLabel("Target reps / hold seconds").fill("10");
  await page.getByLabel("Exercise timer (seconds)", { exact: true }).fill("45");
  await page.getByLabel("Rest between sets (seconds)").fill("75");
  await page
    .getByLabel("Technique / video link")
    .fill("https://example.com/row-technique");
  await page.getByLabel("Or upload an image", { exact: false }).setInputFiles({
    name: "row.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByAltText("Exercise preview")).toBeVisible();
  await page
    .getByRole("button", { name: "Save exercise", exact: true })
    .click();
  await expect(
    page.getByText("Exercise saved. Add it to a workout or your weekly plan."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page
    .getByLabel("Add exercise to workout")
    .selectOption({ label: "Test ring row" });
  await expect(
    page.getByRole("heading", { name: "Test ring row", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Reps", { exact: true })).toHaveValue("10");
  await expect(page.getByLabel("Timer seconds", { exact: true })).toHaveValue(
    "45",
  );
  await expect(
    page.getByRole("link", { name: "Watch technique" }),
  ).toHaveAttribute("href", "https://example.com/row-technique");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const dock = await page.locator('.tr-timer-dock').boundingBox();
    assert.ok(dock && dock.y >= 0 && Math.abs(dock.y + dock.height - 844) < 2, 'Timers stay at the viewport bottom');
    assert.ok(dock.x >= 0 && dock.x + dock.width <= width, 'Timer dock fits the viewport width');
    await expect(page.getByRole('button', { name: 'Pause timer', exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/timer-dock-${width}.png` });
  }
  await page.clock.fastForward(10000);
  await expect(page.getByRole("timer")).toHaveText("0:35");
  await page.getByRole("button", { name: "Pause timer", exact: true }).click();
  await page.clock.fastForward(5000);
  await expect(page.getByRole("timer")).toHaveText("0:35");
  await expect(page.getByRole("status").first()).toContainText(
    "Saved to cloud",
  );
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("0:35");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.fastForward(35000);
  await expect(
    page.getByText("Time complete. Record your actual reps or hold below."),
  ).toBeVisible();
  await page.getByLabel("Reps", { exact: true }).fill("12");
  await page.getByRole("button", { name: /Complete Set/ }).click();
  await expect(
    page.getByRole("heading", { name: "Saved sets (1)" }),
  ).toBeVisible();
  await expect(page.locator(".tr-rest")).toContainText("1:15");
  await page.getByRole("button", { name: /Complete Set/ }).click();
  await expect(
    page.getByRole("heading", { name: "Saved sets (2)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete set 2", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved sets (1)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo last action" }).click();
  await expect(
    page.getByRole("heading", { name: "Saved sets (2)" }),
  ).toBeVisible();
  await page
    .getByLabel("Add exercise to workout")
    .selectOption({ label: "Parallette handstand" });
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Test ring row", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${output}/product-workout-mobile.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No mobile overflow",
  );
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page.getByRole("button", { name: "Save & finish session" }).click();
  await expect(
    page.getByRole("heading", { name: "Custom workout · completed" }),
  ).toBeVisible();
  await page.getByText("Test ring row · 2 sets", { exact: true }).click();
  await expect(page.getByText(/1\. 12 reps/)).toBeVisible();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await page.getByRole("button", { name: "+ Add goal" }).click();
  await page
    .getByLabel("Goal exercise", { exact: true })
    .selectOption({ label: "Test ring row" });
  await page.getByLabel("Target reps", { exact: true }).fill("15");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(page.getByText("12 / 15 reps", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page
    .getByLabel("Add exercise to workout")
    .selectOption({ label: "Test ring row" });
  await expect(page.locator(".tr-previous")).toContainText("12 reps");
  await expect(page.getByLabel("Reps", { exact: true })).toHaveValue("12");
  offline = true;
  await page.getByRole("button", { name: /Complete Set/ }).click();
  await expect(
    page.getByRole("heading", { name: "Saved sets (1)" }),
  ).toBeVisible();
  offline = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Saved to cloud",
  );
  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  await page.getByLabel("Search exercises").fill("Test ring row");
  await page
    .getByRole("button", { name: "Remove exercise", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching exercises" }),
  ).toBeVisible();
  await page.getByLabel("Show removed exercises").check();
  await page
    .getByRole("button", { name: "Restore exercise", exact: true })
    .click();
  await page.getByLabel("Show removed exercises").uncheck();
  await expect(
    page.getByRole("heading", { name: "Test ring row", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Weekly plan", exact: true }).click();
  await page
    .getByLabel("Add exercise", { exact: true })
    .selectOption({ label: "Test ring row" });
  await page.getByText(/Test ring row · 2/).click();
  await expect(
    page.getByLabel("Rest seconds", { exact: true }).last(),
  ).toHaveValue("75");
  await page.getByRole("button", { name: "Save training plan" }).click();
  await page.getByRole("button", { name: "Workout", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Select app theme" })
    .selectOption("matrix");
  await page.screenshot({
    path: `${output}/product-workout-matrix.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No matrix overflow",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Training product workflow passed: library, upload, presets, timers, refresh, sets, undo, history, goals, offline replay, archive, plan, mobile and themes.",
  );
} catch (error) {
  await page.screenshot({
    path: `${output}/product-failure.png`,
    fullPage: true,
  });
  console.error((await page.locator(".training").innerText()).slice(-3000));
  throw error;
} finally {
  await browser.close();
}
