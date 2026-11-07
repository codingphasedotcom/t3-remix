import type {
  BoardAgentId,
  BoardCompany,
  BoardHire,
  BoardInboxItem,
  BoardSkillRequest,
  BoardTask,
  BoardTaskId,
} from "@t3tools/contracts";

import type { StoredTask } from "./BoardStore.ts";

const MAX_DETAIL_CHARS = 280;

/** Agents below this task still have work to do, so nobody needs the person yet. */
function anyoneMovingBelow(task: BoardTask, tasks: ReadonlyArray<BoardTask>): boolean {
  const below = tasks.filter((candidate) => candidate.parentTaskId === task.id);
  for (let index = 0; index < below.length; index++) {
    const subtask = below[index]!;
    if (subtask.activeRunKind !== null) return true;
    if (subtask.status === "todo" || subtask.status === "in_progress") return true;
    if (subtask.status === "review") return true;
    below.push(...tasks.filter((candidate) => candidate.parentTaskId === subtask.id));
  }
  return false;
}

export interface InboxTaskFacts {
  /** When the task's reviewer last started reviewing it, or null if it never has. */
  readonly lastReviewStartedAt: string | null;
  /** The last comment an agent left on the task. */
  readonly lastAgentComment: string | null;
}

export interface InboxCandidate {
  readonly stored: StoredTask;
  readonly kind: Exclude<BoardInboxItem["kind"], "hire" | "skill">;
}

/** Tasks that could need the person; the caller reads the facts for just these. */
export function inboxCandidates(tasks: ReadonlyArray<StoredTask>): ReadonlyArray<InboxCandidate> {
  const all = tasks.map((stored) => stored.task);
  return tasks.flatMap((stored): ReadonlyArray<InboxCandidate> => {
    const { task } = stored;
    if (task.archivedAt !== null || task.activeRunKind !== null) return [];
    if (task.assignedToUser) return task.status === "todo" ? [{ stored, kind: "todo" }] : [];
    if (task.status === "review") return [{ stored, kind: "review" }];
    // A manager settles its subtasks' trouble, so only a top-level task that is stuck asks.
    if (task.status === "blocked" && task.parentTaskId === null && !anyoneMovingBelow(task, all)) {
      return [{ stored, kind: "blocked" }];
    }
    return [];
  });
}

function truncate(text: string | null): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= MAX_DETAIL_CHARS ? trimmed : `${trimmed.slice(0, MAX_DETAIL_CHARS)}…`;
}

/**
 * What waits on the person in one company. A review waits on them when the board reviews it,
 * or once its reviewer finished without deciding.
 */
export function companyInbox(input: {
  readonly company: BoardCompany;
  readonly candidates: ReadonlyArray<InboxCandidate>;
  readonly facts: ReadonlyMap<BoardTaskId, InboxTaskFacts>;
  /** Every employee's name, by id. */
  readonly agentNames: ReadonlyMap<BoardAgentId, string>;
  readonly hires: ReadonlyArray<BoardHire>;
  readonly skillRequests: ReadonlyArray<BoardSkillRequest>;
}): ReadonlyArray<BoardInboxItem> {
  const base = { companyId: input.company.id, companyName: input.company.name };
  const tasks = input.candidates.flatMap(({ stored, kind }): ReadonlyArray<BoardInboxItem> => {
    const { task } = stored;
    const facts = input.facts.get(task.id);
    if (
      kind === "review" &&
      task.reviewerAgentId !== null &&
      input.agentNames.has(task.reviewerAgentId)
    ) {
      const reviewed = facts?.lastReviewStartedAt ?? null;
      if (reviewed === null || reviewed < stored.statusChangedAt) return [];
    }
    return [
      {
        ...base,
        kind,
        taskId: task.id,
        hireId: null,
        skillRequestId: null,
        title: task.title,
        detail: truncate(facts?.lastAgentComment ?? null),
        agentId: task.assigneeAgentId,
        since: stored.statusChangedAt,
      },
    ];
  });
  const hires = input.hires
    .filter((hire) => hire.status === "pending")
    .map((hire): BoardInboxItem => ({
      ...base,
      kind: "hire",
      taskId: null,
      hireId: hire.id,
      skillRequestId: null,
      title: hire.title.length > 0 ? `${hire.name}, ${hire.title}` : hire.name,
      detail: truncate(hire.reason),
      agentId: hire.requestedByAgentId,
      since: hire.createdAt,
    }));
  const skills = input.skillRequests
    .filter((request) => request.status === "pending")
    .map((request): BoardInboxItem => {
      const agentName = input.agentNames.get(request.agentId) ?? "a former employee";
      return {
        ...base,
        kind: "skill",
        taskId: null,
        hireId: null,
        skillRequestId: request.id,
        title: `${request.name} skill for ${agentName}`,
        detail: truncate(request.reason),
        agentId: request.requestedByAgentId,
        since: request.createdAt,
      };
    });
  return [...tasks, ...hires, ...skills];
}
