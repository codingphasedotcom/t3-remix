import {
  BoardAgent,
  BoardAgentId,
  BoardAgentThread,
  BoardComment,
  BoardCommentId,
  BoardCompany,
  BoardCompanyId,
  BoardCompanySummary,
  BoardDepartment,
  BoardDepartmentId,
  BoardError,
  BoardHire,
  BoardHireId,
  BoardRun,
  BoardRunId,
  BoardSettings,
  BoardSkill,
  BoardSkillId,
  BoardSkillRequest,
  BoardSkillRequestId,
  BoardTask,
  BoardTaskId,
  BoardRoutine,
  BoardRoutineId,
  BoardWorkLink,
  BoardWorkLinkId,
  ChatAttachment,
  ModelSelection,
  ThreadId,
  type BoardCommentAuthorKind,
  type BoardHireStatus,
  type BoardRunKind,
  type BoardRunStatus,
  type BoardTaskStatus,
  type BoardWorkLinkKind,
  type BoardWorkLinkStatus,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { DEFAULT_DEPARTMENT_NAMES } from "./boardOrg.ts";

/** A card plus the fields only the server reads. */
export interface StoredTask {
  readonly task: BoardTask;
  readonly statusChangedAt: string;
  /** The branch checked out in the card's worktree, and the ref it started from. */
  readonly branch: string | null;
  readonly baseRef: string | null;
}

/** Where a card's work landed when its agent started. */
export interface TaskWorkspace {
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly baseRef: string | null;
}

export interface RunningRun {
  readonly run: BoardRun;
  readonly companyId: BoardCompanyId;
}

/** A run with the model its thread used; null when the thread is gone or never recorded one. */
export interface RunFact {
  readonly run: BoardRun;
  readonly modelSelection: ModelSelection | null;
}

/** Tokens one board thread spent on one day. */
export interface ThreadTokenDay {
  readonly threadId: ThreadId;
  readonly day: string | null;
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
}

export interface NewTask {
  readonly companyId: BoardCompanyId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly description: string;
  readonly status: BoardTaskStatus;
  readonly assigneeAgentId: BoardAgentId | null;
  readonly assignedToUser: boolean;
  readonly reviewerAgentId: BoardAgentId | null;
  readonly parentTaskId: BoardTaskId | null;
  readonly createdByAgentId: BoardAgentId | null;
}

export interface TaskChanges {
  readonly title?: string;
  readonly description?: string;
  readonly status?: BoardTaskStatus;
  readonly position?: number;
  readonly assigneeAgentId?: BoardAgentId | null;
  readonly assignedToUser?: boolean;
  readonly reviewerAgentId?: BoardAgentId | null;
}

export interface WorkLinkInput {
  readonly taskId: BoardTaskId;
  readonly kind: BoardWorkLinkKind;
  readonly title: string;
  readonly url: string;
  readonly status: BoardWorkLinkStatus | null;
  readonly agentId: BoardAgentId | null;
}

export interface NewHire {
  readonly companyId: BoardCompanyId;
  readonly requestedByAgentId: BoardAgentId | null;
  readonly name: string;
  readonly title: string;
  readonly departmentId: BoardDepartmentId | null;
  readonly reportsToAgentId: BoardAgentId | null;
  readonly reportsToHireId: BoardHireId | null;
  readonly skillIds: ReadonlyArray<BoardSkillId>;
  readonly instructions: string;
  readonly reason: string;
}

export interface NewSkillRequest {
  readonly companyId: BoardCompanyId;
  readonly requestedByAgentId: BoardAgentId | null;
  readonly agentId: BoardAgentId;
  readonly skillId: BoardSkillId | null;
  readonly name: string;
  readonly description: string;
  readonly installedPath: string | null;
  readonly reason: string;
}

/** Who a hire request reports to: an agent, or another pending request. */
export interface HireManager {
  readonly agentId: BoardAgentId | null;
  readonly hireId: BoardHireId | null;
}

type StoreEffect<A> = Effect.Effect<A, BoardError>;

/** SQLite persistence for companies, their agents, skills, hires, cards, comments, and runs. */
export class BoardStore extends Context.Service<
  BoardStore,
  {
    readonly newId: (prefix: string) => Effect.Effect<string>;
    readonly now: Effect.Effect<string>;

    readonly listCompanySummaries: () => StoreEffect<ReadonlyArray<BoardCompanySummary>>;
    readonly getCompany: (id: BoardCompanyId) => StoreEffect<BoardCompany | null>;
    readonly insertCompany: (company: BoardCompany) => StoreEffect<void>;
    readonly updateCompany: (company: BoardCompany) => StoreEffect<void>;
    readonly deleteCompany: (id: BoardCompanyId) => StoreEffect<void>;
    readonly listCompanyIds: () => StoreEffect<ReadonlyArray<BoardCompanyId>>;

    readonly listSkills: (companyId: BoardCompanyId) => StoreEffect<ReadonlyArray<BoardSkill>>;
    readonly upsertSkill: (skill: BoardSkill) => StoreEffect<void>;
    readonly getSkill: (id: BoardSkillId) => StoreEffect<BoardSkill | null>;
    readonly deleteSkill: (skill: BoardSkill) => StoreEffect<void>;

    readonly listAgents: (companyId: BoardCompanyId) => StoreEffect<ReadonlyArray<BoardAgent>>;
    readonly getAgent: (id: BoardAgentId) => StoreEffect<BoardAgent | null>;
    readonly upsertAgent: (agent: BoardAgent) => StoreEffect<void>;
    /** Removes the agent; its reports move up to its manager and its cards lose it. */
    readonly deleteAgent: (agent: BoardAgent) => StoreEffect<void>;

    readonly listHires: (companyId: BoardCompanyId) => StoreEffect<ReadonlyArray<BoardHire>>;
    readonly getHire: (id: BoardHireId) => StoreEffect<BoardHire | null>;
    readonly insertHire: (hire: NewHire) => StoreEffect<BoardHire>;
    /** Pending requests that reported to this one move to `reportsTo`. */
    readonly decideHire: (
      id: BoardHireId,
      status: BoardHireStatus,
      reportsTo: HireManager,
    ) => StoreEffect<void>;

    readonly listPendingSkillRequests: (
      companyId: BoardCompanyId,
    ) => StoreEffect<ReadonlyArray<BoardSkillRequest>>;
    readonly getSkillRequest: (id: BoardSkillRequestId) => StoreEffect<BoardSkillRequest | null>;
    readonly insertSkillRequest: (request: NewSkillRequest) => StoreEffect<BoardSkillRequest>;
    readonly decideSkillRequest: (
      id: BoardSkillRequestId,
      status: BoardHireStatus,
    ) => StoreEffect<void>;

    readonly listTasks: (companyId: BoardCompanyId) => StoreEffect<ReadonlyArray<StoredTask>>;
    readonly getTask: (id: BoardTaskId) => StoreEffect<StoredTask | null>;
    readonly insertTask: (task: NewTask) => StoreEffect<BoardTaskId>;
    /** Changing a task's status also restores it if it was archived. */
    readonly updateTask: (id: BoardTaskId, changes: TaskChanges) => StoreEffect<boolean>;
    readonly setTasksArchived: (
      ids: ReadonlyArray<BoardTaskId>,
      archivedAt: string | null,
    ) => StoreEffect<void>;
    /** Every thread a run on these tasks used, including reviewers' threads. */
    readonly listTaskThreadIds: (
      ids: ReadonlyArray<BoardTaskId>,
    ) => StoreEffect<ReadonlyArray<ThreadId>>;
    readonly setTaskThread: (
      id: BoardTaskId,
      threadId: ThreadId,
      workspace: TaskWorkspace,
    ) => StoreEffect<void>;
    readonly deleteTask: (task: BoardTask) => StoreEffect<void>;
    readonly countOpenSubtasks: (parentId: BoardTaskId) => StoreEffect<number>;
    /**
     * Every thread that ran a task in a finished tree: its top-level task is archived, or the
     * whole tree is done. A finished subtask counts only once its top-level task does.
     */
    readonly listFinishedTreeThreadIds: () => StoreEffect<ReadonlySet<ThreadId>>;
    /** Each worktree folder a task's threads recorded, which may no longer be on disk. */
    readonly listTaskWorktrees: (
      companyId: BoardCompanyId,
    ) => StoreEffect<
      ReadonlyArray<{ readonly worktreePath: string; readonly taskId: BoardTaskId }>
    >;
    /** Cards whose title, description, or comments mention `query`, newest first. */
    readonly searchTasks: (
      companyId: BoardCompanyId,
      query: string,
      limit: number,
    ) => StoreEffect<ReadonlyArray<StoredTask>>;

    readonly listComments: (taskId: BoardTaskId) => StoreEffect<ReadonlyArray<BoardComment>>;
    readonly listRoutines: (companyId: BoardCompanyId) => StoreEffect<ReadonlyArray<BoardRoutine>>;
    readonly getRoutine: (id: BoardRoutineId) => StoreEffect<BoardRoutine | null>;
    readonly upsertRoutine: (routine: BoardRoutine) => StoreEffect<void>;
    readonly deleteRoutine: (id: BoardRoutineId) => StoreEffect<void>;
    /** Enabled routines, in every company, whose next run is at or before `at`. */
    readonly listDueRoutines: (at: string) => StoreEffect<ReadonlyArray<BoardRoutine>>;
    readonly listWorkLinks: (taskId: BoardTaskId) => StoreEffect<ReadonlyArray<BoardWorkLink>>;
    /** Every link on the company's tasks, oldest first. */
    readonly listCompanyWorkLinks: (
      companyId: BoardCompanyId,
    ) => StoreEffect<ReadonlyArray<BoardWorkLink>>;
    /** The board's own updates on the company's tasks since `since`, oldest first. */
    readonly listCompanyUpdates: (
      companyId: BoardCompanyId,
      since: string,
    ) => StoreEffect<ReadonlyArray<BoardComment>>;
    /** Adds the link, or updates the one the task already has for the same URL. */
    readonly upsertWorkLink: (link: WorkLinkInput) => StoreEffect<BoardWorkLink>;
    readonly getWorkLink: (id: BoardWorkLinkId) => StoreEffect<BoardWorkLink | null>;
    readonly deleteWorkLink: (id: BoardWorkLinkId) => StoreEffect<void>;
    readonly insertComment: (input: {
      readonly taskId: BoardTaskId;
      readonly authorKind: BoardCommentAuthorKind;
      readonly authorAgentId: BoardAgentId | null;
      readonly body: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
    }) => StoreEffect<BoardComment>;
    /** Replaces the tasks `taskId` waits on. */
    readonly setTaskDependencies: (
      taskId: BoardTaskId,
      waitsOn: ReadonlyArray<BoardTaskId>,
    ) => StoreEffect<void>;
    /** Comments whose files this thread has already been sent. */
    readonly listDeliveredComments: (threadId: ThreadId) => StoreEffect<ReadonlySet<string>>;
    readonly recordDeliveries: (
      threadId: ThreadId,
      commentIds: ReadonlyArray<BoardCommentId>,
    ) => StoreEffect<void>;

    readonly listRuns: (taskId: BoardTaskId) => StoreEffect<ReadonlyArray<BoardRun>>;
    readonly insertRun: (input: {
      readonly taskId: BoardTaskId;
      readonly agentId: BoardAgentId;
      readonly threadId: ThreadId;
      readonly kind: BoardRunKind;
    }) => StoreEffect<BoardRunId>;
    readonly endRun: (
      id: BoardRunId,
      status: Exclude<BoardRunStatus, "running">,
    ) => StoreEffect<void>;
    readonly runForThread: (threadId: ThreadId) => StoreEffect<RunningRun | null>;
    /** Each employee's board threads, newest first, with the latest run in each. */
    readonly listAgentThreads: (
      companyId: BoardCompanyId,
    ) => StoreEffect<ReadonlyArray<BoardAgentThread>>;
    readonly listRunningRuns: () => StoreEffect<ReadonlyArray<RunningRun>>;
    readonly listRunFacts: (companyId: BoardCompanyId) => StoreEffect<ReadonlyArray<RunFact>>;
    /** Tokens per board thread and day, where days start at the viewer's midnight. */
    readonly listThreadTokenDays: (
      companyId: BoardCompanyId,
      utcOffsetMinutes: number,
    ) => StoreEffect<ReadonlyArray<ThreadTokenDay>>;
    readonly countRunningRuns: (companyId: BoardCompanyId) => StoreEffect<number>;
    /** Input plus output tokens since `since`, per agent; a thread counts for its latest agent. */
    readonly tokenUsageSince: (
      companyId: BoardCompanyId,
      since: string,
    ) => StoreEffect<ReadonlyArray<{ readonly agentId: BoardAgentId; readonly tokens: number }>>;
    readonly countRuns: (taskId: BoardTaskId) => StoreEffect<number>;
    /** When the latest run of `kind` (any kind when omitted) ended; null while it runs. */
    readonly lastRunEndedAt: (
      taskId: BoardTaskId,
      kind?: BoardRunKind,
    ) => StoreEffect<string | null>;
    /** The thread of `agentId`'s latest run on the task (of `kind`, when given). */
    readonly latestAgentThread: (
      taskId: BoardTaskId,
      agentId: BoardAgentId,
      kind?: BoardRunKind,
    ) => StoreEffect<ThreadId | null>;
    /**
     * Subtasks that became blocked after every run on their parent had ended, leaving out
     * subtasks that only wait on subtasks of their own.
     */
    readonly listNewlyBlockedSubtasks: (
      companyId: BoardCompanyId,
    ) => StoreEffect<
      ReadonlyArray<{ readonly parentId: BoardTaskId; readonly taskId: BoardTaskId }>
    >;
    /** Tasks with a person's comment posted after every run on the task had ended. */
    readonly listTasksAwaitingReply: (
      companyId: BoardCompanyId,
    ) => StoreEffect<ReadonlySet<BoardTaskId>>;
    readonly lastRunStartedAt: (
      taskId: BoardTaskId,
      kind: BoardRunKind,
    ) => StoreEffect<string | null>;

    readonly getSettings: (companyId: BoardCompanyId) => StoreEffect<BoardSettings>;
    readonly upsertSettings: (settings: BoardSettings) => StoreEffect<void>;
  }
>()("t3/board/BoardStore") {}

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_BASE_REF = "HEAD";
const MAX_COMMENT_CHARS = 8_000;
const MAX_AGENT_THREADS = 300;

interface CompanyRow {
  readonly company_id: string;
  readonly name: string;
  readonly mission: string;
  readonly memory: string;
  readonly departments_json: string;
  readonly project_id: string;
  readonly ceo_agent_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SkillRow {
  readonly skill_id: string;
  readonly company_id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly installed_path: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AgentRow {
  readonly agent_id: string;
  readonly company_id: string;
  readonly name: string;
  readonly title: string;
  readonly avatar: string;
  readonly department_id: string;
  readonly reports_to_agent_id: string | null;
  readonly skill_ids_json: string;
  readonly instructions: string;
  readonly memory: string;
  readonly model_selection_json: string;
  readonly runtime_mode: string;
  readonly paused: number;
  readonly monthly_token_limit: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface HireRow {
  readonly hire_id: string;
  readonly company_id: string;
  readonly requested_by_agent_id: string | null;
  readonly name: string;
  readonly title: string;
  readonly department_id: string | null;
  readonly reports_to_agent_id: string | null;
  readonly reports_to_hire_id: string | null;
  readonly skill_ids_json: string;
  readonly instructions: string;
  readonly reason: string;
  readonly status: string;
  readonly created_at: string;
}

interface SkillRequestRow {
  readonly request_id: string;
  readonly company_id: string;
  readonly requested_by_agent_id: string | null;
  readonly agent_id: string;
  readonly skill_id: string | null;
  readonly name: string;
  readonly description: string;
  readonly installed_path: string | null;
  readonly reason: string;
  readonly status: string;
  readonly created_at: string;
}

interface TaskRow {
  readonly task_id: string;
  readonly company_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly position: number;
  readonly assignee_agent_id: string | null;
  readonly assigned_to_user: number;
  readonly reviewer_agent_id: string | null;
  readonly parent_task_id: string | null;
  readonly thread_id: string | null;
  readonly worktree_path: string | null;
  readonly branch: string | null;
  readonly base_ref: string | null;
  readonly created_by_agent_id: string | null;
  readonly status_changed_at: string;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly comment_count: number;
  readonly active_run_kind: string | null;
  readonly waits_on_json: string;
}

interface CommentRow {
  readonly comment_id: string;
  readonly task_id: string;
  readonly author_kind: string;
  readonly author_agent_id: string | null;
  readonly body: string;
  readonly attachments_json: string;
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
  readonly company_id: string;
}

interface SettingsRow {
  readonly auto_dispatch: number;
  readonly max_concurrent_runs: number;
  readonly use_worktrees: number;
  readonly base_ref: string;
  readonly monthly_token_limit: number | null;
}

const SkillIdsJson = Schema.fromJsonString(Schema.Array(BoardSkillId));
const DepartmentsJson = Schema.fromJsonString(Schema.Array(BoardDepartment));
const decodeDepartments = Schema.decodeUnknownEffect(DepartmentsJson);
const encodeDepartments = Schema.encodeEffect(DepartmentsJson);
const ModelSelectionJson = Schema.fromJsonString(ModelSelection);
const decodeSkillIds = Schema.decodeUnknownEffect(SkillIdsJson);
const decodeTaskIds = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(BoardTaskId)));
const AttachmentsJson = Schema.fromJsonString(Schema.Array(ChatAttachment));
const decodeAttachments = Schema.decodeUnknownEffect(AttachmentsJson);
const encodeAttachments = Schema.encodeEffect(AttachmentsJson);
const encodeSkillIds = Schema.encodeEffect(SkillIdsJson);
const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelectionJson);
const encodeModelSelection = Schema.encodeEffect(ModelSelectionJson);
const decodeCompany = Schema.decodeUnknownEffect(BoardCompany);
const decodeCompanySummary = Schema.decodeUnknownEffect(BoardCompanySummary);
const decodeSkill = Schema.decodeUnknownEffect(BoardSkill);
const decodeAgent = Schema.decodeUnknownEffect(BoardAgent);
const decodeHire = Schema.decodeUnknownEffect(BoardHire);
const decodeSkillRequest = Schema.decodeUnknownEffect(BoardSkillRequest);
const decodeTask = Schema.decodeUnknownEffect(BoardTask);
const decodeComment = Schema.decodeUnknownEffect(BoardComment);
const decodeWorkLink = Schema.decodeUnknownEffect(BoardWorkLink);
const decodeRoutine = Schema.decodeUnknownEffect(BoardRoutine);

interface RoutineRow {
  readonly routine_id: string;
  readonly company_id: string;
  readonly title: string;
  readonly description: string;
  readonly assignee_agent_id: string | null;
  readonly assigned_to_user: number;
  readonly every_days: number;
  readonly next_run_at: string;
  readonly enabled: number;
  readonly last_task_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const toRoutine = (row: RoutineRow) =>
  decodeRoutine({
    id: row.routine_id,
    companyId: row.company_id,
    title: row.title,
    description: row.description,
    assigneeAgentId: row.assignee_agent_id,
    assignedToUser: row.assigned_to_user === 1,
    everyDays: row.every_days,
    nextRunAt: row.next_run_at,
    enabled: row.enabled === 1,
    lastTaskId: row.last_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

interface WorkLinkRow {
  readonly link_id: string;
  readonly task_id: string;
  readonly kind: string;
  readonly title: string;
  readonly url: string;
  readonly status: string | null;
  readonly agent_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const toWorkLink = (row: WorkLinkRow) =>
  decodeWorkLink({
    id: row.link_id,
    taskId: row.task_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    status: row.status,
    agentId: row.agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
const decodeRun = Schema.decodeUnknownEffect(BoardRun);
const decodeSettings = Schema.decodeUnknownEffect(BoardSettings);
const decodeAgentThread = Schema.decodeUnknownEffect(BoardAgentThread);

const TASK_COLUMNS = `
  t.task_id,
  t.company_id,
  t.project_id,
  t.title,
  t.description,
  t.status,
  t.position,
  t.assignee_agent_id,
  t.assigned_to_user,
  t.reviewer_agent_id,
  t.parent_task_id,
  t.thread_id,
  t.worktree_path,
  t.branch,
  t.base_ref,
  t.created_by_agent_id,
  t.status_changed_at,
  t.archived_at,
  t.created_at,
  t.updated_at,
  (SELECT COUNT(*) FROM board_comments c
    WHERE c.task_id = t.task_id AND c.author_kind != 'system') AS comment_count,
  (SELECT r.kind FROM board_runs r
    WHERE r.task_id = t.task_id AND r.status = 'running'
    ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1) AS active_run_kind,
  (SELECT json_group_array(d.waits_on_task_id) FROM (
    SELECT waits_on_task_id FROM board_task_dependencies
    WHERE task_id = t.task_id ORDER BY rowid
  ) d) AS waits_on_json
`;

/** Wraps a store failure so callers see one error type with a readable message. */
const failWith =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, BoardError, R> =>
    effect.pipe(Effect.mapError((cause) => new BoardError({ message, cause })));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;

  // The board owns its tables instead of taking an id in the shared migration sequence. The
  // migrator skips every id below the highest one recorded, so a fork-owned id would either
  // collide with or silently hide a later upstream migration.
  const columns = (table: string) =>
    sql<{ readonly name: string }>`SELECT name FROM pragma_table_info(${table})`.pipe(
      Effect.map((rows) => new Set(rows.map((row) => row.name))),
    );
  // The first board prototype kept agents and cards outside any company. Keep those rows, under
  // a legacy name, rather than mixing them into company boards.
  const agentColumns = yield* columns("board_agents");
  if (agentColumns.size > 0 && !agentColumns.has("company_id")) {
    yield* sql`ALTER TABLE board_agents RENAME TO board_legacy_agents`;
  }
  const taskColumns = yield* columns("board_tasks");
  if (taskColumns.size > 0 && !taskColumns.has("company_id")) {
    yield* sql`ALTER TABLE board_tasks RENAME TO board_legacy_tasks`;
    yield* sql`DROP INDEX IF EXISTS idx_board_tasks_project`;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS board_companies (
      company_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mission TEXT NOT NULL,
      memory TEXT NOT NULL DEFAULT '',
      departments_json TEXT NOT NULL DEFAULT '[]',
      project_id TEXT NOT NULL,
      ceo_agent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_skills (
      skill_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_skills_company ON board_skills(company_id)`;
  if (!(yield* columns("board_skills")).has("installed_path")) {
    yield* sql`ALTER TABLE board_skills ADD COLUMN installed_path TEXT`;
  }
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_agents (
      agent_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      department_id TEXT NOT NULL DEFAULT '',
      reports_to_agent_id TEXT,
      skill_ids_json TEXT NOT NULL,
      instructions TEXT NOT NULL,
      memory TEXT NOT NULL DEFAULT '',
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      paused INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_agents_company ON board_agents(company_id)`;
  // Memory arrived after companies; tables created before it gain the column empty.
  if (!(yield* columns("board_companies")).has("memory")) {
    yield* sql`ALTER TABLE board_companies ADD COLUMN memory TEXT NOT NULL DEFAULT ''`;
  }
  if (!(yield* columns("board_agents")).has("memory")) {
    yield* sql`ALTER TABLE board_agents ADD COLUMN memory TEXT NOT NULL DEFAULT ''`;
  }
  if (!(yield* columns("board_agents")).has("avatar")) {
    yield* sql`ALTER TABLE board_agents ADD COLUMN avatar TEXT NOT NULL DEFAULT ''`;
  }
  if (!(yield* columns("board_companies")).has("departments_json")) {
    yield* sql`ALTER TABLE board_companies ADD COLUMN departments_json TEXT NOT NULL DEFAULT '[]'`;
  }
  if (!(yield* columns("board_agents")).has("department_id")) {
    yield* sql`ALTER TABLE board_agents ADD COLUMN department_id TEXT NOT NULL DEFAULT ''`;
  }
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_hires (
      hire_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      requested_by_agent_id TEXT,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      department_id TEXT,
      reports_to_agent_id TEXT,
      reports_to_hire_id TEXT,
      skill_ids_json TEXT NOT NULL,
      instructions TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_hires_company ON board_hires(company_id, status)`;
  const hireColumns = yield* columns("board_hires");
  if (!hireColumns.has("department_id")) {
    yield* sql`ALTER TABLE board_hires ADD COLUMN department_id TEXT`;
  }
  if (!hireColumns.has("reports_to_hire_id")) {
    yield* sql`ALTER TABLE board_hires ADD COLUMN reports_to_hire_id TEXT`;
  }
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_skill_requests (
      request_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      requested_by_agent_id TEXT,
      agent_id TEXT NOT NULL,
      skill_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      installed_path TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_skill_requests_company
    ON board_skill_requests(company_id, status)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_tasks (
      task_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      position REAL NOT NULL,
      assignee_agent_id TEXT,
      assigned_to_user INTEGER NOT NULL DEFAULT 0,
      reviewer_agent_id TEXT,
      parent_task_id TEXT,
      thread_id TEXT,
      worktree_path TEXT,
      branch TEXT,
      base_ref TEXT,
      created_by_agent_id TEXT,
      status_changed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_tasks_company ON board_tasks(company_id, position)`;
  // Cards record their branch and base since workspaces were described in prompts.
  const cardColumns = yield* columns("board_tasks");
  if (!cardColumns.has("branch")) {
    yield* sql`ALTER TABLE board_tasks ADD COLUMN branch TEXT`;
  }
  if (!cardColumns.has("base_ref")) {
    yield* sql`ALTER TABLE board_tasks ADD COLUMN base_ref TEXT`;
  }
  if (!cardColumns.has("assigned_to_user")) {
    yield* sql`ALTER TABLE board_tasks ADD COLUMN assigned_to_user INTEGER NOT NULL DEFAULT 0`;
  }
  if (!cardColumns.has("archived_at")) {
    yield* sql`ALTER TABLE board_tasks ADD COLUMN archived_at TEXT`;
  }
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
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_comments_task ON board_comments(task_id, created_at)`;
  if (!(yield* columns("board_comments")).has("attachments_json")) {
    yield* sql`ALTER TABLE board_comments ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'`;
  }
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_task_dependencies (
      task_id TEXT NOT NULL,
      waits_on_task_id TEXT NOT NULL,
      PRIMARY KEY (task_id, waits_on_task_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_board_task_dependencies_waits_on
    ON board_task_dependencies(waits_on_task_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_attachment_deliveries (
      thread_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, comment_id)
    )
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
    CREATE TABLE IF NOT EXISTS board_work_links (
      link_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT,
      agent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_board_work_links_task_url ON board_work_links(task_id, url)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_routines (
      routine_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assignee_agent_id TEXT,
      assigned_to_user INTEGER NOT NULL DEFAULT 0,
      every_days INTEGER NOT NULL,
      next_run_at TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      last_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_routines_due ON board_routines(enabled, next_run_at)`;
  if (!(yield* columns("board_routines")).has("assigned_to_user")) {
    yield* sql`ALTER TABLE board_routines ADD COLUMN assigned_to_user INTEGER NOT NULL DEFAULT 0`;
  }
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_company_settings (
      company_id TEXT PRIMARY KEY,
      auto_dispatch INTEGER NOT NULL,
      max_concurrent_runs INTEGER NOT NULL,
      use_worktrees INTEGER NOT NULL,
      base_ref TEXT NOT NULL,
      monthly_token_limit INTEGER,
      updated_at TEXT NOT NULL
    )
  `;
  // Monthly limits arrived after settings and agents; existing rows have none.
  if (!(yield* columns("board_company_settings")).has("monthly_token_limit")) {
    yield* sql`ALTER TABLE board_company_settings ADD COLUMN monthly_token_limit INTEGER`;
  }
  if (!(yield* columns("board_agents")).has("monthly_token_limit")) {
    yield* sql`ALTER TABLE board_agents ADD COLUMN monthly_token_limit INTEGER`;
  }

  const newId: BoardStore["Service"]["newId"] = (prefix) =>
    random.uuidV4().pipe(Effect.map((uuid) => `${prefix}:${uuid}`));
  const now = DateTime.now.pipe(Effect.map((value) => DateTime.formatIso(value)));

  // Companies made before departments get the default set, with the CEO in Executive and
  // everyone else in Engineering until someone moves them.
  const undivided = yield* sql<{
    readonly company_id: string;
    readonly ceo_agent_id: string | null;
  }>`SELECT company_id, ceo_agent_id FROM board_companies WHERE departments_json = '[]'`;
  for (const row of undivided) {
    const departments = yield* Effect.forEach(DEFAULT_DEPARTMENT_NAMES, (name) =>
      newId("board-department").pipe(
        Effect.map((id) => ({ id: BoardDepartmentId.make(id), name })),
      ),
    );
    const executive = departments[0]?.id ?? null;
    const engineering = departments.find((department) => department.name === "Engineering")?.id;
    const departmentsJson = yield* encodeDepartments(departments);
    yield* sql.withTransaction(
      Effect.all([
        sql`UPDATE board_companies SET departments_json = ${departmentsJson}
          WHERE company_id = ${row.company_id}`,
        sql`UPDATE board_agents
          SET department_id = CASE WHEN agent_id = ${row.ceo_agent_id} THEN ${executive}
            ELSE ${engineering ?? executive} END
          WHERE company_id = ${row.company_id} AND department_id = ''`,
      ]),
    );
  }

  // Row decoders run once per row inside reads that already own a span.
  const toCompany = Effect.fnUntraced(function* (row: CompanyRow) {
    return yield* decodeCompany({
      id: row.company_id,
      name: row.name,
      mission: row.mission,
      departments: yield* decodeDepartments(row.departments_json),
      memory: row.memory,
      projectId: row.project_id,
      ceoAgentId: row.ceo_agent_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  const toSkill = (row: SkillRow) =>
    decodeSkill({
      id: row.skill_id,
      companyId: row.company_id,
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      installedPath: row.installed_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });

  const toAgent = Effect.fnUntraced(function* (row: AgentRow) {
    return yield* decodeAgent({
      id: row.agent_id,
      companyId: row.company_id,
      name: row.name,
      title: row.title,
      avatar: row.avatar,
      departmentId: row.department_id,
      reportsToAgentId: row.reports_to_agent_id,
      skillIds: yield* decodeSkillIds(row.skill_ids_json),
      instructions: row.instructions,
      memory: row.memory,
      modelSelection: yield* decodeModelSelection(row.model_selection_json),
      runtimeMode: row.runtime_mode,
      paused: row.paused === 1,
      monthlyTokenLimit: row.monthly_token_limit,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  const toHire = Effect.fnUntraced(function* (row: HireRow) {
    return yield* decodeHire({
      id: row.hire_id,
      companyId: row.company_id,
      requestedByAgentId: row.requested_by_agent_id,
      name: row.name,
      title: row.title,
      departmentId: row.department_id,
      reportsToAgentId: row.reports_to_agent_id,
      reportsToHireId: row.reports_to_hire_id,
      skillIds: yield* decodeSkillIds(row.skill_ids_json),
      instructions: row.instructions,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
    });
  });

  const toSkillRequest = (row: SkillRequestRow) =>
    decodeSkillRequest({
      id: row.request_id,
      companyId: row.company_id,
      requestedByAgentId: row.requested_by_agent_id,
      agentId: row.agent_id,
      skillId: row.skill_id,
      name: row.name,
      description: row.description,
      installedPath: row.installed_path,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
    });

  const toStoredTask = Effect.fnUntraced(function* (row: TaskRow) {
    const task = yield* decodeTask({
      id: row.task_id,
      companyId: row.company_id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      position: row.position,
      assigneeAgentId: row.assignee_agent_id,
      assignedToUser: row.assigned_to_user === 1,
      reviewerAgentId: row.reviewer_agent_id,
      parentTaskId: row.parent_task_id,
      waitsOnTaskIds: yield* decodeTaskIds(row.waits_on_json),
      threadId: row.thread_id,
      worktreePath: row.worktree_path,
      activeRunKind: row.active_run_kind,
      createdByAgentId: row.created_by_agent_id,
      commentCount: row.comment_count,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return {
      task,
      statusChangedAt: row.status_changed_at,
      branch: row.branch,
      baseRef: row.base_ref,
    } satisfies StoredTask;
  });

  const toComment = Effect.fnUntraced(function* (row: CommentRow) {
    return yield* decodeComment({
      id: row.comment_id,
      taskId: row.task_id,
      authorKind: row.author_kind,
      authorAgentId: row.author_agent_id,
      body: row.body,
      attachments: yield* decodeAttachments(row.attachments_json),
      createdAt: row.created_at,
    });
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

  const toRunningRun = Effect.fnUntraced(function* (row: RunningRunRow) {
    return {
      run: yield* toRun(row),
      companyId: BoardCompanyId.make(row.company_id),
    } satisfies RunningRun;
  });

  const listCompanySummaries: BoardStore["Service"]["listCompanySummaries"] = Effect.fn(
    "BoardStore.listCompanySummaries",
  )(function* () {
    const rows = yield* sql<{
      readonly company_id: string;
      readonly name: string;
      readonly project_id: string;
      readonly agent_count: number;
      readonly open_task_count: number;
      readonly pending_hire_count: number;
    }>`
        SELECT
          c.company_id,
          c.name,
          c.project_id,
          (SELECT COUNT(*) FROM board_agents a WHERE a.company_id = c.company_id) AS agent_count,
          (SELECT COUNT(*) FROM board_tasks t
            WHERE t.company_id = c.company_id AND t.status != 'done') AS open_task_count,
          (SELECT COUNT(*) FROM board_hires h
            WHERE h.company_id = c.company_id AND h.status = 'pending') AS pending_hire_count
        FROM board_companies c
        ORDER BY c.created_at, c.company_id
      `;
    const members = yield* sql<{
      readonly agent_id: string;
      readonly company_id: string;
      readonly name: string;
      readonly title: string;
      readonly avatar: string;
    }>`
        SELECT agent_id, company_id, name, title, avatar FROM board_agents
        ORDER BY created_at, rowid
      `;
    return yield* Effect.forEach(rows, (row) =>
      decodeCompanySummary({
        id: row.company_id,
        name: row.name,
        projectId: row.project_id,
        members: members
          .filter((member) => member.company_id === row.company_id)
          .map((member) => ({
            id: member.agent_id,
            name: member.name,
            title: member.title,
            avatar: member.avatar,
          })),
        agentCount: row.agent_count,
        openTaskCount: row.open_task_count,
        pendingHireCount: row.pending_hire_count,
      }),
    );
  }, failWith("Could not list companies."));

  const getCompany: BoardStore["Service"]["getCompany"] = Effect.fn("BoardStore.getCompany")(
    function* (id) {
      const rows = yield* sql<CompanyRow>`SELECT * FROM board_companies WHERE company_id = ${id}`;
      const row = rows[0];
      return row === undefined ? null : yield* toCompany(row);
    },
    failWith("Could not read the company."),
  );

  const writeCompany = Effect.fnUntraced(function* (company: BoardCompany) {
    const departments = yield* encodeDepartments(company.departments);
    yield* sql`
      INSERT INTO board_companies (
        company_id, name, mission, memory, departments_json, project_id, ceo_agent_id,
        created_at, updated_at
      )
      VALUES (
        ${company.id}, ${company.name}, ${company.mission}, ${company.memory}, ${departments},
        ${company.projectId}, ${company.ceoAgentId}, ${company.createdAt}, ${company.updatedAt}
      )
      ON CONFLICT (company_id) DO UPDATE SET
        name = excluded.name,
        mission = excluded.mission,
        memory = excluded.memory,
        departments_json = excluded.departments_json,
        project_id = excluded.project_id,
        ceo_agent_id = excluded.ceo_agent_id,
        updated_at = excluded.updated_at
    `;
  });

  const insertCompany: BoardStore["Service"]["insertCompany"] = (company) =>
    writeCompany(company).pipe(Effect.asVoid, failWith("Could not save the company."));

  const updateCompany: BoardStore["Service"]["updateCompany"] = (company) =>
    writeCompany(company).pipe(Effect.asVoid, failWith("Could not save the company."));

  const deleteCompany: BoardStore["Service"]["deleteCompany"] = (id) =>
    sql
      .withTransaction(
        Effect.all(
          [
            sql`DELETE FROM board_attachment_deliveries WHERE comment_id IN
              (SELECT comment_id FROM board_comments WHERE task_id IN
                (SELECT task_id FROM board_tasks WHERE company_id = ${id}))`,
            sql`DELETE FROM board_comments WHERE task_id IN
              (SELECT task_id FROM board_tasks WHERE company_id = ${id})`,
            sql`DELETE FROM board_task_dependencies WHERE task_id IN
              (SELECT task_id FROM board_tasks WHERE company_id = ${id})`,
            sql`DELETE FROM board_runs WHERE task_id IN
              (SELECT task_id FROM board_tasks WHERE company_id = ${id})`,
            sql`DELETE FROM board_work_links WHERE task_id IN
              (SELECT task_id FROM board_tasks WHERE company_id = ${id})`,
            sql`DELETE FROM board_tasks WHERE company_id = ${id}`,
            sql`DELETE FROM board_hires WHERE company_id = ${id}`,
            sql`DELETE FROM board_skill_requests WHERE company_id = ${id}`,
            sql`DELETE FROM board_routines WHERE company_id = ${id}`,
            sql`DELETE FROM board_agents WHERE company_id = ${id}`,
            sql`DELETE FROM board_skills WHERE company_id = ${id}`,
            sql`DELETE FROM board_company_settings WHERE company_id = ${id}`,
            sql`DELETE FROM board_companies WHERE company_id = ${id}`,
          ],
          { discard: true },
        ),
      )
      .pipe(failWith("Could not delete the company."));

  const listCompanyIds: BoardStore["Service"]["listCompanyIds"] = () =>
    sql<{ readonly company_id: string }>`SELECT company_id FROM board_companies`.pipe(
      Effect.map((rows) => rows.map((row) => BoardCompanyId.make(row.company_id))),
      failWith("Could not list companies."),
    );

  const listSkills: BoardStore["Service"]["listSkills"] = Effect.fn("BoardStore.listSkills")(
    function* (companyId) {
      const rows = yield* sql<SkillRow>`
        SELECT * FROM board_skills WHERE company_id = ${companyId} ORDER BY name, skill_id
      `;
      return yield* Effect.forEach(rows, toSkill);
    },
    failWith("Could not list skills."),
  );

  const getSkill: BoardStore["Service"]["getSkill"] = Effect.fn("BoardStore.getSkill")(function* (
    id,
  ) {
    const rows = yield* sql<SkillRow>`SELECT * FROM board_skills WHERE skill_id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : yield* toSkill(row);
  }, failWith("Could not read the skill."));

  const upsertSkill: BoardStore["Service"]["upsertSkill"] = (skill) =>
    sql`
      INSERT INTO board_skills (
        skill_id, company_id, name, description, instructions, installed_path, created_at,
        updated_at
      )
      VALUES (
        ${skill.id}, ${skill.companyId}, ${skill.name}, ${skill.description},
        ${skill.instructions}, ${skill.installedPath}, ${skill.createdAt}, ${skill.updatedAt}
      )
      ON CONFLICT (skill_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        instructions = excluded.instructions,
        installed_path = excluded.installed_path,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid, failWith("Could not save the skill."));

  const listAgents: BoardStore["Service"]["listAgents"] = Effect.fn("BoardStore.listAgents")(
    function* (companyId) {
      const rows = yield* sql<AgentRow>`
        SELECT * FROM board_agents WHERE company_id = ${companyId} ORDER BY created_at, rowid
      `;
      return yield* Effect.forEach(rows, toAgent);
    },
    failWith("Could not list agents."),
  );

  const getAgent: BoardStore["Service"]["getAgent"] = Effect.fn("BoardStore.getAgent")(function* (
    id,
  ) {
    const rows = yield* sql<AgentRow>`SELECT * FROM board_agents WHERE agent_id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : yield* toAgent(row);
  }, failWith("Could not read the agent."));

  const upsertAgent: BoardStore["Service"]["upsertAgent"] = Effect.fn("BoardStore.upsertAgent")(
    function* (agent) {
      const skillIds = yield* encodeSkillIds(agent.skillIds);
      const modelSelection = yield* encodeModelSelection(agent.modelSelection);
      yield* sql`
        INSERT INTO board_agents (
          agent_id, company_id, name, title, avatar, department_id, reports_to_agent_id,
          skill_ids_json, instructions, memory, model_selection_json, runtime_mode, paused,
          monthly_token_limit, created_at, updated_at
        )
        VALUES (
          ${agent.id}, ${agent.companyId}, ${agent.name}, ${agent.title}, ${agent.avatar},
          ${agent.departmentId}, ${agent.reportsToAgentId}, ${skillIds}, ${agent.instructions},
          ${agent.memory},
          ${modelSelection}, ${agent.runtimeMode}, ${agent.paused ? 1 : 0},
          ${agent.monthlyTokenLimit}, ${agent.createdAt}, ${agent.updatedAt}
        )
        ON CONFLICT (agent_id) DO UPDATE SET
          name = excluded.name,
          title = excluded.title,
          avatar = excluded.avatar,
          department_id = excluded.department_id,
          reports_to_agent_id = excluded.reports_to_agent_id,
          skill_ids_json = excluded.skill_ids_json,
          instructions = excluded.instructions,
          memory = excluded.memory,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          paused = excluded.paused,
          monthly_token_limit = excluded.monthly_token_limit,
          updated_at = excluded.updated_at
      `;
    },
    failWith("Could not save the agent."),
  );

  const deleteSkill: BoardStore["Service"]["deleteSkill"] = Effect.fn("BoardStore.deleteSkill")(
    function* (skill) {
      const agents = yield* listAgents(skill.companyId);
      const at = yield* now;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const agent of agents) {
            if (!agent.skillIds.includes(skill.id)) continue;
            yield* upsertAgent({
              ...agent,
              skillIds: agent.skillIds.filter((id) => id !== skill.id),
              updatedAt: at,
            });
          }
          yield* sql`DELETE FROM board_skills WHERE skill_id = ${skill.id}`;
        }),
      );
    },
    failWith("Could not delete the skill."),
  );

  const deleteAgent: BoardStore["Service"]["deleteAgent"] = (agent) =>
    sql
      .withTransaction(
        Effect.all(
          [
            sql`UPDATE board_agents SET reports_to_agent_id = ${agent.reportsToAgentId}
              WHERE reports_to_agent_id = ${agent.id}`,
            sql`UPDATE board_tasks SET assignee_agent_id = NULL
              WHERE assignee_agent_id = ${agent.id}`,
            sql`UPDATE board_tasks SET reviewer_agent_id = NULL
              WHERE reviewer_agent_id = ${agent.id}`,
            sql`UPDATE board_routines SET assignee_agent_id = NULL
              WHERE assignee_agent_id = ${agent.id}`,
            sql`UPDATE board_companies SET ceo_agent_id = NULL WHERE ceo_agent_id = ${agent.id}`,
            sql`DELETE FROM board_agents WHERE agent_id = ${agent.id}`,
          ],
          { discard: true },
        ),
      )
      .pipe(failWith("Could not remove the agent."));

  const listHires: BoardStore["Service"]["listHires"] = Effect.fn("BoardStore.listHires")(
    function* (companyId) {
      const rows = yield* sql<HireRow>`
        SELECT * FROM board_hires WHERE company_id = ${companyId}
        ORDER BY created_at DESC, rowid DESC LIMIT 50
      `;
      return yield* Effect.forEach(rows, toHire);
    },
    failWith("Could not list hire requests."),
  );

  const getHire: BoardStore["Service"]["getHire"] = Effect.fn("BoardStore.getHire")(function* (id) {
    const rows = yield* sql<HireRow>`SELECT * FROM board_hires WHERE hire_id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : yield* toHire(row);
  }, failWith("Could not read the hire request."));

  const insertHire: BoardStore["Service"]["insertHire"] = Effect.fn("BoardStore.insertHire")(
    function* (hire) {
      const id = BoardHireId.make(yield* newId("board-hire"));
      const at = yield* now;
      const skillIds = yield* encodeSkillIds(hire.skillIds);
      yield* sql`
        INSERT INTO board_hires (
          hire_id, company_id, requested_by_agent_id, name, title, department_id,
          reports_to_agent_id, reports_to_hire_id, skill_ids_json, instructions, reason, status,
          created_at, decided_at
        )
        VALUES (
          ${id}, ${hire.companyId}, ${hire.requestedByAgentId}, ${hire.name}, ${hire.title},
          ${hire.departmentId}, ${hire.reportsToAgentId}, ${hire.reportsToHireId}, ${skillIds},
          ${hire.instructions}, ${hire.reason}, 'pending', ${at}, NULL
        )
      `;
      const created = yield* getHire(id);
      if (created === null) return yield* new BoardError({ message: "The hire request vanished." });
      return created;
    },
    failWith("Could not save the hire request."),
  );

  const decideHire: BoardStore["Service"]["decideHire"] = Effect.fn("BoardStore.decideHire")(
    function* (id, status, reportsTo) {
      const at = yield* now;
      yield* sql.withTransaction(
        Effect.all([
          sql`
            UPDATE board_hires SET status = ${status}, decided_at = ${at}
            WHERE hire_id = ${id} AND status = 'pending'
          `,
          sql`
            UPDATE board_hires
            SET reports_to_agent_id = ${reportsTo.agentId}, reports_to_hire_id = ${reportsTo.hireId}
            WHERE reports_to_hire_id = ${id} AND status = 'pending'
          `,
        ]),
      );
    },
    failWith("Could not record the hiring decision."),
  );

  const listPendingSkillRequests: BoardStore["Service"]["listPendingSkillRequests"] = Effect.fn(
    "BoardStore.listPendingSkillRequests",
  )(function* (companyId) {
    const rows = yield* sql<SkillRequestRow>`
      SELECT * FROM board_skill_requests WHERE company_id = ${companyId} AND status = 'pending'
      ORDER BY created_at, rowid
    `;
    return yield* Effect.forEach(rows, toSkillRequest);
  }, failWith("Could not list skill requests."));

  const getSkillRequest: BoardStore["Service"]["getSkillRequest"] = Effect.fn(
    "BoardStore.getSkillRequest",
  )(function* (id) {
    const rows = yield* sql<SkillRequestRow>`
      SELECT * FROM board_skill_requests WHERE request_id = ${id}
    `;
    const row = rows[0];
    return row === undefined ? null : yield* toSkillRequest(row);
  }, failWith("Could not read the skill request."));

  const insertSkillRequest: BoardStore["Service"]["insertSkillRequest"] = Effect.fn(
    "BoardStore.insertSkillRequest",
  )(function* (request) {
    const id = BoardSkillRequestId.make(yield* newId("board-skill-request"));
    const at = yield* now;
    yield* sql`
      INSERT INTO board_skill_requests (
        request_id, company_id, requested_by_agent_id, agent_id, skill_id, name, description,
        installed_path, reason, status, created_at, decided_at
      )
      VALUES (
        ${id}, ${request.companyId}, ${request.requestedByAgentId}, ${request.agentId},
        ${request.skillId}, ${request.name}, ${request.description}, ${request.installedPath},
        ${request.reason}, 'pending', ${at}, NULL
      )
    `;
    const created = yield* getSkillRequest(id);
    if (created === null) {
      return yield* new BoardError({ message: "The skill request vanished." });
    }
    return created;
  }, failWith("Could not save the skill request."));

  const decideSkillRequest: BoardStore["Service"]["decideSkillRequest"] = Effect.fn(
    "BoardStore.decideSkillRequest",
  )(function* (id, status) {
    const at = yield* now;
    yield* sql`
      UPDATE board_skill_requests SET status = ${status}, decided_at = ${at}
      WHERE request_id = ${id} AND status = 'pending'
    `;
  }, failWith("Could not record the skill decision."));

  const listTasks: BoardStore["Service"]["listTasks"] = Effect.fn("BoardStore.listTasks")(
    function* (companyId) {
      const rows = yield* sql<TaskRow>`
        SELECT ${sql.literal(TASK_COLUMNS)}
        FROM board_tasks t
        WHERE t.company_id = ${companyId}
        ORDER BY t.position, t.created_at
      `;
      return yield* Effect.forEach(rows, toStoredTask);
    },
    failWith("Could not list tasks."),
  );

  const getTask: BoardStore["Service"]["getTask"] = Effect.fn("BoardStore.getTask")(function* (id) {
    const rows = yield* sql<TaskRow>`
        SELECT ${sql.literal(TASK_COLUMNS)} FROM board_tasks t WHERE t.task_id = ${id}
      `;
    const row = rows[0];
    return row === undefined ? null : yield* toStoredTask(row);
  }, failWith("Could not read the task."));

  const nextPosition = (companyId: BoardCompanyId, status: BoardTaskStatus) =>
    sql<{ readonly position: number | null }>`
      SELECT MAX(position) AS position FROM board_tasks
      WHERE company_id = ${companyId} AND status = ${status}
    `.pipe(Effect.map((rows) => (rows[0]?.position ?? 0) + 1));

  const insertTask: BoardStore["Service"]["insertTask"] = Effect.fn("BoardStore.insertTask")(
    function* (task) {
      const id = BoardTaskId.make(yield* newId("board-task"));
      const at = yield* now;
      const position = yield* nextPosition(task.companyId, task.status);
      yield* sql`
        INSERT INTO board_tasks (
          task_id, company_id, project_id, title, description, status, position,
          assignee_agent_id, assigned_to_user, reviewer_agent_id, parent_task_id, thread_id,
          worktree_path, created_by_agent_id, status_changed_at, created_at, updated_at
        )
        VALUES (
          ${id}, ${task.companyId}, ${task.projectId}, ${task.title}, ${task.description},
          ${task.status}, ${position}, ${task.assigneeAgentId}, ${task.assignedToUser ? 1 : 0},
          ${task.reviewerAgentId}, ${task.parentTaskId}, NULL, NULL, ${task.createdByAgentId},
          ${at}, ${at}, ${at}
        )
      `;
      return id;
    },
    failWith("Could not create the task."),
  );

  const updateTask: BoardStore["Service"]["updateTask"] = Effect.fn("BoardStore.updateTask")(
    function* (id, changes) {
      const current = yield* getTask(id);
      if (current === null) return false;
      const before = current.task;
      const at = yield* now;
      const status = changes.status ?? before.status;
      const statusChanged = status !== before.status;
      const position =
        changes.position ??
        (statusChanged ? yield* nextPosition(before.companyId, status) : before.position);
      yield* sql`
        UPDATE board_tasks SET
          title = ${changes.title ?? before.title},
          description = ${changes.description ?? before.description},
          status = ${status},
          position = ${position},
          assignee_agent_id = ${changes.assigneeAgentId === undefined ? before.assigneeAgentId : changes.assigneeAgentId},
          assigned_to_user = ${(changes.assignedToUser ?? before.assignedToUser) ? 1 : 0},
          reviewer_agent_id = ${changes.reviewerAgentId === undefined ? before.reviewerAgentId : changes.reviewerAgentId},
          status_changed_at = ${statusChanged ? at : current.statusChangedAt},
          archived_at = ${statusChanged ? null : before.archivedAt},
          updated_at = ${at}
        WHERE task_id = ${id}
      `;
      return statusChanged;
    },
    failWith("Could not update the task."),
  );

  const setTasksArchived: BoardStore["Service"]["setTasksArchived"] = Effect.fn(
    "BoardStore.setTasksArchived",
  )(function* (ids, archivedAt) {
    if (ids.length === 0) return;
    yield* sql`UPDATE board_tasks SET archived_at = ${archivedAt} WHERE task_id IN ${sql.in(ids)}`;
  }, failWith("Could not archive the task."));

  const listTaskThreadIds: BoardStore["Service"]["listTaskThreadIds"] = Effect.fn(
    "BoardStore.listTaskThreadIds",
  )(function* (ids) {
    if (ids.length === 0) return [];
    const rows = yield* sql<{ readonly thread_id: string }>`
      SELECT DISTINCT thread_id FROM board_runs WHERE task_id IN ${sql.in(ids)}
    `;
    return rows.map((row) => ThreadId.make(row.thread_id));
  }, failWith("Could not list the task's threads."));

  const listFinishedTreeThreadIds: BoardStore["Service"]["listFinishedTreeThreadIds"] = () =>
    sql<{ readonly thread_id: string }>`
      WITH RECURSIVE tree(task_id, root_id) AS (
        SELECT task_id, task_id FROM board_tasks WHERE parent_task_id IS NULL
        UNION
        SELECT child.task_id, tree.root_id
        FROM board_tasks child JOIN tree ON child.parent_task_id = tree.task_id
      )
      SELECT DISTINCT run.thread_id
      FROM board_runs run
      JOIN tree ON tree.task_id = run.task_id
      WHERE NOT EXISTS (
        SELECT 1 FROM tree member
        JOIN board_tasks task ON task.task_id = member.task_id
        JOIN board_tasks root ON root.task_id = member.root_id
        WHERE member.root_id = tree.root_id
          AND task.status != 'done'
          AND root.archived_at IS NULL
      )
    `.pipe(
      Effect.map((rows) => new Set(rows.map((row) => ThreadId.make(row.thread_id)))),
      failWith("Could not list the threads of finished tasks."),
    );

  const listTaskWorktrees: BoardStore["Service"]["listTaskWorktrees"] = (companyId) =>
    sql<{ readonly worktree_path: string; readonly task_id: string }>`
      SELECT DISTINCT
        json_extract(th.payload_json, '$.worktreePath') AS worktree_path, r.task_id
      FROM board_runs r
      JOIN board_tasks t ON t.task_id = r.task_id
      JOIN orchestration_v2_projection_threads th ON th.thread_id = r.thread_id
      WHERE t.company_id = ${companyId}
        AND th.deleted_at IS NULL
        AND json_extract(th.payload_json, '$.worktreePath') IS NOT NULL
      ORDER BY worktree_path, r.task_id
    `.pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          worktreePath: row.worktree_path,
          taskId: BoardTaskId.make(row.task_id),
        })),
      ),
      failWith("Could not list the company's worktrees."),
    );

  const setTaskThread: BoardStore["Service"]["setTaskThread"] = Effect.fn(
    "BoardStore.setTaskThread",
  )(function* (id, threadId, workspace) {
    const at = yield* now;
    yield* sql`
        UPDATE board_tasks
        SET thread_id = ${threadId}, worktree_path = ${workspace.worktreePath},
          branch = ${workspace.branch}, base_ref = ${workspace.baseRef}, updated_at = ${at}
        WHERE task_id = ${id}
      `;
  }, failWith("Could not link the task to its thread."));

  const deleteTask: BoardStore["Service"]["deleteTask"] = (task) =>
    sql
      .withTransaction(
        Effect.all(
          [
            sql`UPDATE board_tasks SET parent_task_id = ${task.parentTaskId}
              WHERE parent_task_id = ${task.id}`,
            sql`DELETE FROM board_attachment_deliveries WHERE comment_id IN
              (SELECT comment_id FROM board_comments WHERE task_id = ${task.id})`,
            sql`DELETE FROM board_comments WHERE task_id = ${task.id}`,
            // Tasks that waited on this one no longer wait for it.
            sql`DELETE FROM board_task_dependencies
              WHERE task_id = ${task.id} OR waits_on_task_id = ${task.id}`,
            sql`DELETE FROM board_work_links WHERE task_id = ${task.id}`,
            sql`DELETE FROM board_runs WHERE task_id = ${task.id}`,
            sql`DELETE FROM board_tasks WHERE task_id = ${task.id}`,
          ],
          { discard: true },
        ),
      )
      .pipe(failWith("Could not delete the task."));

  const countOpenSubtasks: BoardStore["Service"]["countOpenSubtasks"] = (parentId) =>
    sql<{ readonly open: number }>`
      SELECT COUNT(*) AS open FROM board_tasks
      WHERE parent_task_id = ${parentId} AND status != 'done'
    `.pipe(
      Effect.map((rows) => rows[0]?.open ?? 0),
      failWith("Could not count subtasks."),
    );

  const searchTasks: BoardStore["Service"]["searchTasks"] = Effect.fn("BoardStore.searchTasks")(
    function* (companyId, query, limit) {
      const pattern = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const rows = yield* sql<TaskRow>`
        SELECT ${sql.literal(TASK_COLUMNS)}
        FROM board_tasks t
        WHERE t.company_id = ${companyId}
          AND (
            t.title LIKE ${pattern} ESCAPE '\\'
            OR t.description LIKE ${pattern} ESCAPE '\\'
            OR EXISTS (
              SELECT 1 FROM board_comments c
              WHERE c.task_id = t.task_id AND c.author_kind != 'system'
                AND c.body LIKE ${pattern} ESCAPE '\\'
            )
          )
        ORDER BY t.updated_at DESC
        LIMIT ${limit}
      `;
      return yield* Effect.forEach(rows, toStoredTask);
    },
    failWith("Could not search tasks."),
  );

  const listComments: BoardStore["Service"]["listComments"] = Effect.fn("BoardStore.listComments")(
    function* (taskId) {
      const rows = yield* sql<CommentRow>`
        SELECT * FROM board_comments WHERE task_id = ${taskId} ORDER BY created_at, rowid
      `;
      return yield* Effect.forEach(rows, toComment);
    },
    failWith("Could not read comments."),
  );

  const listRoutines: BoardStore["Service"]["listRoutines"] = Effect.fn("BoardStore.listRoutines")(
    function* (companyId) {
      const rows = yield* sql<RoutineRow>`
        SELECT * FROM board_routines WHERE company_id = ${companyId} ORDER BY created_at, rowid
      `;
      return yield* Effect.forEach(rows, toRoutine);
    },
    failWith("Could not read the routines."),
  );

  const getRoutine: BoardStore["Service"]["getRoutine"] = Effect.fn("BoardStore.getRoutine")(
    function* (id) {
      const rows = yield* sql<RoutineRow>`SELECT * FROM board_routines WHERE routine_id = ${id}`;
      const row = rows[0];
      return row === undefined ? null : yield* toRoutine(row);
    },
    failWith("Could not read the routine."),
  );

  const upsertRoutine: BoardStore["Service"]["upsertRoutine"] = (routine) =>
    sql`
      INSERT INTO board_routines (
        routine_id, company_id, title, description, assignee_agent_id, assigned_to_user,
        every_days, next_run_at, enabled, last_task_id, created_at, updated_at
      )
      VALUES (
        ${routine.id}, ${routine.companyId}, ${routine.title}, ${routine.description},
        ${routine.assigneeAgentId}, ${routine.assignedToUser ? 1 : 0}, ${routine.everyDays},
        ${routine.nextRunAt},
        ${routine.enabled ? 1 : 0}, ${routine.lastTaskId}, ${routine.createdAt}, ${routine.updatedAt}
      )
      ON CONFLICT (routine_id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        assignee_agent_id = excluded.assignee_agent_id,
        assigned_to_user = excluded.assigned_to_user,
        every_days = excluded.every_days,
        next_run_at = excluded.next_run_at,
        enabled = excluded.enabled,
        last_task_id = excluded.last_task_id,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid, failWith("Could not save the routine."));

  const deleteRoutine: BoardStore["Service"]["deleteRoutine"] = (id) =>
    sql`DELETE FROM board_routines WHERE routine_id = ${id}`.pipe(
      Effect.asVoid,
      failWith("Could not delete the routine."),
    );

  const listDueRoutines: BoardStore["Service"]["listDueRoutines"] = Effect.fn(
    "BoardStore.listDueRoutines",
  )(function* (at) {
    const rows = yield* sql<RoutineRow>`
      SELECT * FROM board_routines WHERE enabled = 1 AND next_run_at <= ${at}
      ORDER BY next_run_at, rowid
    `;
    return yield* Effect.forEach(rows, toRoutine);
  }, failWith("Could not read the routines."));

  const listWorkLinks: BoardStore["Service"]["listWorkLinks"] = Effect.fn(
    "BoardStore.listWorkLinks",
  )(function* (taskId) {
    const rows = yield* sql<WorkLinkRow>`
      SELECT * FROM board_work_links WHERE task_id = ${taskId} ORDER BY created_at, rowid
    `;
    return yield* Effect.forEach(rows, toWorkLink);
  }, failWith("Could not read the task's links."));

  const listCompanyWorkLinks: BoardStore["Service"]["listCompanyWorkLinks"] = Effect.fn(
    "BoardStore.listCompanyWorkLinks",
  )(function* (companyId) {
    const rows = yield* sql<WorkLinkRow>`
      SELECT l.* FROM board_work_links l JOIN board_tasks t ON t.task_id = l.task_id
      WHERE t.company_id = ${companyId} ORDER BY l.created_at, l.rowid
    `;
    return yield* Effect.forEach(rows, toWorkLink);
  }, failWith("Could not read the company's links."));

  const listCompanyUpdates: BoardStore["Service"]["listCompanyUpdates"] = Effect.fn(
    "BoardStore.listCompanyUpdates",
  )(function* (companyId, since) {
    const rows = yield* sql<CommentRow>`
      SELECT c.* FROM board_comments c JOIN board_tasks t ON t.task_id = c.task_id
      WHERE t.company_id = ${companyId} AND c.author_kind = 'system' AND c.created_at >= ${since}
      ORDER BY c.created_at, c.rowid
    `;
    return yield* Effect.forEach(rows, toComment);
  }, failWith("Could not read the company's updates."));

  const getWorkLink: BoardStore["Service"]["getWorkLink"] = Effect.fn("BoardStore.getWorkLink")(
    function* (id) {
      const rows = yield* sql<WorkLinkRow>`SELECT * FROM board_work_links WHERE link_id = ${id}`;
      const row = rows[0];
      return row === undefined ? null : yield* toWorkLink(row);
    },
    failWith("Could not read the link."),
  );

  const upsertWorkLink: BoardStore["Service"]["upsertWorkLink"] = Effect.fn(
    "BoardStore.upsertWorkLink",
  )(function* (link) {
    const id = BoardWorkLinkId.make(yield* newId("board-link"));
    const at = yield* now;
    yield* sql`
      INSERT INTO board_work_links (
        link_id, task_id, kind, title, url, status, agent_id, created_at, updated_at
      )
      VALUES (
        ${id}, ${link.taskId}, ${link.kind}, ${link.title}, ${link.url}, ${link.status},
        ${link.agentId}, ${at}, ${at}
      )
      ON CONFLICT (task_id, url) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        status = excluded.status,
        agent_id = COALESCE(excluded.agent_id, board_work_links.agent_id),
        updated_at = excluded.updated_at
    `;
    const rows = yield* sql<WorkLinkRow>`
      SELECT * FROM board_work_links WHERE task_id = ${link.taskId} AND url = ${link.url}
    `;
    const row = rows[0];
    if (row === undefined) return yield* new BoardError({ message: "The link vanished." });
    return yield* toWorkLink(row);
  }, failWith("Could not save the link."));

  const deleteWorkLink: BoardStore["Service"]["deleteWorkLink"] = (id) =>
    sql`DELETE FROM board_work_links WHERE link_id = ${id}`.pipe(
      Effect.asVoid,
      failWith("Could not remove the link."),
    );

  const insertComment: BoardStore["Service"]["insertComment"] = Effect.fn(
    "BoardStore.insertComment",
  )(function* (input) {
    const id = BoardCommentId.make(yield* newId("board-comment"));
    const createdAt = yield* now;
    const body = input.body.slice(0, MAX_COMMENT_CHARS);
    const attachments = input.attachments ?? [];
    yield* sql`
        INSERT INTO board_comments (
          comment_id, task_id, author_kind, author_agent_id, body, attachments_json, created_at
        )
        VALUES (
          ${id}, ${input.taskId}, ${input.authorKind}, ${input.authorAgentId}, ${body},
          ${yield* encodeAttachments(attachments)}, ${createdAt}
        )
      `;
    return {
      id,
      taskId: input.taskId,
      authorKind: input.authorKind,
      authorAgentId: input.authorAgentId,
      body,
      attachments,
      createdAt,
    } satisfies BoardComment;
  }, failWith("Could not add the comment."));

  const setTaskDependencies: BoardStore["Service"]["setTaskDependencies"] = (taskId, waitsOn) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM board_task_dependencies WHERE task_id = ${taskId}`;
          for (const id of new Set(waitsOn)) {
            yield* sql`
              INSERT INTO board_task_dependencies (task_id, waits_on_task_id)
              VALUES (${taskId}, ${id})
            `;
          }
        }),
      )
      .pipe(failWith("Could not save what the task waits on."));

  const listDeliveredComments: BoardStore["Service"]["listDeliveredComments"] = (threadId) =>
    sql<{ readonly comment_id: string }>`
      SELECT comment_id FROM board_attachment_deliveries WHERE thread_id = ${threadId}
    `.pipe(
      Effect.map((rows) => new Set(rows.map((row) => row.comment_id))),
      failWith("Could not read which files the thread has."),
    );

  const recordDeliveries: BoardStore["Service"]["recordDeliveries"] = (threadId, commentIds) =>
    Effect.forEach(
      commentIds,
      (commentId) => sql`
        INSERT OR IGNORE INTO board_attachment_deliveries (thread_id, comment_id)
        VALUES (${threadId}, ${commentId})
      `,
      { discard: true },
    ).pipe(failWith("Could not record the files sent to the thread."));

  const listRuns: BoardStore["Service"]["listRuns"] = Effect.fn("BoardStore.listRuns")(function* (
    taskId,
  ) {
    const rows = yield* sql<RunRow>`
        SELECT * FROM board_runs WHERE task_id = ${taskId} ORDER BY started_at, rowid
      `;
    return yield* Effect.forEach(rows, toRun);
  }, failWith("Could not read runs."));

  const insertRun: BoardStore["Service"]["insertRun"] = Effect.fn("BoardStore.insertRun")(
    function* (input) {
      const id = BoardRunId.make(yield* newId("board-run"));
      const at = yield* now;
      yield* sql`
        INSERT INTO board_runs (
          run_id, task_id, agent_id, thread_id, kind, status, started_at, ended_at
        )
        VALUES (
          ${id}, ${input.taskId}, ${input.agentId}, ${input.threadId}, ${input.kind},
          'running', ${at}, NULL
        )
      `;
      return id;
    },
    failWith("Could not record the run."),
  );

  const endRun: BoardStore["Service"]["endRun"] = Effect.fn("BoardStore.endRun")(function* (
    id,
    status,
  ) {
    const at = yield* now;
    yield* sql`
        UPDATE board_runs SET status = ${status}, ended_at = ${at}
        WHERE run_id = ${id} AND status = 'running'
      `;
  }, failWith("Could not record the run's end."));

  const runForThread: BoardStore["Service"]["runForThread"] = Effect.fn("BoardStore.runForThread")(
    function* (threadId) {
      const rows = yield* sql<RunningRunRow>`
        SELECT r.*, t.company_id FROM board_runs r
        JOIN board_tasks t ON t.task_id = r.task_id
        WHERE r.thread_id = ${threadId}
        ORDER BY CASE r.status WHEN 'running' THEN 0 ELSE 1 END, r.started_at DESC, r.rowid DESC
        LIMIT 1
      `;
      const row = rows[0];
      return row === undefined ? null : yield* toRunningRun(row);
    },
    failWith("Could not resolve the thread's task."),
  );

  const listAgentThreads: BoardStore["Service"]["listAgentThreads"] = Effect.fn(
    "BoardStore.listAgentThreads",
  )(function* (companyId) {
    // SQLite fills the bare columns from the row holding MAX(started_at), so each thread
    // reports its latest run. Settled, archived, and deleted threads are finished work, which
    // the Threads view keeps. A failed run stops counting once the thread runs again without a
    // failure, including when a person continues it from the thread itself.
    const rows = yield* sql<RunRow>`
        SELECT
          latest.thread_id, latest.agent_id, latest.task_id, latest.kind, latest.started_at,
          CASE
            WHEN latest.status = 'failed' AND (
              SELECT o.status FROM orchestration_v2_projection_runs o
              WHERE o.thread_id = latest.thread_id AND o.requested_at > latest.ended_at
              ORDER BY o.ordinal DESC LIMIT 1
            ) != 'failed' THEN 'completed'
            ELSE latest.status
          END AS status
        FROM (
          SELECT
            r.thread_id, r.agent_id, r.task_id, r.kind, r.status, r.ended_at,
            MAX(r.started_at) AS started_at, MAX(r.rowid) AS sequence
          FROM board_runs r
          JOIN board_tasks t ON t.task_id = r.task_id
          LEFT JOIN orchestration_v2_projection_threads th ON th.thread_id = r.thread_id
          WHERE t.company_id = ${companyId}
            AND th.archived_at IS NULL
            AND th.deleted_at IS NULL
            AND json_extract(th.payload_json, '$.settledOverride') IS NOT 'settled'
          GROUP BY r.thread_id, r.agent_id
          ORDER BY started_at DESC, sequence DESC
          LIMIT ${MAX_AGENT_THREADS}
        ) latest
        ORDER BY latest.started_at DESC, latest.sequence DESC
      `;
    return yield* Effect.forEach(rows, (row) =>
      decodeAgentThread({
        threadId: row.thread_id,
        agentId: row.agent_id,
        taskId: row.task_id,
        kind: row.kind,
        status: row.status,
        startedAt: row.started_at,
      }),
    );
  }, failWith("Could not list employee threads."));

  const listRunningRuns: BoardStore["Service"]["listRunningRuns"] = Effect.fn(
    "BoardStore.listRunningRuns",
  )(function* () {
    const rows = yield* sql<RunningRunRow>`
        SELECT r.*, t.company_id FROM board_runs r
        JOIN board_tasks t ON t.task_id = r.task_id
        WHERE r.status = 'running'
      `;
    return yield* Effect.forEach(rows, toRunningRun);
  }, failWith("Could not list running agents."));

  // Board runs do not record a model or tokens; the orchestration projection holds both, on the
  // run's thread and on each provider turn in it.
  const listRunFacts: BoardStore["Service"]["listRunFacts"] = Effect.fn("BoardStore.listRunFacts")(
    function* (companyId) {
      const rows = yield* sql<RunRow & { readonly model_selection_json: string | null }>`
        SELECT r.*, json_extract(th.payload_json, '$.modelSelection') AS model_selection_json
        FROM board_runs r
        JOIN board_tasks t ON t.task_id = r.task_id
        LEFT JOIN orchestration_v2_projection_threads th ON th.thread_id = r.thread_id
        WHERE t.company_id = ${companyId}
      `;
      return yield* Effect.forEach(rows, (row) =>
        Effect.all({
          run: toRun(row),
          modelSelection:
            row.model_selection_json === null
              ? Effect.succeed(null)
              : decodeModelSelection(row.model_selection_json).pipe(
                  Effect.orElseSucceed(() => null),
                ),
        }),
      );
    },
    failWith("Could not read run history."),
  );

  const listThreadTokenDays: BoardStore["Service"]["listThreadTokenDays"] = Effect.fn(
    "BoardStore.listThreadTokenDays",
  )(function* (companyId, utcOffsetMinutes) {
    const rows = yield* sql<{
      readonly thread_id: string;
      readonly day: string | null;
      readonly input_tokens: number;
      readonly cached_input_tokens: number;
      readonly output_tokens: number;
    }>`
        SELECT
          p.thread_id,
          date(COALESCE(p.started_at, p.completed_at), ${`${utcOffsetMinutes} minutes`}) AS day,
          COALESCE(SUM(json_extract(p.payload_json, '$.turnTokenUsage.inputTokens')), 0)
            AS input_tokens,
          COALESCE(SUM(json_extract(p.payload_json, '$.turnTokenUsage.cachedInputTokens')), 0)
            AS cached_input_tokens,
          COALESCE(SUM(json_extract(p.payload_json, '$.turnTokenUsage.outputTokens')), 0)
            AS output_tokens
        FROM orchestration_v2_projection_provider_turns p
        WHERE p.thread_id IN (
          SELECT r.thread_id FROM board_runs r
          JOIN board_tasks t ON t.task_id = r.task_id
          WHERE t.company_id = ${companyId}
        )
        GROUP BY p.thread_id, day
      `;
    return rows.map((row) => ({
      threadId: ThreadId.make(row.thread_id),
      day: row.day,
      input: row.input_tokens,
      cachedInput: row.cached_input_tokens,
      output: row.output_tokens,
    }));
  }, failWith("Could not read token usage."));

  const tokenUsageSince: BoardStore["Service"]["tokenUsageSince"] = (companyId, since) =>
    sql<{ readonly agent_id: string | null; readonly tokens: number }>`
      SELECT
        (SELECT r.agent_id FROM board_runs r WHERE r.thread_id = p.thread_id
          ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1) AS agent_id,
        COALESCE(SUM(
          COALESCE(json_extract(p.payload_json, '$.turnTokenUsage.inputTokens'), 0)
          + COALESCE(json_extract(p.payload_json, '$.turnTokenUsage.outputTokens'), 0)
        ), 0) AS tokens
      FROM orchestration_v2_projection_provider_turns p
      WHERE p.thread_id IN (
        SELECT r.thread_id FROM board_runs r
        JOIN board_tasks t ON t.task_id = r.task_id
        WHERE t.company_id = ${companyId}
      )
        AND COALESCE(p.started_at, p.completed_at) >= ${since}
      GROUP BY agent_id
    `.pipe(
      Effect.map((rows) =>
        rows.flatMap((row) =>
          row.agent_id === null
            ? []
            : [{ agentId: BoardAgentId.make(row.agent_id), tokens: row.tokens }],
        ),
      ),
      failWith("Could not read token usage."),
    );

  const countRunningRuns: BoardStore["Service"]["countRunningRuns"] = (companyId) =>
    sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM board_runs r
      JOIN board_tasks t ON t.task_id = r.task_id
      WHERE t.company_id = ${companyId} AND r.status = 'running'
    `.pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      failWith("Could not count running agents."),
    );

  const countRuns: BoardStore["Service"]["countRuns"] = (taskId) =>
    sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM board_runs WHERE task_id = ${taskId}
    `.pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      failWith("Could not count runs."),
    );

  const lastRunEndedAt: BoardStore["Service"]["lastRunEndedAt"] = (taskId, kind) =>
    sql<{ readonly ended_at: string | null }>`
      SELECT ended_at FROM board_runs
      WHERE task_id = ${taskId} AND (${kind ?? null} IS NULL OR kind = ${kind ?? null})
      ORDER BY started_at DESC, rowid DESC LIMIT 1
    `.pipe(
      Effect.map((rows) => rows[0]?.ended_at ?? null),
      failWith("Could not read the last run."),
    );

  const latestAgentThread: BoardStore["Service"]["latestAgentThread"] = (taskId, agentId, kind) =>
    sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM board_runs
      WHERE task_id = ${taskId} AND agent_id = ${agentId}
        AND (${kind ?? null} IS NULL OR kind = ${kind ?? null})
      ORDER BY started_at DESC, rowid DESC LIMIT 1
    `.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : (rows[0].thread_id as ThreadId))),
      failWith("Could not read the agent's thread."),
    );

  const listNewlyBlockedSubtasks: BoardStore["Service"]["listNewlyBlockedSubtasks"] = (companyId) =>
    sql<{ readonly parent_task_id: string; readonly task_id: string }>`
      SELECT c.parent_task_id, c.task_id FROM board_tasks c
      WHERE c.company_id = ${companyId} AND c.status = 'blocked' AND c.parent_task_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM board_tasks g WHERE g.parent_task_id = c.task_id AND g.status != 'done'
        )
        AND c.status_changed_at > COALESCE(
          (SELECT MAX(COALESCE(r.ended_at, '9999')) FROM board_runs r
            WHERE r.task_id = c.parent_task_id),
          ''
        )
    `.pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          parentId: BoardTaskId.make(row.parent_task_id),
          taskId: BoardTaskId.make(row.task_id),
        })),
      ),
      failWith("Could not read blocked tasks."),
    );

  // A run still going counts as ending in the future: whoever it is sees the comment live.
  const listTasksAwaitingReply: BoardStore["Service"]["listTasksAwaitingReply"] = (companyId) =>
    sql<{ readonly task_id: string }>`
      SELECT DISTINCT c.task_id FROM board_comments c
      JOIN board_tasks t ON t.task_id = c.task_id
      WHERE t.company_id = ${companyId} AND c.author_kind = 'user'
        AND c.created_at > COALESCE(
          (SELECT MAX(COALESCE(r.ended_at, '9999')) FROM board_runs r WHERE r.task_id = c.task_id),
          ''
        )
    `.pipe(
      Effect.map((rows) => new Set(rows.map((row) => BoardTaskId.make(row.task_id)))),
      failWith("Could not read the board's comments."),
    );

  const lastRunStartedAt: BoardStore["Service"]["lastRunStartedAt"] = (taskId, kind) =>
    sql<{ readonly started_at: string }>`
      SELECT started_at FROM board_runs
      WHERE task_id = ${taskId} AND kind = ${kind}
      ORDER BY started_at DESC, rowid DESC LIMIT 1
    `.pipe(
      Effect.map((rows) => rows[0]?.started_at ?? null),
      failWith("Could not read the last run."),
    );

  const getSettings: BoardStore["Service"]["getSettings"] = Effect.fn("BoardStore.getSettings")(
    function* (companyId) {
      const rows = yield* sql<SettingsRow>`
        SELECT auto_dispatch, max_concurrent_runs, use_worktrees, base_ref, monthly_token_limit
        FROM board_company_settings WHERE company_id = ${companyId}
      `;
      const row = rows[0];
      return yield* decodeSettings({
        companyId,
        autoDispatch: row === undefined ? true : row.auto_dispatch === 1,
        maxConcurrentRuns: row?.max_concurrent_runs ?? DEFAULT_MAX_CONCURRENT_RUNS,
        useWorktrees: row === undefined ? true : row.use_worktrees === 1,
        baseRef: row?.base_ref ?? DEFAULT_BASE_REF,
        monthlyTokenLimit: row?.monthly_token_limit ?? null,
      });
    },
    failWith("Could not read board settings."),
  );

  const upsertSettings: BoardStore["Service"]["upsertSettings"] = Effect.fn(
    "BoardStore.upsertSettings",
  )(function* (settings) {
    const at = yield* now;
    yield* sql`
        INSERT INTO board_company_settings (
          company_id, auto_dispatch, max_concurrent_runs, use_worktrees, base_ref,
          monthly_token_limit, updated_at
        )
        VALUES (
          ${settings.companyId}, ${settings.autoDispatch ? 1 : 0}, ${settings.maxConcurrentRuns},
          ${settings.useWorktrees ? 1 : 0}, ${settings.baseRef}, ${settings.monthlyTokenLimit},
          ${at}
        )
        ON CONFLICT (company_id) DO UPDATE SET
          auto_dispatch = excluded.auto_dispatch,
          max_concurrent_runs = excluded.max_concurrent_runs,
          use_worktrees = excluded.use_worktrees,
          base_ref = excluded.base_ref,
          monthly_token_limit = excluded.monthly_token_limit,
          updated_at = excluded.updated_at
      `;
  }, failWith("Could not save board settings."));

  return BoardStore.of({
    newId,
    now,
    listCompanySummaries,
    getCompany,
    insertCompany,
    updateCompany,
    deleteCompany,
    listCompanyIds,
    listSkills,
    upsertSkill,
    getSkill,
    deleteSkill,
    listAgents,
    getAgent,
    upsertAgent,
    deleteAgent,
    listHires,
    getHire,
    insertHire,
    decideHire,
    listPendingSkillRequests,
    getSkillRequest,
    insertSkillRequest,
    decideSkillRequest,
    listTasks,
    getTask,
    insertTask,
    updateTask,
    setTasksArchived,
    listTaskThreadIds,
    listFinishedTreeThreadIds,
    listTaskWorktrees,
    setTaskThread,
    deleteTask,
    countOpenSubtasks,
    searchTasks,
    listComments,
    insertComment,
    setTaskDependencies,
    listDeliveredComments,
    recordDeliveries,
    listRuns,
    insertRun,
    endRun,
    runForThread,
    listAgentThreads,
    listRunningRuns,
    listRunFacts,
    listThreadTokenDays,
    countRunningRuns,
    countRuns,
    lastRunEndedAt,
    listTasksAwaitingReply,
    tokenUsageSince,
    listNewlyBlockedSubtasks,
    listRoutines,
    getRoutine,
    upsertRoutine,
    deleteRoutine,
    listDueRoutines,
    listWorkLinks,
    listCompanyWorkLinks,
    listCompanyUpdates,
    upsertWorkLink,
    getWorkLink,
    deleteWorkLink,
    latestAgentThread,
    lastRunStartedAt,
    getSettings,
    upsertSettings,
  });
});

export const layer = Layer.effect(BoardStore, make);
