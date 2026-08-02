import { getDb } from "@/db";
import {
  LocalStoryStore,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import { notFound } from "next/navigation";
import type {
  AdventureBranchSummary,
  AdventureRecoveryPoint,
  LoadedAdventure,
} from "@/lib/storage/story-store";
import type { SourceDocumentSummary } from "@/lib/reference/原文参考";
import type { StoryMemoryDashboard } from "@/lib/memory/剧情记忆";
import { GameInterface } from "./游戏界面";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GamePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  let adventure: LoadedAdventure;
  let sourceDocuments: SourceDocumentSummary[];
  let branches: AdventureBranchSummary[];
  let recoveryPoints: AdventureRecoveryPoint[];
  let memory: StoryMemoryDashboard;
  try {
    const store = new LocalStoryStore(getDb());
    adventure = store.loadAdventure(sessionId);
    sourceDocuments = store.listSourceDocuments(sessionId);
    branches = store.listBranches(sessionId);
    recoveryPoints = store.listRecoveryPoints(sessionId);
    memory = store.loadStoryMemory(sessionId);
  } catch (error) {
    if (error instanceof StoryNotFoundError) notFound();
    throw error;
  }

  return (
    <GameInterface
      adventure={adventure}
      initialSourceDocuments={sourceDocuments}
      initialBranches={branches}
      initialRecoveryPoints={recoveryPoints}
      initialMemory={memory}
    />
  );
}
