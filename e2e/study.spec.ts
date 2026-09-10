import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const key = "jspsych-demo:session:v1";
async function start(page: Page) { await page.goto("/"); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "同意して始める" }).click(); await expect(page.getByText("場面 1 / 4", { exact: true })).toBeVisible(); }
async function answer(page: Page) { await page.locator('input[name="Q0"][value="0"]').check(); await page.locator('input[name="Q1"][value="6"]').check(); await page.getByRole("button", { name: "回答を確定する" }).click(); }
test("required scales, four answers, completion clears local data", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "回答を確定する" }).click();
  await expect(page.getByText("場面 1 / 4", { exact: true })).toBeVisible();
  await page.locator('input[name="Q0"][value="0"]').check();
  await page.getByRole("button", { name: "回答を確定する" }).click();
  await expect(page.getByText("場面 1 / 4", { exact: true })).toBeVisible();
  for (let i = 0; i < 4; i++) { await expect(page.getByText(`場面 ${i + 1} / 4`, { exact: true })).toBeVisible(); await answer(page); }
  await expect(page.getByRole("heading", { name: "ご協力ありがとうございました" })).toBeVisible();
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
});
test("manual retry only; save blocks next scene and final upload resume preserves metadata", async ({ page }) => {
  await start(page);
  for (let i = 0; i < 3; i++) await answer(page);
  await expect(page.getByText("場面 4 / 4", { exact: true })).toBeVisible(); let calls = 0;
  await page.route("**/api/sessions/*/trials/*", async route => { calls++; await route.fulfill({ status: 503, contentType: "application/json", body: '{}' }); });
  await answer(page); await expect(page.getByRole("button", { name: "接続を確認して再送する" })).toBeVisible();
  await expect(page.locator('input[type="radio"]')).toHaveCount(0);
  expect(calls).toBe(1);
  const before = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).answers, key);
  await page.unroute("**/api/sessions/*/trials/*"); await page.reload();
  await page.getByRole("button", { name: "続きから再開する" }).click();
  await expect(page.getByRole("button", { name: "接続を確認して再送する" })).toBeVisible();
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).answers, key)).toEqual(before);
  await page.getByRole("button", { name: "接続を確認して再送する" }).click();
  await expect(page.getByRole("heading", { name: "ご協力ありがとうございました" })).toBeVisible();
});
test("reload before first answer records task resume; second tab cannot mutate", async ({ page, context }) => {
  await start(page);
  const before = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  const other = await context.newPage(); await other.goto("/");
  await expect(other.getByText(/別のタブでこのサイトを使用中/)).toBeVisible();
  expect(await other.evaluate(k => JSON.parse(localStorage.getItem(k)!).id, key)).toBe(before.id);
  await other.close(); await page.reload();
  await page.getByRole("button", { name: "続きから再開する" }).click();
  await expect(page.getByText("場面 1 / 4", { exact: true })).toBeVisible();
  await answer(page);
  const after = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  expect(after.answers[0].resumeCount).toBe(1); expect(after.answers[0].presentationAttempt).toBe(2);
  expect(after.session.manifest).toEqual(before.session.manifest);
});
test("storage failure retains selected inputs and scene", async ({ page }) => {
  await start(page);
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as any).restoreStorage = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = () => { throw new Error("test quota"); }; });
  await answer(page); await expect(page.getByText(/回答を端末に保存できませんでした/)).toBeVisible();
  await expect(page.locator('input[name="Q0"][value="0"]')).toBeChecked();
  await expect(page.getByText("場面 1 / 4", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).restoreStorage()); await page.getByRole("button", { name: "回答を確定する" }).click();
  await expect(page.getByText("場面 2 / 4", { exact: true })).toBeVisible();
});
test("1024px keyboard-only task and small-screen advisory", async ({ page, browser }) => {
  console.log(`Browser: ${browser.version()}; OS: ${process.platform}; viewport: 1024x1000`);
  await page.setViewportSize({ width: 800, height: 900 }); await page.goto("/"); await expect(page.getByText(/PCの広い画面/)).toBeVisible(); await expect(page.getByRole("checkbox")).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  for (let i = 0; i < 4; i++) {
    await expect(page.getByText(`場面 ${i + 1} / 4`, { exact: true })).toBeVisible();
    await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { name: "ご協力ありがとうございました" })).toBeVisible();
});
test("failed resume respects Retry-After and resumes uploads through manual retry", async ({ page }) => {
  await start(page); await page.reload();
  let calls = 0;
  await page.route(/\/api\/sessions\/[^/]+$/, async route => { calls++; await route.fulfill({ status: 429, headers: { "Retry-After": "2" }, contentType: "application/json", body: '{}' }); });
  await page.getByRole("button", { name: "続きから再開する" }).click();
  await expect(page.getByRole("button", { name: "続きから再開する" })).toBeDisabled();
  const retry = page.getByRole("button", { name: "接続を確認して再送する" }); await expect(retry).toBeDisabled();
  await page.unroute(/\/api\/sessions\/[^/]+$/); await expect(retry).toBeEnabled(); expect(calls).toBe(1);
  await retry.click();
  for (let i = 0; i < 4; i++) await answer(page);
  await expect(page.getByRole("heading", { name: "ご協力ありがとうございました" })).toBeVisible();
});
test("15 second timeout does not resend until requested", async ({ page }) => {
  await start(page); let calls = 0;
  await page.route("**/api/sessions/*/trials/*", async () => { calls++; });
  const started = Date.now(); await answer(page);
  await expect(page.getByRole("button", { name: "接続を確認して再送する" })).toBeVisible({ timeout: 18000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(14500); expect(calls).toBe(1);
  await page.unroute("**/api/sessions/*/trials/*");
  await expect(page.locator('input[type="radio"]')).toHaveCount(0); expect(calls).toBe(1);
  await page.getByRole("button", { name: "接続を確認して再送する" }).click();
  for (let i = 1; i < 4; i++) await answer(page);
  await expect(page.getByRole("heading", { name: "ご協力ありがとうございました" })).toBeVisible();
});
test("lost create response reuses persisted credentials; lost final response reconciles", async ({ page }) => {
  await page.goto("/"); let id = "";
  await page.route("**/api/sessions", async route => { id = route.request().postDataJSON().session_id; await route.fetch(); await route.abort(); });
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "同意して始める" }).click();
  await expect(page.getByRole("button", { name: "接続を確認して再送する" })).toBeVisible();
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).id, key)).toBe(id);
  await page.unroute("**/api/sessions"); await page.reload(); await page.getByRole("button", { name: "続きから再開する" }).click();
  for (let i = 0; i < 3; i++) await answer(page);
  await expect(page.getByText("場面 4 / 4", { exact: true })).toBeVisible();
  await page.route("**/api/sessions/*/trials/*", async route => { await route.fetch(); await route.abort(); });
  await answer(page); await expect(page.getByRole("button", { name: "接続を確認して再送する" })).toBeVisible();
  await page.unroute("**/api/sessions/*/trials/*"); await page.reload(); await page.getByRole("button", { name: "続きから再開する" }).click();
  await expect(page.getByRole("heading", { name: "ご協力ありがとうございました" })).toBeVisible();
});
test("pending resume sends before presenting next scene; closed tab reopens same progress", async ({ page, context }) => {
  await start(page); await page.route("**/api/sessions/*/trials/*", route => route.abort());
  await answer(page); await expect(page.getByRole("button", { name: "接続を確認して再送する" })).toBeVisible();
  const before = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  await page.close(); const next = await context.newPage(); await next.goto("/"); await next.getByRole("button", { name: "続きから再開する" }).click();
  await expect(next.getByRole("button", { name: "接続を確認して再送する" })).toBeVisible();
  await expect(next.locator('input[type="radio"]')).toHaveCount(0);
  await next.getByRole("button", { name: "接続を確認して再送する" }).click();
  await expect(next.getByText("場面 2 / 4", { exact: true })).toBeVisible();
  const after = await next.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  expect(after.answers).toEqual(before.answers); expect(after.resumeCount).toBe(1);
});
test("storage failure before identity prevents creation; unsupported locks prevents start", async ({ page }) => {
  await page.goto("/"); let posts = 0; page.on("request", r => { if (r.method() === "POST") posts++; });
  await page.getByRole("checkbox").check();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("quota"); }; });
  await page.getByRole("button", { name: "同意して始める" }).click(); await expect(page.getByText(/開始要求は送信していません/)).toBeVisible(); expect(posts).toBe(0);
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
  await page.reload(); await expect(page.getByText(/この環境では実験を開始できません/)).toBeVisible(); await expect(page.getByRole("checkbox")).toHaveCount(0);
});
test("expiry uses server clock despite a changed client clock and clears local state", async ({ page }) => {
  await start(page); await page.reload();
  await page.route("**/api/config", async route => {
    const response = await route.fetch(); const config = await response.json();
    await route.fulfill({ json: { ...config, serverTime: "2099-01-01T00:00:00.000Z" } });
  });
  await page.addInitScript(() => { Date.now = () => 0; }); await page.reload();
  await expect(page.getByText(/再開・送信の期限を過ぎたため/)).toBeVisible(); expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
});
test("normal resume completes with server-confirmed values", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await start(page); await page.screenshot({ path: info.outputPath("task.png"), fullPage: true });
  await answer(page); await expect(page.getByText("場面 2 / 4", { exact: true })).toBeVisible();
  const progress = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  await page.reload(); await page.getByRole("button", { name: "続きから再開する" }).click();
  for (let i = 1; i < 4; i++) await answer(page);
  await expect(page.getByRole("heading", { name: "ご協力ありがとうございました" })).toBeVisible();
  const response = await page.request.get(`/api/sessions/${progress.id}`, { headers: { Authorization: `Bearer ${progress.token}` } });
  expect(response.status()).toBe(200); const session = await response.json();
  expect(session.completedAt).toBeTruthy(); expect(session.answers).toHaveLength(4);
  expect(session.answers.every((a: any) => a.understanding === 1 && a.usefulness === 7)).toBeTruthy();
  expect(session.manifest).toEqual(progress.session.manifest); expect(errors).toEqual([]);
  console.log(JSON.stringify({ sessionId: progress.id, completedAt: session.completedAt, answers: session.answers.length, browserErrors: errors.length }));
});
test("a fast client clock must not delete an unexpired session", async ({ page }) => {
  await start(page); const id = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).id, key);
  await page.addInitScript(() => { Date.now = () => 4_102_444_800_000; });
  await page.reload(); await page.getByRole("button", { name: "続きから再開する" }).click();
  await expect(page.getByText("場面 1 / 4", { exact: true })).toBeVisible();
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).id, key)).toBe(id);
});
test("active expiry stops inputs and clears local credentials", async ({ page }) => {
  await page.route("**/api/sessions", async route => {
    const response = await route.fetch(); const session = await response.json();
    await route.fulfill({ json: { ...session, resumeExpiresAt: new Date(Date.parse(session.serverTime) + 1500).toISOString() } });
  });
  await start(page); await expect(page.getByText(/再開・送信の期限を過ぎたため/)).toBeVisible();
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull(); await expect(page.locator('input[type="radio"]')).toHaveCount(0);
});
