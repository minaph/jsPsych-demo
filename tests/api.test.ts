/// <reference types="@cloudflare/workers-types" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { studyApi, retain } from "../worker/study-api.ts";
import type { StudyEnv } from "../worker/study-api.ts";
import type { SessionView } from "../shared/experiment.ts";
import { STUDY_VERSION, CONSENT_VERSION } from "../shared/study.ts";
test("isolated local D1: collection gate, exact access/retention boundaries, strict API", async () => {
  const proxy = await getPlatformProxy<StudyEnv>({ configPath: "wrangler.jsonc", persist: false, remoteBindings: false });
  try {
    const env = { ...proxy.env, COLLECTION_ENABLED: "true" };
    for (const statement of readFileSync("migrations/0002_study.sql", "utf8").split(";").filter(s => s.trim())) await env.DB.prepare(statement).run();
    const id = crypto.randomUUID(); const token = "ef".repeat(32);
    const create = { session_id: id, study_version: STUDY_VERSION, consent_version: CONSENT_VERSION, consent: true };
    const now = new Date();
    const call = (path: string, method = "GET", data?: unknown, options: { closed?: boolean; at?: Date; token?: string } = {}) => studyApi(new Request(`https://test.invalid${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.token ?? token}` }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), { ...env, COLLECTION_ENABLED: options.closed ? "false" : "true" }, () => options.at ?? now);
    assert.equal((await call("/api/sessions", "POST", create, { closed: true })).status, 403);
    for (const input of [{ ...create, consent: false }, { ...create, extra: true }, { ...create, study_version: "old" }, { ...create, consent_version: "old" }]) assert.equal((await call("/api/sessions", "POST", input)).status, 400);
    assert.equal((await call("/api/sessions", "POST", create)).status, 201);
    const repeated = await call("/api/sessions", "POST", create, { closed: true }); assert.equal(repeated.status, 200);
    const session = await repeated.json() as SessionView;
    const a = { trialId: session.manifest.trials[0].trialId, understanding: 1, usefulness: 7, rtMs: 123, segmentId: crypto.randomUUID(), segmentStartedAt: now.toISOString(), resumeCount: 0, presentationAttempt: 1, clientAnsweredAt: now.toISOString() };
    const path = `/api/sessions/${id}`;
    assert.equal((await call(`${path}/trials/${a.trialId}`, "PUT", a, { closed: true })).status, 201);
    assert.equal((await call(`${path}/trials/S99`, "PUT", { ...a, trialId: "S99" })).status, 404);
    assert.equal((await call(`${path}/trials/${a.trialId}`, "PUT", { ...a, extra: true })).status, 400);
    const cutoff = Date.parse(session.resumeExpiresAt);
    assert.equal((await call(path, "GET", undefined, { at: new Date(cutoff - 1) })).status, 200);
    for (const time of [cutoff, cutoff + 1]) {
      assert.equal((await call(path, "GET", undefined, { at: new Date(time) })).status, 410);
      assert.equal((await call(path, "GET", undefined, { at: new Date(time), token: "00".repeat(32) })).status, 401);
      assert.equal((await call(`${path}/trials/${a.trialId}`, "PUT", a, { at: new Date(time) })).status, 410);
    }
    const del = Date.parse(session.deleteAfter);
    for (const [time, expected] of [[del - 1, 1], [del, 0], [del + 1, 0]]) assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE delete_after > ?").bind(new Date(time).toISOString()).first<{ n: number }>())!.n, expected);
    await retain(env.DB, new Date(del - 1).toISOString()); assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM trials").first<{ n: number }>())!.n, 1);
    await retain(env.DB, new Date(del).toISOString()); assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM trials").first<{ n: number }>())!.n, 0);
    assert.ok((await env.DB.prepare("SELECT last_success_at FROM retention_runs").first())!.last_success_at);
    const missing = await call("/api/missing"); assert.equal(missing.status,404); assert.equal(missing.headers.get("Cache-Control"),"no-store"); assert.match(missing.headers.get("Content-Type")!,/json/);
  } finally { await proxy.dispose(); }
});
