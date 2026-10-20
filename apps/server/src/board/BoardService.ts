import {
  BoardAgent,
  BoardAgentId,
  BoardComment,
  BoardCommentId,
  BoardError,
  BoardRun,
  BoardRunId,
  BoardSettings,
  BoardTask,
  BoardTaskId,
  CommandId,
  MessageId,
  ThreadId,
  type BoardAgentUpsertInput,
  type BoardCommand,
  type BoardCommandResult,
  type BoardCommentAddInput,
  type BoardCommentAuthorKind,
  type BoardRunKind,
  type BoardRunStatus,
  type BoardSettingsUpdateInput,
  type BoardSnapshot,
  type BoardTaskCreateInput,
  type BoardTaskDetail,
  type BoardTaskStatus,
  type BoardTaskUpdateInput,
  type OrchestrationV2Run,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import {
  boardStatusLabel,
  buildReviewPrompt,
  buildReworkPrompt,
  buildUserCommentMessage,
  buildWorkPrompt,
  type BoardPromptContext,
} from "./boardPrompts.ts";

/** Who is changing the board. An agent is identified by the thread its MCP credential belongs to. */
export type BoardActor =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly threadId: ThreadId };

export interface BoardAssignment {
  readonly projectId: ProjectId;
  readonly taskId: BoardTaskId;
  readonly agentId: BoardAgentId;
  readonly kind: BoardRunKind;
}

export class BoardService extends Context.Service<
  BoardService,
  {
    readonly snapshot: (projectId: ProjectId) => Effect.Effect<BoardSnapshot, BoardError>;
    readonly subscribe: (projectId: ProjectId) => Stream.Stream<BoardSnapshot, BoardError>;
    readonly taskDetail: (taskId: BoardTaskId) => Effect.Effect<BoardTaskDetail, BoardError>;
    readonly subscribeTaskDetail: (
      taskId: BoardTaskId,
    ) => Stream.Stream<BoardTaskDetail, BoardError>;
    readonly listAgents: () => Effect.Effect<ReadonlyArray<BoardAgent>, BoardError>;
    readonly upsertAgent: (input: BoardAgentUpsertInput) => Effect.Effect<BoardAgent, BoardError>;
    readonly deleteAgent: (id: BoardAgentId) => Effect.Effect<void, BoardError>;
    readonly createTask: (
      input: BoardTaskCreateInput,
      actor: BoardActor,
    ) => Effect.Effect<BoardTask, BoardError>;
    readonly updateTask: (
      input: BoardTaskUpdateInput,
      actor: BoardActor,
    ) => Effect.Effect<BoardTask, BoardError>;
    readonly deleteTask: (id: BoardTaskId) => Effect.Effect<void, BoardError>;
    /** Starts the assignee (or the reviewer, for a card in review) now, ignoring auto-dispatch. */
    readonly startTask: (id: BoardTaskId) => Effect.Effect<BoardTask, BoardError>;
    readonly addComment: (
      input: BoardCommentAddInput,
      actor: BoardActor,
    ) => Effect.Effect<BoardComment, BoardError>;
    readonly updateSettings: (
      input: BoardSettingsUpdateInput,
    ) => Effect.Effect<BoardSettings, BoardError>;
    /** Applies one client mutation; the RPC transport sends every board write through here. */
    readonly runCommand: (
      command: BoardCommand,
      actor: BoardActor,
    ) => Effect.Effect<BoardCommandResult, BoardError>;
    /** The card and role a board-launched thread is working on, if any. */
    readonly assignmentForThread: (
      threadId: ThreadId,
    ) => Effect.Effect<BoardAssignment | null, BoardError>;
  }
>()("t3/board/BoardService") {}

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_BASE_REF = "HEAD";
const MAX_COMMENT_CHARS = 8_000;

interface AgentRow {
  readonly agent_id: string;
  readonly name: string;
  readonly role: string;
  readonly instructions: string;
  readonly model_selection_json: string;
  readonly runtime_mode: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface TaskRow {
  readonly task_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly position: number;
  readonly assignee_agent_id: string | null;
  readonly reviewer_agent_id: string | null;
  readonly parent_task_id: string | null;
  readonly thread_id: string | null;
  readonly worktree_path: string | null;
  readonly created_by_agent_id: string | null;
  readonly status_changed_at: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly comment_count: number;
  readonly active_run_kind: string | null;
}

interface CommentRow {
  readonly comment_id: string;
  readonly task_id: string;
  readonly author_kind: string;
  readonly author_agent_id: string | null;
  readonly body: string;
  readonly created_at: string;
}

interface RunRow {
  readonly run_id: string;
  readonly task_id: string;
  readonly agent_id: string;
  readonly thread_id: string;
  readonly kind: string;
  readonly status: string;
  readonly started_at: string;
  readonly ended_at: string | null;
}

interface RunningRunRow extends RunRow {
  readonly project_id: string;
}

interface SettingsRow {
  readonly auto_dispatch: number;
  readonly max_concurrent_runs: number;
  readonly use_worktrees: number;
  readonly base_ref: string;
}

/** A task row plus the fields only the server reads. */
interface StoredTask {
  readonly task: BoardTask;
  readonly statusChangedAt: string;
}

const decodeAgent = Schema.decodeUnknownEffect(BoardAgent);
const decodeModelSelectionJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(BoardAgent.fields.modelSelection),
);
const encodeModelSelectionJson = Schema.encodeEffect(
  Schema.fromJsonString(BoardAgent.fields.modelSelection),
);
const decodeTask = Schema.decodeUnknownEffect(BoardTask);
const decodeComment = Schema.decodeUnknownEffect(BoardComment);
const decodeRun = Schema.decodeUnknownEffect(BoardRun);
const decodeSettings = Schema.decodeUnknownEffect(BoardSettings);

function boardError(message: string, cause?: unknown): BoardError {
  return new BoardError({ message, ...(cause === undefined ? {} : { cause }) });
}

const nowIso = DateTime.now.pipe(Effect.map((value) => DateTime.formatIso(value)));

const TASK_COLUMNS = `
  t.task_id,
  t.project_id,
  t.title,
  t.description,
  t.status,
  t.position,
  t.assignee_agent_id,
  t.reviewer_agent_id,
  t.parent_task_id,
  t.thread_id,
  t.worktree_path,
  t.created_by_agent_id,
  t.status_changed_at,
  t.created_at,
  t.updated_at,
  (SELECT COUNT(*) FROM board_comments c
    WHERE c.task_id = t.task_id AND c.author_kind != 'system') AS comment_count,
  (SELECT r.kind FROM board_runs r
    WHERE r.task_id = t.task_id AND r.status = 'running'
    ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1) AS active_run_kind
`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;

  // The board owns its tables instead of taking an id in the shared migration sequence. The
  // migrator skips every id below the highest one recorded, so a fork-owned id would either
  // collide with or silently hide a later upstream migration.
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      instructions TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_tasks (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      position REAL NOT NULL,
      assignee_agent_id TEXT,
      reviewer_agent_id TEXT,
      parent_task_id TEXT,
      thread_id TEXT,
      worktree_path TEXT,
      created_by_agent_id TEXT,
      status_changed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_board_tasks_project
    ON board_tasks(project_id, position)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_comments (
      comment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author_kind TEXT NOT NULL,
      author_agent_id TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_board_comments_task
    ON board_comments(task_id, created_at)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_runs_thread ON board_runs(thread_id, status)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_runs_task ON board_runs(task_id, started_at)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_settings (
      project_id TEXT PRIMARY KEY,
      auto_dispatch INTEGER NOT NULL,
      max_concurrent_runs INTEGER NOT NULL,
      use_worktrees INTEGER NOT NULL,
      base_ref TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // `null` means agents changed, which every project's board shows.
  const changes = yield* PubSub.unbounded<ProjectId | null>();
  const notify = (projectId: ProjectId | null) =>
    PubSub.publish(changes, projectId).pipe(Effect.asVoid);
  // Dispatch decisions read and then write runs; serializing them keeps two passes from
  // starting the same card or overshooting the concurrency limit.
  const dispatchLock = yield* Semaphore.make(1);

  const newId = (prefix: string) =>
    crypto.randomUUIDv4().pipe(
      Effect.map((uuid) => `${prefix}:${uuid}`),
      Effect.orDie,
    );

  // Row decoders run per row inside reads that already own a span.
  const toAgent = Effect.fnUntraced(function* (row: AgentRow) {
    const modelSelection = yield* decodeModelSelectionJson(row.model_selection_json);
    return yield* decodeAgent({
      id: row.agent_id,
      name: row.name,
      role: row.role,
      instructions: row.instructions,
      modelSelection,
      runtimeMode: row.runtime_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  const toStoredTask = Effect.fnUntraced(function* (row: TaskRow) {
    const task = yield* decodeTask({
      id: row.task_id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      position: row.position,
      assigneeAgentId: row.assignee_agent_id,
      reviewerAgentId: row.reviewer_agent_id,
      parentTaskId: row.parent_task_id,
      threadId: row.thread_id,
      worktreePath: row.worktree_path,
      activeRunKind: row.active_run_kind,
      createdByAgentId: row.created_by_agent_id,
      commentCount: row.comment_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return { task, statusChangedAt: row.status_changed_at } satisfies StoredTask;
  });

  const toComment = (row: CommentRow) =>
    decodeComment({
      id: row.comment_id,
      taskId: row.task_id,
      authorKind: row.author_kind,
      authorAgentId: row.author_agent_id,
      body: row.body,
      createdAt: row.created_at,
    });

  const toRun = (row: RunRow) =>
    decodeRun({
      id: row.run_id,
      taskId: row.task_id,
      agentId: row.agent_id,
      threadId: row.thread_id,
      kind: row.kind,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    });

  const selectAgents = Effect.fn("BoardService.selectAgents")(function* () {
    const rows = yield* sql<AgentRow>`SELECT * FROM board_agents ORDER BY created_at, agent_id`;
    return yield* Effect.forEach(rows, toAgent);
  });

  const selectTasks = Effect.fn("BoardService.selectTasks")(function* (projectId: ProjectId) {
    const rows = yield* sql<TaskRow>`
      SELECT ${sql.literal(TASK_COLUMNS)}
      FROM board_tasks t
      WHERE t.project_id = ${projectId}
      ORDER BY t.position, t.created_at
    `;
    return yield* Effect.forEach(rows, toStoredTask);
  });

  const selectTask = Effect.fn("BoardService.selectTask")(function* (taskId: BoardTaskId) {
    const rows = yield* sql<TaskRow>`
      SELECT ${sql.literal(TASK_COLUMNS)}
      FROM board_tasks t
      WHERE t.task_id = ${taskId}
    `;
    const row = rows[0];
    return row === undefined ? null : yield* toStoredTask(row);
  });

  const requireTask = (taskId: BoardTaskId) =>
    selectTask(taskId).pipe(
      Effect.mapError((cause) => boardError("Could not read the board card.", cause)),
      Effect.flatMap((stored) =>
        stored === null
          ? Effect.fail(boardError(`Board card ${taskId} was not found.`))
          : Effect.succeed(stored),
      ),
    );

  const selectComments = Effect.fn("BoardService.selectComments")(function* (taskId: BoardTaskId) {
    const rows = yield* sql<CommentRow>`
      SELECT * FROM board_comments WHERE task_id = ${taskId} ORDER BY created_at, rowid
    `;
    return yield* Effect.forEach(rows, toComment);
  });

  const selectRuns = Effect.fn("BoardService.selectRuns")(function* (taskId: BoardTaskId) {
    const rows = yield* sql<RunRow>`
      SELECT * FROM board_runs WHERE task_id = ${taskId} ORDER BY started_at, rowid
    `;
    return yield* Effect.forEach(rows, toRun);
  });

  const selectSettings = Effect.fn("BoardService.selectSettings")(function* (projectId: ProjectId) {
    const rows = yield* sql<SettingsRow>`
      SELECT auto_dispatch, max_concurrent_runs, use_worktrees, base_ref
      FROM board_settings WHERE project_id = ${projectId}
    `;
    const row = rows[0];
    return yield* decodeSettings({
      projectId,
      autoDispatch: row === undefined ? true : row.auto_dispatch === 1,
      maxConcurrentRuns: row?.max_concurrent_runs ?? DEFAULT_MAX_CONCURRENT_RUNS,
      useWorktrees: row === undefined ? true : row.use_worktrees === 1,
      baseRef: row?.base_ref ?? DEFAULT_BASE_REF,
    });
  });

  const snapshot: BoardService["Service"]["snapshot"] = Effect.fn("BoardService.snapshot")(
    function* (projectId) {
      const settings = yield* selectSettings(projectId);
      const agents = yield* selectAgents();
      const tasks = yield* selectTasks(projectId);
      return {
        projectId,
        settings,
        agents,
        tasks: tasks.map((stored) => stored.task),
      } satisfies BoardSnapshot;
    },
    Effect.mapError((cause) => boardError("Could not load the board.", cause)),
  );

  const subscribe: BoardService["Service"]["subscribe"] = (projectId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the first snapshot so a change in between is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(snapshot(projectId)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === null || changed === projectId),
            Stream.mapEffect(() => snapshot(projectId)),
          ),
        );
      }),
    );

  const taskDetail: BoardService["Service"]["taskDetail"] = Effect.fn("BoardService.taskDetail")(
    function* (taskId) {
      const stored = yield* requireTask(taskId);
      const comments = yield* selectComments(taskId).pipe(
        Effect.mapError((cause) => boardError("Could not read card comments.", cause)),
      );
      const runs = yield* selectRuns(taskId).pipe(
        Effect.mapError((cause) => boardError("Could not read card runs.", cause)),
      );
      return { task: stored.task, comments, runs } satisfies BoardTaskDetail;
    },
  );

  const subscribeTaskDetail: BoardService["Service"]["subscribeTaskDetail"] = (taskId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const first = yield* taskDetail(taskId);
        const projectId = first.task.projectId;
        return Stream.concat(
          Stream.succeed(first),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === null || changed === projectId),
            Stream.mapEffect(() => taskDetail(taskId)),
          ),
        );
      }),
    );

  const listAgents: BoardService["Service"]["listAgents"] = () =>
    selectAgents().pipe(Effect.mapError((cause) => boardError("Could not list agents.", cause)));

  const runningRunForThread = Effect.fn("BoardService.runningRunForThread")(function* (
    threadId: ThreadId,
  ) {
    const rows = yield* sql<RunningRunRow>`
      SELECT r.*, t.project_id FROM board_runs r
      JOIN board_tasks t ON t.task_id = r.task_id
      WHERE r.thread_id = ${threadId}
      ORDER BY CASE r.status WHEN 'running' THEN 0 ELSE 1 END, r.started_at DESC, r.rowid DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  });

  const assignmentForThread: BoardService["Service"]["assignmentForThread"] = (threadId) =>
    runningRunForThread(threadId).pipe(
      Effect.flatMap((row) =>
        row === null
          ? Effect.succeed(null)
          : toRun(row).pipe(
              Effect.map((run): BoardAssignment => ({
                projectId: row.project_id as ProjectId,
                taskId: run.taskId,
                agentId: run.agentId,
                kind: run.kind,
              })),
            ),
      ),
      Effect.mapError((cause) => boardError("Could not resolve the calling agent.", cause)),
    );

  const insertComment = Effect.fn("BoardService.insertComment")(function* (input: {
    readonly taskId: BoardTaskId;
    readonly authorKind: BoardCommentAuthorKind;
    readonly authorAgentId: BoardAgentId | null;
    readonly body: string;
  }) {
    const id = BoardCommentId.make(yield* newId("board-comment"));
    const createdAt = yield* nowIso;
    const body = input.body.slice(0, MAX_COMMENT_CHARS);
    yield* sql`
      INSERT INTO board_comments (comment_id, task_id, author_kind, author_agent_id, body, created_at)
      VALUES (${id}, ${input.taskId}, ${input.authorKind}, ${input.authorAgentId}, ${body}, ${createdAt})
    `;
    return {
      id,
      taskId: input.taskId,
      authorKind: input.authorKind,
      authorAgentId: input.authorAgentId,
      body,
      createdAt,
    } satisfies BoardComment;
  });

  const systemComment = (taskId: BoardTaskId, body: string) =>
    insertComment({ taskId, authorKind: "system", authorAgentId: null, body });

  const writeTaskStatus = Effect.fn("BoardService.writeTaskStatus")(function* (
    taskId: BoardTaskId,
    status: BoardTaskStatus,
  ) {
    const at = yield* nowIso;
    yield* sql`
      UPDATE board_tasks
      SET status = ${status}, status_changed_at = ${at}, updated_at = ${at}
      WHERE task_id = ${taskId} AND status != ${status}
    `;
  });

  const actorAgentId = Effect.fn("BoardService.actorAgentId")(function* (actor: BoardActor) {
    if (actor.kind === "user") return null;
    const run = yield* runningRunForThread(actor.threadId);
    return run === null ? null : BoardAgentId.make(run.agent_id);
  });

  const actorLabel = (
    agents: ReadonlyArray<BoardAgent>,
    agentId: BoardAgentId | null,
    actor: BoardActor,
  ) =>
    actor.kind === "user"
      ? "A human"
      : (agents.find((agent) => agent.id === agentId)?.name ?? "An agent");

  const assertAgentExists = Effect.fn("BoardService.assertAgentExists")(function* (
    agents: ReadonlyArray<BoardAgent>,
    agentId: BoardAgentId | null | undefined,
  ) {
    if (agentId === null || agentId === undefined) return;
    if (!agents.some((agent) => agent.id === agentId)) {
      return yield* boardError(`Agent ${agentId} does not exist. board_list_agents lists them.`);
    }
  });

  const upsertAgent: BoardService["Service"]["upsertAgent"] = Effect.fn("BoardService.upsertAgent")(
    function* (input) {
      const at = yield* nowIso;
      const id = input.id ?? BoardAgentId.make(yield* newId("board-agent"));
      const modelSelectionJson = yield* encodeModelSelectionJson(input.modelSelection).pipe(
        Effect.mapError((cause) => boardError("Could not encode the agent's model.", cause)),
      );
      yield* sql`
        INSERT INTO board_agents (
          agent_id, name, role, instructions, model_selection_json, runtime_mode, created_at, updated_at
        )
        VALUES (
          ${id}, ${input.name}, ${input.role}, ${input.instructions},
          ${modelSelectionJson}, ${input.runtimeMode}, ${at}, ${at}
        )
        ON CONFLICT (agent_id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          instructions = excluded.instructions,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError((cause) => boardError("Could not save the agent.", cause)));
      const rows = yield* sql<AgentRow>`SELECT * FROM board_agents WHERE agent_id = ${id}`.pipe(
        Effect.mapError((cause) => boardError("Could not read the agent.", cause)),
      );
      const row = rows[0];
      if (row === undefined) return yield* boardError("The saved agent disappeared.");
      const agent = yield* toAgent(row).pipe(
        Effect.mapError((cause) => boardError("Could not decode the agent.", cause)),
      );
      yield* notify(null);
      return agent;
    },
  );

  const deleteAgent: BoardService["Service"]["deleteAgent"] = Effect.fn("BoardService.deleteAgent")(
    function* (id) {
      yield* sql
        .withTransaction(
          sql`UPDATE board_tasks SET assignee_agent_id = NULL WHERE assignee_agent_id = ${id}`.pipe(
            Effect.andThen(
              sql`UPDATE board_tasks SET reviewer_agent_id = NULL WHERE reviewer_agent_id = ${id}`,
            ),
            Effect.andThen(sql`DELETE FROM board_agents WHERE agent_id = ${id}`),
          ),
        )
        .pipe(Effect.mapError((cause) => boardError("Could not delete the agent.", cause)));
      yield* notify(null);
    },
  );

  const nextPosition = Effect.fn("BoardService.nextPosition")(function* (
    projectId: ProjectId,
    status: BoardTaskStatus,
  ) {
    const rows = yield* sql<{ readonly position: number | null }>`
      SELECT MAX(position) AS position FROM board_tasks
      WHERE project_id = ${projectId} AND status = ${status}
    `;
    return (rows[0]?.position ?? 0) + 1;
  });

  const createTask: BoardService["Service"]["createTask"] = Effect.fn("BoardService.createTask")(
    function* (input, actor) {
      const agents = yield* listAgents();
      yield* assertAgentExists(agents, input.assigneeAgentId);
      yield* assertAgentExists(agents, input.reviewerAgentId);
      if (input.parentTaskId !== undefined && input.parentTaskId !== null) {
        const parent = yield* requireTask(input.parentTaskId);
        if (parent.task.projectId !== input.projectId) {
          return yield* boardError("A subtask must belong to its parent card's project.");
        }
      }
      const status = input.status ?? (input.assigneeAgentId ? "todo" : "backlog");
      const created = yield* Effect.gen(function* () {
        const id = BoardTaskId.make(yield* newId("board-task"));
        const at = yield* nowIso;
        const position = yield* nextPosition(input.projectId, status);
        const creatorAgentId = yield* actorAgentId(actor);
        yield* sql`
          INSERT INTO board_tasks (
            task_id, project_id, title, description, status, position,
            assignee_agent_id, reviewer_agent_id, parent_task_id, thread_id, worktree_path,
            created_by_agent_id, status_changed_at, created_at, updated_at
          )
          VALUES (
            ${id}, ${input.projectId}, ${input.title}, ${input.description ?? ""}, ${status}, ${position},
            ${input.assigneeAgentId ?? null}, ${input.reviewerAgentId ?? null}, ${input.parentTaskId ?? null},
            NULL, NULL, ${creatorAgentId}, ${at}, ${at}, ${at}
          )
        `;
        if (actor.kind === "agent") {
          yield* systemComment(id, `Created by ${actorLabel(agents, creatorAgentId, actor)}.`);
        }
        return yield* requireTask(id);
      }).pipe(Effect.mapError((cause) => boardError("Could not create the card.", cause)));
      yield* notify(input.projectId);
      return created.task;
    },
  );

  // Moves a parent waiting in "blocked" back to "todo" once its last subtask is done, so the
  // agent that split the work resumes in its own thread.
  const resumeParentIfSubtasksDone = Effect.fn("BoardService.resumeParentIfSubtasksDone")(
    function* (parentTaskId: BoardTaskId) {
      const parent = yield* selectTask(parentTaskId);
      if (parent === null || parent.task.status !== "blocked") return;
      const siblings = yield* sql<{ readonly open: number }>`
      SELECT COUNT(*) AS open FROM board_tasks
      WHERE parent_task_id = ${parentTaskId} AND status != 'done'
    `;
      if ((siblings[0]?.open ?? 0) > 0) return;
      yield* writeTaskStatus(parentTaskId, "todo");
      yield* systemComment(parentTaskId, "Every subtask is done; moved back to To do.");
    },
  );

  const updateTask: BoardService["Service"]["updateTask"] = Effect.fn("BoardService.updateTask")(
    function* (input, actor) {
      const current = yield* requireTask(input.id);
      const agents = yield* listAgents();
      yield* assertAgentExists(agents, input.assigneeAgentId);
      yield* assertAgentExists(agents, input.reviewerAgentId);
      const before = current.task;
      const updated = yield* Effect.gen(function* () {
        const at = yield* nowIso;
        const status = input.status ?? before.status;
        const statusChanged = status !== before.status;
        const position =
          input.position ??
          (statusChanged ? yield* nextPosition(before.projectId, status) : before.position);
        yield* sql`
          UPDATE board_tasks SET
            title = ${input.title ?? before.title},
            description = ${input.description ?? before.description},
            status = ${status},
            position = ${position},
            assignee_agent_id = ${input.assigneeAgentId === undefined ? before.assigneeAgentId : input.assigneeAgentId},
            reviewer_agent_id = ${input.reviewerAgentId === undefined ? before.reviewerAgentId : input.reviewerAgentId},
            status_changed_at = ${statusChanged ? at : current.statusChangedAt},
            updated_at = ${at}
          WHERE task_id = ${input.id}
        `;
        if (statusChanged) {
          const agentId = yield* actorAgentId(actor);
          yield* systemComment(
            input.id,
            `${actorLabel(agents, agentId, actor)} moved this card from ${boardStatusLabel(before.status)} to ${boardStatusLabel(status)}.`,
          );
          if (status === "done" && before.parentTaskId !== null) {
            yield* resumeParentIfSubtasksDone(before.parentTaskId);
          }
        }
        return yield* requireTask(input.id);
      }).pipe(Effect.mapError((cause) => boardError("Could not update the card.", cause)));
      yield* notify(before.projectId);
      return updated.task;
    },
  );

  const deleteTask: BoardService["Service"]["deleteTask"] = Effect.fn("BoardService.deleteTask")(
    function* (id) {
      const current = yield* requireTask(id);
      yield* sql
        .withTransaction(
          sql`UPDATE board_tasks SET parent_task_id = ${current.task.parentTaskId} WHERE parent_task_id = ${id}`.pipe(
            Effect.andThen(sql`DELETE FROM board_comments WHERE task_id = ${id}`),
            Effect.andThen(sql`DELETE FROM board_runs WHERE task_id = ${id}`),
            Effect.andThen(sql`DELETE FROM board_tasks WHERE task_id = ${id}`),
          ),
        )
        .pipe(Effect.mapError((cause) => boardError("Could not delete the card.", cause)));
      yield* notify(current.task.projectId);
    },
  );

  const addComment: BoardService["Service"]["addComment"] = Effect.fn("BoardService.addComment")(
    function* (input, actor) {
      const current = yield* requireTask(input.taskId);
      const comment = yield* Effect.gen(function* () {
        const authorAgentId = yield* actorAgentId(actor);
        return yield* insertComment({
          taskId: input.taskId,
          authorKind: actor.kind === "user" ? "user" : "agent",
          authorAgentId,
          body: input.body,
        });
      }).pipe(Effect.mapError((cause) => boardError("Could not add the comment.", cause)));
      // A human talking to a working agent should reach it now, not on its next run.
      if (
        actor.kind === "user" &&
        current.task.activeRunKind !== null &&
        current.task.threadId !== null
      ) {
        yield* threads
          .sendToThread({
            projectId: current.task.projectId,
            commandId: CommandId.make(`board:comment:${comment.id}`),
            threadId: current.task.threadId,
            messageId: MessageId.make(`board-comment:${comment.id}`),
            text: buildUserCommentMessage(current.task, input.body),
            attachments: [],
            mode: "auto",
            createdBy: "user",
            creationSource: "server",
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Could not forward a board comment to its agent", {
                taskId: input.taskId,
                cause,
              }),
            ),
          );
      }
      yield* notify(current.task.projectId);
      return comment;
    },
  );

  const updateSettings: BoardService["Service"]["updateSettings"] = Effect.fn(
    "BoardService.updateSettings",
  )(
    function* (input) {
      const current = yield* selectSettings(input.projectId);
      const next = {
        ...current,
        ...(input.autoDispatch === undefined ? {} : { autoDispatch: input.autoDispatch }),
        ...(input.maxConcurrentRuns === undefined
          ? {}
          : { maxConcurrentRuns: input.maxConcurrentRuns }),
        ...(input.useWorktrees === undefined ? {} : { useWorktrees: input.useWorktrees }),
        ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      } satisfies BoardSettings;
      const at = yield* nowIso;
      yield* sql`
        INSERT INTO board_settings (
          project_id, auto_dispatch, max_concurrent_runs, use_worktrees, base_ref, updated_at
        )
        VALUES (
          ${input.projectId}, ${next.autoDispatch ? 1 : 0}, ${next.maxConcurrentRuns},
          ${next.useWorktrees ? 1 : 0}, ${next.baseRef}, ${at}
        )
        ON CONFLICT (project_id) DO UPDATE SET
          auto_dispatch = excluded.auto_dispatch,
          max_concurrent_runs = excluded.max_concurrent_runs,
          use_worktrees = excluded.use_worktrees,
          base_ref = excluded.base_ref,
          updated_at = excluded.updated_at
      `;
      yield* notify(input.projectId);
      return next;
    },
    Effect.mapError((cause) => boardError("Could not save board settings.", cause)),
  );

  const promptContext = Effect.fn("BoardService.promptContext")(function* (
    task: BoardTask,
    agent: BoardAgent,
    agents: ReadonlyArray<BoardAgent>,
    allTasks: ReadonlyArray<BoardTask>,
  ) {
    const ancestors: Array<BoardTask> = [];
    let parentId = task.parentTaskId;
    while (parentId !== null && ancestors.length < 10) {
      const parent = allTasks.find((candidate) => candidate.id === parentId);
      if (parent === undefined) break;
      ancestors.push(parent);
      parentId = parent.parentTaskId;
    }
    const comments = yield* selectComments(task.id);
    return {
      agent,
      task,
      ancestors,
      subtasks: allTasks.filter((candidate) => candidate.parentTaskId === task.id),
      comments,
      agents,
    } satisfies BoardPromptContext;
  });

  const insertRun = Effect.fn("BoardService.insertRun")(function* (input: {
    readonly taskId: BoardTaskId;
    readonly agentId: BoardAgentId;
    readonly threadId: ThreadId;
    readonly kind: BoardRunKind;
  }) {
    const id = BoardRunId.make(yield* newId("board-run"));
    const at = yield* nowIso;
    yield* sql`
      INSERT INTO board_runs (run_id, task_id, agent_id, thread_id, kind, status, started_at, ended_at)
      VALUES (${id}, ${input.taskId}, ${input.agentId}, ${input.threadId}, ${input.kind}, 'running', ${at}, NULL)
    `;
    return id;
  });

  const endRun = Effect.fn("BoardService.endRun")(function* (
    runId: string,
    status: Exclude<BoardRunStatus, "running">,
  ) {
    const at = yield* nowIso;
    yield* sql`
      UPDATE board_runs SET status = ${status}, ended_at = ${at}
      WHERE run_id = ${runId} AND status = 'running'
    `;
  });

  const lastRunEndedAt = Effect.fn("BoardService.lastRunEndedAt")(function* (
    taskId: BoardTaskId,
    kind: BoardRunKind,
  ) {
    const rows = yield* sql<{ readonly ended_at: string | null }>`
      SELECT ended_at FROM board_runs
      WHERE task_id = ${taskId} AND kind = ${kind}
      ORDER BY started_at DESC, rowid DESC LIMIT 1
    `;
    return rows[0]?.ended_at ?? null;
  });

  const countRuns = Effect.fn("BoardService.countRuns")(function* (taskId: BoardTaskId) {
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM board_runs WHERE task_id = ${taskId}
    `;
    return rows[0]?.count ?? 0;
  });

  const workspaceFor = Effect.fn("BoardService.workspaceFor")(function* (
    task: BoardTask,
    settings: BoardSettings,
  ) {
    if (!settings.useWorktrees) return { type: "root" } as const;
    const strategy = { type: "worktree", baseRef: settings.baseRef } as const;
    // A project that is not a git repository, or a base ref that no longer resolves, still
    // gets its agent; it just shares the project checkout.
    return yield* threadLaunch
      .checkWorktreeBase({ projectId: task.projectId, workspaceStrategy: strategy })
      .pipe(
        Effect.as<ThreadLaunchService.ThreadLaunchWorkspaceStrategy>(strategy),
        Effect.catch(() => Effect.succeed({ type: "root" } as const)),
      );
  });

  const startRun = Effect.fn("BoardService.startRun")(function* (input: {
    readonly stored: StoredTask;
    readonly kind: BoardRunKind;
    readonly agent: BoardAgent;
    readonly agents: ReadonlyArray<BoardAgent>;
    readonly allTasks: ReadonlyArray<BoardTask>;
    readonly settings: BoardSettings;
  }) {
    const { stored, kind, agent } = input;
    const task = stored.task;
    const context = yield* promptContext(task, agent, input.agents, input.allTasks);
    const attempt = (yield* countRuns(task.id)) + 1;
    const key = `${task.id}:${kind}:${attempt}`;
    const commandId = CommandId.make(`board:${key}`);
    const messageId = MessageId.make(`board-message:${key}`);

    // Rework continues the builder's own thread so it keeps its context.
    const reuseThread = kind === "work" && task.threadId !== null;
    const threadId = reuseThread
      ? (task.threadId as ThreadId)
      : ThreadId.make(yield* newId("board-thread"));
    const runId = yield* insertRun({ taskId: task.id, agentId: agent.id, threadId, kind });
    if (kind === "work") yield* writeTaskStatus(task.id, "in_progress");
    yield* systemComment(
      task.id,
      kind === "work"
        ? `${agent.name} started working${reuseThread ? " (continuing in the same thread)" : ""}.`
        : `${agent.name} started reviewing.`,
    );
    yield* notify(task.projectId);

    const launched = yield* Effect.exit(
      Effect.gen(function* () {
        if (reuseThread) {
          const since = yield* lastRunEndedAt(task.id, "work");
          yield* threads.sendToThread({
            projectId: task.projectId,
            commandId,
            threadId,
            messageId,
            text: buildReworkPrompt(context, since),
            attachments: [],
            mode: "queue",
            createdBy: "system",
            creationSource: "server",
          });
          return null;
        }
        const workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy =
          kind === "review" && task.worktreePath !== null
            ? { type: "existing_worktree", worktreePath: task.worktreePath }
            : kind === "review"
              ? { type: "root" }
              : yield* workspaceFor(task, input.settings);
        const prompt =
          kind === "work"
            ? buildWorkPrompt(context)
            : buildReviewPrompt(context, {
                worktreePath: task.worktreePath,
                baseRef: input.settings.useWorktrees ? input.settings.baseRef : null,
              });
        const result = yield* threadLaunch.launch({
          commandId,
          threadId,
          projectId: task.projectId,
          title: `${kind === "review" ? "Review" : agent.name}: ${task.title}`,
          generateTitle: false,
          modelSelection: agent.modelSelection,
          runtimeMode: agent.runtimeMode,
          interactionMode: "default",
          workspaceStrategy,
          initialMessage: { messageId, text: prompt, attachments: [] },
          createdBy: "system",
          creationSource: "server",
        });
        return result.projection.thread.worktreePath;
      }),
    );

    if (launched._tag === "Failure") {
      yield* Effect.logWarning("Board could not start an agent", {
        taskId: task.id,
        cause: launched.cause,
      });
      yield* endRun(runId, "failed");
      yield* writeTaskStatus(task.id, "blocked");
      yield* systemComment(
        task.id,
        `${agent.name} could not be started. Check the agent's provider and model, then move the card back.`,
      );
      return;
    }
    if (kind === "work" && !reuseThread) {
      const at = yield* nowIso;
      yield* sql`
        UPDATE board_tasks
        SET thread_id = ${threadId}, worktree_path = ${launched.value}, updated_at = ${at}
        WHERE task_id = ${task.id}
      `;
      yield* notify(task.projectId);
    }
  });

  const runningCount = Effect.fn("BoardService.runningCount")(function* (projectId: ProjectId) {
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM board_runs r
      JOIN board_tasks t ON t.task_id = r.task_id
      WHERE t.project_id = ${projectId} AND r.status = 'running'
    `;
    return rows[0]?.count ?? 0;
  });

  /** Picks the agent that should run next on a card, or null when the card should wait. */
  const nextRunFor = Effect.fn("BoardService.nextRunFor")(function* (
    stored: StoredTask,
    agents: ReadonlyArray<BoardAgent>,
    manual: boolean,
  ) {
    const task = stored.task;
    if (task.activeRunKind !== null) return null;
    if (task.status === "todo" && task.assigneeAgentId !== null) {
      const agent = agents.find((candidate) => candidate.id === task.assigneeAgentId);
      return agent === undefined ? null : { kind: "work" as const, agent };
    }
    if (task.status === "review" && task.reviewerAgentId !== null) {
      // One review per visit to the Review column: a reviewer that ends without deciding
      // hands the card to a human instead of being restarted forever.
      const lastReviewStart = yield* sql<{ readonly started_at: string }>`
        SELECT started_at FROM board_runs
        WHERE task_id = ${task.id} AND kind = 'review'
        ORDER BY started_at DESC, rowid DESC LIMIT 1
      `;
      const reviewedThisVisit =
        lastReviewStart[0] !== undefined && lastReviewStart[0].started_at >= stored.statusChangedAt;
      if (reviewedThisVisit && !manual) return null;
      const agent = agents.find((candidate) => candidate.id === task.reviewerAgentId);
      return agent === undefined ? null : { kind: "review" as const, agent };
    }
    return null;
  });

  const dispatchProject = Effect.fn("BoardService.dispatchProject")(function* (
    projectId: ProjectId,
    options: { readonly onlyTaskId?: BoardTaskId } = {},
  ) {
    const settings = yield* selectSettings(projectId);
    if (!settings.autoDispatch && options.onlyTaskId === undefined) return;
    const agents = yield* selectAgents();
    const tasks = yield* selectTasks(projectId);
    const allTasks = tasks.map((stored) => stored.task);
    let slots = settings.maxConcurrentRuns - (yield* runningCount(projectId));
    for (const stored of tasks) {
      if (options.onlyTaskId !== undefined && stored.task.id !== options.onlyTaskId) continue;
      if (slots <= 0 && options.onlyTaskId === undefined) break;
      const next = yield* nextRunFor(stored, agents, options.onlyTaskId !== undefined);
      if (next === null) continue;
      yield* startRun({ stored, ...next, agents, allTasks, settings });
      slots -= 1;
    }
  });

  // Every board change triggers a pass, and a pass only publishes a change when it starts a
  // run (inside startRun), so passes settle instead of feeding each other.
  const dispatch = (projectId: ProjectId, options?: { readonly onlyTaskId?: BoardTaskId }) =>
    dispatchLock
      .withPermits(1)(dispatchProject(projectId, options))
      .pipe(
        Effect.catch((cause) => Effect.logWarning("Board dispatch failed", { projectId, cause })),
      );

  const startTask: BoardService["Service"]["startTask"] = Effect.fn("BoardService.startTask")(
    function* (id) {
      const current = yield* requireTask(id);
      if (current.task.activeRunKind !== null) {
        return yield* boardError("An agent is already working on this card.");
      }
      if (current.task.status === "done") {
        return yield* boardError("Move the card out of Done to rework it.");
      }
      if (current.task.status === "review" && current.task.reviewerAgentId === null) {
        return yield* boardError("Set a reviewer before starting the review.");
      }
      if (current.task.status !== "review" && current.task.assigneeAgentId === null) {
        return yield* boardError("Assign an agent before starting the card.");
      }
      if (current.task.status !== "review") {
        yield* updateTask({ id, status: "todo" }, { kind: "user" });
      }
      yield* dispatch(current.task.projectId, { onlyTaskId: id });
      return (yield* requireTask(id)).task;
    },
  );

  /** Settles a card when the agent's thread has gone idle without moving it. */
  const settleRun = Effect.fn("BoardService.settleRun")(function* (
    row: RunningRunRow,
    runStatus: OrchestrationV2Run["status"],
  ) {
    const succeeded = runStatus === "completed";
    yield* endRun(
      row.run_id,
      succeeded ? "completed" : runStatus === "failed" ? "failed" : "cancelled",
    );
    const stored = yield* selectTask(BoardTaskId.make(row.task_id));
    if (stored === null) return;
    const agents = yield* selectAgents();
    const name = agents.find((agent) => agent.id === row.agent_id)?.name ?? "The agent";
    if (row.kind === "work" && stored.task.status === "in_progress") {
      const next: BoardTaskStatus = succeeded ? "review" : "blocked";
      yield* writeTaskStatus(stored.task.id, next);
      yield* systemComment(
        stored.task.id,
        succeeded
          ? `${name} finished without moving the card; moved it to Review.`
          : `${name}'s run ended (${runStatus}); moved the card to Blocked.`,
      );
    } else if (row.kind === "review" && stored.task.status === "review") {
      yield* systemComment(
        stored.task.id,
        `${name} finished reviewing without a decision; waiting for a human.`,
      );
    }
    // The published change starts the next pass; dispatching here would re-enter the lock.
    yield* notify(stored.task.projectId);
  });

  const onRunUpdated = Effect.fn("BoardService.onRunUpdated")(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
  ) {
    if (!ThreadManagementService.isTerminalRunStatus(run.status)) return;
    const row = yield* runningRunForThread(threadId);
    if (row === null || row.status !== "running") return;
    // A queued follow-up keeps the agent working; settle once the thread is idle.
    const shell = yield* threads.getThreadShell(threadId);
    if (shell !== null && shell.activeRunId !== null && shell.activeRunId !== run.id) return;
    yield* settleRun(row, run.status);
  });

  // Runs that ended while the server was down never produce a live event.
  const recoverRuns = Effect.fn("BoardService.recoverRuns")(function* () {
    const rows = yield* sql<RunningRunRow>`
      SELECT r.*, t.project_id FROM board_runs r
      JOIN board_tasks t ON t.task_id = r.task_id
      WHERE r.status = 'running'
    `;
    for (const row of rows) {
      const shell = yield* threads.getThreadShell(ThreadId.make(row.thread_id));
      if (shell !== null && shell.activeRunId !== null) continue;
      yield* settleRun(row, shell?.status === "failed" ? "failed" : "completed");
    }
    const projects = yield* sql<{ readonly project_id: string }>`
      SELECT DISTINCT project_id FROM board_tasks
    `;
    for (const project of projects) yield* dispatch(project.project_id as ProjectId);
  });

  yield* forkParked(
    recoverRuns().pipe(
      Effect.catch((cause) => Effect.logWarning("Board run recovery failed", { cause })),
      Effect.andThen(
        Stream.runForEach(threads.streamDomainEvents, (event) =>
          event.type === "run.updated"
            ? dispatchLock
                .withPermits(1)(onRunUpdated(event.threadId, event.payload))
                .pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Board could not settle a run", {
                      threadId: event.threadId,
                      cause,
                    }),
                  ),
                )
            : Effect.void,
        ),
      ),
    ),
  );

  // Card changes from people and agents can make work startable. Subscribing here, before the
  // service is returned, means no change published after construction is missed.
  const dispatchTriggers = yield* PubSub.subscribe(changes);
  yield* forkParked(
    Stream.runForEach(Stream.fromSubscription(dispatchTriggers), (projectId) =>
      projectId === null ? Effect.void : dispatch(projectId),
    ),
  );

  const runCommand: BoardService["Service"]["runCommand"] = (command, actor) => {
    switch (command.type) {
      case "agent.upsert":
        return upsertAgent(command.agent).pipe(Effect.map((agent) => ({ agent })));
      case "agent.delete":
        return deleteAgent(command.id).pipe(Effect.as({}));
      case "task.create":
        return createTask(command.task, actor).pipe(Effect.map((task) => ({ task })));
      case "task.update":
        return updateTask(command.task, actor).pipe(Effect.map((task) => ({ task })));
      case "task.delete":
        return deleteTask(command.id).pipe(Effect.as({}));
      case "task.start":
        return startTask(command.id).pipe(Effect.map((task) => ({ task })));
      case "comment.add":
        return addComment(command.comment, actor).pipe(Effect.map((comment) => ({ comment })));
      case "settings.update":
        return updateSettings(command.settings).pipe(Effect.map((settings) => ({ settings })));
    }
  };

  return BoardService.of({
    runCommand,
    snapshot,
    subscribe,
    taskDetail,
    subscribeTaskDetail,
    listAgents,
    upsertAgent,
    deleteAgent,
    createTask,
    updateTask,
    deleteTask,
    startTask,
    addComment,
    updateSettings,
    assignmentForThread,
  });
});

export const layer = Layer.effect(BoardService, make);
