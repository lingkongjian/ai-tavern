export class BranchAndSaveInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "分支或存档请求无效。");
    this.name = "BranchAndSaveInputError";
    this.issues = issues;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(
  value: unknown,
  label: string,
  maximumLength = 80,
) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BranchAndSaveInputError([`${label}不能为空。`]);
  }
  const result = value.trim();
  if (result.length > maximumLength) {
    throw new BranchAndSaveInputError([
      `${label}不能超过 ${maximumLength} 个字符。`,
    ]);
  }
  return result;
}

export function parseCreateBranchRequest(value: unknown) {
  if (!isObject(value)) {
    throw new BranchAndSaveInputError(["请求内容必须是 JSON 对象。"]);
  }
  const name = requiredText(value.name, "分支名称");
  const sourceTurnId =
    typeof value.sourceTurnId === "string" ? value.sourceTurnId.trim() : "";
  const recoveryPointId =
    typeof value.recoveryPointId === "string"
      ? value.recoveryPointId.trim()
      : "";
  if (Boolean(sourceTurnId) === Boolean(recoveryPointId)) {
    throw new BranchAndSaveInputError([
      "必须且只能选择一个历史回合或存档作为分支起点。",
    ]);
  }
  return {
    name,
    ...(sourceTurnId ? { sourceTurnId } : {}),
    ...(recoveryPointId ? { recoveryPointId } : {}),
  };
}

export type BranchUpdateRequest =
  | { operation: "switch" }
  | { operation: "rename"; name: string };

export function parseBranchUpdateRequest(value: unknown): BranchUpdateRequest {
  if (!isObject(value)) {
    throw new BranchAndSaveInputError(["请求内容必须是 JSON 对象。"]);
  }
  if (value.operation === "switch") return { operation: "switch" };
  if (value.operation === "rename") {
    return {
      operation: "rename",
      name: requiredText(value.name, "分支名称"),
    };
  }
  throw new BranchAndSaveInputError(["不支持该分支操作"]);
}

export function parseCreateSavePointRequest(value: unknown) {
  if (!isObject(value)) {
    throw new BranchAndSaveInputError(["请求内容必须是 JSON 对象。"]);
  }
  return { name: requiredText(value.name, "存档名称") };
}
