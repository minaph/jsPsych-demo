import type { Manifest } from "./study.ts";
export interface TrialAnswer {
  trialId: string; understanding: number; usefulness: number; rtMs: number;
  segmentId: string; segmentStartedAt: string; resumeCount: number;
  presentationAttempt: number; clientAnsweredAt: string;
}
export interface SessionView {
  sessionId: string; manifest: Manifest; createdAt: string; resumeExpiresAt: string;
  deleteAfter: string; completedAt: string | null; serverTime: string; answers: TrialAnswer[];
}
export interface StudyConfig { studyVersion: string; consentVersion: string; collectionEnabled: boolean; testOnly: boolean; serverTime: string }
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function object(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
export function exact(v: Record<string, unknown>, keys: readonly string[]) { return Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)); }
const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const answerKeys = ["trialId", "understanding", "usefulness", "rtMs", "segmentId", "segmentStartedAt", "resumeCount", "presentationAttempt", "clientAnsweredAt"] as const;
export function isTrialAnswer(v: unknown): v is TrialAnswer {
  return object(v) && exact(v, answerKeys) && typeof v.trialId === "string" && /^S0[1-4]$/.test(v.trialId)
    && integer(v.understanding, 1, 7) && integer(v.usefulness, 1, 7) && integer(v.rtMs, 0, 86_400_000)
    && uuid(v.segmentId) && date(v.segmentStartedAt) && date(v.clientAnsweredAt)
    && integer(v.resumeCount, 0, 100_000) && integer(v.presentationAttempt, 1, 100_000);
}
export function canonical(answer: TrialAnswer): string { return JSON.stringify(answerKeys.map(key => answer[key])); }
