import type {
  BoardAgent,
  BoardAgentId,
  BoardCompanyId,
  BoardTask,
  BoardTaskId,
  ProjectId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  dropPosition,
  employeeThreadTitle,
  groupTasksByStatus,
  limitProgress,
  localDateTimeInput,
  orgChartRows,
  parseTokenLimit,
  repeatLabel,
} from "./board.logic";

function card(id: string, status: BoardTask["status"], position: number): BoardTask {
  return {
    id: id as BoardTaskId,
    companyId: "company" as BoardCompanyId,
    projectId: "project" as ProjectId,
    title: id,
    description: "",
    status,
    position,
    assigneeAgentId: null,
    assignedToUser: false,
    reviewerAgentId: null,
    parentTaskId: null,
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

describe("dropPosition", () => {
  const column = [card("a", "todo", 1), card("b", "todo", 2), card("c", "todo", 4)];

  it("appends after the last card", () => {
    expect(dropPosition(column, null)).toBe(5);
    expect(dropPosition([], null)).toBe(1);
  });

  it("lands between the target and the card above it", () => {
    expect(dropPosition(column, "c" as BoardTaskId)).toBe(3);
    expect(dropPosition(column, "a" as BoardTaskId)).toBe(0);
  });
});

describe("groupTasksByStatus", () => {
  it("applies a pending drop before the server confirms it", () => {
    const tasks = [card("a", "todo", 1), card("b", "todo", 2)];
    const grouped = groupTasksByStatus(
      tasks,
      new Map([["a" as BoardTaskId, { status: "review" as const, position: 1 }]]),
    );
    expect(grouped.todo.map((task) => task.id)).toEqual(["b"]);
    expect(grouped.review.map((task) => task.id)).toEqual(["a"]);
  });
});

describe("orgChartRows", () => {
  const agent = (id: string, reportsToAgentId: string | null) =>
    ({ id, reportsToAgentId }) as unknown as BoardAgent;

  it("lists the CEO first and each manager just above its reports", () => {
    const agents = [
      agent("engineer", "cto"),
      agent("cto", "ceo"),
      agent("ceo", null),
      agent("designer", "ceo"),
      agent("stray", "removed-manager"),
    ];
    expect(
      orgChartRows(agents, "ceo" as BoardAgentId).map((row) => [row.agent.id, row.depth]),
    ).toEqual([
      ["ceo", 0],
      ["cto", 1],
      ["engineer", 2],
      ["designer", 1],
      ["stray", 0],
    ]);
  });
});

describe("employeeThreadTitle", () => {
  it("drops the employee's own name, which the sidebar tree already shows", () => {
    expect(employeeThreadTitle("Linus: Payment form", "Linus")).toBe("Payment form");
    expect(employeeThreadTitle("Review (Morgan): Payment form", "Morgan")).toBe(
      "Review: Payment form",
    );
    expect(employeeThreadTitle("Renamed by hand", "Linus")).toBe("Renamed by hand");
  });
});

describe("token limits", () => {
  it("reads limits the way people type them", () => {
    expect(parseTokenLimit("5M")).toBe(5_000_000);
    expect(parseTokenLimit("250k")).toBe(250_000);
    expect(parseTokenLimit("1,500,000")).toBe(1_500_000);
    expect(parseTokenLimit("1.5m")).toBe(1_500_000);
    expect(parseTokenLimit("  ")).toBeNull();
    expect(parseTokenLimit("lots")).toBe("invalid");
    expect(parseTokenLimit("0")).toBe("invalid");
  });

  it("warns from 80% and stops at the limit", () => {
    expect(limitProgress(500, null)).toBeNull();
    expect(limitProgress(700, 1_000)).toEqual({ share: 0.7, nearing: false, reached: false });
    expect(limitProgress(850, 1_000)).toEqual({ share: 0.85, nearing: true, reached: false });
    expect(limitProgress(1_000, 1_000)).toEqual({ share: 1, nearing: false, reached: true });
  });
});

describe("routines", () => {
  it("names how often a routine repeats", () => {
    expect([1, 7, 14, 30].map(repeatLabel)).toEqual([
      "Every day",
      "Every week",
      "Every 2 weeks",
      "Every 30 days",
    ]);
  });

  it("fills a datetime-local input in local time", () => {
    expect(localDateTimeInput(new Date(2026, 9, 21, 9, 5))).toBe("2026-10-21T09:05");
  });
});
