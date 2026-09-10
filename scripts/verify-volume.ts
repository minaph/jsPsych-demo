import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { exportData, query } from "./export-data.ts";
import { makeManifest, STUDY_VERSION, CONSENT_VERSION } from "../shared/study.ts";
const target = "local";
const dir = mkdtempSync(join(tmpdir(), "jspsych-volume-"));
const now = new Date().toISOString(); const future = new Date(Date.now() + 86400000).toISOString(); const deletion = new Date(Date.now() + 30 * 86400000).toISOString();
const quote = (value: unknown) => value === null ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;
const prefix = `volume-${crypto.randomUUID()}-`;
let sql = ""; const ids: string[] = [];
for (let i = 0; i < 507; i++) {
  const id = `${prefix}${String(i).padStart(3,"0")}`; ids.push(id); const manifest = makeManifest(() => i % 2 ? 0.75 : 0.25);
  const complete = i < 500; const count = complete ? 4 : i === 505 ? 4 : i === 506 ? 1 : i === 504 ? 2 : i - 500;
  const expired = i === 504; const retained = i < 505;
  sql += `INSERT INTO sessions VALUES(${[id,"synthetic-not-authenticatable",1,STUDY_VERSION,CONSENT_VERSION,manifest.assignedCondition,JSON.stringify(manifest),now,expired ? now : future,retained ? deletion : now,complete || i === 505 ? now : null].map(quote).join(",")});\n`;
  for (const t of manifest.trials.slice(0, count)) sql += `INSERT INTO trials VALUES(${[id,t.trialId,t.sceneId,t.condition,t.presentationIndex,1,7,123,crypto.randomUUID(),now,0,1,now,now,"synthetic"].map(quote).join(",")});\n`;
}
const fixture = join(dir, "fixture.sql"); writeFileSync(fixture, sql);
execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--file", fixture, "--json"], { stdio: "pipe", maxBuffer: 16 * 1024 * 1024 });
const result = exportData(target, join(dir,"complete"));
const s = result.sessions.filter(r => String(r.session_id).startsWith(prefix)); const t = result.trials.filter(r => String(r.session_id).startsWith(prefix));
assert.equal(s.length,505); assert.equal(t.length,2000); assert.equal(s.filter(r => r.status === "complete").length,500);
assert.equal(s.find(r => r.session_id === ids[500])!.saved_trial_count,0);
assert.equal(s.find(r => r.session_id === ids[504])!.status,"expired-uncompleted");
for (const row of t) { assert.equal(row.understanding,1); assert.equal(row.usefulness,7); assert.equal(row.condition,row.assigned_condition); }
assert.equal(result.incomplete.filter(r => String(r.session_id).startsWith(prefix)).length,8);
assert.ok(t.every(r => typeof r.situation === "string" && typeof r.understanding_question === "string"));
assert.ok(!Object.keys(t[0]).some(k => /token|hash/.test(k)));
// Test scheduled cascade, rollback on deletion failure, and subsequent retry against actual local D1.
query(`CREATE TRIGGER test_retention_failure BEFORE DELETE ON sessions WHEN OLD.session_id='${ids[505]}' BEGIN SELECT RAISE(ABORT,'synthetic retention failure'); END`,target);
try { await fetch("http://127.0.0.1:5173/cdn-cgi/local/scheduled?cron=17%20*%20*%20*%20*"); assert.equal(query(`SELECT COUNT(*) AS n FROM sessions WHERE session_id='${ids[505]}'`,target)[0].n,1); }
finally { query("DROP TRIGGER test_retention_failure",target); }
assert.ok((await fetch("http://127.0.0.1:5173/cdn-cgi/local/scheduled?cron=17%20*%20*%20*%20*")).ok);
assert.equal(query(`SELECT COUNT(*) AS n FROM trials WHERE session_id IN ('${ids[505]}','${ids[506]}')`,target)[0].n,0);
assert.ok(query("SELECT last_success_at FROM retention_runs",target)[0].last_success_at);
console.log(JSON.stringify({ passed: "500 completed sessions / 2000 trials, zero/partial/expired filters, deletion rollback/retry/cascade", fixturePrefix: prefix, evidence: dir, at: now }));
