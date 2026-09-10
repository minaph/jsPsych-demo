import { test } from "node:test";
import assert from "node:assert/strict";
import { makeManifest, scenes } from "../shared/study.ts";
import { canonical, isTrialAnswer } from "../shared/experiment.ts";
import { csv } from "../scripts/export-data.ts";
test("independent condition branches and common four scenes", () => {
  for (const value of [0, 0.499999, 0.5, 0.999999]) {
    const manifest = makeManifest(() => value);
    assert.equal(manifest.assignedCondition, value < 0.5 ? "acknowledge" : "neutral");
    assert.deepEqual(manifest.trials.map(t => t.sceneId).sort(), ["S01", "S02", "S03", "S04"]);
    for (const trial of manifest.trials) { assert.equal(trial.condition, manifest.assignedCondition); assert.equal(trial.proposal, scenes.find(s => s.id === trial.sceneId)!.proposal); }
  }
});
test("prefix sentence counts and polite endings", () => { for (const s of scenes) { assert.equal(s.acknowledge.split("。").length, 2); assert.equal(s.neutral.split("。").length, 2); assert.match(s.acknowledge, /ですね。$/); assert.match(s.neutral, /します。$/); } });
test("strict ratings and canonical immutable DTO", () => {
  const a = { trialId: "S01", understanding: 1, usefulness: 7, rtMs: 42, segmentId: crypto.randomUUID(), segmentStartedAt: new Date().toISOString(), resumeCount: 0, presentationAttempt: 1, clientAnsweredAt: new Date().toISOString() };
  assert.ok(isTrialAnswer(a));
  for (const value of [0, 8, 1.5, "1", null]) assert.ok(!isTrialAnswer({ ...a, understanding: value }));
  assert.ok(!isTrialAnswer({ ...a, condition: "neutral" }));
  assert.equal(canonical(a), canonical({ ...a }));
});
test("CSV escapes fixed stimulus quotes and newlines and always writes headers", () => {
  assert.equal(csv([], ["question"]), '"question"\r\n');
  assert.equal(csv([{ question: '提案「A」, "B"\n次の行' }], ["question"]), '"question"\r\n"提案「A」, ""B""\n次の行"\r\n');
});
