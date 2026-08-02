export interface RenameAdventureRequest {
  name: string;
}

export class RenameAdventureInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "剧本名称无效。");
    this.name = "RenameAdventureInputError";
    this.issues = issues;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseRenameAdventureRequest(
  value: unknown,
): RenameAdventureRequest {
  if (!isObject(value)) {
    throw new RenameAdventureInputError(["请求内容必须是 JSON 对象。"]);
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new RenameAdventureInputError(["剧本名称不能为空。"]);
  }
  const name = value.name.trim();
  if (name.length > 80) {
    throw new RenameAdventureInputError(["剧本名称不能超过 80 个字符。"]);
  }
  return { name };
}
