import type { WorldBookSyncPlan } from "@/lib/worldbook/contracts";

export type ProposalStance = "accept" | "partial_accept" | "reject";

export type ActionStance = "benevolent" | "neutral" | "malicious";

export type DecisionContext = "proposal_response" | "action_direction";

export interface SuggestedChoice {
  id: string;
  label: string;
  description: string;
  stance: ProposalStance | ActionStance;
}

export interface GeneratedChoiceSet {
  context: DecisionContext;
  prompt: string;
  choices: SuggestedChoice[];
  customInputEnabled: true;
}

export type RoleplayInputMode = "speech" | "action" | "mixed";

export type StoryDirectionStatus =
  | "active"
  | "completed"
  | "replaced"
  | "cancelled";

/** 会话级剧情走向目标及其生命周期。 */
export interface StoryDirectionState {
  id: string;
  content: string;
  status: StoryDirectionStatus;
  createdAtTurnId: string;
  endedAtTurnId?: string;
  completionReason?: string;
  /** 指向已经发生的剧情或状态变化，防止仅凭模型声明提前完成。 */
  completionEvidence?: string[];
}

/** 每轮结束后由剧情引擎给出的走向完成评估。 */
export interface StoryDirectionEvaluation {
  status: "active" | "completed";
  reason: string;
  evidence: string[];
  continuity: "aligned" | "diverged" | "uncertain";
  continuityReason: string;
  recommendedModuleId: string | null;
  suggestedNextDirection: {
    title: string;
    content: string;
    reason: string;
  } | null;
}

/** 一个回合结束时需要以原子方式保存的剧情状态。 */
export interface TurnStateCommit {
  storyDirectionEvaluation?: StoryDirectionEvaluation;
  worldBookSync: WorldBookSyncPlan;
}

/** 玩家在一个回合中可以提供的三种语义互不相同的输入。 */
export interface PlayerTurnInputs {
  /** 选择“自定义”候选项时，替代候选选项的当前决策。 */
  customChoice?: string;
  /** 玩家角色在故事内说的话或做的动作。 */
  roleplay?: {
    mode: RoleplayInputMode;
    content: string;
  };
  /** 对 NPC 不可见、跨回合生效，直至被替换、取消或由剧情实际完成。 */
  storyDirection?: string;
}
