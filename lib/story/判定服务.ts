export const ATTRIBUTE_WHITELIST = [
  "力量",
  "敏捷",
  "感知",
  "意志",
  "魅力",
  "智力",
  "体质",
] as const;

export type AttributeName = (typeof ATTRIBUTE_WHITELIST)[number];

export const DEFAULT_ATTRIBUTE_VALUE = 50;
export const ATTRIBUTE_DIRECT_MARGIN = 30;
export const PARTIAL_SUCCESS_BAND = 10;
export const ROLL_FLUCTUATION_RATIO = 0.3;
export const ATTRIBUTE_ROLL_MIN = 1;
export const ATTRIBUTE_ROLL_MAX = 100;

export type AttributeCheckOutcome =
  | "success"
  | "partial_success"
  | "failure"
  | "skipped";

export interface AttributeCheckRequest {
  id: string;
  characterId: string;
  attribute: AttributeName;
  difficulty: number;
  context: string;
}

export interface AttributeCheckResolution {
  checkId: string;
  characterId: string;
  attribute: AttributeName;
  difficulty: number;
  context: string;
  attributeValue: number;
  margin: number;
  direct: boolean;
  roll: number | null;
  finalValue: number;
  outcome: AttributeCheckOutcome;
  outcomeLabel: string;
}

export const ATTRIBUTE_OUTCOME_LABELS: Record<AttributeCheckOutcome, string> = {
  success: "成功",
  partial_success: "部分成功",
  failure: "失败",
  skipped: "放弃判定",
};

export function isAttributeName(value: unknown): value is AttributeName {
  return (
    typeof value === "string" &&
    (ATTRIBUTE_WHITELIST as readonly string[]).includes(value)
  );
}

export function normalizeAttributeValue(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function validateRoll(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ATTRIBUTE_ROLL_MIN &&
    value <= ATTRIBUTE_ROLL_MAX
  );
}

export function resolveAttributeCheck(input: {
  attributeValue: number;
  difficulty: number;
  roll: number | null;
}): {
  margin: number;
  direct: boolean;
  roll: number | null;
  finalValue: number;
  outcome: AttributeCheckOutcome;
  outcomeLabel: string;
} {
  const attributeValue = normalizeAttributeValue(input.attributeValue);
  const difficulty = Math.max(1, Math.min(100, input.difficulty));
  const margin = attributeValue - difficulty;

  if (margin >= ATTRIBUTE_DIRECT_MARGIN) {
    return {
      margin,
      direct: true,
      roll: null,
      finalValue: attributeValue,
      outcome: "success",
      outcomeLabel: ATTRIBUTE_OUTCOME_LABELS.success,
    };
  }
  if (margin <= -ATTRIBUTE_DIRECT_MARGIN) {
    return {
      margin,
      direct: true,
      roll: null,
      finalValue: attributeValue,
      outcome: "failure",
      outcomeLabel: ATTRIBUTE_OUTCOME_LABELS.failure,
    };
  }

  if (input.roll === null) {
    throw new AttributeCheckRollRequiredError(
      "该判定处于不确定区间，必须先掷骰才能结算。",
    );
  }
  if (!validateRoll(input.roll)) {
    throw new AttributeCheckRollRequiredError("骰子点数必须是 1 到 100 之间的整数。");
  }
  const roll = input.roll;
  const finalValue = Math.round(
    (attributeValue + roll * ROLL_FLUCTUATION_RATIO) * 10,
  ) / 10;
  const outcome: AttributeCheckOutcome =
    finalValue >= difficulty
      ? "success"
      : finalValue >= difficulty - PARTIAL_SUCCESS_BAND
        ? "partial_success"
        : "failure";
  return {
    margin,
    direct: false,
    roll,
    finalValue,
    outcome,
    outcomeLabel: ATTRIBUTE_OUTCOME_LABELS[outcome],
  };
}

export function skipAttributeCheck(input: {
  attributeValue: number;
  difficulty: number;
}): {
  margin: number;
  direct: boolean;
  roll: number | null;
  finalValue: number;
  outcome: AttributeCheckOutcome;
  outcomeLabel: string;
} {
  const attributeValue = normalizeAttributeValue(input.attributeValue);
  const difficulty = Math.max(1, Math.min(100, input.difficulty));
  return {
    margin: attributeValue - difficulty,
    direct: false,
    roll: null,
    finalValue: attributeValue,
    outcome: "skipped",
    outcomeLabel: ATTRIBUTE_OUTCOME_LABELS.skipped,
  };
}

export function resolveAttributeChecks(input: {
  requests: AttributeCheckRequest[];
  attributeValues: Record<string, Record<string, number>>;
  rolls: Map<string, number | null>;
  skipUnrolled?: boolean;
}): AttributeCheckResolution[] {
  return input.requests.map((request) => {
    const attributeValue =
      input.attributeValues[request.characterId]?.[request.attribute] ??
      DEFAULT_ATTRIBUTE_VALUE;
    const difficulty = Math.max(1, Math.min(100, request.difficulty));
    const margin = attributeValue - difficulty;
    const roll = input.rolls.get(request.id) ?? null;
    const resolved =
      roll === null &&
      input.skipUnrolled === true &&
      margin > -ATTRIBUTE_DIRECT_MARGIN &&
      margin < ATTRIBUTE_DIRECT_MARGIN
        ? skipAttributeCheck({ attributeValue, difficulty })
        : resolveAttributeCheck({
            attributeValue,
            difficulty,
            roll,
          });
    return {
      checkId: request.id,
      characterId: request.characterId,
      attribute: request.attribute,
      difficulty,
      context: request.context,
      attributeValue,
      margin: resolved.margin,
      direct: resolved.direct,
      roll: resolved.roll,
      finalValue: resolved.finalValue,
      outcome: resolved.outcome,
      outcomeLabel: resolved.outcomeLabel,
    };
  });
}

export class AttributeCheckRollRequiredError extends Error {
  public readonly issues: string[];

  constructor(message: string) {
    super(message);
    this.name = "AttributeCheckRollRequiredError";
    this.issues = [message];
  }
}
