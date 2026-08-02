export interface WorldBookEntryDraft {
  keys: string[];
  content: string;
  enabled: boolean;
  constant?: boolean;
  position?: "before_char" | "after_char";
  order?: number;
  extensions?: Record<string, unknown>;
}

interface WorldBookChangeSource {
  sourceTurnId: string;
  sourceStoryDirectionId?: string;
  reason: string;
  evidence: string[];
}

export type WorldBookChange =
  | (WorldBookChangeSource & {
      operation: "create";
      entry: WorldBookEntryDraft;
    })
  | (WorldBookChangeSource & {
      operation: "update";
      targetEntryId: string;
      patch: Partial<WorldBookEntryDraft>;
    })
  | (WorldBookChangeSource & {
      operation: "deactivate";
      targetEntryId: string;
    });

/**
 * 自动同步只写入当前会话的动态层；永久合并到基础世界书需要玩家确认。
 */
export interface WorldBookSyncPlan {
  scope: "session_overlay";
  required: boolean;
  changes: WorldBookChange[];
}
