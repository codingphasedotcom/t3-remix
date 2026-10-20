import type {
  BoardAgent,
  BoardAgentId,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
} from "@t3tools/contracts";

export interface BoardColumn {
  readonly status: BoardTaskStatus;
  readonly label: string;
  readonly hint: string;
}

export const BOARD_COLUMNS: ReadonlyArray<BoardColumn> = [
  { status: "backlog", label: "Backlog", hint: "Waits for a human to schedule it." },
  { status: "todo", label: "To do", hint: "Cards with an assignee start automatically." },
  { status: "in_progress", label: "In progress", hint: "An agent is working the card." },
  { status: "review", label: "Review", hint: "The reviewer starts when one is set." },
  { status: "blocked", label: "Blocked", hint: "Needs a decision or its subtasks." },
  { status: "done", label: "Done", hint: "Approved work." },
];

export function boardStatusLabel(status: BoardTaskStatus): string {
  return BOARD_COLUMNS.find((column) => column.status === status)?.label ?? status;
}

export interface BoardPlacement {
  readonly status: BoardTaskStatus;
  readonly position: number;
}

/** Cards per column, ordered by position, with pending drops applied. */
export function groupTasksByStatus(
  tasks: ReadonlyArray<BoardTask>,
  placements: ReadonlyMap<BoardTaskId, BoardPlacement>,
): Record<BoardTaskStatus, ReadonlyArray<BoardTask>> {
  const groups: Record<BoardTaskStatus, Array<BoardTask>> = {
    backlog: [],
    todo: [],
    in_progress: [],
    review: [],
    blocked: [],
    done: [],
  };
  for (const task of tasks) {
    const placement = placements.get(task.id);
    const placed = placement === undefined ? task : { ...task, ...placement };
    groups[placed.status].push(placed);
  }
  for (const column of Object.values(groups)) {
    column.sort((left, right) => left.position - right.position);
  }
  return groups;
}

/**
 * Position for a card dropped into `column` just before `beforeTaskId`, or at the end when
 * that is null. Positions are fractional so one move never renumbers its neighbours.
 */
export function dropPosition(
  column: ReadonlyArray<BoardTask>,
  beforeTaskId: BoardTaskId | null,
): number {
  if (beforeTaskId === null) {
    const last = column.at(-1);
    return last === undefined ? 1 : last.position + 1;
  }
  const index = column.findIndex((task) => task.id === beforeTaskId);
  const before = column[index];
  if (index === -1 || before === undefined) return (column.at(-1)?.position ?? 0) + 1;
  const previous = column[index - 1];
  return previous === undefined ? before.position - 1 : (previous.position + before.position) / 2;
}

export function agentById(
  agents: ReadonlyArray<BoardAgent>,
  id: BoardAgentId | null,
): BoardAgent | null {
  if (id === null) return null;
  return agents.find((agent) => agent.id === id) ?? null;
}

export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function subtaskProgress(
  tasks: ReadonlyArray<BoardTask>,
  taskId: BoardTaskId,
): { readonly done: number; readonly total: number } {
  const subtasks = tasks.filter((task) => task.parentTaskId === taskId);
  return {
    done: subtasks.filter((task) => task.status === "done").length,
    total: subtasks.length,
  };
}
