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
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as BoardService from "./BoardService.ts";
import * as BoardStore from "./BoardStore.ts";

const projectId = ProjectId.make("project-1");
const model = { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" };
const user = { kind: "user" } as const;
const isBoardError = Schema.is(BoardError);

const makeHarness = Effect.gen(function* () {
  const launches = yield* Ref.make<ReadonlyArray<ThreadLaunchService.ThreadLaunchInput>>([]);
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
    streamDomainEvents: Stream.fromQueue(events),
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
  const layer = BoardService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        BoardStore.layer.pipe(Layer.provide(NodeCrypto.layer)),
        threads,
        launcher,
        folders,
      ),
    ),
  );
  return { launches, events, layer };
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

it.effect("a manager's delegated card runs, then comes back to that manager for review", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId, lead, engineer } = yield* createCompany(board);

      // The board gives the CTO a card; it starts in its own thread.
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
      assert.include(prompt, "Engineer (Engineer)");

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

      // The engineer's run ends without moving its card; the CTO is started to review it.
      yield* Queue.offer(harness.events, {
        type: "run.updated",
        threadId: threadOf(working, subtask.id),
        payload: { id: "run-engineer", status: "completed" },
      } as unknown as OrchestrationV2DomainEvent);
      const reviewing = yield* boardWhere(board, company.id, (snapshot) =>
        snapshot.tasks.some((task) => task.id === subtask.id && task.activeRunKind === "review"),
      );
      assert.equal(reviewing.tasks.find((task) => task.id === subtask.id)?.status, "review");
      // Each employee's threads are listed for the sidebar, newest first.
      assert.deepEqual(
        reviewing.threads.map((thread) => [thread.agentId, thread.kind]),
        [
          [lead.id, "review"],
          [engineer.id, "work"],
          [lead.id, "work"],
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

      // The CTO, working a card, asks for a designer.
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
      const hire = yield* board.requestHire(
        {
          companyId: company.id,
          name: "Dana",
          title: "Designer",
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
      assert.deepEqual(agent?.skillIds, [skill!.id]);
      assert.deepEqual(agent?.modelSelection, model);
      const after = yield* board.snapshot(company.id);
      assert.equal(after.hires.find((candidate) => candidate.id === hire.id)?.status, "approved");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("returns a split card to its owner once every subtask is done", () =>
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

it.effect("lessons an agent remembers reach its next card's prompt", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const { company, ceoId, engineer } = yield* createCompany(board);
      // Three cards run at once below; the default allows two.
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
      yield* board.remember(
        { scope: "company", note: "We support Node 20 and newer." },
        { kind: "agent", threadId: ceoCard.threadId },
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
