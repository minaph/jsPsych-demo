import { useEffect, useRef } from "react";
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";

interface Props {
  onAnswer: (rtMs: number) => void;
  onError: () => void;
}

export function HelloTrial({ onAnswer, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = document.createElement("div");
    host.current!.append(container);
    let active = true;
    let experiment: ReturnType<typeof initJsPsych> | undefined;

    // Defer initialization so StrictMode can clean up its first setup before a trial starts.
    const timer = window.setTimeout(() => {
      experiment = initJsPsych({
        display_element: container,
        on_finish: () => {
          if (!active || !experiment) return;
          const result = experiment.data.get().last(1).values()[0];
          if (result?.response !== 0 || typeof result.rt !== "number" || !Number.isFinite(result.rt)) {
            onError();
            return;
          }
          onAnswer(Math.round(result.rt));
        },
      });
      void experiment.run([{
        type: htmlButtonResponse,
        stimulus: '<p class="eyebrow">YOUR FIRST TRIAL</p><h2 class="trial-title">Hello, world.</h2><p class="trial-copy">準備ができたら、下のボタンで<br class="mobile-break" />あいさつを返してください。</p>',
        choices: ["こんにちは"],
      }]).catch(() => { if (active) onError(); });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      experiment?.abortExperiment("");
      container.remove();
    };
  }, [onAnswer, onError]);

  return <div className="experiment-host" ref={host} />;
}
