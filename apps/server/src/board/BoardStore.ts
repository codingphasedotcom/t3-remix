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
  BoardTask,
  BoardTaskId,
  ModelSelection,
  type BoardCommentAuthorKind,
  type BoardHireStatus,
  type BoardRunKind,
  type BoardRunStatus,
  type BoardTaskStatus,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
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

export interface NewTask {
  readonly companyId: BoardCompanyId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly description: string;
  readonly status: BoardTaskStatus;
  readonly assigneeAgentId: BoardAgentId | null;
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
  readonly reviewerAgentId?: BoardAgentId | null;
}

export interface NewHire {
  readonly companyId: BoardCompanyId;
  readonly requestedByAgentId: BoardAgentId | null;
  readonly name: string;
  readonly title: string;
  readonly departmentId: BoardDepartmentId | null;
  readonly reportsToAgentId: BoardAgentId | null;
  readonly skillIds: ReadonlyArray<BoardSkillId>;
  readonly instructions: string;
  readonly reason: string;
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
    readonly decideHire: (id: BoardHireId, status: BoardHireStatus) => StoreEffect<void>;

    readonly listTasks: (companyId: BoardCompanyId) => StoreEffect<ReadonlyArray<StoredTask>>;
    readonly getTask: (id: BoardTaskId) => StoreEffect<StoredTask | null>;
    readonly insertTask: (task: NewTask) => StoreEffect<BoardTaskId>;
    readonly updateTask: (id: BoardTaskId, changes: TaskChanges) => StoreEffect<boolean>;
    readonly setTaskThread: (
      id: BoardTaskId,
      threadId: ThreadId,
      workspace: TaskWorkspace,
    ) => StoreEffect<void>;
    readonly deleteTask: (task: BoardTask) => StoreEffect<void>;
    readonly countOpenSubtasks: (parentId: BoardTaskId) => StoreEffect<number>;
    /** Cards whose title, description, or comments mention `query`, newest first. */
    readonly searchTasks: (
      companyId: BoardCompanyId,
      query: string,
      limit: number,
    ) => StoreEffect<ReadonlyArray<StoredTask>>;

    readonly listComments: (taskId: BoardTaskId) => StoreEffect<ReadonlyArray<BoardComment>>;
    readonly insertComment: (input: {
      readonly taskId: BoardTaskId;
      readonly authorKind: BoardCommentAuthorKind;
      readonly authorAgentId: BoardAgentId | null;
      readonly body: string;
    }) => StoreEffect<BoardComment>;

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
    readonly countRunningRuns: (companyId: BoardCompanyId) => StoreEffect<number>;
    readonly countRuns: (taskId: BoardTaskId) => StoreEffect<number>;
    readonly lastRunEndedAt: (
      taskId: BoardTaskId,
      kind: BoardRunKind,
    ) => StoreEffect<string | null>;
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
  readonly skill_ids_json: string;
  readonly instructions: string;
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
  readonly reviewer_agent_id: string | null;
  readonly parent_task_id: string | null;
  readonly thread_id: string | null;
  readonly worktree_path: string | null;
  readonly branch: string | null;
  readonly base_ref: string | null;
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
  readonly company_id: string;
}

interface SettingsRow {
  readonly auto_dispatch: number;
  readonly max_concurrent_runs: number;
  readonly use_worktrees: number;
  readonly base_ref: string;
}

const SkillIdsJson = Schema.fromJsonString(Schema.Array(BoardSkillId));
const DepartmentsJson = Schema.fromJsonString(Schema.Array(BoardDepartment));
const decodeDepartments = Schema.decodeUnknownEffect(DepartmentsJson);
const encodeDepartments = Schema.encodeEffect(DepartmentsJson);
const ModelSelectionJson = Schema.fromJsonString(ModelSelection);
const decodeSkillIds = Schema.decodeUnknownEffect(SkillIdsJson);
const encodeSkillIds = Schema.encodeEffect(SkillIdsJson);
const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelectionJson);
const encodeModelSelection = Schema.encodeEffect(ModelSelectionJson);
const decodeCompany = Schema.decodeUnknownEffect(BoardCompany);
const decodeCompanySummary = Schema.decodeUnknownEffect(BoardCompanySummary);
const decodeSkill = Schema.decodeUnknownEffect(BoardSkill);
const decodeAgent = Schema.decodeUnknownEffect(BoardAgent);
const decodeHire = Schema.decodeUnknownEffect(BoardHire);
const decodeTask = Schema.decodeUnknownEffect(BoardTask);
const decodeComment = Schema.decodeUnknownEffect(BoardComment);
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
  t.reviewer_agent_id,
  t.parent_task_id,
  t.thread_id,
  t.worktree_path,
  t.branch,
  t.base_ref,
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

/** Wraps a store failure so callers see one error type with a readable message. */
const failWith =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, BoardError, R> =>
    effect.pipe(Effect.mapError((cause) => new BoardError({ message, cause })));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

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
      skill_ids_json TEXT NOT NULL,
      instructions TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_board_hires_company ON board_hires(company_id, status)`;
  if (!(yield* columns("board_hires")).has("department_id")) {
    yield* sql`ALTER TABLE board_hires ADD COLUMN department_id TEXT`;
  }
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
    CREATE TABLE IF NOT EXISTS board_company_settings (
      company_id TEXT PRIMARY KEY,
      auto_dispatch INTEGER NOT NULL,
      max_concurrent_runs INTEGER NOT NULL,
      use_worktrees INTEGER NOT NULL,
      base_ref TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  const newId: BoardStore["Service"]["newId"] = (prefix) =>
    crypto.randomUUIDv4().pipe(
      Effect.map((uuid) => `${prefix}:${uuid}`),
      Effect.orDie,
    );
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
      skillIds: yield* decodeSkillIds(row.skill_ids_json),
      instructions: row.instructions,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
    });
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
    return {
      task,
      statusChangedAt: row.status_changed_at,
      branch: row.branch,
      baseRef: row.base_ref,
    } satisfies StoredTask;
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
    return yield* Effect.forEach(rows, (row) =>
      decodeCompanySummary({
        id: row.company_id,
        name: row.name,
        projectId: row.project_id,
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
            sql`DELETE FROM board_comments WHERE task_id IN
              (SELECT task_id FROM board_tasks WHERE company_id = ${id})`,
            sql`DELETE FROM board_runs WHERE task_id IN
              (SELECT task_id FROM board_tasks WHERE company_id = ${id})`,
            sql`DELETE FROM board_tasks WHERE company_id = ${id}`,
            sql`DELETE FROM board_hires WHERE company_id = ${id}`,
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
        skill_id, company_id, name, description, instructions, created_at, updated_at
      )
      VALUES (
        ${skill.id}, ${skill.companyId}, ${skill.name}, ${skill.description},
        ${skill.instructions}, ${skill.createdAt}, ${skill.updatedAt}
      )
      ON CONFLICT (skill_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        instructions = excluded.instructions,
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
          created_at, updated_at
        )
        VALUES (
          ${agent.id}, ${agent.companyId}, ${agent.name}, ${agent.title}, ${agent.avatar},
          ${agent.departmentId}, ${agent.reportsToAgentId}, ${skillIds}, ${agent.instructions},
          ${agent.memory},
          ${modelSelection}, ${agent.runtimeMode}, ${agent.paused ? 1 : 0}, ${agent.createdAt},
          ${agent.updatedAt}
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
          reports_to_agent_id, skill_ids_json, instructions, reason, status, created_at, decided_at
        )
        VALUES (
          ${id}, ${hire.companyId}, ${hire.requestedByAgentId}, ${hire.name}, ${hire.title},
          ${hire.departmentId}, ${hire.reportsToAgentId}, ${skillIds}, ${hire.instructions},
          ${hire.reason}, 'pending', ${at}, NULL
        )
      `;
      const created = yield* getHire(id);
      if (created === null) return yield* new BoardError({ message: "The hire request vanished." });
      return created;
    },
    failWith("Could not save the hire request."),
  );

  const decideHire: BoardStore["Service"]["decideHire"] = Effect.fn("BoardStore.decideHire")(
    function* (id, status) {
      const at = yield* now;
      yield* sql`
        UPDATE board_hires SET status = ${status}, decided_at = ${at}
        WHERE hire_id = ${id} AND status = 'pending'
      `;
    },
    failWith("Could not record the hiring decision."),
  );

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
    failWith("Could not list cards."),
  );

  const getTask: BoardStore["Service"]["getTask"] = Effect.fn("BoardStore.getTask")(function* (id) {
    const rows = yield* sql<TaskRow>`
        SELECT ${sql.literal(TASK_COLUMNS)} FROM board_tasks t WHERE t.task_id = ${id}
      `;
    const row = rows[0];
    return row === undefined ? null : yield* toStoredTask(row);
  }, failWith("Could not read the card."));

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
          assignee_agent_id, reviewer_agent_id, parent_task_id, thread_id, worktree_path,
          created_by_agent_id, status_changed_at, created_at, updated_at
        )
        VALUES (
          ${id}, ${task.companyId}, ${task.projectId}, ${task.title}, ${task.description},
          ${task.status}, ${position}, ${task.assigneeAgentId}, ${task.reviewerAgentId},
          ${task.parentTaskId}, NULL, NULL, ${task.createdByAgentId}, ${at}, ${at}, ${at}
        )
      `;
      return id;
    },
    failWith("Could not create the card."),
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
          reviewer_agent_id = ${changes.reviewerAgentId === undefined ? before.reviewerAgentId : changes.reviewerAgentId},
          status_changed_at = ${statusChanged ? at : current.statusChangedAt},
          updated_at = ${at}
        WHERE task_id = ${id}
      `;
      return statusChanged;
    },
    failWith("Could not update the card."),
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
  }, failWith("Could not link the card to its thread."));

  const deleteTask: BoardStore["Service"]["deleteTask"] = (task) =>
    sql
      .withTransaction(
        Effect.all(
          [
            sql`UPDATE board_tasks SET parent_task_id = ${task.parentTaskId}
              WHERE parent_task_id = ${task.id}`,
            sql`DELETE FROM board_comments WHERE task_id = ${task.id}`,
            sql`DELETE FROM board_runs WHERE task_id = ${task.id}`,
            sql`DELETE FROM board_tasks WHERE task_id = ${task.id}`,
          ],
          { discard: true },
        ),
      )
      .pipe(failWith("Could not delete the card."));

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
    failWith("Could not search cards."),
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

  const insertComment: BoardStore["Service"]["insertComment"] = Effect.fn(
    "BoardStore.insertComment",
  )(function* (input) {
    const id = BoardCommentId.make(yield* newId("board-comment"));
    const createdAt = yield* now;
    const body = input.body.slice(0, MAX_COMMENT_CHARS);
    yield* sql`
        INSERT INTO board_comments (
          comment_id, task_id, author_kind, author_agent_id, body, created_at
        )
        VALUES (
          ${id}, ${input.taskId}, ${input.authorKind}, ${input.authorAgentId}, ${body}, ${createdAt}
        )
      `;
    return {
      id,
      taskId: input.taskId,
      authorKind: input.authorKind,
      authorAgentId: input.authorAgentId,
      body,
      createdAt,
    } satisfies BoardComment;
  }, failWith("Could not add the comment."));

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
    failWith("Could not resolve the thread's card."),
  );

  const listAgentThreads: BoardStore["Service"]["listAgentThreads"] = Effect.fn(
    "BoardStore.listAgentThreads",
  )(function* (companyId) {
    // SQLite fills the bare columns from the row holding MAX(started_at), so each thread
    // reports its latest run.
    const rows = yield* sql<RunRow>`
        SELECT
          r.thread_id, r.agent_id, r.task_id, r.kind, r.status,
          MAX(r.started_at) AS started_at, MAX(r.rowid) AS sequence
        FROM board_runs r
        JOIN board_tasks t ON t.task_id = r.task_id
        WHERE t.company_id = ${companyId}
        GROUP BY r.thread_id, r.agent_id
        ORDER BY started_at DESC, sequence DESC
        LIMIT ${MAX_AGENT_THREADS}
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
      WHERE task_id = ${taskId} AND kind = ${kind}
      ORDER BY started_at DESC, rowid DESC LIMIT 1
    `.pipe(
      Effect.map((rows) => rows[0]?.ended_at ?? null),
      failWith("Could not read the last run."),
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
        SELECT auto_dispatch, max_concurrent_runs, use_worktrees, base_ref
        FROM board_company_settings WHERE company_id = ${companyId}
      `;
      const row = rows[0];
      return yield* decodeSettings({
        companyId,
        autoDispatch: row === undefined ? true : row.auto_dispatch === 1,
        maxConcurrentRuns: row?.max_concurrent_runs ?? DEFAULT_MAX_CONCURRENT_RUNS,
        useWorktrees: row === undefined ? true : row.use_worktrees === 1,
        baseRef: row?.base_ref ?? DEFAULT_BASE_REF,
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
          company_id, auto_dispatch, max_concurrent_runs, use_worktrees, base_ref, updated_at
        )
        VALUES (
          ${settings.companyId}, ${settings.autoDispatch ? 1 : 0}, ${settings.maxConcurrentRuns},
          ${settings.useWorktrees ? 1 : 0}, ${settings.baseRef}, ${at}
        )
        ON CONFLICT (company_id) DO UPDATE SET
          auto_dispatch = excluded.auto_dispatch,
          max_concurrent_runs = excluded.max_concurrent_runs,
          use_worktrees = excluded.use_worktrees,
          base_ref = excluded.base_ref,
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
    listTasks,
    getTask,
    insertTask,
    updateTask,
    setTaskThread,
    deleteTask,
    countOpenSubtasks,
    searchTasks,
    listComments,
    insertComment,
    listRuns,
    insertRun,
    endRun,
    runForThread,
    listAgentThreads,
    listRunningRuns,
    countRunningRuns,
    countRuns,
    lastRunEndedAt,
    lastRunStartedAt,
    getSettings,
    upsertSettings,
  });
});

export const layer = Layer.effect(BoardStore, make);
