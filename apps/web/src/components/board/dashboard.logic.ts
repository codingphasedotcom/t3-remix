import type {
  BoardAgent,
  BoardAgentThread,
  BoardDashboard,
  BoardDepartmentId,
  BoardOpenWorktree,
  BoardRunStats,
  BoardSnapshot,
  BoardTask,
  BoardTaskStatus,
  BoardTokenTotals,
} from "@t3tools/contracts";

import { BOARD_COLUMNS, departmentLabel, orgChartRows } from "./board.logic";

export const EMPTY_RUN_STATS: BoardRunStats = {
  runs: 0,
  reviews: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  running: 0,
  finishedRunMs: 0,
  tokens: { input: 0, cachedInput: 0, output: 0 },
  lastRunAt: null,
};

const endedRuns = (stats: BoardRunStats) => stats.completed + stats.failed + stats.cancelled;

/** Share of ended runs that completed; null before any run has ended. */
export function successRate(stats: BoardRunStats): number | null {
  const ended = endedRuns(stats);
  return ended === 0 ? null : stats.completed / ended;
}

export function averageRunMs(stats: BoardRunStats): number | null {
  const ended = endedRuns(stats);
  return ended === 0 ? null : stats.finishedRunMs / ended;
}

export function totalTokens(tokens: BoardTokenTotals): number {
  return tokens.input + tokens.output;
}

/** Share of input tokens served from the prompt cache. */
export function cachedShare(tokens: BoardTokenTotals): number | null {
  return tokens.input === 0 ? null : tokens.cachedInput / tokens.input;
}

export interface ColumnCount {
  readonly status: BoardTaskStatus;
  readonly label: string;
  readonly count: number;
}

export function cardsByColumn(tasks: ReadonlyArray<BoardTask>): ReadonlyArray<ColumnCount> {
  return BOARD_COLUMNS.map((column) => ({
    status: column.status,
    label: column.label,
    count: tasks.filter((task) => task.status === column.status).length,
  }));
}

export type EmployeeActivity = "working" | "paused" | "idle";

export interface EmployeeRow {
  readonly agent: BoardAgent;
  readonly role: string;
  readonly department: string | null;
  readonly activity: EmployeeActivity;
  /** Tasks assigned to them that are not done. */
  readonly openCards: number;
  readonly doneCards: number;
  readonly stats: BoardRunStats;
}

/** Everyone in org-chart order, with their cards from the board and runs from the dashboard. */
export function employeeRows(
  snapshot: BoardSnapshot,
  dashboard: BoardDashboard | null,
): ReadonlyArray<EmployeeRow> {
  const company = snapshot.company;
  if (company === null) return [];
  const statsByAgent = new Map(dashboard?.agents.map((entry) => [entry.agentId, entry.stats]));
  return orgChartRows(snapshot.agents, company.ceoAgentId).map(({ agent }) => {
    const assigned = snapshot.tasks.filter((task) => task.assigneeAgentId === agent.id);
    const working = snapshot.threads.some(
      (thread) => thread.agentId === agent.id && thread.status === "running",
    );
    return {
      agent,
      role: company.ceoAgentId === agent.id ? "CEO" : agent.title || "Employee",
      department: departmentLabel(company.departments, agent.departmentId),
      activity: agent.paused ? "paused" : working ? "working" : "idle",
      openCards: assigned.filter((task) => task.status !== "done").length,
      doneCards: assigned.filter((task) => task.status === "done").length,
      stats: statsByAgent.get(agent.id) ?? EMPTY_RUN_STATS,
    };
  });
}

export interface DepartmentRow {
  readonly id: BoardDepartmentId;
  readonly name: string;
  readonly headcount: number;
  readonly openCards: number;
  readonly doneCards: number;
  readonly tokens: number;
}

export function departmentRows(
  snapshot: BoardSnapshot,
  employees: ReadonlyArray<EmployeeRow>,
): ReadonlyArray<DepartmentRow> {
  return (snapshot.company?.departments ?? []).map((department) => {
    const members = employees.filter((row) => row.agent.departmentId === department.id);
    const sum = (pick: (row: EmployeeRow) => number) =>
      members.reduce((total, row) => total + pick(row), 0);
    return {
      id: department.id,
      name: department.name,
      headcount: members.length,
      openCards: sum((row) => row.openCards),
      doneCards: sum((row) => row.doneCards),
      tokens: sum((row) => totalTokens(row.stats.tokens)),
    };
  });
}

export interface AttentionItems {
  readonly blocked: ReadonlyArray<BoardTask>;
  /** Tasks in To do with neither an agent nor you on them, which nothing will start. */
  readonly unassigned: ReadonlyArray<BoardTask>;
  readonly pendingHires: number;
  /** Employee threads whose latest run failed and that nothing has run again since. */
  readonly failed: ReadonlyArray<BoardAgentThread>;
}

export function attentionItems(snapshot: BoardSnapshot): AttentionItems {
  return {
    blocked: snapshot.tasks.filter((task) => task.status === "blocked"),
    unassigned: snapshot.tasks.filter(
      (task) => task.status === "todo" && task.assigneeAgentId === null && !task.assignedToUser,
    ),
    pendingHires: snapshot.hires.filter((hire) => hire.status === "pending").length,
    failed: snapshot.threads.filter((thread) => thread.status === "failed"),
  };
}

export function hasAttentionItems(attention: AttentionItems): boolean {
  return (
    attention.blocked.length > 0 ||
    attention.unassigned.length > 0 ||
    attention.pendingHires > 0 ||
    attention.failed.length > 0
  );
}

const TASK_ORDER: Record<BoardTaskStatus, number> = {
  blocked: 0,
  review: 1,
  in_progress: 2,
  todo: 3,
  backlog: 4,
  done: 5,
};

/** Open tasks, most urgent first: agents at work, then what waits on you, then the queue. */
export function priorityTasks(
  tasks: ReadonlyArray<BoardTask>,
  limit: number,
): ReadonlyArray<BoardTask> {
  return tasks
    .filter((task) => task.status !== "done" && task.archivedAt === null)
    .toSorted(
      (left, right) =>
        Number(right.activeRunKind !== null) - Number(left.activeRunKind !== null) ||
        TASK_ORDER[left.status] - TASK_ORDER[right.status] ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, limit);
}

/** The latest runs across the company, newest first. */
export function recentThreads(
  threads: ReadonlyArray<BoardAgentThread>,
  limit: number,
): ReadonlyArray<BoardAgentThread> {
  return threads
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, limit);
}

export type ActivityMetric = "runs" | "tasksFinished" | "tokens";

/** Rounds a duration to its two largest units, such as "3h 20m" or "45s". */
export function formatSpan(ms: number): string {
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

export interface WorktreeTaskRow {
  readonly task: BoardTask;
  readonly depth: number;
  readonly worktrees: number;
}

export interface WorktreeGroup {
  /** The main task first, then its subtasks in board order. */
  readonly rows: ReadonlyArray<WorktreeTaskRow>;
  readonly worktrees: number;
  /** How many tasks must reach Done before cleanup can take these worktrees. */
  readonly toFinish: number;
}

/**
 * Each main task holding a worktree, with its whole tree: a subtask with no worktree of its own
 * still keeps the rest open. Closest to being cleaned up first, finished groups last.
 */
export function worktreeGroups(
  tasks: ReadonlyArray<BoardTask>,
  worktrees: ReadonlyArray<BoardOpenWorktree>,
): ReadonlyArray<WorktreeGroup> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<BoardTask["parentTaskId"], Array<BoardTask>>();
  for (const task of tasks) {
    children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]);
  }
  const mainTaskOf = (task: BoardTask): BoardTask => {
    const parent = task.parentTaskId === null ? undefined : byId.get(task.parentTaskId);
    return parent === undefined ? task : mainTaskOf(parent);
  };
  const perTask = new Map<BoardTask["id"], number>();
  const perMainTask = new Map<BoardTask["id"], number>();
  const bump = (counts: Map<BoardTask["id"], number>, id: BoardTask["id"]) =>
    counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const worktree of worktrees) {
    const owners = worktree.taskIds.flatMap((id) => byId.get(id) ?? []);
    for (const owner of owners) bump(perTask, owner.id);
    for (const mainId of new Set(owners.map((owner) => mainTaskOf(owner).id))) {
      bump(perMainTask, mainId);
    }
  }
  const rowsUnder = (task: BoardTask, depth: number): ReadonlyArray<WorktreeTaskRow> => [
    { task, depth, worktrees: perTask.get(task.id) ?? 0 },
    ...(children.get(task.id) ?? []).flatMap((child) => rowsUnder(child, depth + 1)),
  ];
  return [...perMainTask]
    .flatMap(([mainId, count]) => {
      const main = byId.get(mainId);
      if (main === undefined) return [];
      const rows = rowsUnder(main, 0);
      const toFinish =
        main.archivedAt !== null ? 0 : rows.filter((row) => row.task.status !== "done").length;
      return [{ rows, worktrees: count, toFinish }];
    })
    .toSorted(
      (left, right) =>
        Number(left.toFinish === 0) - Number(right.toFinish === 0) ||
        left.toFinish - right.toFinish ||
        right.worktrees - left.worktrees,
    );
}

/** Minutes to add to UTC for this browser's current local time. */
export function browserUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
