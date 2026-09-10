import type { SessionView, StudyConfig, TrialAnswer } from "../shared/experiment";
import { canonical, isTrialAnswer, object, uuid } from "../shared/experiment";
import { CONSENT_VERSION, STUDY_VERSION } from "../shared/study";
export const STORAGE_KEY = "jspsych-demo:session:v1";
export const LOCK_KEY = "jspsych-demo:exclusive";
interface Progress {
  version: 1; id: string; token: string; session?: SessionView; answers: TrialAnswer[]; acknowledged: string[];
  attempts: Record<string, number>; resumeCount: number; taskStarted: boolean;
}
export type Stage = "loading" | "intro" | "resume" | "task" | "pending" | "complete" | "expired" | "terminal" | "blocked";
export interface State { stage: Stage; config?: StudyConfig; progress?: Progress; message: string; retry: boolean; busy: boolean; retryAt: number; tick: number }
class RequestError extends Error { constructor(public status: number, public waitMs = 0) { super("request_failed"); } }
export class SessionController {
  state: State = { stage: "loading", message: "", retry: false, busy: false, retryAt: 0, tick: 0 };
  private alive = true;
  private sending = false;
  private paused = false;
  private needsResumeCount = false;
  private segmentId = crypto.randomUUID();
  private segmentStartedAt = new Date().toISOString();
  private deadline = Infinity;
  private requests = new Set<AbortController>();
  private timer: ReturnType<typeof setInterval>;
  private operation: "config" | "create" | "resume" | "queue" = "config";
  constructor(private notify: (state: State) => void) {
    this.timer = setInterval(() => {
      if (performance.now() >= this.deadline) this.expire();
      else if (this.state.retryAt > 0) this.emit({ tick: this.state.tick + 1 });
    }, 500);
  }
  dispose() { this.alive = false; clearInterval(this.timer); for (const c of this.requests) c.abort(); }
  private emit(update: Partial<State>) { if (this.alive) { this.state = { ...this.state, ...update }; this.notify(this.state); } }
  private persist(progress: Progress) {
    if (!this.alive) throw new Error("disposed");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    this.state = { ...this.state, progress };
  }
  private clear() { localStorage.removeItem(STORAGE_KEY); this.state = { ...this.state, progress: undefined }; this.deadline = Infinity; }
  private expire() {
    for (const c of this.requests) c.abort(); this.paused = true;
    try { this.clear(); this.emit({ stage: "expired", retry: false, busy: false, message: "再開・送信の期限を過ぎたため、この端末の進捗を消去しました。保存済みデータは開始から30日間保持されます。保存の成否はここでは確認できません。" }); }
    catch { this.emit({ stage: "terminal", retry: false, message: "期限を過ぎました。ブラウザー設定からこのサイトの保存データを消去してください。" }); }
  }
  private async request<T>(path: string, method = "GET", data?: unknown): Promise<T> {
    const controller = new AbortController(); this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const p = this.state.progress;
      const response = await fetch(path, { method, cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json", ...(p ? { Authorization: `Bearer ${p.token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      if (!response.ok) {
        const retry = response.headers.get("Retry-After"); let waitMs = 0;
        if (response.status === 429 && retry) {
          const seconds = /^\d+$/.test(retry) ? Number(retry) : NaN;
          waitMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry) - Date.parse(response.headers.get("Date") ?? new Date().toISOString()));
          if (!Number.isFinite(waitMs)) waitMs = 0;
        }
        throw new RequestError(response.status, waitMs);
      }
      const result = await response.json() as T;
      if (!this.alive) throw new Error("disposed");
      return result;
    } finally { clearTimeout(timer); this.requests.delete(controller); }
  }
  private failure(error: unknown) {
    if (!this.alive || this.state.stage === "expired") return;
    this.paused = true;
    if (error instanceof RequestError && error.status === 410) { this.expire(); return; }
    if (error instanceof RequestError && [400, 401, 403, 409].includes(error.status)) {
      const message = error.status === 403 ? "現在、新しい回答の受付を停止しています。" : error.status === 409 ? "保存済みの回答と一致しないため停止しました。上書きは行いません。検証担当者へご連絡ください。" : "進捗を安全に確認できないため停止しました。検証担当者へご連絡ください。";
      this.emit({ stage: "terminal", message, retry: false, busy: false }); return;
    }
    this.emit({ message: "保存・接続を確認できませんでした。接続をご確認のうえ、手動で再送してください。回答済みの内容はこの端末に保持しています。", retry: true, busy: false, retryAt: performance.now() + (error instanceof RequestError ? error.waitMs : 0) });
  }
  async init() {
    try {
      localStorage.setItem(`${STORAGE_KEY}:probe`, "1"); localStorage.removeItem(`${STORAGE_KEY}:probe`);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p: unknown = JSON.parse(raw);
        if (!object(p) || p.version !== 1 || !uuid(p.id) || typeof p.token !== "string" || !/^[0-9a-f]{64}$/.test(p.token) || !Array.isArray(p.answers) || !p.answers.every(isTrialAnswer) || !Array.isArray(p.acknowledged) || !object(p.attempts) || !Number.isInteger(p.resumeCount)) throw new Error("invalid_storage");
        this.state = { ...this.state, progress: p as unknown as Progress };
      }
    } catch { this.emit({ stage: "terminal", message: "端末の保存領域を利用できないか、進捗が破損しています。ブラウザー設定を確認してください。", retry: false }); return; }
    await this.config();
  }
  private async config() {
    this.operation = "config"; this.emit({ busy: true, retry: false });
    try {
      const config = await this.request<StudyConfig>("/api/config"); const p = this.state.progress;
      if (p?.session && config.serverTime >= p.session.resumeExpiresAt) { this.expire(); return; }
      if (p?.session) this.deadline = performance.now() + Date.parse(p.session.resumeExpiresAt) - Date.parse(config.serverTime);
      this.emit({ config, stage: p ? "resume" : "intro", message: "", busy: false });
    } catch (e) { this.failure(e); }
  }
  async start() {
    if (this.state.busy || this.state.stage !== "intro" || !this.state.config?.collectionEnabled) return;
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
      this.persist({ version: 1, id: crypto.randomUUID(), token, answers: [], acknowledged: [], attempts: {}, resumeCount: 0, taskStarted: false });
    } catch { this.emit({ message: "端末に進捗を保存できません。保存環境を確認してください。開始要求は送信していません。" }); return; }
    await this.create();
  }
  private async create() {
    this.operation = "create"; this.emit({ busy: true, retry: false });
    try {
      const p = this.state.progress!;
      const session = await this.request<SessionView>("/api/sessions", "POST", { session_id: p.id, study_version: STUDY_VERSION, consent_version: CONSENT_VERSION, consent: true });
      this.persist({ ...p, session }); this.syncDeadline(session); this.present();
    } catch (e) { this.failure(e); }
    finally { this.emit({ busy: false }); }
  }
  private syncDeadline(session: SessionView) { this.deadline = Math.min(this.deadline, performance.now() + Date.parse(session.resumeExpiresAt) - Date.parse(session.serverTime)); }
  async resume() {
    if (this.state.busy) return;
    if (!this.state.progress?.session) { await this.create(); return; }
    this.operation = "resume"; this.emit({ busy: true, retry: false });
    try {
      const p = this.state.progress;
      const session = await this.request<SessionView>(`/api/sessions/${p.id}`);
      if (JSON.stringify(session.manifest) !== JSON.stringify(p.session!.manifest)) throw new RequestError(409);
      this.syncDeadline(session);
      for (const answer of session.answers) {
        const local = p.answers.find(a => a.trialId === answer.trialId);
        if (local && canonical(local) !== canonical(answer)) throw new RequestError(409);
      }
      if (session.completedAt) { this.complete(); return; }
      const answers = [...p.answers, ...session.answers.filter(a => !p.answers.some(b => b.trialId === a.trialId))];
      this.persist({ ...p, session, answers, acknowledged: session.answers.map(a => a.trialId) });
      this.needsResumeCount = p.taskStarted && answers.length < 4;
      if (answers.length > session.answers.length) {
        this.paused = true; this.operation = "queue";
        this.emit({ stage: "pending", message: "未送信の回答があります。同じ回答を再送してから課題を再開します。", retry: true, busy: false });
      } else this.present();
    } catch (e) { this.failure(e); }
    finally { this.emit({ busy: false }); }
  }
  private present() {
    const p = this.state.progress!;
    const trial = p.session!.manifest.trials.find(t => !p.answers.some(a => a.trialId === t.trialId));
    if (!trial) { this.emit({ stage: "pending", busy: false }); return; }
    try {
      this.persist({ ...p, taskStarted: true, resumeCount: p.resumeCount + (this.needsResumeCount ? 1 : 0), attempts: { ...p.attempts, [trial.trialId]: (p.attempts[trial.trialId] ?? 0) + 1 } });
      this.needsResumeCount = false;
      this.emit({ stage: "task", busy: false, ...(this.paused ? {} : { message: "", retry: false }) });
    } catch { this.emit({ stage: "terminal", message: "提示開始を端末に保存できません。保存領域を確認後、ページを再読み込みして再開してください。", retry: false }); }
  }
  confirm = (understanding: number, usefulness: number, rtMs: number): boolean => {
    if (this.state.stage !== "task" || performance.now() >= this.deadline) { if (performance.now() >= this.deadline) this.expire(); return false; }
    const p = this.state.progress!;
    const trial = p.session!.manifest.trials.find(t => !p.answers.some(a => a.trialId === t.trialId))!;
    const answer: TrialAnswer = { trialId: trial.trialId, understanding, usefulness, rtMs, segmentId: this.segmentId, segmentStartedAt: this.segmentStartedAt, resumeCount: p.resumeCount, presentationAttempt: p.attempts[trial.trialId], clientAnsweredAt: new Date().toISOString() };
    try { this.persist({ ...p, answers: [...p.answers, answer] }); return true; }
    catch { this.emit({ message: "回答を端末に保存できませんでした。入力は残っています。ブラウザーの保存環境を確認し、もう一度回答を確定してください。" }); return false; }
  };
  advance = () => { this.emit({ stage: "pending", message: "" }); if (!this.paused) void this.send(); };
  trialError = () => this.emit({ stage: "terminal", retry: false, message: "課題画面を表示できませんでした。ページを再読み込みして再開してください。" });
  private complete() {
    try { this.clear(); this.emit({ stage: "complete", message: "", retry: false, busy: false }); }
    catch { this.emit({ stage: "terminal", message: "サーバーへの保存は完了しましたが、端末の進捗を消去できません。ブラウザー設定からこのサイトの保存データを消去してください。", retry: false }); }
  }
  private async send() {
    if (this.sending || !this.alive || performance.now() >= this.deadline) return;
    this.sending = true; this.operation = "queue";
    try {
      if (this.alive && !this.paused && this.state.progress) {
        const p = this.state.progress; const answer = p.answers.find(a => !p.acknowledged.includes(a.trialId));
        if (!answer) { this.present(); return; }
        const result = await this.request<{ trialId: string; completedAt: string | null }>(`/api/sessions/${p.id}/trials/${answer.trialId}`, "PUT", answer);
        if (result.trialId !== answer.trialId) throw new RequestError(409);
        if (result.completedAt) { this.complete(); return; }
        const current = this.state.progress!;
        this.persist({ ...current, acknowledged: [...current.acknowledged, answer.trialId] });
        this.present();
      }
    } catch (e) { this.failure(e); }
    finally { this.sending = false; this.emit({ busy: false }); }
  }
  async retry() {
    if (this.state.busy || this.sending || !this.state.retry || performance.now() < this.state.retryAt) return;
    this.emit({ retry: false, message: "", retryAt: 0 }); this.paused = false;
    if (this.operation === "config") await this.config();
    else if (this.operation === "create") await this.create();
    else if (this.operation === "resume") await this.resume();
    else { this.emit({ busy: true }); await this.send(); }
  }
  reset() {
    if (this.sending || this.state.busy) return;
    try { this.clear(); this.paused = false; this.needsResumeCount = false; this.emit({ stage: "intro", message: "", retry: false }); }
    catch { this.emit({ message: "端末の進捗を消去できません。ブラウザー設定をご確認ください。" }); }
  }
}
