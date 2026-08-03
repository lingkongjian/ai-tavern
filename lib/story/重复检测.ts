export interface SceneRepetitionResult {
  repeated: boolean;
  similarity: number;
}

const NGRAM_SIZE = 3;
const DEFAULT_THRESHOLD = 0.55;
const MINIMUM_SCENE_LENGTH = 24;

function normalizeScene(value: string) {
  return value
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。！？、；：,.!?;:""''「」『』（）()]/g, "")
    .toLowerCase();
}

function ngramSet(value: string, size: number) {
  const result = new Set<string>();
  for (let index = 0; index + size <= value.length; index += 1) {
    result.add(value.slice(index, index + size));
  }
  return result;
}

export function sceneSimilarity(left: string, right: string) {
  const leftNormalized = normalizeScene(left);
  const rightNormalized = normalizeScene(right);
  if (
    leftNormalized.length < MINIMUM_SCENE_LENGTH ||
    rightNormalized.length < MINIMUM_SCENE_LENGTH
  ) {
    return 0;
  }
  const leftGrams = ngramSet(leftNormalized, NGRAM_SIZE);
  const rightGrams = ngramSet(rightNormalized, NGRAM_SIZE);
  if (leftGrams.size === 0 || rightGrams.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) intersection += 1;
  }
  return intersection / (leftGrams.size + rightGrams.size - intersection);
}

export function detectSceneRepetition(
  currentScene: string,
  previousScene: string,
  threshold: number = DEFAULT_THRESHOLD,
): SceneRepetitionResult {
  const similarity = sceneSimilarity(currentScene, previousScene);
  return {
    repeated: similarity >= threshold,
    similarity,
  };
}

export function repetitionFixInstruction(similarity: number) {
  return `上一个 JSON 的剧情与上一回合高度重复（相似度 ${Math.round(
    similarity * 100,
  )}%）。只保留本轮需要的新发展，重写 scene、events 与 dialogue 以推进剧情，不要复述已经展示过的内容，并重新返回完整 JSON。`;
}
