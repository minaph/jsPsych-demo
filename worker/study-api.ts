import { CONSENT_VERSION, DAY_MS, makeManifest, SCHEMA_VERSION, STUDY_VERSION } from "../shared/study.ts";
import type { Manifest } from "../shared/study.ts";
import { canonical, exact, isTrialAnswer, object, uuid } from "../shared/experiment.ts";
import type { TrialAnswer } from "../shared/experiment.ts";
export interface StudyEnv { DB: D1Database; COLLECTION_ENABLED?: string; TEST_ONLY?: string }
interface SessionRow { session_id: string; token_hash: string; manifest_json: string; created_at: string; resume_expires_at: string; delete_after: string; completed_at: string | null }
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join(""); }
async function body(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw new ApiError(400, "json_required");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_json");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new ApiError(400, "body_too_large"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, "invalid_json"); }
}
const answerSelect = `SELECT trial_id AS trialId, understanding, usefulness, rt_ms AS rtMs, segment_id AS segmentId, segment_started_at AS segmentStartedAt, resume_count AS resumeCount, presentation_attempt AS presentationAttempt, client_answered_at AS clientAnsweredAt FROM trials WHERE session_id = ? ORDER BY presentation_index`;
async function view(db: D1Database, row: SessionRow, now: string) {
  return { sessionId: row.session_id, manifest: JSON.parse(row.manifest_json), createdAt: row.created_at, resumeExpiresAt: row.resume_expires_at, deleteAfter: row.delete_after, completedAt: row.completed_at, serverTime: now, answers: (await db.prepare(answerSelect).bind(row.session_id).all<TrialAnswer>()).results };
}
export async function studyApi(request: Request, env: StudyEnv, clock: () => Date = () => new Date()): Promise<Response> {
  try {
    const url = new URL(request.url); const now = clock().toISOString();
    if (url.pathname === "/api/config" && request.method === "GET") return json({ studyVersion: STUDY_VERSION, consentVersion: CONSENT_VERSION, collectionEnabled: env.COLLECTION_ENABLED === "true", testOnly: env.TEST_ONLY === "true", serverTime: now });
    const create = url.pathname === "/api/sessions" && request.method === "POST";
    const match = /^\/api\/sessions\/([^/]+)(?:\/trials\/(S0[1-4]))?$/.exec(url.pathname);
    if (!create && !(match && (match[2] ? request.method === "PUT" : request.method === "GET"))) return json({ error: "not_found" }, 404);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) throw new ApiError(403, "origin_not_allowed");
    const token = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("Authorization") ?? "")?.[1];
    if (!token) throw new ApiError(401, "unauthorized");
    const tokenHash = await hash(token);
    const input = create ? await body(request, 4096) : null;
    if (create && (!object(input) || !exact(input, ["session_id", "study_version", "consent_version", "consent"]) || !uuid(input.session_id) || input.study_version !== STUDY_VERSION || input.consent_version !== CONSENT_VERSION || input.consent !== true)) throw new ApiError(400, "invalid_session");
    const id = create ? (input as Record<string, string>).session_id : match![1];
    if (!uuid(id)) throw new ApiError(401, "unauthorized");
    let row = await env.DB.prepare("SELECT * FROM sessions WHERE session_id = ?").bind(id).first<SessionRow>();
    let created = false;
    if (create && !row) {
      if (env.COLLECTION_ENABLED !== "true") throw new ApiError(403, "collection_closed");
      const manifest = makeManifest();
      const inserted = await env.DB.prepare(`INSERT INTO sessions (session_id,token_hash,schema_version,study_version,consent_version,assigned_condition,manifest_json,created_at,resume_expires_at,delete_after) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO NOTHING`).bind(id, tokenHash, SCHEMA_VERSION, STUDY_VERSION, CONSENT_VERSION, manifest.assignedCondition, JSON.stringify(manifest), now, new Date(Date.parse(now) + DAY_MS).toISOString(), new Date(Date.parse(now) + 30 * DAY_MS).toISOString()).run();
      created = inserted.meta.changes > 0;
      row = await env.DB.prepare("SELECT * FROM sessions WHERE session_id = ?").bind(id).first<SessionRow>();
    }
    if (!row || row.token_hash !== tokenHash) throw new ApiError(401, "unauthorized");
    if (now >= row.resume_expires_at || now >= row.delete_after) throw new ApiError(410, "expired");
    if (create || request.method === "GET") return json(await view(env.DB, row, now), created ? 201 : 200);
    const answer = await body(request, 8192);
    if (!isTrialAnswer(answer) || answer.trialId !== match![2]) throw new ApiError(400, "invalid_answer");
    const manifest = JSON.parse(row.manifest_json) as Manifest;
    const trial = manifest.trials.find(t => t.trialId === answer.trialId);
    if (!trial || trial.condition !== manifest.assignedCondition) throw new ApiError(400, "invalid_trial");
    const payloadHash = await hash(canonical(answer));
    // D1 batch is transactional: a failed completion update also rolls back the fourth insert.
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO trials (session_id,trial_id,scene_id,condition,presentation_index,understanding,usefulness,rt_ms,segment_id,segment_started_at,resume_count,presentation_attempt,client_answered_at,received_at,payload_hash) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = ? AND resume_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND delete_after > strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(session_id,trial_id) DO NOTHING`).bind(id, answer.trialId, trial.sceneId, trial.condition, trial.presentationIndex, answer.understanding, answer.usefulness, answer.rtMs, answer.segmentId, answer.segmentStartedAt, answer.resumeCount, answer.presentationAttempt, answer.clientAnsweredAt, now, payloadHash, id),
      env.DB.prepare(`UPDATE sessions SET completed_at = COALESCE(completed_at, ?) WHERE session_id = ? AND (SELECT COUNT(*) FROM trials WHERE session_id = ?) = 4`).bind(now, id, id),
      env.DB.prepare("SELECT payload_hash FROM trials WHERE session_id = ? AND trial_id = ?").bind(id, answer.trialId),
      env.DB.prepare("SELECT completed_at, resume_expires_at FROM sessions WHERE session_id = ?").bind(id),
    ]);
    const saved = results[2].results[0] as { payload_hash: string } | undefined;
    if (!saved) throw new ApiError(410, "expired");
    if (saved.payload_hash !== payloadHash) throw new ApiError(409, "answer_conflict");
    return json({ trialId: answer.trialId, completedAt: (results[3].results[0] as { completed_at: string | null }).completed_at, serverTime: now }, results[0].meta.changes > 0 ? 201 : 200);
  } catch (error) {
    return error instanceof ApiError ? json({ error: error.message }, error.status) : json({ error: "temporarily_unavailable" }, 503);
  }
}
export async function retain(db: D1Database, now = new Date().toISOString()) {
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE delete_after <= ?").bind(now),
    db.prepare("INSERT INTO retention_runs(singleton,last_success_at,deleted_sessions) VALUES(1,?,changes()) ON CONFLICT(singleton) DO UPDATE SET last_success_at=excluded.last_success_at,deleted_sessions=excluded.deleted_sessions").bind(now),
  ]);
}
