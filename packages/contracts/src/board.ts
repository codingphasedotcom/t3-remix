import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode } from "./providerPolicy.ts";

export const BoardAgentId = TrimmedNonEmptyString.pipe(Schema.brand("BoardAgentId"));
export type BoardAgentId = typeof BoardAgentId.Type;

export const BoardTaskId = TrimmedNonEmptyString.pipe(Schema.brand("BoardTaskId"));
export type BoardTaskId = typeof BoardTaskId.Type;

export const BoardCommentId = TrimmedNonEmptyString.pipe(Schema.brand("BoardCommentId"));
export type BoardCommentId = typeof BoardCommentId.Type;

export const BoardRunId = TrimmedNonEmptyString.pipe(Schema.brand("BoardRunId"));
export type BoardRunId = typeof BoardRunId.Type;

const BOARD_TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
] as const;

export const BoardTaskStatus = Schema.Literals(BOARD_TASK_STATUSES).annotate({
  description:
    "Card column. todo with an assignee starts the assignee; review with a reviewer starts the reviewer; done is final.",
});
export type BoardTaskStatus = typeof BoardTaskStatus.Type;

const MAX_BOARD_CONCURRENT_RUNS = 10;

const BoardConcurrentRuns = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_BOARD_CONCURRENT_RUNS }),
);

export const BoardAgent = Schema.Struct({
  id: BoardAgentId,
  name: TrimmedNonEmptyString,
  role: TrimmedString,
  instructions: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardAgent = typeof BoardAgent.Type;

export const BoardRunKind = Schema.Literals(["work", "review"]);
export type BoardRunKind = typeof BoardRunKind.Type;

export const BoardRunStatus = Schema.Literals(["running", "completed", "failed", "cancelled"]);
export type BoardRunStatus = typeof BoardRunStatus.Type;

export const BoardTask = Schema.Struct({
  id: BoardTaskId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: BoardTaskStatus,
  position: Schema.Number,
  assigneeAgentId: Schema.NullOr(BoardAgentId),
  reviewerAgentId: Schema.NullOr(BoardAgentId),
  parentTaskId: Schema.NullOr(BoardTaskId),
  threadId: Schema.NullOr(ThreadId),
  worktreePath: Schema.NullOr(Schema.String),
  activeRunKind: Schema.NullOr(BoardRunKind),
  createdByAgentId: Schema.NullOr(BoardAgentId),
  commentCount: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardTask = typeof BoardTask.Type;

export const BoardCommentAuthorKind = Schema.Literals(["user", "agent", "system"]);
export type BoardCommentAuthorKind = typeof BoardCommentAuthorKind.Type;

export const BoardComment = Schema.Struct({
  id: BoardCommentId,
  taskId: BoardTaskId,
  authorKind: BoardCommentAuthorKind,
  authorAgentId: Schema.NullOr(BoardAgentId),
  body: Schema.String,
  createdAt: IsoDateTime,
});
export type BoardComment = typeof BoardComment.Type;

export const BoardRun = Schema.Struct({
  id: BoardRunId,
  taskId: BoardTaskId,
  agentId: BoardAgentId,
  threadId: ThreadId,
  kind: BoardRunKind,
  status: BoardRunStatus,
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
});
export type BoardRun = typeof BoardRun.Type;

export const BoardSettings = Schema.Struct({
  projectId: ProjectId,
  autoDispatch: Schema.Boolean,
  maxConcurrentRuns: BoardConcurrentRuns,
  useWorktrees: Schema.Boolean.annotate({
    description: "Give each card its own git worktree; reviewers open the same worktree.",
  }),
  baseRef: TrimmedNonEmptyString,
});
export type BoardSettings = typeof BoardSettings.Type;

export const BoardSnapshot = Schema.Struct({
  projectId: ProjectId,
  settings: BoardSettings,
  agents: Schema.Array(BoardAgent),
  tasks: Schema.Array(BoardTask),
});
export type BoardSnapshot = typeof BoardSnapshot.Type;

export const BoardTaskDetail = Schema.Struct({
  task: BoardTask,
  comments: Schema.Array(BoardComment),
  runs: Schema.Array(BoardRun),
});
export type BoardTaskDetail = typeof BoardTaskDetail.Type;

export const BoardSubscribeInput = Schema.Struct({ projectId: ProjectId });
export type BoardSubscribeInput = typeof BoardSubscribeInput.Type;

export const BoardTaskDetailInput = Schema.Struct({ taskId: BoardTaskId });
export type BoardTaskDetailInput = typeof BoardTaskDetailInput.Type;

export const BoardAgentUpsertInput = Schema.Struct({
  id: Schema.optional(BoardAgentId),
  name: TrimmedNonEmptyString,
  role: TrimmedString,
  instructions: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
});
export type BoardAgentUpsertInput = typeof BoardAgentUpsertInput.Type;

export const BoardTaskCreateInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  status: Schema.optional(BoardTaskStatus),
  assigneeAgentId: Schema.optional(Schema.NullOr(BoardAgentId)),
  reviewerAgentId: Schema.optional(Schema.NullOr(BoardAgentId)),
  parentTaskId: Schema.optional(Schema.NullOr(BoardTaskId)),
});
export type BoardTaskCreateInput = typeof BoardTaskCreateInput.Type;

export const BoardTaskUpdateInput = Schema.Struct({
  id: BoardTaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  status: Schema.optional(BoardTaskStatus),
  position: Schema.optional(Schema.Number),
  assigneeAgentId: Schema.optional(Schema.NullOr(BoardAgentId)),
  reviewerAgentId: Schema.optional(Schema.NullOr(BoardAgentId)),
});
export type BoardTaskUpdateInput = typeof BoardTaskUpdateInput.Type;

export const BoardCommentAddInput = Schema.Struct({
  taskId: BoardTaskId,
  body: TrimmedNonEmptyString,
});
export type BoardCommentAddInput = typeof BoardCommentAddInput.Type;

export const BoardSettingsUpdateInput = Schema.Struct({
  projectId: ProjectId,
  autoDispatch: Schema.optional(Schema.Boolean),
  maxConcurrentRuns: Schema.optional(BoardConcurrentRuns),
  useWorktrees: Schema.optional(Schema.Boolean),
  baseRef: Schema.optional(TrimmedNonEmptyString),
});
export type BoardSettingsUpdateInput = typeof BoardSettingsUpdateInput.Type;

/**
 * Every board mutation travels through one RPC. The WebSocket RPC group is already near the
 * size where its inferred types collapse, so the board adds three methods instead of ten.
 */
export const BoardCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("agent.upsert"), agent: BoardAgentUpsertInput }),
  Schema.Struct({ type: Schema.Literal("agent.delete"), id: BoardAgentId }),
  Schema.Struct({ type: Schema.Literal("task.create"), task: BoardTaskCreateInput }),
  Schema.Struct({ type: Schema.Literal("task.update"), task: BoardTaskUpdateInput }),
  Schema.Struct({ type: Schema.Literal("task.delete"), id: BoardTaskId }),
  Schema.Struct({ type: Schema.Literal("task.start"), id: BoardTaskId }),
  Schema.Struct({ type: Schema.Literal("comment.add"), comment: BoardCommentAddInput }),
  Schema.Struct({ type: Schema.Literal("settings.update"), settings: BoardSettingsUpdateInput }),
]);
export type BoardCommand = typeof BoardCommand.Type;

export const BoardCommandResult = Schema.Struct({
  agent: Schema.optional(BoardAgent),
  task: Schema.optional(BoardTask),
  comment: Schema.optional(BoardComment),
  settings: Schema.optional(BoardSettings),
});
export type BoardCommandResult = typeof BoardCommandResult.Type;

export class BoardError extends Schema.TaggedError<BoardError>()("BoardError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
