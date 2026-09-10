import { useCallback, useEffect, useRef, useState } from "react";
import type { HelloAnswer, SavedAnswer } from "../shared/contracts";
import { HelloTrial } from "./HelloTrial";

type Stage = "intro" | "running" | "saving" | "complete" | "save-error" | "trial-error";
type Connection = "checking" | "ready" | "error";

export function App() {
  const [stage, setStage] = useState<Stage>("intro");
  const [connection, setConnection] = useState<Connection>("checking");
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [attemptId, setAttemptId] = useState("");
  const pending = useRef<HelloAnswer | null>(null);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setConnection("checking");
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void fetch("/api/health", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        const health = await response.json();
        if (health.ok !== true || health.database !== "connected") throw new Error("invalid_health");
        setConnection("ready");
      })
      .catch(() => { if (!disposed) setConnection("error"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [healthAttempt]);

  useEffect(() => {
    if (stage === "complete" || stage === "save-error" || stage === "trial-error") heading.current?.focus();
  }, [stage]);

  const save = useCallback(async (answer: HelloAnswer) => {
    if (submitting.current) return;
    submitting.current = true;
    setStage("saving");
    try {
      const response = await fetch("/api/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answer),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("save_failed");
      const saved = await response.json() as SavedAnswer;
      if (saved.id !== answer.id || saved.response !== answer.response || saved.rtMs !== answer.rtMs || !saved.savedAt) {
        throw new Error("invalid_confirmation");
      }
      pending.current = null;
      setStage("complete");
    } catch {
      setStage("save-error");
    } finally {
      submitting.current = false;
    }
  }, []);

  const onAnswer = useCallback((rtMs: number) => {
    const answer: HelloAnswer = { id: attemptId, response: "hello", rtMs };
    pending.current = answer;
    void save(answer);
  }, [attemptId, save]);

  const onTrialError = useCallback(() => setStage("trial-error"), []);

  function start() {
    pending.current = null;
    setAttemptId(crypto.randomUUID());
    setStage("running");
  }

  return (
    <div className="page">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="jsPsych demo ホーム"><span className="brand-mark" aria-hidden="true" />jsPsych demo</a>
        <span className="edition">HELLO WORLD / 001</span>
      </header>

      <main>
        <section className="intro-heading" aria-label="デモの紹介">
          <p className="eyebrow">A SMALL BEGINNING</p>
          <h1>ひとつの回答から、<br /><span>はじめよう。</span></h1>
          <p className="lead">ブラウザーで体験する、小さな実験。</p>
        </section>

        <section className="trial-card" aria-label="接続確認デモ" aria-busy={stage === "saving"}>
          <div className="card-topline">
            <span>01 <span className="topline-divider">/</span> FIRST CONTACT</span>
            <span className={`connection ${connection}`} role="status">
              <span aria-hidden="true" />
              {connection === "ready" ? "接続済み" : connection === "checking" ? "接続を確認中" : "接続できません"}
            </span>
          </div>

          {stage === "intro" && <div className="card-content">
            <span className="orbit" aria-hidden="true"><span /></span>
            <h2>まずは、あいさつを。</h2>
            <p>短い画面をひとつ体験して、<br />回答が届くことを確認するデモです。</p>
            <button className="primary-button" disabled={connection !== "ready"} onClick={start}>デモを始める <span aria-hidden="true">↗</span></button>
            <p className="duration">1試行 · 約15秒</p>
            {connection === "error" && <div className="inline-error" role="alert">
              <p>接続を確認できませんでした。</p>
              <button className="text-button" onClick={() => setHealthAttempt(n => n + 1)}>接続を再確認する</button>
            </div>}
          </div>}

          {stage === "running" && <HelloTrial onAnswer={onAnswer} onError={onTrialError} />}

          {stage === "saving" && <div className="card-content state-content" role="status">
            <span className="saving-indicator" aria-hidden="true" />
            <h2>回答を届けています。</h2>
            <p>保存が確認できるまで、<br />このページを開いたままお待ちください。</p>
          </div>}

          {stage === "complete" && <div className="card-content state-content">
            <span className="success-mark" aria-hidden="true">✓</span>
            <h2 tabIndex={-1} ref={heading}>回答を保存しました。</h2>
            <p>ご協力ありがとうございました。<br />このページを閉じていただけます。</p>
            <button className="secondary-button" onClick={() => setStage("intro")}>もう一度試す</button>
          </div>}

          {stage === "save-error" && <div className="card-content state-content">
            <h2 tabIndex={-1} ref={heading}>保存を確認できませんでした。</h2>
            <p>回答はこのページに残っています。<br />接続をご確認のうえ、もう一度お送りください。</p>
            <button className="primary-button" onClick={() => { if (pending.current) void save(pending.current); }}>同じ回答を再送する</button>
            <p className="duration">再読み込みやページを閉じる操作はお待ちください。</p>
          </div>}

          {stage === "trial-error" && <div className="card-content state-content">
            <h2 tabIndex={-1} ref={heading}>デモを開始できませんでした。</h2>
            <p>もう一度、最初からお試しください。</p>
            <button className="secondary-button" onClick={() => setStage("intro")}>開始画面へ戻る</button>
          </div>}
        </section>

        <p className="data-note">接続確認用のデモです。開始すると、ボタンの回答と反応時間をランダムIDとともに保存します。<br className="desktop-break" />氏名などの入力はありません。データは30日経過後に削除されます。</p>
      </main>

      <footer><span>React + jsPsych</span><span>Cloudflare Workers + D1</span></footer>
    </div>
  );
}
