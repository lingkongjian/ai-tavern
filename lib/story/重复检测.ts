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

/**
 * 与最近若干回合的 scene 逐一比较（含上一回合），任一相似度达到阈值即判定重复。
 * 用于拦截"隔几回合后语义重复"的多回合兜圈子：只要最近窗口内出现过高度相似
 * 的场景，就要求重写推进。返回窗口内最高相似度，供错误提示展示。
 */
export function detectSceneRepetitionAgainstRecent(
  currentScene: string,
  recentScenes: string[],
  threshold: number = DEFAULT_THRESHOLD,
): SceneRepetitionResult {
  let worst: SceneRepetitionResult = { repeated: false, similarity: 0 };
  for (const scene of recentScenes) {
    const result = detectSceneRepetition(currentScene, scene, threshold);
    if (result.repeated) return result;
    if (result.similarity > worst.similarity) worst = result;
  }
  return worst;
}

export function repetitionFixInstruction(similarity: number) {
  return `上一个 JSON 的剧情与最近几回合高度重复（相似度 ${Math.round(
    similarity * 100,
  )}%）。只保留本轮需要的新发展，重写 scene、events 与 dialogue 以推进剧情，不要复述已经展示过的内容或重复近期已出现的桥段与结论，并重新返回完整 JSON。`;
}
