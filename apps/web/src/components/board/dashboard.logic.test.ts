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
  priorityTasks,
  recentThreads,
  successRate,
  worktreeGroups,
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

describe("priorityTasks", () => {
  it("puts live work first, then what waits on you, then the queue, and leaves out closed tasks", () => {
    const tasks = [
      card("idea", "backlog", null),
      card("queued", "todo", "linus"),
      card("review", "review", "linus"),
      card("stuck", "blocked", "grace"),
      { ...card("running", "todo", "linus"), activeRunKind: "work" as const },
      card("finished", "done", "linus"),
      { ...card("archived", "blocked", "linus"), archivedAt: "2026-10-21T00:00:00.000Z" },
    ];
    expect(priorityTasks(tasks, 10).map((task) => task.id)).toEqual([
      "running",
      "stuck",
      "review",
      "queued",
      "idea",
    ]);
    expect(priorityTasks(tasks, 2).map((task) => task.id)).toEqual(["running", "stuck"]);
  });

  it("shows the most recently touched task first within a column", () => {
    const older = card("older", "review", "linus");
    const newer = { ...card("newer", "review", "linus"), updatedAt: "2026-10-21T00:00:00.000Z" };
    expect(priorityTasks([older, newer], 10).map((task) => task.id)).toEqual(["newer", "older"]);
  });
});

describe("recentThreads", () => {
  it("lists the newest runs first and stops at the limit", () => {
    expect(recentThreads(snapshot.threads, 1).map((thread) => thread.threadId)).toEqual([
      "thread-1",
    ]);
    expect(
      recentThreads(snapshot.threads.toReversed(), 5).map((thread) => thread.threadId),
    ).toEqual(["thread-1", "thread-2"]);
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

describe("worktreeGroups", () => {
  const subtaskOf = (parent: string, id: string, status: BoardTask["status"]): BoardTask => ({
    ...card(id, status, null),
    parentTaskId: parent as BoardTaskId,
  });
  const open = (path: string, ...taskIds: ReadonlyArray<string>) => ({
    worktreePath: path,
    taskIds: taskIds as ReadonlyArray<BoardTaskId>,
  });
  const summary = (groups: ReturnType<typeof worktreeGroups>) =>
    groups.map((group) => ({
      rows: group.rows.map((row) => [row.task.id, row.depth, row.worktrees]),
      worktrees: group.worktrees,
      toFinish: group.toFinish,
    }));

  it("groups a subtask's worktree under its main task and counts what is left to finish", () => {
    expect(
      summary(
        worktreeGroups(
          [
            card("main", "in_progress", null),
            subtaskOf("main", "done-child", "done"),
            subtaskOf("main", "open-child", "backlog"),
            subtaskOf("done-child", "grandchild", "review"),
          ],
          [open("/a", "done-child"), open("/b", "main", "grandchild")],
        ),
      ),
    ).toEqual([
      {
        rows: [
          ["main", 0, 1],
          ["done-child", 1, 1],
          ["grandchild", 2, 1],
          ["open-child", 1, 0],
        ],
        worktrees: 2,
        toFinish: 3,
      },
    ]);
  });

  it("counts a worktree once for a tree when several of its tasks used it", () => {
    const [group] = worktreeGroups(
      [card("main", "review", null), subtaskOf("main", "child", "done")],
      [open("/a", "main", "child")],
    );
    expect(group?.worktrees).toBe(1);
  });

  it("treats an archived main task as finished even with open subtasks", () => {
    const [group] = worktreeGroups(
      [
        { ...card("main", "done", null), archivedAt: "2026-11-01T00:00:00.000Z" },
        subtaskOf("main", "child", "backlog"),
      ],
      [open("/a", "child")],
    );
    expect(group?.toFinish).toBe(0);
  });

  it("puts the groups closest to cleanup first and finished groups last", () => {
    const groups = worktreeGroups(
      [
        card("finished", "done", null),
        card("two-left", "review", null),
        subtaskOf("two-left", "other", "todo"),
        card("one-left", "review", null),
      ],
      [open("/a", "finished"), open("/b", "two-left"), open("/c", "one-left")],
    );
    expect(groups.map((group) => group.rows[0]?.task.id)).toEqual([
      "one-left",
      "two-left",
      "finished",
    ]);
  });

  it("ignores a worktree whose tasks are no longer on the board", () => {
    expect(worktreeGroups([card("main", "done", null)], [open("/a", "deleted")])).toEqual([]);
  });
});
