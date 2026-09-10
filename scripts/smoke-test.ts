import assert from "node:assert/strict";

const argument = process.argv[2];
if (!argument) throw new Error("Usage: npm run smoke -- <base-url>. This creates one synthetic DB row.");
const base = new URL(argument);
if (!/^https?:$/.test(base.protocol)) throw new Error("An HTTP(S) base URL is required.");

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(20_000) });
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body: unknown = await response.json();
  assert.ok(typeof body === "object" && body !== null && !Array.isArray(body));
  return { status: response.status, body: body as Record<string, unknown> };
}

const health = await request("/api/health");
assert.equal(health.status, 200);
assert.equal(health.body.database, "connected");
assert.equal((await request("/api/missing")).status, 404);
assert.equal((await request("/api/responses")).status, 405);

const answer = { id: crypto.randomUUID(), response: "hello", rtMs: 1234 };
const post = (value: unknown, extraHeaders = {}) => request("/api/responses", {
  method: "POST", headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(value),
});

assert.equal((await post({ ...answer, rtMs: -1 })).status, 400);
assert.equal((await post({ ...answer, response: "invalid" })).status, 400);
assert.equal((await post(answer, { Origin: "https://unrelated.invalid" })).status, 403);
assert.equal((await request("/api/responses", { method: "POST", body: "{}" })).status, 415);
assert.equal((await request("/api/responses", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
})).status, 400);
assert.equal((await post({ padding: "x".repeat(5000) })).status, 413);

const [first, duplicate] = await Promise.all([post(answer), post(answer)]);
assert.deepEqual([first.status, duplicate.status].sort(), [200, 201]);
assert.deepEqual(first.body, duplicate.body);
assert.equal(first.body.id, answer.id);
assert.equal(first.body.rtMs, 1234);
assert.ok(typeof first.body.savedAt === "string");
assert.ok(!Number.isNaN(Date.parse(first.body.savedAt)));
assert.equal((await post({ ...answer, rtMs: 5678 })).status, 409);
assert.deepEqual((await post(answer)).body, first.body);

console.log(JSON.stringify({ ok: true, base: base.origin, syntheticRowId: answer.id,
  checks: ["D1 connection", "API routing", "validation", "origin", "body limit", "concurrent retry", "conflict", "saved response"] }, null, 2));
