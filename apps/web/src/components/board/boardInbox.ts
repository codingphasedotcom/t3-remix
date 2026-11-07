import type { BoardInboxItem, BoardInboxKind, EnvironmentId } from "@t3tools/contracts";

import { boardLive } from "../../state/board";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";

/** The one subscription every inbox reader shares: the badge, the tab, and notifications. */
export const boardInboxQuery = (environmentId: EnvironmentId) =>
  boardLive({ environmentId, input: { companyId: null, inbox: true } });

/** What waits on the person on one environment, oldest first. */
export function useBoardInbox(environmentId: EnvironmentId | null): ReadonlyArray<BoardInboxItem> {
  const environment = useEnvironment(environmentId);
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  return (
    useEnvironmentQuery(connected && environmentId !== null ? boardInboxQuery(environmentId) : null)
      .data?.inbox ?? []
  );
}

/** Changes when the item comes back after being handled, so it is announced again. */
export function inboxKey(item: BoardInboxItem): string {
  return `${item.kind}:${item.taskId ?? item.hireId ?? item.skillRequestId}:${item.since}`;
}

export const INBOX_LABELS: Record<BoardInboxKind, string> = {
  review: "Ready for your review",
  blocked: "Stuck, needs you",
  hire: "Hire request",
  skill: "Skill request",
  todo: "Your to-do",
};
