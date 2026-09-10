import { useEffect, useRef, useState } from "react";
import { LOCK_KEY, SessionController } from "./session";
import type { State } from "./session";
import { StudyTrial } from "./StudyTrial";
export function App() {
  const [state, setState] = useState<State>({ stage: "loading", message: "", retry: false, busy: false, retryAt: 0, tick: 0 });
  const [consent, setConsent] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const controller = useRef<SessionController | null>(null);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    let disposed = false; let release: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!navigator.locks || !crypto?.randomUUID || !crypto.subtle || !window.isSecureContext) {
        setState(s => ({ ...s, stage: "blocked", message: "この環境では実験を開始できません。PCのChromeを通常ウィンドウで開いてください。" })); return;
      }
      void navigator.locks.request(LOCK_KEY, { ifAvailable: true }, async lock => {
        if (disposed) return;
        if (!lock) { setState(s => ({ ...s, stage: "blocked", message: "別のタブでこのサイトを使用中です。そのタブを閉じてから、このページを再読み込みしてください。" })); return; }
        const session = new SessionController(setState); controller.current = session;
        const held = new Promise<void>(resolve => { release = resolve; });
        void session.init(); await held; session.dispose();
      }).catch(() => { if (!disposed) setState(s => ({ ...s, stage: "blocked", message: "ブラウザーの排他機能を利用できません。PCのChromeで開き直してください。" })); });
    }, 0);
    return () => { disposed = true; clearTimeout(timer); controller.current?.dispose(); controller.current = null; release?.(); };
  }, []);
  const p = state.progress;
  const trial = p?.session?.manifest.trials.find(t => !p.answers.some(a => a.trialId === t.trialId));
  const small = width < 1024;
  return <div className="page">
    <header className="site-header"><span className="wordmark"><span className="brand-mark" aria-hidden="true" />ことばと、休日。</span><span className="edition">A MOMENT TO CONSIDER</span></header>
    <main>
      <section className="intro-heading"><p className="eyebrow">言葉の受けとめ方について</p><h1>ひとつの提案を、<br /><span>あなたの視点から。</span></h1></section>
      {state.config?.testOnly && <p className="test-notice">技術検証専用です。実参加者の募集は行っていません。検証担当者が合成回答を入力してください。</p>}
      <section className="trial-card" aria-label="実験">
        {small && <p className="inline-error" role="alert">読みやすく操作するため、PCの広い画面でのご利用をおすすめします。</p>}
        <div>
          {state.stage === "intro" && <div className="card-content consent-content">
            <h2>はじめにお読みください</h2>
            <p>4つの場面を自分の状況として想像し、あらかじめ作成された提案を2つの項目で評価します。目安は約5分です（所要時間は未検証）。その場でAIや人が応答するものではありません。</p>
            <p>氏名や連絡先は入力しません。ランダムな参加ID、回答、所要時間、中断・再提示の情報を保存します。回答と再開情報はこのブラウザーにも保持します。</p>
            <p>開始から24時間以内は同じブラウザーで再開・送信できます。期限後は完了確認もできません。サーバーのデータは開始から30日後に取得対象外となり、毎時の処理で削除します。バックアップや取得したCSVは別途管理されます。</p>
            <p>途中でページを閉じて中止できます。保存済みの回答は保持期限まで残ります。ホスティング基盤にアクセスログが残る可能性があります。</p>
            {state.config?.collectionEnabled ? <><p>各場面で、2項目とも1「まったくそう思わない」から7「とてもそう思う」を選び、回答を確定してください。</p><label className="consent-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />説明を読み、技術検証用の回答を保存することに同意します。</label><button className="primary-button" disabled={!consent || state.busy || !!p} onClick={() => void controller.current?.start()}>同意して始める</button></> : <p role="status">現在は受付を停止しています。研究責任者・問い合わせ先・参加条件・説明同意文などの準備完了後に受付を検討します。</p>}
          </div>}
          {state.stage === "resume" && <div className="card-content"><h2>この端末に進捗が残っています</h2><p>ご自身の進捗であることを確認してから再開してください。</p><button className="primary-button" disabled={state.busy || state.retry} onClick={() => void controller.current?.resume()}>続きから再開する</button><button className="text-button" disabled={state.busy} onClick={() => { if (window.confirm("この端末の進捗を消去します。未送信の回答は失われます。サーバーに保存済みの回答は削除されません。よろしいですか？")) controller.current?.reset(); }}>この端末の進捗を消す</button></div>}
          {state.stage === "task" && trial && controller.current && <StudyTrial key={trial.trialId} trial={trial} questions={p!.session!.manifest.questions} confirm={controller.current.confirm} advance={controller.current.advance} onError={controller.current.trialError} />}
          {state.stage === "pending" && <div className="card-content"><h2>回答の保存を確認しています</h2><p>まだ完了ではありません。保存確認まで、このページを開いてお待ちください。</p></div>}
          {state.stage === "complete" && <div className="card-content" role="status"><h2>ご協力ありがとうございました</h2><p>すべての回答を保存しました。このページを閉じていただけます。</p></div>}
          {state.stage === "loading" && <div className="card-content" role="status">開始の準備をしています。</div>}
          {state.message && <div className="notice" role="alert"><p>{state.message}</p></div>}
          {state.retry && <div className="retry"><button className="secondary-button" disabled={state.busy || performance.now() < state.retryAt} onClick={() => void controller.current?.retry()}>接続を確認して再送する</button>{performance.now() < state.retryAt && <p>時間をおいてから再送できます。</p>}</div>}
        </div>
      </section>
      <p className="data-note">PCのChromeでの利用を想定しています。同じブラウザーから24時間以内に再開できます。</p>
    </main>
    <footer><span>ことばと、休日。</span><span>4つの場面を想像する</span></footer>
  </div>;
}
