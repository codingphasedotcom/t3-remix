import type {
  BoardAgent,
  BoardAgentId,
  BoardDashboard,
  BoardDepartmentId,
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
  /** Unassigned tasks waiting in To do, which nothing will start. */
  readonly unassigned: ReadonlyArray<BoardTask>;
  readonly pendingHires: number;
  readonly failing: ReadonlyArray<{ readonly agentId: BoardAgentId; readonly failed: number }>;
}

export function attentionItems(
  snapshot: BoardSnapshot,
  dashboard: BoardDashboard | null,
): AttentionItems {
  return {
    blocked: snapshot.tasks.filter((task) => task.status === "blocked"),
    unassigned: snapshot.tasks.filter(
      (task) => task.status === "todo" && task.assigneeAgentId === null,
    ),
    pendingHires: snapshot.hires.filter((hire) => hire.status === "pending").length,
    failing: (dashboard?.agents ?? [])
      .filter((entry) => entry.stats.failed > 0)
      .map((entry) => ({ agentId: entry.agentId, failed: entry.stats.failed }))
      .toSorted((a, b) => b.failed - a.failed),
  };
}

export function hasAttentionItems(attention: AttentionItems): boolean {
  return (
    attention.blocked.length > 0 ||
    attention.unassigned.length > 0 ||
    attention.pendingHires > 0 ||
    attention.failing.length > 0
  );
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

/** Minutes to add to UTC for this browser's current local time. */
export function browserUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
