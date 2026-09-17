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
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
try {
  await page.clock.install({ time: new Date("2026-09-14T12:00:00") });
  await page.goto("http://127.0.0.1:5178/cboard/training");
  await expect(
    page.getByRole("heading", { name: "Upper chest and push", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status").first()).toContainText(
    "Saved to cloud",
  );
  await page.screenshot({
    path: `${output}/today-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Start Workout →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parallette handstand", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Hold / time (seconds)", { exact: true }).fill("8");
  await page.getByLabel("Successful balance").check();
  await page.getByRole("button", { name: "Save attempt ✓" }).click();
  await expect(page.getByText("1 sets saved", { exact: false })).toBeVisible();
  await expect(page.locator(".tr-rest")).toContainText("Rest ·");
  await page.getByRole("button", { name: "Undo last action" }).click();
  await expect(page.getByText("0 sets saved", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save attempt ✓" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Saved to cloud",
  );
  await page.reload();
  await expect(page.getByText("1 sets saved", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save attempt ✓" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("button", { name: "Next exercise →", exact: true })
    .click();
  const started = Date.now();
  await page.getByRole("button", { name: "Complete Set ✓" }).click();
  assert.ok(
    Date.now() - started < 10000,
    "Normal set logs in under ten seconds",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${output}/workout-mobile.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile has no horizontal overflow",
  );
  await page
    .getByRole("combobox", { name: "Select app theme" })
    .selectOption("matrix");
  await page.screenshot({
    path: `${output}/workout-mobile-matrix.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page.getByRole("button", { name: "Save & finish session" }).click();
  await expect(
    page.getByRole("heading", { name: "Calendar & history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Upper chest and push · partial" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Progress that earns the next step" }),
  ).toBeVisible();
  await page.screenshot({
    path: `${output}/progress-mobile-matrix.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Training Plan", exact: true })
    .click();
  await page.getByLabel("Plan name", { exact: true }).fill("My re-entry plan");
  await page.getByRole("button", { name: "Save training plan" }).click();
  await expect(
    page.getByText("Plan saved. Future workouts use this schedule."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Exercise Library", exact: true })
    .click();
  await page
    .getByLabel("Search name, muscle, equipment or purpose")
    .fill("missing-exercise");
  await expect(
    page.getByRole("heading", { name: "No matching exercises" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Create exercise" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Band assisted row");
  await page
    .getByRole("button", { name: "Save exercise", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON backup" }).click();
  const backup = await downloadPromise;
  await backup.saveAs(`${output}/backup.json`);
  const saved = JSON.parse(await fs.readFile(`${output}/backup.json`, "utf8"));
  assert.equal(saved.sessions[0].sets.length, 2);
  assert.equal(saved.plan.name, "My re-entry plan");
  await page.getByLabel("Restore JSON backup").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.getByRole("alert")).toContainText("Unsupported backup");
  const qualified = structuredClone(saved);
  qualified.plan.start = "2026-09-01";
  const completed = qualified.sessions[0],
    prescription = completed.exercises.find((p) => p.exerciseId === "incline"),
    set = completed.sets.find((s) => s.exerciseId === "incline");
  completed.date = "2026-09-13";
  completed.status = "completed";
  completed.exercises = [prescription];
  completed.index = 0;
  completed.sets = Array.from({ length: 3 }, (_, i) => ({
    ...set,
    id: `qualified-${i}`,
    reps: 10,
    rir: 2,
    pain: 0,
    technique: "Clean",
  }));
  completed.after = { incline: 0 };
  completed.morning = {};
  await page.getByLabel("Restore JSON backup").setInputFiles({
    name: "qualified.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(qualified)),
  });
  await page
    .getByRole("button", { name: "Confirm restore", exact: true })
    .click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Next-morning check-in · 2026-09-13" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: /Low-incline machine press/ })
    .selectOption("0");
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await page
    .getByRole("combobox", { name: /^Exercise/ })
    .selectOption("incline");
  await page
    .getByRole("button", { name: "Confirm small progression", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Progression already applied" }),
  ).toBeDisabled();
  await expect(page.getByRole("status").first()).toContainText(
    "Saved to cloud",
  );
  assert.equal(
    remote.data.plan.days[0].exercises.find((p) => p.exerciseId === "incline")
      .min,
    9,
  );
  await page.getByRole("button", { name: "Today", exact: true }).click();
  offline = true;
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(page.getByRole("status").first()).toContainText(
    "Saved on this device",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Upper chest and push", exact: true }),
  ).toBeVisible();
  offline = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Saved to cloud",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  remote = {
    ...remote,
    revision: remote.revision + 1,
    data: {
      ...remote.data,
      plan: { ...remote.data.plan, name: "Other device plan" },
    },
  };
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Conflict:");
  const pending = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        "cboard:training:v1:11111111-1111-4111-8111-111111111111",
      ),
    ),
  );
  assert.equal(pending.dirty, true, "Conflict preserves pending local backup");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Resolve a cloud conflict", { exact: true }).click();
  await page
    .getByRole("button", { name: "Load cloud copy", exact: true })
    .click();
  await expect(page.getByRole("status").first()).toContainText(
    "Cloud copy loaded",
  );
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const peer = await context.newPage();
  await peer.clock.install({ time: new Date("2026-09-14T12:00:00") });
  await peer.goto("http://127.0.0.1:5178/cboard/training");
  await expect(
    peer.getByRole("heading", { name: "Upper chest and push", exact: true }),
  ).toBeVisible();
  await peer.getByLabel("Energy · 5/10", { exact: true }).fill("8");
  await expect(peer.getByRole("status").first()).toContainText(
    "Saved to cloud",
  );
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("another tab");
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            "cboard:training:v1:11111111-1111-4111-8111-111111111111",
          ),
        ).data.checkins["2026-09-14"].energy,
    ),
    8,
  );
  await peer.close();
  await page
    .getByRole("combobox", { name: "Select app theme" })
    .selectOption("original");
  await page.getByRole("link", { name: "C Board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Training", exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(
    "PASS: Today → log / undo / timer → refresh → pause → finish → history → progress; next-morning check and confirmed progression; plan/library; backup validation; offline replay; cloud and multi-tab conflicts; mobile and both themes; existing board.",
  );
  console.log(`Screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  console.error((await page.locator("main").innerText()).slice(-5000));
  throw error;
} finally {
  await browser.close();
}
