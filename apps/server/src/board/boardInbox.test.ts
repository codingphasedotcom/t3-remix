import { assert, it } from "@effect/vitest";
import {
  BoardAgentId,
  BoardCompanyId,
  BoardTaskId,
  ProjectId,
  type BoardCompany,
  type BoardTask,
} from "@t3tools/contracts";

import type { StoredTask } from "./BoardStore.ts";
import { companyInbox, inboxCandidates } from "./boardInbox.ts";

const company: BoardCompany = {
  id: BoardCompanyId.make("company"),
  name: "Acme",
  mission: "",
  departments: [],
  memory: "",
  projectId: ProjectId.make("project"),
  ceoAgentId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const reviewer = BoardAgentId.make("reviewer");

function stored(id: string, patch: Partial<BoardTask>): StoredTask {
  return {
    task: {
      id: BoardTaskId.make(id),
      companyId: company.id,
      projectId: company.projectId,
      title: id,
      description: "",
      status: "todo",
      position: 0,
      assigneeAgentId: null,
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
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      ...patch,
    },
    statusChangedAt: "2026-11-02T00:00:00.000Z",
    branch: null,
    baseRef: null,
  };
}

const inboxOf = (tasks: ReadonlyArray<StoredTask>, lastReviewStartedAt: string | null = null) => {
  const candidates = inboxCandidates(tasks);
  return companyInbox({
    company,
    candidates,
    facts: new Map(
      candidates.map(({ stored: { task } }) => [
        task.id,
        { lastReviewStartedAt, lastAgentComment: null },
      ]),
    ),
    agentIds: new Set([reviewer]),
    hires: [],
  }).map((item) => `${item.kind}:${item.taskId}`);
};

it("asks for a review only when nobody else will review it", () => {
  assert.deepEqual(inboxOf([stored("mine", { status: "review" })]), ["review:mine"]);
  const reviewed = [stored("theirs", { status: "review", reviewerAgentId: reviewer })];
  // The reviewer has not had its turn, or had it before the task came back.
  assert.deepEqual(inboxOf(reviewed), []);
  assert.deepEqual(inboxOf(reviewed, "2026-11-01T12:00:00.000Z"), []);
  // It reviewed this visit and stopped without deciding.
  assert.deepEqual(inboxOf(reviewed, "2026-11-02T01:00:00.000Z"), ["review:theirs"]);
  // A removed reviewer leaves it with the person.
  assert.deepEqual(
    inboxOf([stored("orphan", { status: "review", reviewerAgentId: BoardAgentId.make("gone") })]),
    ["review:orphan"],
  );
});

it("asks about a blocked task only when nothing below it is moving", () => {
  const parent = stored("parent", { status: "blocked" });
  // A manager's subtasks come back to that manager for review.
  const child = (status: BoardTask["status"]) =>
    stored("child", { status, parentTaskId: parent.task.id, reviewerAgentId: reviewer });
  assert.deepEqual(inboxOf([parent]), ["blocked:parent"]);
  assert.deepEqual(inboxOf([parent, child("in_progress")]), []);
  assert.deepEqual(inboxOf([parent, child("review")]), []);
  // Its subtask is stuck too, and that subtask's manager is the parent's agent, not the person.
  assert.deepEqual(inboxOf([parent, child("blocked")]), ["blocked:parent"]);
  assert.deepEqual(inboxOf([parent, child("done")]), ["blocked:parent"]);
});

it("leaves out work in progress, archived tasks, and agents' to-dos", () => {
  assert.deepEqual(
    inboxOf([
      stored("running", { status: "review", activeRunKind: "work" }),
      stored("archived", { status: "review", archivedAt: "2026-11-03T00:00:00.000Z" }),
      stored("agent-todo", { status: "todo", assigneeAgentId: reviewer }),
      stored("my-todo", { status: "todo", assignedToUser: true }),
      stored("my-doing", { status: "in_progress", assignedToUser: true }),
    ]),
    ["todo:my-todo"],
  );
});
