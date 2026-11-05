import type {
  BoardAgent,
  BoardAgentId,
  BoardCompanyId,
  BoardDashboard,
  BoardDepartmentId,
  BoardSnapshot,
  BoardTask,
  BoardTaskId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_RUN_STATS,
  attentionItems,
  averageRunMs,
  departmentRows,
  employeeRows,
  formatSpan,
  hasAttentionItems,
  successRate,
} from "./dashboard.logic";

const companyId = "company" as BoardCompanyId;
const engineering = "engineering" as BoardDepartmentId;
const executive = "executive" as BoardDepartmentId;

function agent(id: string, reportsTo: string | null, extra: Partial<BoardAgent> = {}): BoardAgent {
  return {
    id: id as BoardAgentId,
    companyId,
    name: id,
    title: "Engineer",
    avatar: "",
    departmentId: engineering,
    reportsToAgentId: reportsTo as BoardAgentId | null,
    skillIds: [],
    instructions: "",
    memory: "",
    modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
    runtimeMode: "full-access",
    paused: false,
    monthlyTokenLimit: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...extra,
  };
}

function card(id: string, status: BoardTask["status"], assignee: string | null): BoardTask {
  return {
    id: id as BoardTaskId,
    companyId,
    projectId: "project" as ProjectId,
    title: id,
    description: "",
    status,
    position: 1,
    assigneeAgentId: assignee as BoardAgentId | null,
    assignedToUser: false,
    reviewerAgentId: null,
    parentTaskId: null,
    waitsOnTaskIds: [],
    threadId: null,
    worktreePath: null,
    activeRunKind: null,
    createdByAgentId: null,
    commentCount: 0,
    archivedAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };
}

const ceo = agent("ada", null, { departmentId: executive, title: "" });
const engineer = agent("linus", "ada");
const paused = agent("grace", "ada", { paused: true });

const snapshot: BoardSnapshot = {
  companies: [],
  company: {
    id: companyId,
    name: "Acme",
    mission: "",
    departments: [
      { id: executive, name: "Executive" },
      { id: engineering, name: "Engineering" },
    ],
    memory: "",
    projectId: "project" as ProjectId,
    ceoAgentId: ceo.id,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  },
  settings: null,
  agents: [engineer, paused, ceo],
  skills: [],
  hires: [],
  tasks: [
    card("login", "in_progress", "linus"),
    card("signup", "done", "linus"),
    card("billing", "blocked", "grace"),
    card("docs", "todo", null),
  ],
  routines: [],
  usage: null,
  threads: [
    {
      threadId: "thread-1" as ThreadId,
      agentId: engineer.id,
      taskId: "login" as BoardTaskId,
      kind: "work",
      status: "running",
      startedAt: "2026-10-20T00:00:00.000Z",
    },
    {
      threadId: "thread-2" as ThreadId,
      agentId: engineer.id,
      taskId: "signup" as BoardTaskId,
      kind: "work",
      status: "failed",
      startedAt: "2026-10-19T00:00:00.000Z",
    },
  ],
};

const dashboard: BoardDashboard = {
  companyId,
  totals: EMPTY_RUN_STATS,
  agents: [
    {
      agentId: engineer.id,
      stats: {
        ...EMPTY_RUN_STATS,
        runs: 4,
        completed: 2,
        failed: 1,
        running: 1,
        finishedRunMs: 90_000,
        tokens: { input: 1_000, cachedInput: 400, output: 200 },
      },
    },
  ],
  models: [],
  days: [],
  medianCycleMs: null,
};

describe("run stats", () => {
  it("rates only runs that have ended", () => {
    const stats = dashboard.agents[0]!.stats;
    expect(successRate(stats)).toBeCloseTo(2 / 3);
    expect(averageRunMs(stats)).toBe(30_000);
    expect(successRate(EMPTY_RUN_STATS)).toBeNull();
    expect(averageRunMs(EMPTY_RUN_STATS)).toBeNull();
  });
});

describe("employeeRows", () => {
  it("lists the org chart with each person's cards, activity, and runs", () => {
    const rows = employeeRows(snapshot, dashboard);
    expect(
      rows.map((row) => [row.agent.name, row.role, row.activity, row.openCards, row.doneCards]),
    ).toEqual([
      ["ada", "CEO", "idle", 0, 0],
      ["linus", "Engineer", "working", 1, 1],
      ["grace", "Engineer", "paused", 1, 0],
    ]);
    expect(rows[1]?.stats.runs).toBe(4);
    expect(rows[2]?.stats).toBe(EMPTY_RUN_STATS);
  });

  it("rolls people up into their departments", () => {
    const departments = departmentRows(snapshot, employeeRows(snapshot, dashboard));
    expect(departments.map((row) => [row.name, row.headcount, row.openCards, row.tokens])).toEqual([
      ["Executive", 1, 0, 0],
      ["Engineering", 2, 2, 1_200],
    ]);
  });
});

describe("attentionItems", () => {
  it("flags blocked and unassigned cards and threads whose latest run failed", () => {
    const attention = attentionItems(snapshot);
    expect(attention.blocked.map((task) => task.id)).toEqual(["billing"]);
    expect(attention.unassigned.map((task) => task.id)).toEqual(["docs"]);
    expect(attention.failed.map((thread) => thread.threadId)).toEqual(["thread-2"]);
    expect(hasAttentionItems(attention)).toBe(true);
    expect(hasAttentionItems(attentionItems({ ...snapshot, tasks: [], threads: [] }))).toBe(false);
  });

  it("leaves cards you keep for yourself out of the unassigned list", () => {
    const mine = { ...card("errand", "todo", null), assignedToUser: true };
    const attention = attentionItems({ ...snapshot, tasks: [...snapshot.tasks, mine] });
    expect(attention.unassigned.map((task) => task.id)).toEqual(["docs"]);
  });
});

describe("formatSpan", () => {
  it("keeps the two largest units", () => {
    expect(formatSpan(45_000)).toBe("45s");
    expect(formatSpan(12 * 60_000)).toBe("12m");
    expect(formatSpan(200 * 60_000)).toBe("3h 20m");
    expect(formatSpan(52 * 3_600_000)).toBe("2d 4h");
  });
});
