import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
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

export const BoardRoutineId = TrimmedNonEmptyString.pipe(Schema.brand("BoardRoutineId"));
export type BoardRoutineId = typeof BoardRoutineId.Type;

export const BoardWorkLinkId = TrimmedNonEmptyString.pipe(Schema.brand("BoardWorkLinkId"));
export type BoardWorkLinkId = typeof BoardWorkLinkId.Type;

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
    "Task column. todo with an assignee starts the assignee; review with a reviewer starts the reviewer; done is final.",
});
export type BoardTaskStatus = typeof BoardTaskStatus.Type;

const MAX_BOARD_CONCURRENT_RUNS = 10;

/** Memory rides along in every prompt, so it stays a short, curated list. */
export const MAX_AGENT_MEMORY_CHARS = 8_000;
export const MAX_COMPANY_MEMORY_CHARS = 16_000;

const BoardConcurrentRuns = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_BOARD_CONCURRENT_RUNS }),
);

/** Input plus output tokens per calendar month (UTC); null for no limit. */
const BoardMonthlyTokenLimit = Schema.NullOr(PositiveInt).annotate({
  description:
    "Input plus output tokens per calendar month (UTC). Agents over it are not started until it is raised or the month ends.",
});

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
    description: "Lessons this agent keeps between tasks.",
  }),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  paused: Schema.Boolean,
  monthlyTokenLimit: BoardMonthlyTokenLimit,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardAgent = typeof BoardAgent.Type;

export const BoardHireStatus = Schema.Literals(["pending", "approved", "rejected"]);
export type BoardHireStatus = typeof BoardHireStatus.Type;

/** Servers from before hires could report to other hires send no manager request. */
const ReportsToHireId = Schema.NullOr(BoardHireId)
  .pipe(Schema.withDecodingDefault(Effect.succeed(null)))
  .annotate({
    description:
      "A pending request for their manager, in place of reportsToAgentId. They can be hired once that manager is.",
  });

/** An agent's request to add a teammate. A person approves it before the agent exists. */
export const BoardHire = Schema.Struct({
  id: BoardHireId,
  companyId: BoardCompanyId,
  requestedByAgentId: Schema.NullOr(BoardAgentId),
  name: TrimmedNonEmptyString,
  title: TrimmedString,
  departmentId: Schema.NullOr(BoardDepartmentId),
  reportsToAgentId: Schema.NullOr(BoardAgentId),
  reportsToHireId: ReportsToHireId,
  skillIds: Schema.Array(BoardSkillId),
  instructions: Schema.String,
  reason: Schema.String,
  status: BoardHireStatus,
  createdAt: IsoDateTime,
});
export type BoardHire = typeof BoardHire.Type;

/** "reply" answers a person's comment on a task without working the task itself. */
export const BoardRunKind = Schema.Literals(["work", "review", "reply"]);
export type BoardRunKind = typeof BoardRunKind.Type;

export const BoardRunStatus = Schema.Literals(["running", "completed", "failed", "cancelled"]);
export type BoardRunStatus = typeof BoardRunStatus.Type;

/** Servers from before people could take tasks send no flag; their tasks are never a person's. */
const AssignedToUser = Schema.Boolean.pipe(
  Schema.withDecodingDefault(Effect.succeed(false)),
).annotate({
  description:
    "The person using the board owns it instead of an agent. No agent works, reviews, or replies on it.",
});

/** Servers from before tasks could be archived send no date; their tasks are never archived. */
const TaskArchivedAt = Schema.NullOr(IsoDateTime)
  .pipe(Schema.withDecodingDefault(Effect.succeed(null)))
  .annotate({
    description:
      "When a person archived the finished task, with its subtasks. Archived tasks leave the board until restored.",
  });

export const BoardTask = Schema.Struct({
  id: BoardTaskId,
  companyId: BoardCompanyId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: BoardTaskStatus,
  position: Schema.Number,
  assigneeAgentId: Schema.NullOr(BoardAgentId),
  assignedToUser: AssignedToUser,
  reviewerAgentId: Schema.NullOr(BoardAgentId),
  parentTaskId: Schema.NullOr(BoardTaskId),
  threadId: Schema.NullOr(ThreadId),
  worktreePath: Schema.NullOr(Schema.String),
  activeRunKind: Schema.NullOr(BoardRunKind),
  createdByAgentId: Schema.NullOr(BoardAgentId),
  commentCount: Schema.Int,
  archivedAt: TaskArchivedAt,
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
    description: "Give each task its own git worktree; reviewers open the same worktree.",
  }),
  baseRef: TrimmedNonEmptyString,
  monthlyTokenLimit: BoardMonthlyTokenLimit,
});
export type BoardSettings = typeof BoardSettings.Type;

const BoardRoutineEveryDays = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 }));

/** A task the board creates on a schedule, such as a weekly review. */
export const BoardRoutine = Schema.Struct({
  id: BoardRoutineId,
  companyId: BoardCompanyId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  assigneeAgentId: Schema.NullOr(BoardAgentId),
  assignedToUser: AssignedToUser,
  everyDays: BoardRoutineEveryDays,
  nextRunAt: IsoDateTime,
  enabled: Schema.Boolean,
  /** The latest task it created; a new one waits until that one is done. */
  lastTaskId: Schema.NullOr(BoardTaskId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardRoutine = typeof BoardRoutine.Type;

/** This month's spending, sent only to companies that set a limit somewhere. */
export const BoardUsage = Schema.Struct({
  monthStart: IsoDateTime,
  companyTokens: NonNegativeInt,
  agents: Schema.Array(Schema.Struct({ agentId: BoardAgentId, tokens: NonNegativeInt })),
});
export type BoardUsage = typeof BoardUsage.Type;

/** Just enough of an employee to @mention them from a chat or a task. */
export const BoardCompanyMember = Schema.Struct({
  id: BoardAgentId,
  name: TrimmedNonEmptyString,
  title: TrimmedString,
  avatar: BoardAvatar,
});
export type BoardCompanyMember = typeof BoardCompanyMember.Type;

export const BoardCompanySummary = Schema.Struct({
  id: BoardCompanyId,
  name: TrimmedNonEmptyString,
  projectId: ProjectId,
  members: Schema.Array(BoardCompanyMember),
  agentCount: Schema.Int,
  openTaskCount: Schema.Int,
  pendingHireCount: Schema.Int,
});
export type BoardCompanySummary = typeof BoardCompanySummary.Type;

/** Tokens spent in board threads; input includes the cached input. */
export const BoardTokenTotals = Schema.Struct({
  input: NonNegativeInt,
  cachedInput: NonNegativeInt,
  output: NonNegativeInt,
});
export type BoardTokenTotals = typeof BoardTokenTotals.Type;

/** How a set of board runs ended, how long they took, and the tokens their threads spent. */
export const BoardRunStats = Schema.Struct({
  runs: NonNegativeInt,
  reviews: NonNegativeInt,
  completed: NonNegativeInt,
  failed: NonNegativeInt,
  cancelled: NonNegativeInt,
  running: NonNegativeInt,
  finishedRunMs: Schema.Number.annotate({ description: "Summed wall-clock time of ended runs." }),
  tokens: BoardTokenTotals,
  lastRunAt: Schema.NullOr(IsoDateTime),
});
export type BoardRunStats = typeof BoardRunStats.Type;

export const BoardDashboardDay = Schema.Struct({
  day: Schema.String.annotate({ description: "YYYY-MM-DD in the viewer's UTC offset." }),
  runs: NonNegativeInt,
  tasksFinished: NonNegativeInt,
  tokens: NonNegativeInt,
});
export type BoardDashboardDay = typeof BoardDashboardDay.Type;

/**
 * Run history and token spend for one company. Tasks, people, and departments are already in
 * the board snapshot, so the dashboard carries only what the snapshot cannot.
 */
export const BoardDashboard = Schema.Struct({
  companyId: BoardCompanyId,
  totals: BoardRunStats,
  agents: Schema.Array(Schema.Struct({ agentId: BoardAgentId, stats: BoardRunStats })),
  models: Schema.Array(
    Schema.Struct({
      modelSelection: ModelSelection,
      agentIds: Schema.Array(BoardAgentId),
      stats: BoardRunStats,
    }),
  ).annotate({ description: "Grouped by the model each run's thread used, busiest first." }),
  days: Schema.Array(BoardDashboardDay).annotate({ description: "Oldest first, one per day." }),
  medianCycleMs: Schema.NullOr(Schema.Number).annotate({
    description: "Median time from a task's creation to done.",
  }),
});
export type BoardDashboard = typeof BoardDashboard.Type;

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
  routines: Schema.Array(BoardRoutine),
  usage: Schema.NullOr(BoardUsage),
  dashboard: Schema.optional(BoardDashboard).annotate({
    description: "Present only for a subscription that asked for it.",
  }),
});
export type BoardSnapshot = typeof BoardSnapshot.Type;

export const BoardWorkLinkKind = Schema.Literals([
  "pull_request",
  "branch",
  "preview",
  "commit",
  "document",
  "other",
  /** A file a person attached for the work, by its path on the server's machine. */
  "file",
]);
export type BoardWorkLinkKind = typeof BoardWorkLinkKind.Type;

export const BoardWorkLinkStatus = Schema.Literals(["open", "draft", "merged", "closed"]);
export type BoardWorkLinkStatus = typeof BoardWorkLinkStatus.Type;

/** Something a task produced, such as a pull request or a preview, so people can find it. */
export const BoardWorkLink = Schema.Struct({
  id: BoardWorkLinkId,
  taskId: BoardTaskId,
  kind: BoardWorkLinkKind,
  title: TrimmedNonEmptyString,
  /** A URL, or a branch name for a branch. */
  url: TrimmedNonEmptyString,
  status: Schema.NullOr(BoardWorkLinkStatus),
  agentId: Schema.NullOr(BoardAgentId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardWorkLink = typeof BoardWorkLink.Type;

/**
 * How a person ships a finished task's branch: a pull request on the repository's host, or a
 * merge into the branch checked out in the project folder.
 */
export const BoardShipMethod = Schema.Literals(["pull_request", "merge"]);
export type BoardShipMethod = typeof BoardShipMethod.Type;

/** Why a task's branch cannot be shipped right now, or null when it can. */
export function boardShipBlocker(task: BoardTask, tasks: ReadonlyArray<BoardTask>): string | null {
  if (task.threadId === null) return "This task has not started, so it has no branch yet.";
  if (task.worktreePath === null) {
    return "This task worked in the project folder, so it has no branch of its own.";
  }
  const parent = tasks.find((candidate) => candidate.id === task.parentTaskId);
  if (parent?.worktreePath === task.worktreePath) return "Subtasks ship with their parent task.";
  if (task.status !== "review" && task.status !== "done") {
    return "Ship a task once it is in Review or Done.";
  }
  // Subtasks share their parent's worktree, so any of them still running blocks it too.
  const busy = tasks.some(
    (other) => other.worktreePath === task.worktreePath && other.activeRunKind !== null,
  );
  if (busy) {
    return "An agent is still working in this task's worktree.";
  }
  return null;
}

export const BoardTaskDetail = Schema.Struct({
  task: BoardTask,
  comments: Schema.Array(BoardComment),
  runs: Schema.Array(BoardRun),
  links: Schema.Array(BoardWorkLink),
});
export type BoardTaskDetail = typeof BoardTaskDetail.Type;

/**
 * The dashboard rides on the board subscription rather than its own RPC: the WebSocket RPC group
 * is at the size where another method collapses its inferred types.
 */
export const BoardSubscribeInput = Schema.Struct({
  companyId: Schema.NullOr(BoardCompanyId),
  dashboard: Schema.optional(
    Schema.Struct({
      utcOffsetMinutes: Schema.Int.check(Schema.isBetween({ minimum: -840, maximum: 840 })),
    }),
  ).annotate({
    description:
      "Also send the company's dashboard, with days starting at midnight in the viewer's UTC offset.",
  }),
});
export type BoardSubscribeInput = typeof BoardSubscribeInput.Type;

export const BoardTaskDetailInput = Schema.Struct({ taskId: BoardTaskId });
export type BoardTaskDetailInput = typeof BoardTaskDetailInput.Type;

export const BoardCompanyWorkspace = Schema.Union([
  Schema.Struct({ type: Schema.Literal("existing"), projectId: ProjectId }),
  Schema.Struct({ type: Schema.Literal("new"), folderName: TrimmedNonEmptyString }),
]).annotate({
  description:
    "The company's home project, where its agents work: an existing project, or a new project folder.",
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
  workspace: Schema.optional(BoardCompanyWorkspace).annotate({
    description:
      "Moves the company to another project. Tasks that already started stay where they are.",
  }),
});
export type BoardCompanyUpdateInput = typeof BoardCompanyUpdateInput.Type;

/**
 * A new company with the same team: departments, skills, employees, who reports to whom, and
 * board settings. Tasks, routines, hire requests, and run history stay with the original.
 */
export const BoardCompanyCloneInput = Schema.Struct({
  sourceCompanyId: BoardCompanyId,
  name: TrimmedNonEmptyString,
  mission: Schema.optional(Schema.String).annotate({
    description: "Defaults to the original company's mission.",
  }),
  workspace: BoardCompanyWorkspace,
  includeMemory: Schema.optional(Schema.Boolean).annotate({
    description:
      "Also copy what the company and each employee remember. Off by default, since lessons usually belong to the original business.",
  }),
});
export type BoardCompanyCloneInput = typeof BoardCompanyCloneInput.Type;

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
  monthlyTokenLimit: Schema.optional(BoardMonthlyTokenLimit),
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

export const BoardRoutineUpsertInput = Schema.Struct({
  id: Schema.optional(BoardRoutineId),
  companyId: BoardCompanyId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  assigneeAgentId: Schema.NullOr(BoardAgentId),
  assignedToUser: Schema.optional(Schema.Boolean),
  everyDays: BoardRoutineEveryDays,
  nextRunAt: IsoDateTime.annotate({ description: "When it next creates a task." }),
  enabled: Schema.Boolean,
});
export type BoardRoutineUpsertInput = typeof BoardRoutineUpsertInput.Type;

export const BoardTaskCreateInput = Schema.Struct({
  companyId: BoardCompanyId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  files: Schema.optional(Schema.Array(TrimmedNonEmptyString)).annotate({
    description: "Absolute paths of files on the server's machine the work needs.",
  }),
  status: Schema.optional(BoardTaskStatus),
  assigneeAgentId: Schema.optional(Schema.NullOr(BoardAgentId)),
  assignedToUser: Schema.optional(Schema.Boolean).annotate({
    description: "Give the task to the person instead of an agent; it replaces any agent assignee.",
  }),
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
  assignedToUser: Schema.optional(Schema.Boolean),
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
  monthlyTokenLimit: Schema.optional(BoardMonthlyTokenLimit),
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
  Schema.Struct({ type: Schema.Literal("company.clone"), company: BoardCompanyCloneInput }),
  Schema.Struct({ type: Schema.Literal("skill.upsert"), skill: BoardSkillUpsertInput }),
  Schema.Struct({ type: Schema.Literal("skill.delete"), id: BoardSkillId }),
  Schema.Struct({ type: Schema.Literal("agent.upsert"), agent: BoardAgentUpsertInput }),
  Schema.Struct({ type: Schema.Literal("agent.delete"), id: BoardAgentId }),
  Schema.Struct({ type: Schema.Literal("hire.decide"), hire: BoardHireDecisionInput }),
  Schema.Struct({ type: Schema.Literal("task.create"), task: BoardTaskCreateInput }),
  Schema.Struct({ type: Schema.Literal("task.update"), task: BoardTaskUpdateInput }),
  Schema.Struct({ type: Schema.Literal("task.delete"), id: BoardTaskId }),
  Schema.Struct({ type: Schema.Literal("task.start"), id: BoardTaskId }),
  Schema.Struct({
    type: Schema.Literal("task.archive"),
    id: BoardTaskId,
    archived: Schema.Boolean.annotate({ description: "False restores an archived task." }),
  }),
  Schema.Struct({ type: Schema.Literal("task.ship"), id: BoardTaskId, method: BoardShipMethod }),
  Schema.Struct({ type: Schema.Literal("comment.add"), comment: BoardCommentAddInput }),
  Schema.Struct({
    type: Schema.Literal("link.add"),
    link: Schema.Struct({
      taskId: BoardTaskId,
      kind: BoardWorkLinkKind,
      title: TrimmedNonEmptyString,
      url: TrimmedNonEmptyString,
    }),
  }),
  Schema.Struct({ type: Schema.Literal("link.delete"), id: BoardWorkLinkId }),
  Schema.Struct({ type: Schema.Literal("settings.update"), settings: BoardSettingsUpdateInput }),
  Schema.Struct({ type: Schema.Literal("routine.upsert"), routine: BoardRoutineUpsertInput }),
  Schema.Struct({ type: Schema.Literal("routine.delete"), id: BoardRoutineId }),
  Schema.Struct({ type: Schema.Literal("routine.run"), id: BoardRoutineId }),
]);
export type BoardCommand = typeof BoardCommand.Type;

export const BoardCommandResult = Schema.Struct({
  company: Schema.optional(BoardCompany),
  skill: Schema.optional(BoardSkill),
  agent: Schema.optional(BoardAgent),
  task: Schema.optional(BoardTask),
  comment: Schema.optional(BoardComment),
  settings: Schema.optional(BoardSettings),
  routine: Schema.optional(BoardRoutine),
  link: Schema.optional(BoardWorkLink),
});
export type BoardCommandResult = typeof BoardCommandResult.Type;

export class BoardError extends Schema.TaggedError<BoardError>()("BoardError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
