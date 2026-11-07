import type {
  BoardAgentId,
  BoardCompanyId,
  BoardRun,
  BoardRunId,
  BoardTask,
  BoardTaskId,
  BoardWorkLink,
  BoardWorkLinkId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import {
  gitTaskIndex,
  parseGitLog,
  parseUnmergedBranches,
  repositoryOf,
  timelineSpans,
} from "./boardTimeline.ts";

const task = (id: string) => id as BoardTaskId;
const pullRequest = (taskId: string, number: number): BoardWorkLink => ({
  id: `link-${number}` as BoardWorkLinkId,
  taskId: task(taskId),
  kind: "pull_request",
  title: `#${number}`,
  url: `https://github.com/acme/shop/pull/${number}`,
  status: "merged",
  agentId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});
const index = gitTaskIndex({
  branches: [
    { taskId: task("checkout"), branch: "board/fix-checkout-1", createdAt: "2026-10-01T00:00:00Z" },
    {
      taskId: task("pricing"),
      branch: "board/remove-pricing-2",
      createdAt: "2026-10-01T00:00:00Z",
    },
    { taskId: task("login"), branch: "board/fix-login-3", createdAt: "2026-10-01T00:00:00Z" },
    { taskId: task("docs"), branch: "board/docs-4", createdAt: "2026-10-01T00:00:00Z" },
    // Started from the commit below and never got one of its own.
    { taskId: task("report"), branch: "board/report-5", createdAt: "2026-11-02T10:00:00Z" },
  ],
  links: [pullRequest("search", 45), pullRequest("lessons", 62)],
});
const commit = (fields: ReadonlyArray<string>) => `\n${fields.join("\u001f")}\u001e`;

it("matches each landed commit to the task whose pull request or branch it carried", () => {
  const log = [
    commit([
      "a1",
      "p1 p2",
      "Grace",
      "2026-11-06T12:00:00-05:00",
      "HEAD -> main",
      "Merge pull request #45 from acme/board/search-5",
    ]),
    commit(["b2", "p3", "Ada", "2026-11-06T10:00:00Z", "", "lesson style checks under zoom (#62)"]),
    commit([
      "c3",
      "p4 p5",
      "Linus",
      "2026-11-05T09:00:00Z",
      "",
      "Merge board/fix-checkout-1: Fix checkout",
    ]),
    commit([
      "d4",
      "p6 p7",
      "Vera",
      "2026-11-04T09:00:00Z",
      "",
      "Merge branch 'board/remove-pricing-2'",
    ]),
    commit([
      "e5",
      "p8",
      "Ada",
      "2026-11-03T09:00:00Z",
      "board/fix-login-3, origin/main",
      "Fix login",
    ]),
    commit(["f6", "p9", "Ada", "2026-11-02T09:00:00Z", "board/report-5", "Bump deps"]),
  ].join("");
  const commits = parseGitLog(log, index);
  assert.deepEqual(
    commits.map((entry) => [entry.sha, entry.taskId, entry.pullRequest, entry.merge]),
    [
      ["a1", "search", 45, true],
      ["b2", "lessons", 62, false],
      ["c3", "checkout", null, true],
      ["d4", "pricing", null, true],
      ["e5", "login", null, false],
      ["f6", null, null, false],
    ],
  );
  assert.equal(commits[0]?.at, "2026-11-06T17:00:00.000Z");
});

it("lists only tasks' branches the checked-out branch doesn't have, newest first", () => {
  const output = [
    "board/docs-4\u001f2026-11-01T09:00:00Z\u001fDraft docs\u001e",
    "\nexperiment\u001f2026-11-05T09:00:00Z\u001fTry something\u001e",
    "\nboard/fix-login-3\u001f2026-11-03T09:00:00+01:00\u001fFix login\u001e\n",
  ].join("");
  assert.deepEqual(
    parseUnmergedBranches(output, index).map((branch) => [branch.name, branch.taskId, branch.at]),
    [
      ["board/fix-login-3", "login", "2026-11-03T08:00:00.000Z"],
      ["board/docs-4", "docs", "2026-11-01T09:00:00.000Z"],
    ],
  );
});

it("names one repository the same way from its remotes and its pull requests", () => {
  assert.deepEqual(
    [
      "git@github.com:CodingPhaseDotCom/codingphasev4.git\n",
      "https://github.com/codingphasedotcom/codingphasev4.git",
      "ssh://git@github.com/codingphasedotcom/codingphasev4",
      "https://github.com/codingphasedotcom/codingphasev4/pull/18",
    ].map(repositoryOf),
    Array(4).fill("github.com/codingphasedotcom/codingphasev4"),
  );
});

it("spans each top-level task from creation to done, with everyone who ran below it", () => {
  const agent = (id: string) => id as BoardAgentId;
  const boardTask = (id: string, fields: Partial<BoardTask>): BoardTask => ({
    id: task(id),
    companyId: "company" as BoardCompanyId,
    projectId: "project" as ProjectId,
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
    ...fields,
  });
  const run = (taskId: string, agentId: string, startedAt: string): BoardRun => ({
    id: `run-${taskId}-${startedAt}` as BoardRunId,
    taskId: task(taskId),
    agentId: agent(agentId),
    threadId: `thread-${taskId}` as ThreadId,
    kind: "work",
    status: "completed",
    startedAt,
    endedAt: null,
  });
  const entry = (value: BoardTask, statusChangedAt = value.createdAt) => ({
    task: value,
    statusChangedAt,
  });
  const spans = timelineSpans({
    tasks: [
      entry(boardTask("site", { status: "done" }), "2026-11-04T00:00:00.000Z"),
      entry(boardTask("copy", { status: "done", parentTaskId: task("site") })),
      entry(boardTask("headline", { status: "done", parentTaskId: task("copy") })),
      entry(boardTask("someday", { status: "backlog" })),
      entry(
        boardTask("fix", {
          status: "in_progress",
          assigneeAgentId: agent("qa"),
          createdAt: "2026-11-05T00:00:00.000Z",
        }),
      ),
    ],
    runs: [
      run("site", "lead", "2026-11-03T00:00:00.000Z"),
      run("headline", "designer", "2026-11-02T12:00:00.000Z"),
      run("copy", "writer", "2026-11-02T00:00:00.000Z"),
      run("site", "lead", "2026-11-01T01:00:00.000Z"),
    ],
  });
  assert.deepEqual(spans, [
    {
      taskId: task("fix"),
      start: "2026-11-05T00:00:00.000Z",
      end: null,
      agentIds: [agent("qa")],
      subtasks: 0,
    },
    {
      taskId: task("site"),
      start: "2026-11-01T00:00:00.000Z",
      end: "2026-11-04T00:00:00.000Z",
      agentIds: [agent("lead"), agent("writer"), agent("designer")],
      subtasks: 2,
    },
  ]);
});
