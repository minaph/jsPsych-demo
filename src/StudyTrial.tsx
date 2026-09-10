import { useEffect, useRef } from "react";
import { initJsPsych } from "jspsych";
import surveyLikert from "@jspsych/plugin-survey-likert";
import type { Trial } from "../shared/study";
interface Props { trial: Trial; questions: readonly string[]; confirm: (u: number, v: number, rt: number) => boolean; advance: () => void; onError: () => void }
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function StudyTrial({ trial, questions, confirm, advance, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = document.createElement("div"); host.current!.append(container);
    let active = true; let startedAt = 0; let confirmed = false;
    let experiment: ReturnType<typeof initJsPsych> | undefined;
    // Persist before the plugin consumes the form; failed storage leaves every input intact.
    const submit = (event: Event) => {
      const form = event.target as HTMLFormElement;
      if (!form.checkValidity()) return;
      const values = new FormData(form);
      if (confirmed || !confirm(Number(values.get("Q0")) + 1, Number(values.get("Q1")) + 1, Math.round(performance.now() - startedAt))) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      confirmed = true;
    };
    container.addEventListener("submit", submit, true);
    const timer = setTimeout(() => {
      experiment = initJsPsych({ display_element: container, on_finish: () => { if (active && confirmed) advance(); } });
      void experiment.run([{
        type: surveyLikert,
        preamble: `<p class="eyebrow">場面 ${trial.presentationIndex} / 4</p><h2 tabindex="-1">この状況を想像してください</h2><p class="situation">${escape(trial.situation)} あなたがこの状況にいると想像して、次の提案を読んでください。</p><blockquote>${escape(trial.prefix)}<br>${escape(trial.proposal)}</blockquote>`,
        questions: questions.map((prompt, i) => ({ prompt: escape(prompt), name: i === 0 ? "understanding" : "usefulness", labels: ["1<br>まったくそう<br>思わない", "2", "3", "4", "5", "6", "7<br>とてもそう<br>思う"], required: true })),
        button_label: "回答を確定する", randomize_question_order: false,
        on_load: () => {
          startedAt = performance.now();
          container.querySelectorAll<HTMLElement>(".jspsych-survey-likert-opts").forEach((group, i) => { group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", questions[i]); });
          container.querySelector<HTMLElement>("h2")?.focus();
        },
      }]).catch(() => { if (active) onError(); });
    }, 0);
    return () => { active = false; clearTimeout(timer); container.removeEventListener("submit", submit, true); experiment?.abortExperiment(""); container.remove(); };
  }, [trial, questions, confirm, advance, onError]);
  return <div className="experiment-host" ref={host} />;
}
