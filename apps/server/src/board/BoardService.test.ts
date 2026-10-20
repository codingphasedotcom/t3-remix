import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  type BoardTask,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as BoardService from "./BoardService.ts";

const projectId = ProjectId.make("project-1");
const modelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" };

it.effect("runs a card through its assignee and then its reviewer", () =>
  Effect.gen(function* () {
    const launches = yield* Ref.make<ReadonlyArray<ThreadLaunchService.ThreadLaunchInput>>([]);
    const reviewLaunched = yield* Deferred.make<ThreadLaunchService.ThreadLaunchInput>();
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();

    const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
      streamDomainEvents: Stream.fromQueue(events),
      // The settled thread has no queued follow-up.
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
          Effect.andThen(
            input.title.startsWith("Review")
              ? Deferred.succeed(reviewLaunched, input)
              : Effect.void,
          ),
          Effect.as({
            threadId: input.threadId as ThreadId,
            projection: {
              thread: { worktreePath: "/worktrees/card-1" },
            } as unknown as ThreadLaunchService.ThreadLaunchResult["projection"],
            resumed: false,
          }),
        ),
    });

    yield* Effect.gen(function* () {
      const board = yield* BoardService.BoardService;
      const builder = yield* board.upsertAgent({
        name: "Builder",
        role: "Engineer",
        instructions: "Ship it.",
        modelSelection,
        runtimeMode: "full-access",
      });
      const reviewer = yield* board.upsertAgent({
        name: "Reviewer",
        role: "Code reviewer",
        instructions: "Check it.",
        modelSelection,
        runtimeMode: "full-access",
      });
      const created = yield* board.createTask(
        {
          projectId,
          title: "Add rate limiting",
          assigneeAgentId: builder.id,
          reviewerAgentId: reviewer.id,
          status: "todo",
        },
        { kind: "user" },
      );

      // Wait on the persisted board, not the launch call, so the card's thread link is stored.
      const cardWhere = (matches: (task: BoardTask) => boolean) =>
        board.subscribe(projectId).pipe(
          Stream.map((snapshot) => snapshot.tasks.find((task) => task.id === created.id)),
          Stream.filter((task) => task !== undefined && matches(task)),
          Stream.runHead,
        );
      yield* cardWhere((task) => task.worktreePath !== null);
      const working = yield* board.taskDetail(created.id);
      const [workLaunch] = yield* Ref.get(launches);
      assert.equal(working.task.status, "in_progress");
      assert.equal(working.task.activeRunKind, "work");
      assert.equal(working.task.worktreePath, "/worktrees/card-1");
      assert.deepEqual(workLaunch?.workspaceStrategy, { type: "worktree", baseRef: "HEAD" });
      assert.include(workLaunch?.initialMessage?.text ?? "", "Add rate limiting");
      assert.include(workLaunch?.initialMessage?.text ?? "", "Ship it.");

      // The builder's run ends without the agent moving its card.
      yield* Queue.offer(events, {
        type: "run.updated",
        threadId: working.task.threadId,
        payload: { id: "run-1", status: "completed" },
      } as unknown as OrchestrationV2DomainEvent);

      const reviewLaunch = yield* Deferred.await(reviewLaunched);
      const reviewing = yield* board.taskDetail(created.id);
      assert.equal(reviewing.task.status, "review");
      assert.equal(reviewing.task.activeRunKind, "review");
      assert.deepEqual(reviewLaunch.workspaceStrategy, {
        type: "existing_worktree",
        worktreePath: "/worktrees/card-1",
      });
      assert.deepEqual(
        reviewing.runs.map((run) => [run.kind, run.status]),
        [
          ["work", "completed"],
          ["review", "running"],
        ],
      );
    }).pipe(
      Effect.provide(
        BoardService.layer.pipe(Layer.provide(Layer.mergeAll(threads, launcher, NodeCrypto.layer))),
      ),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("returns a split card to its owner once every subtask is done", () =>
  Effect.gen(function* () {
    const board = yield* BoardService.BoardService;
    yield* board.updateSettings({ projectId, autoDispatch: false });
    const parent = yield* board.createTask(
      { projectId, title: "Ship billing", status: "blocked" },
      { kind: "user" },
    );
    const first = yield* board.createTask(
      { projectId, title: "Schema", parentTaskId: parent.id, status: "review" },
      { kind: "user" },
    );
    const second = yield* board.createTask(
      { projectId, title: "API", parentTaskId: parent.id, status: "review" },
      { kind: "user" },
    );

    yield* board.updateTask({ id: first.id, status: "done" }, { kind: "user" });
    assert.equal((yield* board.taskDetail(parent.id)).task.status, "blocked");
    yield* board.updateTask({ id: second.id, status: "done" }, { kind: "user" });
    const resumed = yield* board.taskDetail(parent.id);
    assert.equal(resumed.task.status, "todo");
    assert.include(resumed.comments.at(-1)?.body ?? "", "Every subtask is done");
  }).pipe(
    Effect.provide(
      BoardService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              streamDomainEvents: Stream.never,
            }),
            Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
            NodeCrypto.layer,
          ),
        ),
      ),
    ),
    Effect.provide(SqlitePersistence.layerMemory),
  ),
);
