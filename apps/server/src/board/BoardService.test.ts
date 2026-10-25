import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  BoardError,
  ProjectId,
  ProviderInstanceId,
  type BoardAgentId,
  type BoardCompanyId,
  type BoardSnapshot,
  type BoardTaskId,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  type Project,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import type * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as BoardService from "./BoardService.ts";
import * as BoardStore from "./BoardStore.ts";

const projectId = ProjectId.make("project-1");
const model = { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" };
const user = { kind: "user" } as const;
const isBoardError = Schema.is(BoardError);

/** What a git command printed; `git` answers each one, in order, from the harness's script. */
interface GitReply {
  readonly exitCode?: number;
  readonly stdout?: string;
}

const pullRequestOpened = {
  action: "commit_push_pr",
  branch: { status: "skipped_not_requested" },
  commit: { status: "created" },
  push: { status: "pushed" },
  pr: {
    status: "created",
    url: "https://github.com/acme/shop/pull/7",
    number: 7,
    baseBranch: "main",
    title: "Fix checkout",
  },
  toast: { title: "Created PR", cta: { kind: "none" } },
} as unknown as GitRunStackedActionResult;

const makeHarness = Effect.gen(function* () {
  const launches = yield* Ref.make<ReadonlyArray<ThreadLaunchService.ThreadLaunchInput>>([]);
  const gitActions = yield* Ref.make<ReadonlyArray<GitRunStackedActionInput>>([]);
  const gitCommands = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
  const gitScript = yield* Ref.make<(args: ReadonlyArray<string>) => GitReply>(() => ({}));
  const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  // Messages to existing threads, in order; taking one waits until it has been sent.
  const sent = yield* Queue.unbounded<ThreadManagementService.ThreadManagementSendInput>();
  const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
    streamDomainEvents: Stream.fromQueue(events),
    sendToThread: (input) =>
      Queue.offer(sent, input).pipe(
        Effect.as({} as ThreadManagementService.ThreadManagementSendResult),
      ),
    dispatch: (command) =>
      Ref.update(dispatched, (all) => [...all, command]).pipe(
        Effect.as({} as Orchestrator.OrchestratorV2DispatchResult),
      ),
    // A settled thread has no queued follow-up.
    getThreadShell: () =>
      Effect.succeed({
        activeRunId: null,
        status: "completed",
      } as unknown as OrchestrationV2ThreadShell),
  });
  const launcher = Layer.mock(ThreadLaunchService.ThreadLaunchService)({
    checkWorktreeBase: () => Effect.void,
    launch: (input) =>
      Ref.update(launches, (all) => [...all, input]).pipe(
        Effect.as({
          threadId: input.threadId as ThreadId,
          projection: {
            thread: { worktreePath: `/worktrees/${String(input.threadId)}` },
          } as unknown as ThreadLaunchService.ThreadLaunchResult["projection"],
          resumed: false,
        }),
      ),
  });
  const folders = Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
    namedProjectsRoot: "/projects",
    createNamedProject: (input) =>
      Effect.succeed({
        projectId: ProjectId.make(`project-${input.name}`),
        workspaceRoot: `/projects/${input.name}`,
      }),
  });
  const projects = Layer.mock(ProjectService.ProjectService)({
    getById: () => Effect.succeed(Option.some({ workspaceRoot: "/repo" } as Project)),
    getShell: () => Effect.succeedNone,
  });
  const gitWorkflow = Layer.mock(GitWorkflowService.GitWorkflowService)({
    runStackedAction: (input) =>
      Ref.update(gitActions, (all) => [...all, input]).pipe(
        Effect.as(
          input.action === "commit_push_pr"
            ? pullRequestOpened
            : ({ commit: { status: "skipped_no_changes" } } as GitRunStackedActionResult),
        ),
      ),
  });
  const gitDriver = Layer.mock(GitVcsDriver.GitVcsDriver)({
    execute: (input) =>
      Effect.gen(function* () {
        yield* Ref.update(gitCommands, (all) => [...all, input.args]);
        const reply = (yield* Ref.get(gitScript))(input.args);
        return {
          exitCode: reply.exitCode ?? 0,
          stdout: reply.stdout ?? "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        } as GitVcsDriver.ExecuteGitResult;
      }),
  });
  const fileSystem = FileSystem.layerNoop({ realPath: (path) => Effect.succeed(path) });
  const layer = BoardService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        BoardStore.layer.pipe(Layer.provide(NodeCrypto.layer)),
        threads,
        launcher,
        folders,
        projects,
        gitWorkflow,
        gitDriver,
        fileSystem,
      ),
    ),
  );
  return { launches, events, sent, gitActions, gitCommands, gitScript, dispatched, layer };
});

/** Creates a company whose CEO, CTO, and engineer form a three-level chain. */
const createCompany = Effect.fn("test.createCompany")(function* (
  board: BoardService.BoardService["Service"],
) {
  const { company } = yield* board.runCommand(
    {
      type: "company.create",
      company: {
        name: "Acme",
        mission: "Ship the best widgets.",
        workspace: { type: "existing", projectId },
        ceo: {
          name: "Ada",
          instructions: "Lead well.",
          modelSelection: model,
          runtimeMode: "full-access",
        },
      },
    },
    user,
  );
  assert.isDefined(company);
  const ceoId = company!.ceoAgentId as BoardAgentId;
  const hire = Effect.fn("test.hire")(function* (name: string, reportsTo: BoardAgentId) {
    const { agent } = yield* board.runCommand(
      {
        type: "agent.upsert",
        agent: {
          companyId: company!.id,
          name,
          title: name === "Lead" ? "CTO" : "Engineer",
          reportsToAgentId: reportsTo,
          skillIds: [],
          instructions: "",
          modelSelection: model,
          runtimeMode: "full-access",
        },
      },
      user,
    );
    assert.isDefined(agent);
    return agent!;
  });
  const lead = yield* hire("Lead", ceoId);
  const engineer = yield* hire("Engineer", lead.id);
  return { company: company!, ceoId, lead, engineer };
});

/** Waits on the persisted board rather than on launch calls, so every write has landed. */
const boardWhere = (
  board: BoardService.BoardService["Service"],
  companyId: BoardCompanyId,
  matches: (snapshot: BoardSnapshot) => boolean,
) =>
  board
    .subscribe(companyId)
    .pipe(Stream.filter(matches), Stream.runHead, Effect.map(Option.getOrThrow));

const threadOf = (snapshot: BoardSnapshot, taskId: BoardTaskId | undefined) =>
  snapshot.tasks.find((task) => task.id === taskId)?.threadId ?? null;

it.effect("a manager's delegated task runs, then comes back to that manager for review", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId, lead, engineer } = yield* createCompany(board);

      // The board gives the CTO a task; it starts in its own thread.
      const { task: parent } = yield* board.runCommand(
        {
          type: "task.create",
          task: { companyId: company.id, title: "Build checkout", assigneeAgentId: lead.id },
        },
        user,
      );
      const started = yield* boardWhere(
        board,
        company.id,
        (snapshot) => threadOf(snapshot, parent?.id) !== null,
      );
      const leadThread = threadOf(started, parent?.id)!;
      const [leadLaunch] = yield* Ref.get(harness.launches);
      const prompt = leadLaunch?.initialMessage?.text ?? "";
      assert.include(prompt, "Acme");
      assert.include(prompt, "Ship the best widgets.");
      assert.include(prompt, "You report to Ada (CEO).");
      assert.include(prompt, "Engineer (Engineer, Executive)");

      // The CTO delegates to its engineer and becomes the subtask's reviewer.
      const asLead = { kind: "agent", threadId: leadThread } as const;
      const subtask = yield* board.createTask(
        {
          companyId: company.id,
          title: "Payment form",
          parentTaskId: parent!.id,
          assigneeAgentId: engineer.id,
        },
        asLead,
      );
      assert.equal(subtask.reviewerAgentId, lead.id);
      assert.equal(subtask.status, "todo");
      assert.equal(subtask.createdByAgentId, lead.id);

      // The CTO cannot hand work to the CEO above it.
      const refused = yield* board
        .createTask(
          { companyId: company.id, title: "Approve budget", assigneeAgentId: ceoId },
          asLead,
        )
        .pipe(Effect.flip);
      assert.isTrue(isBoardError(refused));
      assert.include(refused.message, "within your reporting line");

      // The engineer works in the CTO's worktree, so the parent branch collects the work.
      const working = yield* boardWhere(
        board,
        company.id,
        (snapshot) => threadOf(snapshot, subtask.id) !== null,
      );
      const engineerLaunch = (yield* Ref.get(harness.launches)).find(
        (launch) => launch.threadId === threadOf(working, subtask.id),
      );
      assert.deepEqual(engineerLaunch?.workspaceStrategy, {
        type: "existing_worktree",
        worktreePath: `/worktrees/${String(leadThread)}`,
      });

      // The CTO parks its own task while the subtask is worked, and its turn ends.
      const finish = finishRun(harness);
      yield* board.updateTask({ id: parent!.id, status: "blocked" }, asLead);
      yield* finish(leadThread, "run-lead");

      // The engineer's run ends without moving its task; the CTO reviews it in the thread where
      // it delegated, so it opens no thread per subtask.
      yield* finish(threadOf(working, subtask.id)!, "run-engineer");
      const reviewing = yield* boardWhere(board, company.id, (snapshot) =>
        snapshot.tasks.some((task) => task.id === subtask.id && task.activeRunKind === "review"),
      );
      assert.equal(reviewing.tasks.find((task) => task.id === subtask.id)?.status, "review");
      const review = yield* Queue.take(harness.sent);
      assert.equal(review.threadId, leadThread);
      assert.include(review.text, `Engineer finished the subtask "Payment form" (${subtask.id})`);
      assert.include(review.text, "## How to review");
      assert.notInclude(review.text, "Ship the best widgets.");
      assert.lengthOf(yield* Ref.get(harness.launches), 2);
      // Each employee's threads are listed for the sidebar, newest first.
      assert.deepEqual(
        reviewing.threads.map((thread) => [thread.agentId, thread.kind]),
        [
          [lead.id, "review"],
          [engineer.id, "work"],
        ],
      );
      const detail = yield* board.taskDetail(subtask.id);
      assert.deepEqual(
        detail.runs.map((run) => [run.kind, run.agentId, run.status]),
        [
          ["work", engineer.id, "completed"],
          ["review", lead.id, "running"],
        ],
      );
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("tells every agent which folder, branch, and base it works in", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId, lead, engineer } = yield* createCompany(board);
      yield* board.runCommand(
        {
          type: "settings.update",
          settings: { companyId: company.id, baseRef: "main", maxConcurrentRuns: 5 },
        },
        user,
      );
      const launchFor = Effect.fn("test.launchFor")(function* (taskId: BoardTaskId | undefined) {
        const snapshot = yield* boardWhere(
          board,
          company.id,
          (current) => threadOf(current, taskId) !== null,
        );
        const launch = (yield* Ref.get(harness.launches)).find(
          (candidate) => candidate.threadId === threadOf(snapshot, taskId),
        );
        assert.isDefined(launch);
        return launch!;
      });

      // A top-level task gets its own worktree on a branch named before launch.
      const { task: parent } = yield* board.runCommand(
        {
          type: "task.create",
          task: { companyId: company.id, title: "Build checkout", assigneeAgentId: lead.id },
        },
        user,
      );
      const leadLaunch = yield* launchFor(parent?.id);
      const strategy = leadLaunch.workspaceStrategy;
      assert.equal(strategy.type, "worktree");
      const branch = strategy.branch ?? "";
      assert.match(branch, /^board\/build-checkout-[0-9a-f]{8}$/);
      const leadPrompt = leadLaunch.initialMessage?.text ?? "";
      assert.include(leadPrompt, "## Where you work");
      assert.include(leadPrompt, "- Folder: a new git worktree made for this task.");
      assert.include(leadPrompt, `- Branch: ${branch}, made for this task.`);
      assert.include(leadPrompt, "- Base: main.");
      assert.include(leadPrompt, "- Shared: no other task works here.");
      assert.include(
        leadPrompt,
        "- Not here: work from other tasks that has not been merged into main.",
      );

      // A subtask works in its parent's worktree and branch, alongside its siblings.
      const asLead = { kind: "agent", threadId: leadLaunch.threadId as ThreadId } as const;
      yield* board.createTask(
        {
          companyId: company.id,
          title: "Receipts",
          parentTaskId: parent!.id,
          assigneeAgentId: engineer.id,
          status: "backlog",
        },
        asLead,
      );
      const subtask = yield* board.createTask(
        {
          companyId: company.id,
          title: "Payment form",
          parentTaskId: parent!.id,
          assigneeAgentId: engineer.id,
        },
        asLead,
      );
      const subtaskPrompt = (yield* launchFor(subtask.id)).initialMessage?.text ?? "";
      assert.include(
        subtaskPrompt,
        `- Folder: /worktrees/${String(leadLaunch.threadId)} (the git worktree of your parent task "Build checkout").`,
      );
      assert.include(subtaskPrompt, `- Branch: ${branch}, your parent task's branch.`);
      assert.include(subtaskPrompt, "- Base: main.");
      assert.include(
        subtaskPrompt,
        '- Shared: yes, with your parent task and its other subtasks: "Receipts" (Engineer, Ideas).',
      );
      assert.include(subtaskPrompt, "merged into main");

      // Without worktrees, agents share the project's own checkout.
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, useWorktrees: false } },
        user,
      );
      const { task: shared } = yield* board.runCommand(
        {
          type: "task.create",
          task: { companyId: company.id, title: "Fix typo", assigneeAgentId: ceoId },
        },
        user,
      );
      const sharedLaunch = yield* launchFor(shared?.id);
      assert.deepEqual(sharedLaunch.workspaceStrategy, { type: "root" });
      const sharedPrompt = sharedLaunch.initialMessage?.text ?? "";
      assert.include(sharedPrompt, "- Folder: /repo (the project's own checkout, not a worktree).");
      assert.include(sharedPrompt, "- Shared: yes, with every agent working without a worktree");
      assert.include(sharedPrompt, "merges it into the branch checked out here");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("puts every employee in exactly one of the company's departments", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId, lead, engineer } = yield* createCompany(board);
      assert.deepEqual(
        company.departments.map((department) => department.name),
        ["Executive", "Design", "Marketing", "Engineering", "Customer Support"],
      );
      const [executive, design, marketing, engineering, support] = company.departments;
      const departmentOf = (agentId: BoardAgentId) =>
        board
          .snapshot(company.id)
          .pipe(
            Effect.map(
              (snapshot) => snapshot.agents.find((agent) => agent.id === agentId)?.departmentId,
            ),
          );
      assert.equal(yield* departmentOf(ceoId), executive!.id);

      // People join their manager's department unless they are placed elsewhere.
      yield* board.runCommand(
        { type: "agent.upsert", agent: { ...lead, departmentId: engineering!.id } },
        user,
      );
      assert.equal(yield* departmentOf(lead.id), engineering!.id);
      const { agent: hire } = yield* board.runCommand(
        {
          type: "agent.upsert",
          agent: {
            companyId: company.id,
            name: "Rita",
            title: "Engineer",
            reportsToAgentId: lead.id,
            skillIds: [],
            instructions: "",
            modelSelection: model,
            runtimeMode: "full-access",
          },
        },
        user,
      );
      assert.equal(hire?.departmentId, engineering!.id);
      assert.equal(yield* departmentOf(engineer.id), executive!.id);

      // Departments can be renamed, added, and removed once nobody is in them.
      const occupied = yield* board
        .runCommand(
          {
            type: "company.update",
            company: { id: company.id, departments: [executive!, design!, support!] },
          },
          user,
        )
        .pipe(Effect.flip);
      assert.include(occupied.message, "Move Lead, Rita out of Engineering");
      const duplicate = yield* board
        .runCommand(
          {
            type: "company.update",
            company: {
              id: company.id,
              departments: [executive!, engineering!, { name: "engineering" }],
            },
          },
          user,
        )
        .pipe(Effect.flip);
      assert.include(duplicate.message, 'two "engineering" departments');
      const { company: updated } = yield* board.runCommand(
        {
          type: "company.update",
          company: {
            id: company.id,
            departments: [
              executive!,
              engineering!,
              { id: support!.id, name: "Support" },
              { name: "Sales" },
            ],
          },
        },
        user,
      );
      assert.deepEqual(
        updated?.departments.map((department) => department.name),
        ["Executive", "Engineering", "Support", "Sales"],
      );
      assert.equal(updated?.departments[2]?.id, support!.id);
      assert.isFalse(updated?.departments.some((department) => department.id === marketing!.id));

      // Agents see their department and who is in each one.
      yield* board.runCommand(
        {
          type: "task.create",
          task: { companyId: company.id, title: "Plan the API", assigneeAgentId: lead.id },
        },
        user,
      );
      yield* boardWhere(board, company.id, (snapshot) =>
        snapshot.tasks.some((task) => task.threadId !== null),
      );
      const [launch] = yield* Ref.get(harness.launches);
      const prompt = launch?.initialMessage?.text ?? "";
      assert.include(prompt, "You are Lead, a CTO in Engineering at Acme");
      assert.include(
        prompt,
        "Departments: Executive (Ada, Engineer); Engineering (Lead, Rita); Support (nobody yet); Sales (nobody yet).",
      );
      assert.include(prompt, "- Rita (Engineer, Engineering)");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("answers a person's comment right away and keeps it in later prompts", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead, engineer } = yield* createCompany(board);
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, maxConcurrentRuns: 5 } },
        user,
      );
      const { task } = yield* board.runCommand(
        {
          type: "task.create",
          task: {
            companyId: company.id,
            title: "Fix the funnel",
            assigneeAgentId: lead.id,
            status: "backlog",
          },
        },
        user,
      );
      const taskNow = (snapshot: BoardSnapshot) =>
        snapshot.tasks.find((candidate) => candidate.id === task?.id);
      const settle = Effect.fn("test.settle")(function* (threadId: ThreadId, id: string) {
        yield* Queue.offer(harness.events, {
          type: "run.updated",
          threadId,
          payload: { id, status: "completed" },
        } as unknown as OrchestrationV2DomainEvent);
        return yield* boardWhere(
          board,
          company.id,
          (snapshot) => taskNow(snapshot)?.activeRunKind === null,
        );
      });

      // Nobody is working the task, so its owner is started just to answer, in a short prompt.
      yield* board.addComment({ taskId: task!.id, body: "Only merge once it is verified." }, user);
      yield* boardWhere(
        board,
        company.id,
        (snapshot) => taskNow(snapshot)?.activeRunKind === "reply",
      );
      const [reply] = yield* Ref.get(harness.launches);
      const replyPrompt = reply?.initialMessage?.text ?? "";
      assert.include(replyPrompt, "## Reply now");
      assert.include(replyPrompt, "- On this task (new): Only merge once it is verified.");
      assert.notInclude(replyPrompt, "Departments:");
      assert.notInclude(replyPrompt, "## What you remember");
      // The reply opens the task's own thread, in the task's workspace.
      assert.equal(reply?.workspaceStrategy.type, "worktree");
      const replied = yield* settle(reply!.threadId as ThreadId, "run-reply-1");
      const taskThread = reply!.threadId as ThreadId;
      assert.equal(taskNow(replied)?.status, "backlog");
      assert.equal(taskNow(replied)?.threadId, taskThread);
      assert.lengthOf(yield* Ref.get(harness.launches), 1);

      // The next comment continues that thread with just what is new. Time has to pass for it
      // to come after the reply that ended.
      yield* TestClock.adjust("1 minute");
      yield* board.addComment({ taskId: task!.id, body: "Use the staging site." }, user);
      yield* boardWhere(
        board,
        company.id,
        (snapshot) => taskNow(snapshot)?.activeRunKind === "reply",
      );
      const secondReply = yield* Queue.take(harness.sent);
      assert.equal(secondReply?.threadId, taskThread);
      assert.include(secondReply?.text ?? "", "- On this task (new): Use the staging site.");
      assert.include(secondReply?.text ?? "", "- On this task: Only merge once it is verified.");
      assert.notInclude(secondReply?.text ?? "", "You are Lead");
      yield* settle(taskThread, "run-reply-2");

      // Work continues the same thread too, starting with the full work prompt.
      yield* board.runCommand(
        { type: "task.update", task: { id: task!.id, status: "todo" } },
        user,
      );
      yield* boardWhere(
        board,
        company.id,
        (snapshot) => taskNow(snapshot)?.activeRunKind === "work",
      );
      const work = yield* Queue.take(harness.sent);
      assert.equal(work?.threadId, taskThread);
      assert.include(work?.text ?? "", "## Where you work");
      assert.include(work?.text ?? "", "- On this task: Only merge once it is verified.");
      assert.lengthOf(yield* Ref.get(harness.launches), 1);

      // People's instructions reach subtasks below the task.
      const subtask = yield* board.createTask(
        {
          companyId: company.id,
          title: "Fix the signup button",
          parentTaskId: task!.id,
          assigneeAgentId: engineer.id,
        },
        { kind: "agent", threadId: taskThread },
      );
      yield* boardWhere(board, company.id, (snapshot) =>
        snapshot.tasks.some(
          (candidate) => candidate.id === subtask.id && candidate.threadId !== null,
        ),
      );
      const subtaskPrompt = (yield* Ref.get(harness.launches)).at(-1)?.initialMessage?.text ?? "";
      assert.include(subtaskPrompt, '- On "Fix the funnel": Use the staging site.');

      // A comment on a task someone is working reaches that thread at once.
      const launchesBefore = (yield* Ref.get(harness.launches)).length;
      yield* board.addComment({ taskId: task!.id, body: "Ship it behind a flag." }, user);
      const forwarded = yield* Queue.take(harness.sent);
      assert.equal(forwarded?.threadId, taskThread);
      assert.include(forwarded?.text ?? "", "Ship it behind a flag.");
      assert.include(forwarded?.text ?? "", "Reply on the board with board_add_comment");
      assert.lengthOf(yield* Ref.get(harness.launches), launchesBefore);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("keeps the org chart a tree with the CEO at the top", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId, lead, engineer } = yield* createCompany(board);

      const cycle = yield* board
        .runCommand(
          { type: "agent.upsert", agent: { ...lead, reportsToAgentId: engineer.id } },
          user,
        )
        .pipe(Effect.flip);
      assert.include(cycle.message, "beneath it");

      const removeCeo = yield* board
        .runCommand({ type: "agent.delete", id: ceoId }, user)
        .pipe(Effect.flip);
      assert.include(removeCeo.message, "always has a CEO");

      // Removing a manager moves its reports up to the manager's manager.
      yield* board.runCommand({ type: "agent.delete", id: lead.id }, user);
      const snapshot = yield* board.snapshot(company.id);
      assert.equal(
        snapshot.agents.find((agent) => agent.id === engineer.id)?.reportsToAgentId,
        ceoId,
      );
      assert.deepEqual(
        snapshot.companies.map((summary) => [summary.name, summary.agentCount]),
        [["Acme", 2]],
      );
      // Summaries carry who can be @mentioned, by job.
      assert.deepEqual(
        snapshot.companies[0]?.members.map((member) => [member.name, member.title]),
        [
          ["Ada", "CEO"],
          ["Engineer", "Engineer"],
        ],
      );
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("adds an agent only once a person approves its hire request", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead } = yield* createCompany(board);
      const { skill } = yield* board.runCommand(
        {
          type: "skill.upsert",
          skill: {
            companyId: company.id,
            name: "Frontend",
            description: "React work",
            instructions: "Use the design system.",
          },
        },
        user,
      );

      // The CTO, working a task, asks for a designer.
      const { task } = yield* board.runCommand(
        {
          type: "task.create",
          task: { companyId: company.id, title: "Redesign", assigneeAgentId: lead.id },
        },
        user,
      );
      const started = yield* boardWhere(
        board,
        company.id,
        (snapshot) => threadOf(snapshot, task?.id) !== null,
      );
      const design = company.departments.find((department) => department.name === "Design");
      const hire = yield* board.requestHire(
        {
          companyId: company.id,
          name: "Dana",
          title: "Designer",
          departmentId: design!.id,
          reportsToAgentId: null,
          skillIds: [skill!.id],
          instructions: "Own the visual design.",
          reason: "Nobody on the team designs.",
        },
        { kind: "agent", threadId: threadOf(started, task?.id)! },
      );
      assert.equal(hire.status, "pending");
      assert.equal(hire.reportsToAgentId, lead.id);
      const before = yield* board.snapshot(company.id);
      assert.isFalse(before.agents.some((agent) => agent.name === "Dana"));

      const { agent } = yield* board.runCommand(
        { type: "hire.decide", hire: { id: hire.id, approve: true } },
        user,
      );
      assert.equal(agent?.reportsToAgentId, lead.id);
      assert.equal(agent?.departmentId, design!.id);
      assert.deepEqual(agent?.skillIds, [skill!.id]);
      assert.deepEqual(agent?.modelSelection, model);
      const after = yield* board.snapshot(company.id);
      assert.equal(after.hires.find((candidate) => candidate.id === hire.id)?.status, "approved");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("returns a split task to its owner once every subtask is done", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company } = yield* createCompany(board);
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, autoDispatch: false } },
        user,
      );
      const create = Effect.fn("test.create")(function* (
        title: string,
        parentTaskId: BoardTaskId | null,
      ) {
        const { task } = yield* board.runCommand(
          {
            type: "task.create",
            task: {
              companyId: company.id,
              title,
              status: parentTaskId === null ? "blocked" : "review",
              parentTaskId,
            },
          },
          user,
        );
        return task!;
      });
      const parent = yield* create("Ship billing", null);
      const first = yield* create("Schema", parent.id);
      const second = yield* create("API", parent.id);

      yield* board.updateTask({ id: first.id, status: "done" }, user);
      assert.equal((yield* board.taskDetail(parent.id)).task.status, "blocked");
      yield* board.updateTask({ id: second.id, status: "done" }, user);
      const resumed = yield* board.taskDetail(parent.id);
      assert.equal(resumed.task.status, "todo");
      assert.include(resumed.comments.at(-1)?.body ?? "", "Every subtask is done");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("the dashboard credits runs and tokens to each employee and the model it ran", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const sql = yield* SqlClient.SqlClient;
      const { company, lead, engineer } = yield* createCompany(board);
      const { task } = yield* board.runCommand(
        {
          type: "task.create",
          task: { companyId: company.id, title: "Fix login", assigneeAgentId: engineer.id },
        },
        user,
      );
      const started = yield* boardWhere(
        board,
        company.id,
        (snapshot) => threadOf(snapshot, task?.id) !== null,
      );
      const threadId = threadOf(started, task?.id)!;
      const [run] = (yield* board.taskDetail(task!.id)).runs;

      // The thread ran a different model than the engineer's default, and spent two turns.
      yield* sql`
        INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
          created_at, updated_at, payload_json
        )
        VALUES (
          ${threadId}, ${projectId}, 'Fix login', 'claude', 'full-access', 'default',
          ${run!.startedAt}, ${run!.startedAt},
          ${JSON.stringify({ modelSelection: { instanceId: "claude", model: "opus" } })}
        )
      `;
      for (const [ordinal, input, output] of [
        [1, 1_000, 200],
        [2, 500, 100],
      ] as const) {
        yield* sql`
          INSERT INTO orchestration_v2_projection_provider_turns (
            provider_turn_id, thread_id, provider_thread_id, node_id, ordinal, status,
            started_at, completed_at, payload_json
          )
          VALUES (
            ${`turn-${ordinal}`}, ${threadId}, 'provider-thread', 'node', ${ordinal}, 'completed',
            ${run!.startedAt}, ${run!.startedAt},
            ${JSON.stringify({
              turnTokenUsage: {
                usageStatus: "complete",
                inputTokens: input,
                cachedInputTokens: input / 2,
                outputTokens: output,
              },
            })}
          )
        `;
      }

      yield* Queue.offer(harness.events, {
        type: "run.updated",
        threadId,
        payload: { id: "run-engineer", status: "completed" },
      } as unknown as OrchestrationV2DomainEvent);
      yield* boardWhere(board, company.id, (snapshot) =>
        snapshot.threads.some(
          (thread) => thread.threadId === threadId && thread.status !== "running",
        ),
      );
      yield* board.updateTask({ id: task!.id, status: "done" }, user);

      const dashboard = yield* board.dashboard({ companyId: company.id, utcOffsetMinutes: 0 });
      const statsOf = (agentId: BoardAgentId) =>
        dashboard.agents.find((entry) => entry.agentId === agentId)?.stats;
      assert.deepInclude(statsOf(engineer.id), {
        runs: 1,
        completed: 1,
        running: 0,
        tokens: { input: 1_500, cachedInput: 750, output: 300 },
      });
      assert.equal(statsOf(lead.id)?.runs, 0);
      assert.deepEqual(
        dashboard.models.map((entry) => [
          entry.modelSelection.model,
          entry.agentIds,
          entry.stats.runs,
        ]),
        [["opus", [engineer.id], 1]],
      );
      assert.equal(dashboard.totals.tokens.output, 300);
      assert.equal(dashboard.days.length, 14);
      const sum = (pick: (day: (typeof dashboard.days)[number]) => number) =>
        dashboard.days.reduce((total, day) => total + pick(day), 0);
      assert.deepEqual(
        [sum((day) => day.runs), sum((day) => day.tasksFinished), sum((day) => day.tokens)],
        [1, 1, 1_800],
      );
      assert.isNotNull(dashboard.medianCycleMs);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("creates a project folder for a company that asks for a new workspace", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company } = yield* board.runCommand(
        {
          type: "company.create",
          company: {
            name: "Globex",
            mission: "",
            workspace: { type: "new", folderName: "globex" },
            ceo: {
              name: "Hank",
              instructions: "",
              modelSelection: model,
              runtimeMode: "full-access",
            },
          },
        },
        user,
      );
      assert.equal(company?.projectId, ProjectId.make("project-globex"));
      assert.equal(company?.name, "Globex");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("lessons an agent remembers reach its next task's prompt", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId, engineer } = yield* createCompany(board);
      // Three tasks run at once below; the default allows two.
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, maxConcurrentRuns: 5 } },
        user,
      );
      const startCard = Effect.fn("test.startCard")(function* (
        title: string,
        assigneeAgentId: BoardAgentId,
      ) {
        const { task } = yield* board.runCommand(
          { type: "task.create", task: { companyId: company.id, title, assigneeAgentId } },
          user,
        );
        const started = yield* boardWhere(
          board,
          company.id,
          (snapshot) => threadOf(snapshot, task?.id) !== null,
        );
        return { task: task!, threadId: threadOf(started, task?.id)! };
      });

      const first = yield* startCard("Fix the build", engineer.id);
      const asEngineer = { kind: "agent", threadId: first.threadId } as const;
      const saved = yield* board.remember(
        { scope: "self", note: "Run tests with pnpm test, not npm." },
        asEngineer,
      );
      assert.include(saved.memory, "Run tests with pnpm test, not npm.");

      // Individual contributors keep lessons to themselves; managers write company memory.
      const denied = yield* board
        .remember({ scope: "company", note: "Use tabs." }, asEngineer)
        .pipe(Effect.flip);
      assert.include(denied.message, "Only the CEO and managers");
      const ceoCard = yield* startCard("Set direction", ceoId);
      // A date the agent wrote itself is dropped; the line already carries one.
      const companyMemory = yield* board.remember(
        { scope: "company", note: "2026-10-20 (Ada): We support Node 20 and newer." },
        { kind: "agent", threadId: ceoCard.threadId },
      );
      assert.match(
        companyMemory.memory,
        /^- \d{4}-\d{2}-\d{2} \(Ada\): We support Node 20 and newer\.$/,
      );

      // A memory past its limit has to be condensed instead of growing.
      const tooLong = yield* board
        .rewriteMemory({ scope: "self", content: "x".repeat(9_000) }, asEngineer)
        .pipe(Effect.flip);
      assert.include(tooLong.message, "the limit is 8000");

      const second = yield* startCard("Add a flag", engineer.id);
      const launch = (yield* Ref.get(harness.launches)).find(
        (candidate) => candidate.threadId === second.threadId,
      );
      const prompt = launch?.initialMessage?.text ?? "";
      assert.include(prompt, "## What you remember");
      assert.include(prompt, "Run tests with pnpm test, not npm.");
      assert.include(prompt, "(Ada): We support Node 20 and newer.");

      yield* board.addComment(
        { taskId: first.task.id, body: "Fixed by pinning esbuild." },
        asEngineer,
      );
      const matches = yield* board.searchCards(company.id, "esbuild");
      assert.deepEqual(
        matches.map((match) => [match.task.title, match.summary]),
        [["Fix the build", "Fixed by pinning esbuild."]],
      );
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

/** Starts `title` for `assigneeAgentId` and waits until its thread is recorded. */
const startTaskFor = Effect.fn("test.startTaskFor")(function* (
  board: BoardService.BoardService["Service"],
  companyId: BoardCompanyId,
  title: string,
  assigneeAgentId: BoardAgentId,
) {
  const { task } = yield* board.runCommand(
    { type: "task.create", task: { companyId, title, assigneeAgentId } },
    user,
  );
  const started = yield* boardWhere(
    board,
    companyId,
    (snapshot) => threadOf(snapshot, task?.id) !== null,
  );
  return { task: task!, threadId: threadOf(started, task?.id)! };
});

const finishRun = (harness: { readonly events: Queue.Queue<OrchestrationV2DomainEvent> }) =>
  Effect.fn("test.finishRun")(function* (threadId: ThreadId, id: string) {
    yield* Queue.offer(harness.events, {
      type: "run.updated",
      threadId,
      payload: { id, status: "completed" },
    } as unknown as OrchestrationV2DomainEvent);
  });

it.effect("a busy manager's review waits for its thread unless a person starts it now", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead, engineer } = yield* createCompany(board);
      const parent = yield* startTaskFor(board, company.id, "Build checkout", lead.id);
      const subtask = yield* board.createTask(
        {
          companyId: company.id,
          title: "Payment form",
          parentTaskId: parent.task.id,
          assigneeAgentId: engineer.id,
        },
        { kind: "agent", threadId: parent.threadId },
      );
      const working = yield* boardWhere(
        board,
        company.id,
        (snapshot) => threadOf(snapshot, subtask.id) !== null,
      );

      // The CTO is still working its own task, so the finished subtask waits for review.
      yield* finishRun(harness)(threadOf(working, subtask.id)!, "run-engineer");
      yield* boardWhere(board, company.id, (snapshot) =>
        snapshot.tasks.some((task) => task.id === subtask.id && task.status === "review"),
      );
      yield* board.runCommand({ type: "task.start", id: subtask.id }, user);
      const review = (yield* Ref.get(harness.launches)).at(-1);
      assert.equal(review?.title, "Review (Lead): Payment form");
      assert.notEqual(review?.threadId, parent.threadId);
      assert.equal(yield* Queue.size(harness.sent), 0);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("lists long skills by name for the agent to read when needed", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead } = yield* createCompany(board);
      const { skill } = yield* board.runCommand(
        {
          type: "skill.upsert",
          skill: {
            companyId: company.id,
            name: "Release process",
            description: "How we ship.",
            instructions: "Step. ".repeat(500),
          },
        },
        user,
      );
      yield* board.runCommand(
        { type: "agent.upsert", agent: { ...lead, skillIds: [skill!.id] } },
        user,
      );
      yield* startTaskFor(board, company.id, "Ship v2", lead.id);
      const prompt = (yield* Ref.get(harness.launches)).at(-1)?.initialMessage?.text ?? "";
      assert.include(prompt, "Read each skill that applies to this task with board_read_skill");
      assert.include(prompt, "- Release process: How we ship.");
      assert.notInclude(prompt, "Step. Step.");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("wakes the manager when a subtask gets stuck, not when it waits on its own", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead, engineer } = yield* createCompany(board);
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, maxConcurrentRuns: 5 } },
        user,
      );
      const finish = finishRun(harness);
      const parent = yield* startTaskFor(board, company.id, "Launch checkout", lead.id);
      const asLead = { kind: "agent", threadId: parent.threadId } as const;
      const subtask = yield* board.createTask(
        {
          companyId: company.id,
          title: "Wire up payments",
          parentTaskId: parent.task.id,
          assigneeAgentId: engineer.id,
        },
        asLead,
      );
      yield* board.updateTask({ id: parent.task.id, status: "blocked" }, asLead);
      yield* finish(parent.threadId, "run-lead");
      const working = yield* boardWhere(
        board,
        company.id,
        (snapshot) =>
          threadOf(snapshot, subtask.id) !== null &&
          // The lead's run has to end before the clock moves, or it ends at the same instant the
          // subtask is blocked and the subtask never counts as blocked since the lead last ran.
          snapshot.tasks.find((task) => task.id === parent.task.id)?.activeRunKind === null,
      );
      const asEngineer = { kind: "agent", threadId: threadOf(working, subtask.id)! } as const;

      yield* TestClock.adjust("1 minute");
      yield* board.addComment(
        { taskId: subtask.id, body: "I need the Stripe API key to go on." },
        asEngineer,
      );
      yield* board.updateTask({ id: subtask.id, status: "blocked" }, asEngineer);
      const escalation = yield* Queue.take(harness.sent);
      assert.equal(escalation.threadId, parent.threadId);
      assert.include(escalation.text, "## Blocked below you");
      assert.include(escalation.text, "I need the Stripe API key to go on.");
      assert.notInclude(escalation.text, "## Reply now");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("links a task's branch and the work its agent reports", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead } = yield* createCompany(board);
      const { task, threadId } = yield* startTaskFor(board, company.id, "Fix checkout", lead.id);
      const asLead = { kind: "agent", threadId } as const;
      const url = "https://github.com/acme/shop/pull/4";
      yield* board.linkWork(
        { taskId: task.id, kind: "pull_request", title: "PR #4", url, status: null },
        asLead,
      );
      yield* board.linkWork(
        { taskId: task.id, kind: "pull_request", title: "PR #4", url, status: "merged" },
        asLead,
      );
      const detail = yield* board.taskDetail(task.id);
      assert.deepEqual(
        detail.links.map((link) => [link.kind, link.status, link.agentId]),
        [
          ["branch", null, null],
          ["pull_request", "merged", lead.id],
        ],
      );
      assert.match(detail.links[0]!.title, /^board\/fix-checkout-[0-9a-f]{8}$/);

      yield* board.runCommand({ type: "link.delete", id: detail.links[1]!.id }, user);
      assert.lengthOf((yield* board.taskDetail(task.id)).links, 1);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("stops starting an employee once their monthly token limit is spent", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const sql = yield* SqlClient.SqlClient;
      const { company, lead } = yield* createCompany(board);
      yield* board.runCommand(
        { type: "agent.upsert", agent: { ...lead, monthlyTokenLimit: 1_000 } },
        user,
      );
      const first = yield* startTaskFor(board, company.id, "First task", lead.id);
      yield* sql`
        INSERT INTO orchestration_v2_projection_provider_turns (
          provider_turn_id, thread_id, provider_thread_id, node_id, ordinal, status, started_at,
          payload_json
        )
        VALUES (
          'turn-1', ${first.threadId}, 'provider-thread-1', 'node-1', 1, 'completed',
          '1970-01-01T00:00:01.000Z',
          '{"turnTokenUsage":{"inputTokens":900,"cachedInputTokens":5000,"outputTokens":300}}'
        )
      `;
      const snapshot = yield* board.snapshot(company.id);
      assert.deepEqual(snapshot.usage?.agents, [{ agentId: lead.id, tokens: 1_200 }]);

      const { task } = yield* board.runCommand(
        {
          type: "task.create",
          task: {
            companyId: company.id,
            title: "Second task",
            assigneeAgentId: lead.id,
            status: "backlog",
          },
        },
        user,
      );
      const refused = yield* board
        .runCommand({ type: "task.start", id: task!.id }, user)
        .pipe(Effect.flip);
      assert.include(refused.message, "Lead reached their monthly token limit.");

      // Raising the limit lets the employee work again.
      yield* board.runCommand(
        { type: "agent.upsert", agent: { ...lead, monthlyTokenLimit: 10_000 } },
        user,
      );
      const { task: started } = yield* board.runCommand({ type: "task.start", id: task!.id }, user);
      assert.notEqual(started?.status, "backlog");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("creates a routine's task on schedule and skips while the last one is open", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId } = yield* createCompany(board);
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, autoDispatch: false } },
        user,
      );
      const { routine } = yield* board.runCommand(
        {
          type: "routine.upsert",
          routine: {
            companyId: company.id,
            title: "Daily numbers",
            description: "Check signups and revenue.",
            assigneeAgentId: ceoId,
            everyDays: 1,
            nextRunAt: "1970-01-01T00:02:00.000Z",
            enabled: true,
          },
        },
        user,
      );
      const routineTasks = (snapshot: BoardSnapshot) =>
        snapshot.tasks.filter((task) => task.title === "Daily numbers");

      yield* TestClock.adjust("3 minutes");
      const created = yield* boardWhere(
        board,
        company.id,
        (snapshot) => routineTasks(snapshot).length === 1,
      );
      const firstTask = routineTasks(created)[0]!;
      assert.equal(firstTask.status, "todo");
      assert.equal(firstTask.assigneeAgentId, ceoId);
      const advanced = created.routines.find((candidate) => candidate.id === routine!.id);
      assert.equal(advanced?.nextRunAt, "1970-01-02T00:02:00.000Z");
      assert.equal(advanced?.lastTaskId, firstTask.id);

      // The first task is still open a day later, so no second copy appears.
      yield* TestClock.adjust("1 day");
      const skipped = yield* boardWhere(board, company.id, (snapshot) =>
        snapshot.routines.some((candidate) => candidate.nextRunAt === "1970-01-03T00:02:00.000Z"),
      );
      assert.lengthOf(routineTasks(skipped), 1);

      yield* board.runCommand(
        { type: "task.update", task: { id: firstTask.id, status: "done" } },
        user,
      );
      yield* TestClock.adjust("1 day");
      yield* boardWhere(board, company.id, (snapshot) => routineTasks(snapshot).length === 2);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("gives agents the files attached to their task and the tasks above it", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead, engineer } = yield* createCompany(board);
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, maxConcurrentRuns: 5 } },
        user,
      );
      const video = "/Users/me/Downloads/launch clip.mp4";
      const { task } = yield* board.runCommand(
        {
          type: "task.create",
          task: {
            companyId: company.id,
            title: "Edit the launch video",
            assigneeAgentId: lead.id,
            files: [video],
          },
        },
        user,
      );
      const started = yield* boardWhere(
        board,
        company.id,
        (snapshot) => threadOf(snapshot, task?.id) !== null,
      );
      const detail = yield* board.taskDetail(task!.id);
      assert.deepEqual(
        detail.links
          .filter((link) => link.kind === "file")
          .map((link) => [link.title, link.url, link.agentId]),
        [["launch clip.mp4", video, null]],
      );
      const prompt = (yield* Ref.get(harness.launches)).at(-1)?.initialMessage?.text ?? "";
      assert.include(prompt, "## Files for this task");
      assert.include(prompt, `- ${video}`);
      assert.include(prompt, "never move, rename, or delete the originals");

      const subtask = yield* board.createTask(
        {
          companyId: company.id,
          title: "Cut the intro",
          parentTaskId: task!.id,
          assigneeAgentId: engineer.id,
        },
        { kind: "agent", threadId: threadOf(started, task?.id)! },
      );
      yield* boardWhere(board, company.id, (snapshot) => threadOf(snapshot, subtask.id) !== null);
      const subtaskPrompt = (yield* Ref.get(harness.launches)).at(-1)?.initialMessage?.text ?? "";
      assert.include(subtaskPrompt, `- ${video} (attached to "Edit the launch video")`);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("runs a routine on demand without moving its schedule", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId } = yield* createCompany(board);
      yield* board.runCommand(
        { type: "settings.update", settings: { companyId: company.id, autoDispatch: false } },
        user,
      );
      const nextRunAt = "1970-01-08T09:00:00.000Z";
      const { routine } = yield* board.runCommand(
        {
          type: "routine.upsert",
          routine: {
            companyId: company.id,
            title: "Executive report",
            description: "Summarize the week.",
            assigneeAgentId: ceoId,
            everyDays: 7,
            nextRunAt,
            enabled: true,
          },
        },
        user,
      );
      const { task } = yield* board.runCommand({ type: "routine.run", id: routine!.id }, user);
      assert.equal(task?.title, "Executive report");
      assert.equal(task?.assigneeAgentId, ceoId);
      const snapshot = yield* board.snapshot(company.id);
      const after = snapshot.routines.find((candidate) => candidate.id === routine!.id);
      assert.equal(after?.lastTaskId, task?.id);
      assert.equal(after?.nextRunAt, nextRunAt);
      const comments = (yield* board.taskDetail(task!.id)).comments.map((comment) => comment.body);
      assert.include(comments, 'Created by the routine "Executive report".');
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

const taskStatus = (snapshot: BoardSnapshot, taskId: BoardTaskId) =>
  snapshot.tasks.find((task) => task.id === taskId)?.status;

it.effect("opens a pull request for a finished task and finishes it once that merges", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead } = yield* createCompany(board);
      const { task, threadId } = yield* startTaskFor(board, company.id, "Fix checkout", lead.id);
      const ship = board.runCommand(
        { type: "task.ship", id: task.id, method: "pull_request" },
        user,
      );

      const early = yield* Effect.flip(ship);
      assert.equal(early.message, "Ship a task once it is in Review or Done.");

      yield* finishRun(harness)(threadId, "run-work-1");
      yield* boardWhere(
        board,
        company.id,
        (snapshot) => taskStatus(snapshot, task.id) === "review",
      );
      const { link } = yield* ship;
      assert.deepInclude((yield* Ref.get(harness.gitActions))[0], {
        cwd: `/worktrees/${threadId}`,
        action: "commit_push_pr",
        threadId,
      });
      assert.deepInclude(link, {
        kind: "pull_request",
        title: "#7 Fix checkout",
        url: "https://github.com/acme/shop/pull/7",
        status: "open",
      });
      // Linked to the task's thread, the pull request is synced like one opened from a chat.
      assert.deepInclude((yield* Ref.get(harness.dispatched))[0], {
        type: "thread.pull-request.link",
        threadId,
        repository: "acme/shop",
        number: 7,
        source: "created",
      });

      yield* Queue.offer(harness.events, {
        type: "thread.pull-request-link-updated",
        threadId,
        payload: {
          host: "github.com",
          repository: "acme/shop",
          number: 7,
          url: "https://github.com/acme/shop/pull/7",
          source: "created",
          snapshot: { state: "merged", title: "Fix checkout", isDraft: false },
        },
      } as unknown as OrchestrationV2DomainEvent);
      yield* boardWhere(board, company.id, (snapshot) => taskStatus(snapshot, task.id) === "done");
      const detail = yield* board.taskDetail(task.id);
      assert.deepEqual(
        detail.links.filter((entry) => entry.kind === "pull_request").map((entry) => entry.status),
        ["merged"],
      );
      assert.include(
        detail.comments.map((comment) => comment.body),
        "Pull request #7 was merged; moved the task from Review to Done.",
      );
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("merges a finished task's branch only into a clean checkout without conflicts", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, lead } = yield* createCompany(board);
      const { task, threadId } = yield* startTaskFor(board, company.id, "Fix checkout", lead.id);
      yield* finishRun(harness)(threadId, "run-work-1");
      yield* boardWhere(
        board,
        company.id,
        (snapshot) => taskStatus(snapshot, task.id) === "review",
      );
      const branch = (yield* board.taskDetail(task.id)).links.find(
        (entry) => entry.kind === "branch",
      )!.title;
      const merge = board.runCommand({ type: "task.ship", id: task.id, method: "merge" }, user);
      const ranMerge = Effect.map(Ref.get(harness.gitCommands), (commands) =>
        commands.filter((args) => args[0] === "merge"),
      );

      let checkout: "dirty" | "conflicting" | "clean" = "dirty";
      yield* Ref.set(harness.gitScript, (args) => {
        if (args[0] === "symbolic-ref") return { stdout: "main\n" };
        if (args[0] === "merge-base") return { exitCode: 1 };
        if (args[0] === "status") return { stdout: checkout === "dirty" ? " M README.md\n" : "" };
        if (args[0] === "merge" && args[1] !== "--abort" && checkout === "conflicting") {
          return { exitCode: 1, stdout: "CONFLICT (content): Merge conflict in app.ts\n" };
        }
        return {};
      });

      const dirty = yield* Effect.flip(merge);
      assert.equal(
        dirty.message,
        "The project folder has uncommitted changes on main. Commit or stash them, then merge.",
      );
      assert.lengthOf(yield* ranMerge, 0);

      checkout = "conflicting";
      const conflict = yield* Effect.flip(merge);
      assert.include(conflict.message, `${branch} conflicts with main, so nothing was merged.`);
      assert.deepInclude(yield* ranMerge, ["merge", "--abort"]);
      assert.equal((yield* board.taskDetail(task.id)).task.status, "review");

      checkout = "clean";
      const { task: shipped, link } = yield* merge;
      assert.equal(shipped?.status, "done");
      assert.deepInclude(link, { kind: "branch", title: branch, status: "merged" });
      // Edits the agent left uncommitted are committed in the task's worktree first.
      assert.deepInclude((yield* Ref.get(harness.gitActions))[0], {
        cwd: `/worktrees/${threadId}`,
        action: "commit",
      });
      assert.deepInclude(yield* ranMerge, [
        "merge",
        "--no-edit",
        "-m",
        `Merge ${branch}: Fix checkout`,
        branch,
      ]);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
