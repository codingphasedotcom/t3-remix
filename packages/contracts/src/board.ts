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

export const BoardCompanyId = TrimmedNonEmptyString.pipe(Schema.brand("BoardCompanyId"));
export type BoardCompanyId = typeof BoardCompanyId.Type;

export const BoardAgentId = TrimmedNonEmptyString.pipe(Schema.brand("BoardAgentId"));
export type BoardAgentId = typeof BoardAgentId.Type;

export const BoardSkillId = TrimmedNonEmptyString.pipe(Schema.brand("BoardSkillId"));
export type BoardSkillId = typeof BoardSkillId.Type;

export const BoardTaskId = TrimmedNonEmptyString.pipe(Schema.brand("BoardTaskId"));
export type BoardTaskId = typeof BoardTaskId.Type;

export const BoardCommentId = TrimmedNonEmptyString.pipe(Schema.brand("BoardCommentId"));
export type BoardCommentId = typeof BoardCommentId.Type;

export const BoardRunId = TrimmedNonEmptyString.pipe(Schema.brand("BoardRunId"));
export type BoardRunId = typeof BoardRunId.Type;

export const BoardHireId = TrimmedNonEmptyString.pipe(Schema.brand("BoardHireId"));
export type BoardHireId = typeof BoardHireId.Type;

export const BoardDepartmentId = TrimmedNonEmptyString.pipe(Schema.brand("BoardDepartmentId"));
export type BoardDepartmentId = typeof BoardDepartmentId.Type;

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

/** Memory rides along in every prompt, so it stays a short, curated list. */
export const MAX_AGENT_MEMORY_CHARS = 8_000;
export const MAX_COMPANY_MEMORY_CHARS = 16_000;

const BoardConcurrentRuns = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_BOARD_CONCURRENT_RUNS }),
);

const BoardDepartmentName = TrimmedNonEmptyString.check(Schema.isMaxLength(40));

/** A part of the company, such as Engineering. Every agent belongs to exactly one. */
export const BoardDepartment = Schema.Struct({
  id: BoardDepartmentId,
  name: BoardDepartmentName,
});
export type BoardDepartment = typeof BoardDepartment.Type;

export const BoardCompany = Schema.Struct({
  id: BoardCompanyId,
  name: TrimmedNonEmptyString,
  mission: Schema.String,
  departments: Schema.Array(BoardDepartment),
  memory: Schema.String.annotate({
    description: "Decisions and conventions every agent in the company should know.",
  }),
  projectId: ProjectId,
  ceoAgentId: Schema.NullOr(BoardAgentId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardCompany = typeof BoardCompany.Type;

export const BoardSkill = Schema.Struct({
  id: BoardSkillId,
  companyId: BoardCompanyId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  instructions: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardSkill = typeof BoardSkill.Type;

/** A face from the app's bundled set, by key; empty lets the client pick one from the id. */
const BoardAvatar = Schema.String.check(Schema.isMaxLength(64));

export const BoardAgent = Schema.Struct({
  id: BoardAgentId,
  companyId: BoardCompanyId,
  name: TrimmedNonEmptyString,
  title: TrimmedString,
  avatar: BoardAvatar,
  departmentId: BoardDepartmentId,
  reportsToAgentId: Schema.NullOr(BoardAgentId),
  skillIds: Schema.Array(BoardSkillId),
  instructions: Schema.String,
  memory: Schema.String.annotate({
    description: "Lessons this agent keeps between cards.",
  }),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  paused: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardAgent = typeof BoardAgent.Type;

export const BoardHireStatus = Schema.Literals(["pending", "approved", "rejected"]);
export type BoardHireStatus = typeof BoardHireStatus.Type;

/** An agent's request to add a teammate. A person approves it before the agent exists. */
export const BoardHire = Schema.Struct({
  id: BoardHireId,
  companyId: BoardCompanyId,
  requestedByAgentId: Schema.NullOr(BoardAgentId),
  name: TrimmedNonEmptyString,
  title: TrimmedString,
  departmentId: Schema.NullOr(BoardDepartmentId),
  reportsToAgentId: Schema.NullOr(BoardAgentId),
  skillIds: Schema.Array(BoardSkillId),
  instructions: Schema.String,
  reason: Schema.String,
  status: BoardHireStatus,
  createdAt: IsoDateTime,
});
export type BoardHire = typeof BoardHire.Type;

export const BoardRunKind = Schema.Literals(["work", "review"]);
export type BoardRunKind = typeof BoardRunKind.Type;

export const BoardRunStatus = Schema.Literals(["running", "completed", "failed", "cancelled"]);
export type BoardRunStatus = typeof BoardRunStatus.Type;

export const BoardTask = Schema.Struct({
  id: BoardTaskId,
  companyId: BoardCompanyId,
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

/** A thread the board started for an employee, with the latest run it held there. */
export const BoardAgentThread = Schema.Struct({
  threadId: ThreadId,
  agentId: BoardAgentId,
  taskId: BoardTaskId,
  kind: BoardRunKind,
  status: BoardRunStatus,
  startedAt: IsoDateTime,
});
export type BoardAgentThread = typeof BoardAgentThread.Type;

export const BoardSettings = Schema.Struct({
  companyId: BoardCompanyId,
  autoDispatch: Schema.Boolean,
  maxConcurrentRuns: BoardConcurrentRuns,
  useWorktrees: Schema.Boolean.annotate({
    description: "Give each card its own git worktree; reviewers open the same worktree.",
  }),
  baseRef: TrimmedNonEmptyString,
});
export type BoardSettings = typeof BoardSettings.Type;

export const BoardCompanySummary = Schema.Struct({
  id: BoardCompanyId,
  name: TrimmedNonEmptyString,
  projectId: ProjectId,
  agentCount: Schema.Int,
  openTaskCount: Schema.Int,
  pendingHireCount: Schema.Int,
});
export type BoardCompanySummary = typeof BoardCompanySummary.Type;

/** Every company's summary, plus the full board of the one being viewed. */
export const BoardSnapshot = Schema.Struct({
  companies: Schema.Array(BoardCompanySummary),
  company: Schema.NullOr(BoardCompany),
  settings: Schema.NullOr(BoardSettings),
  agents: Schema.Array(BoardAgent),
  skills: Schema.Array(BoardSkill),
  hires: Schema.Array(BoardHire),
  tasks: Schema.Array(BoardTask),
  threads: Schema.Array(BoardAgentThread),
});
export type BoardSnapshot = typeof BoardSnapshot.Type;

export const BoardTaskDetail = Schema.Struct({
  task: BoardTask,
  comments: Schema.Array(BoardComment),
  runs: Schema.Array(BoardRun),
});
export type BoardTaskDetail = typeof BoardTaskDetail.Type;

export const BoardSubscribeInput = Schema.Struct({
  companyId: Schema.NullOr(BoardCompanyId),
});
export type BoardSubscribeInput = typeof BoardSubscribeInput.Type;

export const BoardTaskDetailInput = Schema.Struct({ taskId: BoardTaskId });
export type BoardTaskDetailInput = typeof BoardTaskDetailInput.Type;

export const BoardCompanyWorkspace = Schema.Union([
  Schema.Struct({ type: Schema.Literal("existing"), projectId: ProjectId }),
  Schema.Struct({ type: Schema.Literal("new"), folderName: TrimmedNonEmptyString }),
]).annotate({
  description: "Where the company's agents work: an existing project, or a new project folder.",
});
export type BoardCompanyWorkspace = typeof BoardCompanyWorkspace.Type;

export const BoardCompanyCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  mission: Schema.String,
  workspace: BoardCompanyWorkspace,
  ceo: Schema.Struct({
    name: TrimmedNonEmptyString,
    avatar: Schema.optional(BoardAvatar),
    instructions: Schema.String,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
  }),
});
export type BoardCompanyCreateInput = typeof BoardCompanyCreateInput.Type;

export const BoardCompanyUpdateInput = Schema.Struct({
  id: BoardCompanyId,
  name: Schema.optional(TrimmedNonEmptyString),
  mission: Schema.optional(Schema.String),
  memory: Schema.optional(Schema.String),
  departments: Schema.optional(
    Schema.Array(
      Schema.Struct({ id: Schema.optional(BoardDepartmentId), name: BoardDepartmentName }),
    ),
  ).annotate({
    description:
      "Every department in order; entries without an id are new. A department with people in it cannot be removed.",
  }),
});
export type BoardCompanyUpdateInput = typeof BoardCompanyUpdateInput.Type;

export const BoardSkillUpsertInput = Schema.Struct({
  id: Schema.optional(BoardSkillId),
  companyId: BoardCompanyId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  instructions: Schema.String,
});
export type BoardSkillUpsertInput = typeof BoardSkillUpsertInput.Type;

export const BoardAgentUpsertInput = Schema.Struct({
  id: Schema.optional(BoardAgentId),
  companyId: BoardCompanyId,
  name: TrimmedNonEmptyString,
  title: TrimmedString,
  avatar: Schema.optional(BoardAvatar),
  departmentId: Schema.optional(BoardDepartmentId).annotate({
    description: "Defaults to the manager's department.",
  }),
  reportsToAgentId: Schema.NullOr(BoardAgentId),
  skillIds: Schema.Array(BoardSkillId),
  instructions: Schema.String,
  memory: Schema.optional(Schema.String),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  paused: Schema.optional(Schema.Boolean),
});
export type BoardAgentUpsertInput = typeof BoardAgentUpsertInput.Type;

export const BoardHireDecisionInput = Schema.Struct({
  id: BoardHireId,
  approve: Schema.Boolean,
  modelSelection: Schema.optional(ModelSelection).annotate({
    description: "Model for the new agent; defaults to the requesting agent's model.",
  }),
  runtimeMode: Schema.optional(RuntimeMode),
});
export type BoardHireDecisionInput = typeof BoardHireDecisionInput.Type;

export const BoardTaskCreateInput = Schema.Struct({
  companyId: BoardCompanyId,
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
  companyId: BoardCompanyId,
  autoDispatch: Schema.optional(Schema.Boolean),
  maxConcurrentRuns: Schema.optional(BoardConcurrentRuns),
  useWorktrees: Schema.optional(Schema.Boolean),
  baseRef: Schema.optional(TrimmedNonEmptyString),
});
export type BoardSettingsUpdateInput = typeof BoardSettingsUpdateInput.Type;

/**
 * Every board mutation travels through one RPC. The WebSocket RPC group is already near the
 * size where its inferred types collapse, so the board adds three methods instead of many.
 */
export const BoardCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("company.create"), company: BoardCompanyCreateInput }),
  Schema.Struct({ type: Schema.Literal("company.update"), company: BoardCompanyUpdateInput }),
  Schema.Struct({ type: Schema.Literal("company.delete"), id: BoardCompanyId }),
  Schema.Struct({ type: Schema.Literal("skill.upsert"), skill: BoardSkillUpsertInput }),
  Schema.Struct({ type: Schema.Literal("skill.delete"), id: BoardSkillId }),
  Schema.Struct({ type: Schema.Literal("agent.upsert"), agent: BoardAgentUpsertInput }),
  Schema.Struct({ type: Schema.Literal("agent.delete"), id: BoardAgentId }),
  Schema.Struct({ type: Schema.Literal("hire.decide"), hire: BoardHireDecisionInput }),
  Schema.Struct({ type: Schema.Literal("task.create"), task: BoardTaskCreateInput }),
  Schema.Struct({ type: Schema.Literal("task.update"), task: BoardTaskUpdateInput }),
  Schema.Struct({ type: Schema.Literal("task.delete"), id: BoardTaskId }),
  Schema.Struct({ type: Schema.Literal("task.start"), id: BoardTaskId }),
  Schema.Struct({ type: Schema.Literal("comment.add"), comment: BoardCommentAddInput }),
  Schema.Struct({ type: Schema.Literal("settings.update"), settings: BoardSettingsUpdateInput }),
]);
export type BoardCommand = typeof BoardCommand.Type;

export const BoardCommandResult = Schema.Struct({
  company: Schema.optional(BoardCompany),
  skill: Schema.optional(BoardSkill),
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
