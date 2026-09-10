import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Manifest } from "../shared/study.ts";
export type Row = Record<string, string | number | null>;
export function query(sql: string, target: string): Row[] {
  if (!["local", "demo"].includes(target)) throw new Error("Explicit target required");
  const args = ["wrangler", "d1", "execute", "DB", ...(target === "local" ? ["--local"] : ["--remote", "--env", target]), "--command", sql, "--json"];
  const output = execFileSync("npx", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const result = JSON.parse(output) as { results: Row[]; success: boolean }[];
  if (!result.every(r => r.success)) throw new Error("D1 query failed");
  return result.flatMap(r => r.results);
}
export function csv(rows: Row[], columns: string[]) {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [columns.map(cell).join(","), ...rows.map(row => columns.map(c => cell(row[c])).join(","))].join("\r\n") + "\r\n";
}
const sessionColumns = ["session_id", "status", "schema_version", "study_version", "consent_version", "assigned_condition", "created_at", "resume_expires_at", "delete_after", "completed_at", "saved_trial_count"];
const trialColumns = ["session_id", "trial_id", "status", "schema_version", "study_version", "consent_version", "assigned_condition", "scene_id", "condition", "presentation_index", "understanding", "usefulness", "rt_ms", "segment_id", "segment_started_at", "resume_count", "presentation_attempt", "client_answered_at", "received_at", "created_at", "resume_expires_at", "delete_after", "completed_at", "situation", "prefix", "proposal", "understanding_question", "usefulness_question"];
export function exportData(target: string, output: string) {
  const at = new Date().toISOString();
  const status = `CASE WHEN s.completed_at IS NOT NULL THEN 'complete' WHEN s.resume_expires_at > '${at}' THEN 'uncompleted' ELSE 'expired-uncompleted' END AS status`;
  const sessions: Row[] = []; const trials: Row[] = [];
  let cursor = "";
  for (;;) {
    const page = query(`SELECT s.session_id,${status},s.schema_version,s.study_version,s.consent_version,s.assigned_condition,s.created_at,s.resume_expires_at,s.delete_after,s.completed_at,(SELECT COUNT(*) FROM trials t WHERE t.session_id=s.session_id) AS saved_trial_count FROM sessions s WHERE s.delete_after > '${at}' AND s.session_id > '${cursor}' ORDER BY s.session_id LIMIT 200`, target);
    sessions.push(...page); if (page.length < 200) break; cursor = String(page.at(-1)!.session_id);
  }
  cursor = "";
  for (;;) {
    const page = query(`SELECT s.session_id,t.trial_id,${status},s.schema_version,s.study_version,s.consent_version,s.assigned_condition,t.scene_id,t.condition,t.presentation_index,t.understanding,t.usefulness,t.rt_ms,t.segment_id,t.segment_started_at,t.resume_count,t.presentation_attempt,t.client_answered_at,t.received_at,s.created_at,s.resume_expires_at,s.delete_after,s.completed_at,s.manifest_json FROM trials t JOIN sessions s ON s.session_id=t.session_id WHERE s.delete_after > '${at}' AND (s.session_id || ':' || t.trial_id) > '${cursor}' ORDER BY s.session_id,t.trial_id LIMIT 200`, target);
    trials.push(...page); if (page.length < 200) break; cursor = `${page.at(-1)!.session_id}:${page.at(-1)!.trial_id}`;
  }
  const counts = query(`SELECT (SELECT COUNT(*) FROM sessions WHERE delete_after > '${at}') AS sessions, (SELECT COUNT(*) FROM trials t JOIN sessions s ON s.session_id=t.session_id WHERE s.delete_after > '${at}') AS trials`, target)[0];
  if (counts.sessions !== sessions.length || counts.trials !== trials.length) throw new Error("Export count changed or rows missing; retry with collection paused");
  for (const row of trials) {
    const manifest = JSON.parse(String(row.manifest_json)) as Manifest;
    const trial = manifest.trials.find(t => t.trialId === row.trial_id);
    if (!trial) throw new Error("Manifest membership mismatch");
    Object.assign(row, { situation: trial.situation, prefix: trial.prefix, proposal: trial.proposal, understanding_question: manifest.questions[0], usefulness_question: manifest.questions[1] });
    delete row.manifest_json;
  }
  const completed = trials.filter(t => t.status === "complete");
  const incomplete = trials.filter(t => t.status !== "complete");
  const base = resolve(output.replace(/\.csv$/i, "")); mkdirSync(dirname(base), { recursive: true });
  for (const [suffix, data] of [["completed-trials.csv", csv(completed, trialColumns)], ["incomplete-trials.csv", csv(incomplete, trialColumns)], ["sessions.csv", csv(sessions, sessionColumns)], ["metadata.json", JSON.stringify({ extractedAt: at, target, filter: "delete_after strictly after extraction time; split by completed_at", schemaVersions: [...new Set(sessions.map(s => s.schema_version))], sessionCount: sessions.length, completedTrialCount: completed.length, incompleteTrialCount: incomplete.length, snapshot: "fixed cutoff; not transactional during active writes" }, null, 2)]] as const) writeFileSync(`${base}.${suffix}`, data, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ target, sessionCount: sessions.length, completedTrialCount: completed.length, incompleteTrialCount: incomplete.length, base }));
  return { sessions, trials: completed, incomplete };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const target = args[args.indexOf("--target") + 1]; const output = args[args.indexOf("--output") + 1];
  if (args.length !== 4 || !args.includes("--target") || !args.includes("--output") || !output) throw new Error("Usage: --target local|demo --output exports/name");
  exportData(target, output);
}
