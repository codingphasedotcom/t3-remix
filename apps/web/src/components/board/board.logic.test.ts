import type {
  BoardAgent,
  BoardAgentId,
  BoardCompanyId,
  BoardTask,
  BoardTaskId,
  ProjectId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { dropPosition, groupTasksByStatus, orgChartRows } from "./board.logic";

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
    reviewerAgentId: null,
    parentTaskId: null,
    threadId: null,
    worktreePath: null,
    activeRunKind: null,
    createdByAgentId: null,
    commentCount: 0,
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
