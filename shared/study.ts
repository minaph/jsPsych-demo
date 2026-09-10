export const STUDY_VERSION = "holiday-v1";
export const CONSENT_VERSION = "technical-v1";
export const SCHEMA_VERSION = 1;
export const DAY_MS = 86_400_000;
export type Condition = "acknowledge" | "neutral";
export const questions = [
  "この応答は、この場面での私の希望を理解していると感じる。",
  "この提案は、この場面での私にとって役に立つと感じる。",
] as const;
export const scenes = [
  { id: "S01", situation: "明日の午後は予定がありません。最近疲れているので、静かに過ごしたいと考えています。", acknowledge: "静かな時間を過ごして、疲れを癒やしたいのですね。", neutral: "明日の午後の過ごし方について、一つご提案します。", proposal: "近所の落ち着いた喫茶店で、本を読みながら過ごすのはいかがですか。" },
  { id: "S02", situation: "明日の午後は予定がありません。お金をあまり使わずに、気分転換したいと考えています。", acknowledge: "出費を抑えながら、気分を変えて過ごしたいのですね。", neutral: "明日の午後の過ごし方について、一つご提案します。", proposal: "近所の公園で、景色を眺めながら散歩をするのはいかがですか。" },
  { id: "S03", situation: "明日の午後は予定がありません。激しい運動ではなく、無理なく体を動かしたいと考えています。", acknowledge: "体に無理をかけずに、軽く体を動かしたいのですね。", neutral: "明日の午後の過ごし方について、一つご提案します。", proposal: "近所の平坦な遊歩道で、短い距離をゆっくり歩くのはいかがですか。" },
  { id: "S04", situation: "明日の午後は予定がありません。スマートフォンやパソコンの画面を見る時間を減らしたいと考えています。", acknowledge: "画面を見る時間を減らして、別のことを楽しみたいのですね。", neutral: "明日の午後の過ごし方について、一つご提案します。", proposal: "近所の緑のある場所で、植物を眺めながら過ごすのはいかがですか。" },
] as const;
export interface Trial {
  trialId: string; sceneId: string; condition: Condition; presentationIndex: number;
  situation: string; prefix: string; proposal: string;
}
export interface Manifest {
  schemaVersion: number; studyVersion: string; assignedCondition: Condition;
  questions: readonly string[]; trials: Trial[];
}
export function makeManifest(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): Manifest {
  const assignedCondition: Condition = random() < 0.5 ? "acknowledge" : "neutral";
  const order = [...scenes];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { schemaVersion: SCHEMA_VERSION, studyVersion: STUDY_VERSION, assignedCondition, questions,
    trials: order.map((scene, i) => ({ trialId: scene.id, sceneId: scene.id, condition: assignedCondition, presentationIndex: i + 1, situation: scene.situation, prefix: scene[assignedCondition], proposal: scene.proposal })) };
}
