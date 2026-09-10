import assert from "node:assert/strict";
import { query } from "./export-data.ts";
import type { SessionView, TrialAnswer } from "../shared/experiment.ts";
import { STUDY_VERSION, CONSENT_VERSION } from "../shared/study.ts";
const target = process.argv[2] ?? "local";
if (!["local", "demo"].includes(target)) throw new Error("Synthetic tests only in local/demo");
const base = target === "local" ? "http://127.0.0.1:5173" : "https://jspsych-demo-staging.jspsych-demo.workers.dev";
const id = crypto.randomUUID(); const token = "ab".repeat(32);
const payload = { session_id: id, study_version: STUDY_VERSION, consent_version: CONSENT_VERSION, consent: true };
async function request(path: string, method = "GET", data?: unknown, auth = token) {
  return fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
}
assert.equal((await request("/api/sessions", "POST", { ...payload, consent: false })).status, 400);
const creates = await Promise.all(Array.from({ length: 4 }, () => request("/api/sessions", "POST", payload)));
assert.equal(creates.filter(r => r.status === 201).length, 1);
assert.equal(creates.filter(r => r.status === 200).length, 3);
const views = await Promise.all(creates.map(r => r.json() as Promise<SessionView>));
for (const view of views) { assert.deepEqual(view.manifest, views[0].manifest); assert.equal(view.resumeExpiresAt, views[0].resumeExpiresAt); }
assert.equal(query(`SELECT COUNT(*) AS n FROM sessions WHERE session_id='${id}'`, target)[0].n, 1);
assert.equal((await request(`/api/sessions/${id}`, "GET", undefined, "cd".repeat(32))).status, 401);
assert.equal((await request(`/api/sessions/${crypto.randomUUID()}`, "GET")).status, 401);
const answers: TrialAnswer[] = views[0].manifest.trials.map(t => ({ trialId: t.trialId, understanding: 1, usefulness: 7, rtMs: 123, segmentId: crypto.randomUUID(), segmentStartedAt: new Date().toISOString(), resumeCount: 0, presentationAttempt: 1, clientAnsweredAt: new Date().toISOString() }));
const path = (a: TrialAnswer) => `/api/sessions/${id}/trials/${a.trialId}`;
assert.equal((await request(path(answers[0]), "PUT", { ...answers[0], understanding: 0 })).status, 400);
const puts = await Promise.all(Array.from({ length: 4 }, () => request(path(answers[0]), "PUT", answers[0])));
assert.equal(puts.filter(r => r.status === 201).length, 1); assert.equal(puts.filter(r => r.status === 200).length, 3);
assert.equal((await request(path(answers[0]), "PUT", { ...answers[0], usefulness: 1 })).status, 409);
for (const a of answers.slice(1, 3)) assert.equal((await request(path(a), "PUT", a)).status, 201);
assert.equal((await (await request(`/api/sessions/${id}`)).json() as SessionView).completedAt, null);
// Fault injection is confined to this synthetic session, never a public API switch.
if (target === "local") {
  query(`CREATE TRIGGER test_completion_failure BEFORE UPDATE OF completed_at ON sessions WHEN NEW.session_id='${id}' AND (SELECT COUNT(*) FROM trials WHERE session_id=NEW.session_id)=4 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`, target);
  try {
    assert.equal((await request(path(answers[3]), "PUT", answers[3])).status, 503);
    assert.equal(query(`SELECT COUNT(*) AS n FROM trials WHERE session_id='${id}'`, target)[0].n, 3);
  } finally { query("DROP TRIGGER test_completion_failure", target); }
}
assert.equal((await request(path(answers[3]), "PUT", answers[3])).status, 201);
const completed = await (await request(`/api/sessions/${id}`)).json() as SessionView;
assert.ok(completed.completedAt);
assert.equal((await request(path(answers[3]), "PUT", answers[3])).status, 200);
assert.equal((await (await request(`/api/sessions/${id}`)).json() as SessionView).completedAt, completed.completedAt);
assert.deepEqual(completed.answers, answers);
query(`UPDATE sessions SET resume_expires_at='${new Date().toISOString()}' WHERE session_id='${id}'`, target);
assert.equal((await request(`/api/sessions/${id}`)).status, 410);
assert.equal((await request(path(answers[3]), "PUT", answers[3])).status, 410);
assert.equal((await request(`/api/sessions/${id}`, "GET", undefined, "cd".repeat(32))).status, 401);
assert.equal(query(`SELECT completed_at FROM sessions WHERE session_id='${id}'`, target)[0].completed_at, completed.completedAt);
console.log(JSON.stringify({ target, syntheticSessionId: id, passed: ["concurrent create", "auth isolation", "strict ratings", "concurrent identical writes", "conflict immutable", "four-answer completion", ...(target === "local" ? ["transaction rollback"] : []), "completed retry stable", "expired access rejected"], at: new Date().toISOString() }));
