import {
  BoardAgentId,
  BoardCompanyId,
  BoardDepartmentId,
  BoardError,
  BoardRoutineId,
  BoardSkillId,
  MAX_AGENT_MEMORY_CHARS,
  MAX_COMPANY_MEMORY_CHARS,
  boardShipBlocker,
  CommandId,
  MessageId,
  ThreadId,
  type BoardAgent,
  type BoardAgentUpsertInput,
  type BoardCommand,
  type BoardCommandResult,
  type BoardComment,
  type BoardCommentAddInput,
  type BoardCompany,
  type BoardCompanyCloneInput,
  type BoardCompanyCreateInput,
  type BoardCompanyUpdateInput,
  type BoardCompanyWorkspace,
  type BoardDashboard,
  type BoardDepartment,
  type BoardHire,
  type BoardHireDecisionInput,
  type BoardHireId,
  type BoardRunKind,
  type BoardSettings,
  type BoardSettingsUpdateInput,
  type BoardShipMethod,
  type BoardSkill,
  type BoardSkillUpsertInput,
  type BoardSnapshot,
  type BoardSubscribeInput,
  type BoardTask,
  type BoardTaskCreateInput,
  type BoardTaskDetail,
  type BoardTaskId,
  type BoardTaskStatus,
  type BoardTaskUpdateInput,
  type BoardRoutine,
  type BoardRoutineUpsertInput,
  type BoardUsage,
  type BoardWorkLink,
  type BoardWorkLinkId,
  type BoardWorkLinkKind,
  type BoardWorkLinkStatus,
  type OrchestrationV2Run,
  type ProjectId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { createdPullRequestKey } from "../git/linkCreatedPullRequest.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as BoardStore from "./BoardStore.ts";
import { buildDashboard } from "./boardDashboard.ts";
import { DEFAULT_DEPARTMENT_NAMES, assignableBy, createsReportingCycle } from "./boardOrg.ts";
import { makeMergeTaskBranch } from "./boardShip.ts";
import {
  boardStatusLabel,
  buildReReviewPrompt,
  buildReplyPrompt,
  buildReviewPrompt,
  buildReworkPrompt,
  buildUserCommentMessage,
  buildWorkPrompt,
  type BlockedSubtask,
  type BoardPromptContext,
  type BoardWorkspace,
} from "./boardPrompts.ts";

/** Who is changing the board. An agent is identified by the thread its MCP credential belongs to. */
export type BoardActor =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly threadId: ThreadId };

export interface BoardAssignment {
  readonly companyId: BoardCompanyId;
  readonly taskId: BoardTaskId;
  readonly agentId: BoardAgentId;
  readonly kind: BoardRunKind;
}

export interface BoardHireRequestInput {
  readonly companyId: BoardCompanyId;
  readonly name: string;
  readonly title: string;
  readonly departmentId: BoardDepartmentId | null;
  readonly reportsToAgentId: BoardAgentId | null;
  /** A pending request for their manager, so a manager and their team can be proposed together. */
  readonly reportsToHireId: BoardHireId | null;
  readonly skillIds: ReadonlyArray<BoardSkillId>;
  readonly instructions: string;
  readonly reason: string;
}

export type BoardMemoryScope = "self" | "company";

export interface BoardCardMatch {
  readonly task: BoardTask;
  /** The last summary or review comment an agent left, which is usually the useful part. */
  readonly summary: string | null;
}

export class BoardService extends Context.Service<
  BoardService,
  {
    readonly snapshot: (
      companyId: BoardCompanyId | null,
    ) => Effect.Effect<BoardSnapshot, BoardError>;
    /** The board as it changes; with `dashboard`, each snapshot carries the company's dashboard. */
    readonly subscribe: (
      companyId: BoardCompanyId | null,
      dashboard?: BoardSubscribeInput["dashboard"],
    ) => Stream.Stream<BoardSnapshot, BoardError>;
    readonly taskDetail: (taskId: BoardTaskId) => Effect.Effect<BoardTaskDetail, BoardError>;
    readonly subscribeTaskDetail: (
      taskId: BoardTaskId,
    ) => Stream.Stream<BoardTaskDetail, BoardError>;
    /** Run history, model mix, and token spend for one company. */
    readonly dashboard: (input: {
      readonly companyId: BoardCompanyId;
      readonly utcOffsetMinutes: number;
    }) => Effect.Effect<BoardDashboard, BoardError>;
    /** Companies whose agents work in `projectId`, for agents outside any company's card. */
    readonly companiesForProject: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<BoardCompanyId>, BoardError>;
    readonly createTask: (
      input: BoardTaskCreateInput,
      actor: BoardActor,
    ) => Effect.Effect<BoardTask, BoardError>;
    readonly updateTask: (
      input: BoardTaskUpdateInput,
      actor: BoardActor,
    ) => Effect.Effect<BoardTask, BoardError>;
    readonly addComment: (
      input: BoardCommentAddInput,
      actor: BoardActor,
    ) => Effect.Effect<BoardComment, BoardError>;
    /** Records something a task produced, such as a pull request, or updates its status. */
    readonly linkWork: (
      input: {
        readonly taskId: BoardTaskId;
        readonly kind: BoardWorkLinkKind;
        readonly title: string;
        readonly url: string;
        readonly status: BoardWorkLinkStatus | null;
      },
      actor: BoardActor,
    ) => Effect.Effect<BoardWorkLink, BoardError>;
    /** An agent asks the board to add a teammate; a person approves it in the app. */
    readonly requestHire: (
      input: BoardHireRequestInput,
      actor: BoardActor,
    ) => Effect.Effect<BoardHire, BoardError>;
    /** Appends a dated note to the calling agent's memory or, for managers, the company's. */
    readonly remember: (
      input: { readonly scope: BoardMemoryScope; readonly note: string },
      actor: BoardActor,
    ) => Effect.Effect<{ readonly memory: string; readonly remaining: number }, BoardError>;
    /** Replaces a memory with a condensed version written by the agent. */
    readonly rewriteMemory: (
      input: { readonly scope: BoardMemoryScope; readonly content: string },
      actor: BoardActor,
    ) => Effect.Effect<{ readonly memory: string; readonly remaining: number }, BoardError>;
    readonly searchCards: (
      companyId: BoardCompanyId,
      query: string,
    ) => Effect.Effect<ReadonlyArray<BoardCardMatch>, BoardError>;
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

/** A readable branch per card; the thread id keeps a retried card off its earlier branch. */
function cardBranchName(task: BoardTask, threadId: ThreadId): string {
  const slug = sanitizeBranchFragment(task.title)
    .replaceAll("/", "-")
    .slice(0, 40)
    .replace(/[-_]+$/, "");
  const token = threadId
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(-8);
  return `board/${slug}-${token}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path;
}

/** "2026-10-20:" or "2026-10-20 (Grace):" at the start of a memory note. */
const LEADING_NOTE_DATE = /^\d{4}-\d{2}-\d{2}(?:\s*\([^)]*\))?\s*[:\u2013\u2014-]\s*/;

function boardError(message: string, cause?: unknown): BoardError {
  return new BoardError({ message, ...(cause === undefined ? {} : { cause }) });
}

const make = Effect.gen(function* () {
  const store = yield* BoardStore.BoardStore;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projectFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const mergeTaskBranch = yield* makeMergeTaskBranch;

  // `null` means the company list changed, which every subscriber shows.
  const changes = yield* PubSub.unbounded<BoardCompanyId | null>();
  const notify = (companyId: BoardCompanyId | null) =>
    PubSub.publish(changes, companyId).pipe(Effect.asVoid);
  // Dispatch decisions read and then write runs; serializing them keeps two passes from
  // starting the same card or overshooting the concurrency limit.
  const dispatchLock = yield* Semaphore.make(1);

  const requireCompany = Effect.fn("BoardService.requireCompany")(function* (id: BoardCompanyId) {
    const company = yield* store.getCompany(id);
    if (company === null) return yield* boardError(`Company ${id} was not found.`);
    return company;
  });

  const requireTask = Effect.fn("BoardService.requireTask")(function* (id: BoardTaskId) {
    const stored = yield* store.getTask(id);
    if (stored === null) return yield* boardError(`Board task ${id} was not found.`);
    return stored;
  });

  const systemComment = (taskId: BoardTaskId, body: string) =>
    store.insertComment({ taskId, authorKind: "system", authorAgentId: null, body });

  /** The company agent behind an agent actor, or null for people and ordinary threads. */
  const actingAgent = Effect.fn("BoardService.actingAgent")(function* (
    actor: BoardActor,
    companyId: BoardCompanyId,
  ) {
    if (actor.kind === "user") return null;
    const running = yield* store.runForThread(actor.threadId);
    if (running === null || running.companyId !== companyId) return null;
    return yield* store.getAgent(running.run.agentId);
  });

  const actorLabel = (agent: BoardAgent | null, actor: BoardActor) =>
    actor.kind === "user" ? "The board" : (agent?.name ?? "An agent");

  const assertAgentsInCompany = Effect.fn("BoardService.assertAgentsInCompany")(function* (
    agents: ReadonlyArray<BoardAgent>,
    ids: ReadonlyArray<BoardAgentId | null | undefined>,
  ) {
    for (const id of ids) {
      if (id === null || id === undefined) continue;
      if (!agents.some((agent) => agent.id === id)) {
        return yield* boardError(
          `Agent ${id} is not in this company. board_list_agents lists the org chart.`,
        );
      }
    }
  });

  /** Agents may only hand work to themselves and the people beneath them. */
  const assertMayAssign = Effect.fn("BoardService.assertMayAssign")(function* (
    company: BoardCompany,
    agents: ReadonlyArray<BoardAgent>,
    actingAs: BoardAgent | null,
    ids: ReadonlyArray<BoardAgentId | null | undefined>,
  ) {
    if (actingAs === null) return;
    const allowed = assignableBy(company, agents, actingAs);
    for (const id of ids) {
      if (id === null || id === undefined || id === actingAs.id) continue;
      if (!allowed.some((agent) => agent.id === id)) {
        const names = allowed
          .filter((agent) => agent.id !== actingAs.id)
          .map((agent) => `${agent.name} (${agent.id})`);
        return yield* boardError(
          names.length > 0
            ? `You can only assign work within your reporting line: ${names.join(", ")}. Use board_request_hire if you need someone else.`
            : "You have no reports, so you can only assign work to yourself. Use board_request_hire to ask for a teammate.",
        );
      }
    }
  });

  /** This month's tokens; only read when a limit is set, since nothing else needs it live. */
  const monthlyUsage = Effect.fn("BoardService.monthlyUsage")(function* (
    companyId: BoardCompanyId,
    settings: BoardSettings,
    agents: ReadonlyArray<BoardAgent>,
  ) {
    if (
      settings.monthlyTokenLimit === null &&
      agents.every((agent) => agent.monthlyTokenLimit === null)
    ) {
      return null;
    }
    const monthStart = `${(yield* store.now).slice(0, 7)}-01T00:00:00.000Z`;
    const byAgent = yield* store.tokenUsageSince(companyId, monthStart);
    return {
      monthStart,
      companyTokens: byAgent.reduce((sum, row) => sum + row.tokens, 0),
      agents: byAgent,
    } satisfies BoardUsage;
  });

  /** Why an agent may not start this month, or null when it may. */
  const limitReached = (
    usage: BoardUsage | null,
    settings: BoardSettings,
    agent: BoardAgent,
  ): string | null => {
    if (usage === null) return null;
    if (settings.monthlyTokenLimit !== null && usage.companyTokens >= settings.monthlyTokenLimit) {
      return "The company reached its monthly token limit.";
    }
    const spent = usage.agents.find((row) => row.agentId === agent.id)?.tokens ?? 0;
    return agent.monthlyTokenLimit !== null && spent >= agent.monthlyTokenLimit
      ? `${agent.name} reached their monthly token limit.`
      : null;
  };

  const snapshot: BoardService["Service"]["snapshot"] = Effect.fn("BoardService.snapshot")(
    function* (companyId) {
      const companies = yield* store.listCompanySummaries();
      const company = companyId === null ? null : yield* store.getCompany(companyId);
      if (company === null) {
        return {
          companies,
          company: null,
          settings: null,
          agents: [],
          skills: [],
          hires: [],
          tasks: [],
          threads: [],
          routines: [],
          usage: null,
        } satisfies BoardSnapshot;
      }
      const settings = yield* store.getSettings(company.id);
      const agents = yield* store.listAgents(company.id);
      return {
        companies,
        company,
        settings,
        agents,
        skills: yield* store.listSkills(company.id),
        hires: yield* store.listHires(company.id),
        tasks: (yield* store.listTasks(company.id)).map((stored) => stored.task),
        threads: yield* store.listAgentThreads(company.id),
        routines: yield* store.listRoutines(company.id),
        usage: yield* monthlyUsage(company.id, settings, agents),
      } satisfies BoardSnapshot;
    },
  );

  const dashboard: BoardService["Service"]["dashboard"] = Effect.fn("BoardService.dashboard")(
    function* (input) {
      const company = yield* requireCompany(input.companyId);
      return buildDashboard({
        companyId: company.id,
        agents: yield* store.listAgents(company.id),
        tasks: yield* store.listTasks(company.id),
        runs: yield* store.listRunFacts(company.id),
        tokenDays: yield* store.listThreadTokenDays(company.id, input.utcOffsetMinutes),
        now: yield* store.now,
        utcOffsetMinutes: input.utcOffsetMinutes,
      });
    },
  );

  // A running agent's tokens land on the dashboard with the board change that ends its run.
  const view = Effect.fn("BoardService.view")(function* (
    companyId: BoardCompanyId | null,
    options: BoardSubscribeInput["dashboard"],
  ) {
    const board = yield* snapshot(companyId);
    if (options === undefined || board.company === null) return board;
    return {
      ...board,
      dashboard: yield* dashboard({
        companyId: board.company.id,
        utcOffsetMinutes: options.utcOffsetMinutes,
      }),
    } satisfies BoardSnapshot;
  });

  const subscribe: BoardService["Service"]["subscribe"] = (companyId, options) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the first snapshot so a change in between is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(view(companyId, options)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === null || changed === companyId),
            Stream.mapEffect(() => view(companyId, options)),
          ),
        );
      }),
    );

  const taskDetail: BoardService["Service"]["taskDetail"] = Effect.fn("BoardService.taskDetail")(
    function* (taskId) {
      const stored = yield* requireTask(taskId);
      return {
        task: stored.task,
        comments: yield* store.listComments(taskId),
        runs: yield* store.listRuns(taskId),
        links: yield* store.listWorkLinks(taskId),
      } satisfies BoardTaskDetail;
    },
  );

  const subscribeTaskDetail: BoardService["Service"]["subscribeTaskDetail"] = (taskId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const first = yield* taskDetail(taskId);
        const companyId = first.task.companyId;
        return Stream.concat(
          Stream.succeed(first),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === null || changed === companyId),
            Stream.mapEffect(() => taskDetail(taskId)),
          ),
        );
      }),
    );

  const companiesForProject: BoardService["Service"]["companiesForProject"] = Effect.fn(
    "BoardService.companiesForProject",
  )(function* (projectId) {
    const companies = yield* store.listCompanySummaries();
    return companies.filter((company) => company.projectId === projectId).map((c) => c.id);
  });

  const assignmentForThread: BoardService["Service"]["assignmentForThread"] = Effect.fn(
    "BoardService.assignmentForThread",
  )(function* (threadId) {
    const running = yield* store.runForThread(threadId);
    if (running === null) return null;
    return {
      companyId: running.companyId,
      taskId: running.run.taskId,
      agentId: running.run.agentId,
      kind: running.run.kind,
    } satisfies BoardAssignment;
  });

  /** The project a company calls home, creating its folder when it asks for a new one. */
  const resolveWorkspace = Effect.fn("BoardService.resolveWorkspace")(function* (
    workspace: BoardCompanyWorkspace,
  ) {
    if (workspace.type === "existing") return workspace.projectId;
    const created = yield* projectFolders
      .createNamedProject({ name: workspace.folderName })
      .pipe(
        Effect.mapError((cause) =>
          boardError("Could not create the company's project folder.", cause),
        ),
      );
    return created.projectId;
  });

  const createCompany = Effect.fn("BoardService.createCompany")(function* (
    input: BoardCompanyCreateInput,
  ) {
    const projectId = yield* resolveWorkspace(input.workspace);
    const at = yield* store.now;
    const companyId = BoardCompanyId.make(yield* store.newId("board-company"));
    const ceoId = BoardAgentId.make(yield* store.newId("board-agent"));
    const departments = yield* Effect.forEach(DEFAULT_DEPARTMENT_NAMES, (name) =>
      store
        .newId("board-department")
        .pipe(Effect.map((id): BoardDepartment => ({ id: BoardDepartmentId.make(id), name }))),
    );
    const company: BoardCompany = {
      id: companyId,
      name: input.name,
      mission: input.mission,
      departments,
      memory: "",
      projectId,
      ceoAgentId: ceoId,
      createdAt: at,
      updatedAt: at,
    };
    yield* store.insertCompany(company);
    yield* store.upsertAgent({
      id: ceoId,
      companyId,
      name: input.ceo.name,
      title: "CEO",
      avatar: input.ceo.avatar ?? "",
      departmentId: departments[0]!.id,
      reportsToAgentId: null,
      skillIds: [],
      instructions: input.ceo.instructions,
      memory: "",
      modelSelection: input.ceo.modelSelection,
      runtimeMode: input.ceo.runtimeMode,
      paused: false,
      monthlyTokenLimit: null,
      createdAt: at,
      updatedAt: at,
    });
    yield* notify(null);
    return company;
  });

  const updateCompany = Effect.fn("BoardService.updateCompany")(function* (
    input: BoardCompanyUpdateInput,
  ) {
    const current = yield* requireCompany(input.id);
    if (input.memory !== undefined && input.memory.length > MAX_COMPANY_MEMORY_CHARS) {
      return yield* boardError(
        `Company memory is limited to ${MAX_COMPANY_MEMORY_CHARS} characters.`,
      );
    }
    const next: BoardCompany = {
      ...current,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.mission === undefined ? {} : { mission: input.mission }),
      ...(input.memory === undefined ? {} : { memory: input.memory }),
      ...(input.departments === undefined
        ? {}
        : { departments: yield* nextDepartments(current, input.departments) }),
      // Last, so a rejected change above never leaves a new project folder behind.
      ...(input.workspace === undefined
        ? {}
        : { projectId: yield* resolveWorkspace(input.workspace) }),
      updatedAt: yield* store.now,
    };
    yield* store.updateCompany(next);
    yield* notify(null);
    return next;
  });

  const cloneCompany = Effect.fn("BoardService.cloneCompany")(function* (
    input: BoardCompanyCloneInput,
  ) {
    const source = yield* requireCompany(input.sourceCompanyId);
    const agents = yield* store.listAgents(source.id);
    const skills = yield* store.listSkills(source.id);
    const settings = yield* store.getSettings(source.id);
    const projectId = yield* resolveWorkspace(input.workspace);
    const at = yield* store.now;
    const memory = (value: string) => (input.includeMemory === true ? value : "");
    // Fresh ids for everything, mapped from the originals so the copy points only at itself.
    const freshIds = <Id extends string>(ids: ReadonlyArray<Id>, prefix: string) =>
      Effect.forEach(ids, (id) =>
        store.newId(prefix).pipe(Effect.map((fresh) => [id, fresh] as const)),
      ).pipe(Effect.map((pairs) => new Map<string, string>(pairs)));
    const departmentIds = yield* freshIds(
      source.departments.map((department) => department.id),
      "board-department",
    );
    const skillIds = yield* freshIds(
      skills.map((skill) => skill.id),
      "board-skill",
    );
    const agentIds = yield* freshIds(
      agents.map((agent) => agent.id),
      "board-agent",
    );
    const departments = source.departments.map((department): BoardDepartment => ({
      id: BoardDepartmentId.make(departmentIds.get(department.id)!),
      name: department.name,
    }));
    const company: BoardCompany = {
      id: BoardCompanyId.make(yield* store.newId("board-company")),
      name: input.name,
      mission: input.mission ?? source.mission,
      departments,
      memory: memory(source.memory),
      projectId,
      ceoAgentId:
        source.ceoAgentId === null
          ? null
          : BoardAgentId.make(agentIds.get(source.ceoAgentId) ?? source.ceoAgentId),
      createdAt: at,
      updatedAt: at,
    };
    yield* store.insertCompany(company);
    yield* Effect.forEach(
      skills,
      (skill) =>
        store.upsertSkill({
          ...skill,
          id: BoardSkillId.make(skillIds.get(skill.id)!),
          companyId: company.id,
          createdAt: at,
          updatedAt: at,
        }),
      { discard: true },
    );
    yield* Effect.forEach(
      agents,
      (agent) => {
        const department = departmentIds.get(agent.departmentId);
        const manager =
          agent.reportsToAgentId === null ? undefined : agentIds.get(agent.reportsToAgentId);
        return store.upsertAgent({
          ...agent,
          id: BoardAgentId.make(agentIds.get(agent.id)!),
          companyId: company.id,
          departmentId:
            department === undefined ? departments[0]!.id : BoardDepartmentId.make(department),
          reportsToAgentId: manager === undefined ? null : BoardAgentId.make(manager),
          skillIds: agent.skillIds.flatMap((id) => {
            const fresh = skillIds.get(id);
            return fresh === undefined ? [] : [BoardSkillId.make(fresh)];
          }),
          memory: memory(agent.memory),
          createdAt: at,
          updatedAt: at,
        });
      },
      { discard: true },
    );
    yield* store.upsertSettings({ ...settings, companyId: company.id });
    yield* notify(null);
    return company;
  });

  const nextDepartments = Effect.fn("BoardService.nextDepartments")(function* (
    company: BoardCompany,
    requested: NonNullable<BoardCompanyUpdateInput["departments"]>,
  ) {
    if (requested.length === 0)
      return yield* boardError("A company needs at least one department.");
    const names = new Set<string>();
    for (const department of requested) {
      const key = department.name.toLowerCase();
      if (names.has(key))
        return yield* boardError(`There are two "${department.name}" departments.`);
      names.add(key);
      if (department.id !== undefined && !company.departments.some((d) => d.id === department.id)) {
        return yield* boardError(`Department ${department.id} is not in this company.`);
      }
    }
    const agents = yield* store.listAgents(company.id);
    for (const removed of company.departments) {
      if (requested.some((department) => department.id === removed.id)) continue;
      const members = agents.filter((agent) => agent.departmentId === removed.id);
      if (members.length > 0) {
        return yield* boardError(
          `Move ${members.map((agent) => agent.name).join(", ")} out of ${removed.name} before removing it.`,
        );
      }
    }
    return yield* Effect.forEach(requested, (department) =>
      department.id === undefined
        ? store.newId("board-department").pipe(
            Effect.map((id): BoardDepartment => ({
              id: BoardDepartmentId.make(id),
              name: department.name,
            })),
          )
        : Effect.succeed<BoardDepartment>({ id: department.id, name: department.name }),
    );
  });

  const deleteCompany = Effect.fn("BoardService.deleteCompany")(function* (id: BoardCompanyId) {
    yield* requireCompany(id);
    if ((yield* store.countRunningRuns(id)) > 0) {
      return yield* boardError("Agents are still working in this company. Stop them first.");
    }
    yield* store.deleteCompany(id);
    yield* notify(null);
  });

  const upsertSkill = Effect.fn("BoardService.upsertSkill")(function* (
    input: BoardSkillUpsertInput,
  ) {
    yield* requireCompany(input.companyId);
    const existing = input.id === undefined ? null : yield* store.getSkill(input.id);
    if (existing !== null && existing.companyId !== input.companyId) {
      return yield* boardError("That skill belongs to another company.");
    }
    const at = yield* store.now;
    const skill: BoardSkill = {
      id: existing?.id ?? BoardSkillId.make(yield* store.newId("board-skill")),
      companyId: input.companyId,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    yield* store.upsertSkill(skill);
    yield* notify(input.companyId);
    return skill;
  });

  const deleteSkill = Effect.fn("BoardService.deleteSkill")(function* (id: BoardSkillId) {
    const skill = yield* store.getSkill(id);
    if (skill === null) return;
    yield* store.deleteSkill(skill);
    yield* notify(skill.companyId);
  });

  const upsertAgent = Effect.fn("BoardService.upsertAgent")(function* (
    input: BoardAgentUpsertInput,
  ) {
    const company = yield* requireCompany(input.companyId);
    const agents = yield* store.listAgents(company.id);
    const skills = yield* store.listSkills(company.id);
    const existing = input.id === undefined ? null : yield* store.getAgent(input.id);
    if (existing !== null && existing.companyId !== company.id) {
      return yield* boardError("That agent works for another company.");
    }
    const id = existing?.id ?? BoardAgentId.make(yield* store.newId("board-agent"));
    const isCeo = company.ceoAgentId === id;
    // Everyone but the CEO has a manager; the CEO answers to the board.
    const reportsToAgentId = isCeo ? null : (input.reportsToAgentId ?? company.ceoAgentId);
    if (reportsToAgentId !== null) {
      yield* assertAgentsInCompany(agents, [reportsToAgentId]);
      if (createsReportingCycle(agents, id, reportsToAgentId)) {
        return yield* boardError("An agent cannot report to itself or to someone beneath it.");
      }
    }
    const unknownSkill = input.skillIds.find((skillId) => !skills.some((s) => s.id === skillId));
    if (unknownSkill !== undefined) {
      return yield* boardError(`Skill ${unknownSkill} is not in this company's skill library.`);
    }
    // A new person joins their manager's department unless told otherwise.
    const departmentId =
      input.departmentId ??
      existing?.departmentId ??
      agents.find((agent) => agent.id === reportsToAgentId)?.departmentId ??
      company.departments[0]?.id;
    if (
      departmentId === undefined ||
      !company.departments.some((department) => department.id === departmentId)
    ) {
      return yield* boardError("Choose one of the company's departments.");
    }
    if ((input.memory ?? "").length > MAX_AGENT_MEMORY_CHARS) {
      return yield* boardError(`Agent memory is limited to ${MAX_AGENT_MEMORY_CHARS} characters.`);
    }
    const at = yield* store.now;
    const agent: BoardAgent = {
      id,
      companyId: company.id,
      name: input.name,
      title: isCeo ? "CEO" : input.title,
      avatar: input.avatar ?? existing?.avatar ?? "",
      departmentId,
      reportsToAgentId,
      skillIds: [...new Set(input.skillIds)],
      instructions: input.instructions,
      memory: input.memory ?? existing?.memory ?? "",
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      paused: input.paused ?? existing?.paused ?? false,
      monthlyTokenLimit:
        input.monthlyTokenLimit === undefined
          ? (existing?.monthlyTokenLimit ?? null)
          : input.monthlyTokenLimit,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    yield* store.upsertAgent(agent);
    yield* notify(company.id);
    return agent;
  });

  const deleteAgent = Effect.fn("BoardService.deleteAgent")(function* (id: BoardAgentId) {
    const agent = yield* store.getAgent(id);
    if (agent === null) return;
    const company = yield* requireCompany(agent.companyId);
    if (company.ceoAgentId === id) {
      return yield* boardError("A company always has a CEO. Edit the CEO instead of removing it.");
    }
    yield* store.deleteAgent(agent);
    yield* notify(agent.companyId);
  });

  const decideHire = Effect.fn("BoardService.decideHire")(function* (
    input: BoardHireDecisionInput,
  ) {
    const hire = yield* store.getHire(input.id);
    if (hire === null || hire.status !== "pending") {
      return yield* boardError("That hire request was already decided.");
    }
    if (!input.approve) {
      // Their proposed reports move up to whoever this request reported to.
      yield* store.decideHire(hire.id, "rejected", {
        agentId: hire.reportsToAgentId,
        hireId: hire.reportsToHireId,
      });
      yield* notify(hire.companyId);
      return null;
    }
    const manager =
      hire.reportsToHireId === null ? null : yield* store.getHire(hire.reportsToHireId);
    if (manager?.status === "pending") {
      return yield* boardError(`Hire ${manager.name} first: ${hire.name} reports to them.`);
    }
    const company = yield* requireCompany(hire.companyId);
    const agents = yield* store.listAgents(company.id);
    // The new hire inherits a model and permissions from whoever asked, then the CEO.
    const template =
      agents.find((agent) => agent.id === hire.requestedByAgentId) ??
      agents.find((agent) => agent.id === company.ceoAgentId);
    const modelSelection = input.modelSelection ?? template?.modelSelection;
    if (modelSelection === undefined) {
      return yield* boardError("Choose a model for the new agent.");
    }
    const skills = yield* store.listSkills(company.id);
    // A department removed since the request falls back to the manager's.
    const departmentId = company.departments.find(
      (department) => department.id === hire.departmentId,
    )?.id;
    const agent = yield* upsertAgent({
      companyId: company.id,
      name: hire.name,
      title: hire.title,
      ...(departmentId === undefined ? {} : { departmentId }),
      reportsToAgentId: agents.some((candidate) => candidate.id === hire.reportsToAgentId)
        ? hire.reportsToAgentId
        : company.ceoAgentId,
      skillIds: hire.skillIds.filter((id) => skills.some((skill) => skill.id === id)),
      instructions: hire.instructions,
      modelSelection,
      runtimeMode: input.runtimeMode ?? template?.runtimeMode ?? "full-access",
    });
    yield* store.decideHire(hire.id, "approved", { agentId: agent.id, hireId: null });
    yield* notify(company.id);
    return agent;
  });

  const requestHire: BoardService["Service"]["requestHire"] = Effect.fn("BoardService.requestHire")(
    function* (input, actor) {
      const company = yield* requireCompany(input.companyId);
      const agents = yield* store.listAgents(company.id);
      const actingAs = yield* actingAgent(actor, company.id);
      if (input.reportsToHireId !== null) {
        if (input.reportsToAgentId !== null) {
          return yield* boardError("Set reportsToAgentId or reportsToHireId, not both.");
        }
        const manager = yield* store.getHire(input.reportsToHireId);
        if (manager?.companyId !== company.id || manager.status !== "pending") {
          return yield* boardError(
            "reportsToHireId must be a pending hire request in this company; board_list_agents lists them.",
          );
        }
      }
      const reportsToAgentId =
        input.reportsToHireId !== null
          ? null
          : (input.reportsToAgentId ?? actingAs?.id ?? company.ceoAgentId);
      yield* assertAgentsInCompany(agents, [reportsToAgentId]);
      yield* assertMayAssign(company, agents, actingAs, [reportsToAgentId]);
      if (
        input.departmentId !== null &&
        !company.departments.some((department) => department.id === input.departmentId)
      ) {
        return yield* boardError(
          `Choose a department from board_list_agents: ${company.departments.map((department) => department.name).join(", ")}.`,
        );
      }
      const skills = yield* store.listSkills(company.id);
      const hire = yield* store.insertHire({
        companyId: company.id,
        requestedByAgentId: actingAs?.id ?? null,
        name: input.name,
        title: input.title,
        departmentId: input.departmentId,
        reportsToAgentId,
        reportsToHireId: input.reportsToHireId,
        skillIds: input.skillIds.filter((id) => skills.some((skill) => skill.id === id)),
        instructions: input.instructions,
        reason: input.reason,
      });
      yield* notify(company.id);
      return hire;
    },
  );

  const createTask: BoardService["Service"]["createTask"] = Effect.fn("BoardService.createTask")(
    function* (input, actor) {
      const company = yield* requireCompany(input.companyId);
      const agents = yield* store.listAgents(company.id);
      const actingAs = yield* actingAgent(actor, company.id);
      yield* assertAgentsInCompany(agents, [input.assigneeAgentId, input.reviewerAgentId]);
      yield* assertMayAssign(company, agents, actingAs, [input.assigneeAgentId]);
      if (input.parentTaskId !== undefined && input.parentTaskId !== null) {
        const parent = yield* requireTask(input.parentTaskId);
        if (parent.task.companyId !== company.id) {
          return yield* boardError("A subtask must belong to its parent task's company.");
        }
      }
      const assignedToUser = input.assignedToUser ?? false;
      const assigneeAgentId = assignedToUser ? null : (input.assigneeAgentId ?? null);
      // A manager reviews the work it hands down unless it names another reviewer.
      const reviewerAgentId =
        input.reviewerAgentId !== undefined
          ? input.reviewerAgentId
          : actingAs !== null && assigneeAgentId !== actingAs.id
            ? actingAs.id
            : null;
      const id = yield* store.insertTask({
        companyId: company.id,
        projectId: company.projectId,
        title: input.title,
        description: input.description ?? "",
        status: input.status ?? (assigneeAgentId !== null || assignedToUser ? "todo" : "backlog"),
        assigneeAgentId,
        assignedToUser,
        reviewerAgentId,
        parentTaskId: input.parentTaskId ?? null,
        createdByAgentId: actingAs?.id ?? null,
      });
      if (actor.kind === "agent") {
        yield* systemComment(id, `Created by ${actorLabel(actingAs, actor)}.`);
      }
      // Files are referenced where they are, never copied: agents run on the same machine.
      for (const file of new Set(input.files ?? [])) {
        yield* store.upsertWorkLink({
          taskId: id,
          kind: "file",
          title: fileName(file),
          url: file,
          status: null,
          agentId: actingAs?.id ?? null,
        });
      }
      // Read before notifying: the change can start an agent that moves the card at once.
      const created = (yield* requireTask(id)).task;
      yield* notify(company.id);
      return created;
    },
  );

  /** The company agent making a memory change; people edit memory in the app instead. */
  const memoryWriter = Effect.fn("BoardService.memoryWriter")(function* (
    scope: BoardMemoryScope,
    actor: BoardActor,
  ) {
    if (actor.kind !== "agent") return yield* boardError("Only agents write memory this way.");
    const running = yield* store.runForThread(actor.threadId);
    if (running === null) {
      return yield* boardError("Only company agents working a task have a memory.");
    }
    const agent = yield* store.getAgent(running.run.agentId);
    const company = yield* store.getCompany(running.companyId);
    if (agent === null || company === null) return yield* boardError("Your company was removed.");
    if (scope === "company") {
      const agents = yield* store.listAgents(company.id);
      const manages =
        company.ceoAgentId === agent.id ||
        agents.some((candidate) => candidate.reportsToAgentId === agent.id);
      if (!manages) {
        return yield* boardError(
          "Only the CEO and managers write company memory. Keep it in your own memory, or comment on your task so your manager can record it.",
        );
      }
    }
    return { agent, company };
  });

  const saveMemory = Effect.fn("BoardService.saveMemory")(function* (
    scope: BoardMemoryScope,
    agent: BoardAgent,
    company: BoardCompany,
    memory: string,
  ) {
    const limit = scope === "company" ? MAX_COMPANY_MEMORY_CHARS : MAX_AGENT_MEMORY_CHARS;
    if (memory.length > limit) {
      return yield* boardError(
        `That would make the ${scope === "company" ? "company" : "your"} memory ${memory.length} characters; the limit is ${limit}. Condense it with board_rewrite_memory first, keeping only lessons that still matter.`,
      );
    }
    const at = yield* store.now;
    if (scope === "company") {
      yield* store.updateCompany({ ...company, memory, updatedAt: at });
    } else {
      yield* store.upsertAgent({ ...agent, memory, updatedAt: at });
    }
    yield* notify(company.id);
    return { memory, remaining: limit - memory.length };
  });

  const remember: BoardService["Service"]["remember"] = Effect.fn("BoardService.remember")(
    function* (input, actor) {
      const { agent, company } = yield* memoryWriter(input.scope, actor);
      const current = input.scope === "company" ? company.memory : agent.memory;
      const day = (yield* store.now).slice(0, 10);
      // The line already carries the day and author, so a date the agent wrote is dropped.
      const note = input.note.trim().replaceAll("\n", " ").replace(LEADING_NOTE_DATE, "");
      const author = input.scope === "company" ? ` (${agent.name})` : "";
      const next = `${current.trimEnd()}${current.trim().length > 0 ? "\n" : ""}- ${day}${author}: ${note}`;
      return yield* saveMemory(input.scope, agent, company, next);
    },
  );

  const rewriteMemory: BoardService["Service"]["rewriteMemory"] = Effect.fn(
    "BoardService.rewriteMemory",
  )(function* (input, actor) {
    const { agent, company } = yield* memoryWriter(input.scope, actor);
    return yield* saveMemory(input.scope, agent, company, input.content.trim());
  });

  const searchCards: BoardService["Service"]["searchCards"] = Effect.fn("BoardService.searchCards")(
    function* (companyId, query) {
      yield* requireCompany(companyId);
      const matches = yield* store.searchTasks(companyId, query.trim(), 20);
      return yield* Effect.forEach(matches, (stored) =>
        store.listComments(stored.task.id).pipe(
          Effect.map((comments) => ({
            task: stored.task,
            summary: comments.findLast((comment) => comment.authorKind === "agent")?.body ?? null,
          })),
        ),
      );
    },
  );

  // Moves a parent waiting in "blocked" back to "todo" once its last subtask is done, so the
  // agent that split the work resumes in its own thread.
  const resumeParentIfSubtasksDone = Effect.fn("BoardService.resumeParentIfSubtasksDone")(
    function* (parentTaskId: BoardTaskId) {
      const parent = yield* store.getTask(parentTaskId);
      if (parent === null || parent.task.status !== "blocked") return;
      if ((yield* store.countOpenSubtasks(parentTaskId)) > 0) return;
      yield* store.updateTask(parentTaskId, { status: "todo" });
      yield* systemComment(parentTaskId, "Every subtask is done; moved back to To do.");
    },
  );

  const updateTask: BoardService["Service"]["updateTask"] = Effect.fn("BoardService.updateTask")(
    function* (input, actor) {
      const current = yield* requireTask(input.id);
      const before = current.task;
      const company = yield* requireCompany(before.companyId);
      const agents = yield* store.listAgents(company.id);
      const actingAs = yield* actingAgent(actor, company.id);
      yield* assertAgentsInCompany(agents, [input.assigneeAgentId, input.reviewerAgentId]);
      if (actingAs !== null) {
        const involved =
          before.assigneeAgentId === actingAs.id ||
          before.reviewerAgentId === actingAs.id ||
          before.createdByAgentId === actingAs.id;
        const allowed = assignableBy(company, agents, actingAs);
        if (!involved && !allowed.some((agent) => agent.id === before.assigneeAgentId)) {
          return yield* boardError(
            "You can only change tasks you work on, review, created, or that belong to your reports.",
          );
        }
        if (input.assigneeAgentId !== undefined) {
          yield* assertMayAssign(company, agents, actingAs, [input.assigneeAgentId]);
        }
      }
      // A card belongs to the person or to an agent, never both, so taking it clears the other.
      const assignedToUser =
        input.assignedToUser ??
        (input.assigneeAgentId !== undefined && input.assigneeAgentId !== null ? false : undefined);
      const assigneeAgentId = assignedToUser === true ? null : input.assigneeAgentId;
      const statusChanged = yield* store.updateTask(input.id, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.position === undefined ? {} : { position: input.position }),
        ...(assigneeAgentId === undefined ? {} : { assigneeAgentId }),
        ...(assignedToUser === undefined ? {} : { assignedToUser }),
        ...(input.reviewerAgentId === undefined ? {} : { reviewerAgentId: input.reviewerAgentId }),
      });
      if (statusChanged && input.status !== undefined) {
        yield* systemComment(
          input.id,
          `${actorLabel(actingAs, actor)} moved this task from ${boardStatusLabel(before.status)} to ${boardStatusLabel(input.status)}.`,
        );
        if (input.status === "done" && before.parentTaskId !== null) {
          yield* resumeParentIfSubtasksDone(before.parentTaskId);
        }
      }
      yield* notify(company.id);
      return (yield* requireTask(input.id)).task;
    },
  );

  const deleteTask = Effect.fn("BoardService.deleteTask")(function* (id: BoardTaskId) {
    const current = yield* requireTask(id);
    yield* store.deleteTask(current.task);
    yield* notify(current.task.companyId);
  });

  const addComment: BoardService["Service"]["addComment"] = Effect.fn("BoardService.addComment")(
    function* (input, actor) {
      const current = yield* requireTask(input.taskId);
      const actingAs = yield* actingAgent(actor, current.task.companyId);
      const comment = yield* store.insertComment({
        taskId: input.taskId,
        authorKind: actor.kind === "user" ? "user" : "agent",
        authorAgentId: actingAs?.id ?? null,
        body: input.body,
      });
      // A person talking to a working agent reaches it now, in whichever thread is running;
      // with nobody working, the dispatch pass this change triggers starts a reply.
      const running =
        actor.kind === "user" && current.task.activeRunKind !== null
          ? (yield* store.listRunningRuns()).find(({ run }) => run.taskId === input.taskId)
          : undefined;
      if (running !== undefined) {
        yield* threads
          .sendToThread({
            projectId: current.task.projectId,
            commandId: CommandId.make(`board:comment:${comment.id}`),
            threadId: running.run.threadId,
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
      yield* notify(current.task.companyId);
      return comment;
    },
  );

  const linkWork: BoardService["Service"]["linkWork"] = Effect.fn("BoardService.linkWork")(
    function* (input, actor) {
      const current = yield* requireTask(input.taskId);
      const actingAs = yield* actingAgent(actor, current.task.companyId);
      if (actor.kind === "agent" && actingAs === null) {
        return yield* boardError("Only agents of this task's company can link work to it.");
      }
      const link = yield* store.upsertWorkLink({
        taskId: input.taskId,
        kind: input.kind,
        title: input.title,
        url: input.url,
        status: input.status ?? (input.kind === "pull_request" ? "open" : null),
        agentId: actingAs?.id ?? null,
      });
      yield* notify(current.task.companyId);
      return link;
    },
  );

  const deleteWorkLink = Effect.fn("BoardService.deleteWorkLink")(function* (id: BoardWorkLinkId) {
    const link = yield* store.getWorkLink(id);
    if (link === null) return;
    const current = yield* requireTask(link.taskId);
    yield* store.deleteWorkLink(id);
    yield* notify(current.task.companyId);
  });

  /** Landing a task's work approves it, so a task waiting in Review is done. */
  const markLanded = Effect.fn("BoardService.markLanded")(function* (
    task: BoardTask,
    landed: string,
  ) {
    if (task.status !== "review") {
      yield* systemComment(task.id, `${landed}.`);
      return;
    }
    yield* store.updateTask(task.id, { status: "done" });
    yield* systemComment(task.id, `${landed}; moved the task from Review to Done.`);
    if (task.parentTaskId !== null) yield* resumeParentIfSubtasksDone(task.parentTaskId);
  });

  /** Opens a pull request for a finished task's branch, or merges it into the project folder. */
  const shipTask = Effect.fn("BoardService.shipTask")(function* (
    id: BoardTaskId,
    method: BoardShipMethod,
  ) {
    const stored = yield* requireTask(id);
    const { task, branch } = stored;
    const allTasks = (yield* store.listTasks(task.companyId)).map((entry) => entry.task);
    const blocker = boardShipBlocker(task, allTasks);
    const { worktreePath, threadId } = task;
    if (blocker !== null || worktreePath === null || threadId === null || branch === null) {
      return yield* boardError(blocker ?? "This task has no branch recorded to ship.");
    }
    const gitAction = (action: "commit" | "commit_push_pr", failure: string) =>
      git
        .runStackedAction({
          actionId: `board-ship:${task.id}:${action}`,
          cwd: worktreePath,
          action,
          threadId,
          projectId: task.projectId,
        })
        .pipe(Effect.mapError((cause) => boardError(`${failure} ${cause.message}`, cause)));

    if (method === "pull_request") {
      const result = yield* gitAction("commit_push_pr", "Could not open a pull request.");
      const { url, number } = result.pr;
      if (url === undefined || number === undefined) {
        return yield* boardError(
          "The pull request was not opened. Open it from the task's thread.",
        );
      }
      // Linked to the task's thread, the pull request's state is synced like one opened from a
      // chat, and onPullRequestUpdated carries that state back to the board.
      const project = yield* projects
        .getShell(task.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      const key = createdPullRequestKey(result, Option.getOrUndefined(project));
      if (key !== null) {
        yield* threads
          .dispatch({
            type: "thread.pull-request.link",
            commandId: CommandId.make(`board-pr-link:${yield* store.newId("command")}`),
            threadId,
            ...key,
            source: "created",
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Could not link a board pull request to its thread", {
                taskId: task.id,
                cause,
              }),
            ),
          );
      }
      const link = yield* store.upsertWorkLink({
        taskId: task.id,
        kind: "pull_request",
        title: `#${number} ${result.pr.title ?? task.title}`,
        url,
        status: "open",
        agentId: null,
      });
      const into = result.pr.baseBranch === undefined ? "" : ` into ${result.pr.baseBranch}`;
      yield* systemComment(
        task.id,
        result.pr.status === "opened_existing"
          ? `The board found pull request #${number} already open for ${branch}.`
          : `The board opened pull request #${number} from ${branch}${into}.`,
      );
      yield* notify(task.companyId);
      return { task: (yield* requireTask(id)).task, link };
    }

    const project = yield* projects
      .getById(task.projectId)
      .pipe(Effect.mapError((cause) => boardError("Could not read the task's project.", cause)));
    if (Option.isNone(project)) return yield* boardError("The task's project no longer exists.");
    // Agents can stop with edits they never committed; those are part of the task's work.
    yield* gitAction("commit", "Could not commit the task's last changes.");
    const merged = yield* mergeTaskBranch({
      projectRoot: project.value.workspaceRoot,
      branch,
      baseRef: stored.baseRef,
      message: `Merge ${branch}: ${task.title}`,
    }).pipe(
      Effect.catchTags({
        GitCommandError: (cause) =>
          Effect.fail(boardError(`Could not merge ${branch}. ${cause.message}`, cause)),
      }),
    );
    const link = yield* store.upsertWorkLink({
      taskId: task.id,
      kind: "branch",
      title: branch,
      url: branch,
      status: "merged",
      agentId: null,
    });
    yield* markLanded(
      task,
      merged.alreadyMerged
        ? `${branch} was already in ${merged.into}`
        : `The board merged ${branch} into ${merged.into}`,
    );
    yield* notify(task.companyId);
    return { task: (yield* requireTask(id)).task, link };
  });

  /**
   * Keeps a task's linked pull requests in step with the PR sync of its thread, which also picks
   * up pull requests its agent opened on its own.
   */
  const onPullRequestUpdated = Effect.fn("BoardService.onPullRequestUpdated")(function* (
    threadId: ThreadId,
    pullRequest: ThreadPullRequestLink,
  ) {
    const { snapshot } = pullRequest;
    if (snapshot === null || pullRequest.source === "stack-dismissed") return;
    const running = yield* store.runForThread(threadId);
    const stored = running === null ? null : yield* store.getTask(running.run.taskId);
    // Only a task's own thread speaks for its branch; a manager reviews many tasks in one thread.
    if (stored === null || stored.task.threadId !== threadId) return;
    const { task } = stored;
    const status: BoardWorkLinkStatus =
      snapshot.state === "merged"
        ? "merged"
        : snapshot.state === "closed"
          ? "closed"
          : snapshot.isDraft
            ? "draft"
            : "open";
    const title = `#${pullRequest.number} ${snapshot.title}`;
    const existing = (yield* store.listWorkLinks(task.id)).find((link) => {
      if (link.kind !== "pull_request") return false;
      const parsed = sourceControlDefinitions.parseChangeRequestUrl(link.url)?.link ?? null;
      return parsed === null
        ? link.url === pullRequest.url
        : parsed.repository.toLowerCase() === pullRequest.repository.toLowerCase() &&
            parsed.number === pullRequest.number;
    });
    // Every sync emits this event, mostly with nothing new.
    if (existing?.status === status && existing.title === title) return;
    yield* store.upsertWorkLink({
      taskId: task.id,
      kind: "pull_request",
      title,
      url: existing?.url ?? pullRequest.url,
      status,
      agentId: null,
    });
    if (status === "merged" && existing?.status !== "merged") {
      yield* markLanded(task, `Pull request #${pullRequest.number} was merged`);
    }
    yield* notify(task.companyId);
  });

  const upsertRoutine = Effect.fn("BoardService.upsertRoutine")(function* (
    input: BoardRoutineUpsertInput,
  ) {
    const company = yield* requireCompany(input.companyId);
    yield* assertAgentsInCompany(yield* store.listAgents(company.id), [input.assigneeAgentId]);
    const existing = input.id === undefined ? null : yield* store.getRoutine(input.id);
    if (existing !== null && existing.companyId !== company.id) {
      return yield* boardError("That routine belongs to another company.");
    }
    const at = yield* store.now;
    const routine: BoardRoutine = {
      id: existing?.id ?? BoardRoutineId.make(yield* store.newId("board-routine")),
      companyId: company.id,
      title: input.title,
      description: input.description,
      assigneeAgentId: input.assignedToUser === true ? null : input.assigneeAgentId,
      assignedToUser: input.assignedToUser ?? false,
      everyDays: input.everyDays,
      nextRunAt: input.nextRunAt,
      enabled: input.enabled,
      lastTaskId: existing?.lastTaskId ?? null,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    yield* store.upsertRoutine(routine);
    yield* notify(company.id);
    return routine;
  });

  const deleteRoutine = Effect.fn("BoardService.deleteRoutine")(function* (id: BoardRoutineId) {
    const routine = yield* store.getRoutine(id);
    if (routine === null) return;
    yield* store.deleteRoutine(id);
    yield* notify(routine.companyId);
  });

  const createRoutineTask = Effect.fn("BoardService.createRoutineTask")(function* (
    routine: BoardRoutine,
  ) {
    const task = yield* createTask(
      {
        companyId: routine.companyId,
        title: routine.title,
        description: routine.description,
        assigneeAgentId: routine.assigneeAgentId,
        assignedToUser: routine.assignedToUser,
      },
      { kind: "user" },
    );
    yield* systemComment(task.id, `Created by the routine "${routine.title}".`);
    return task;
  });

  /** Creates the routine's task now, whatever its schedule says; the schedule is unchanged. */
  const runRoutineNow = Effect.fn("BoardService.runRoutineNow")(function* (id: BoardRoutineId) {
    const routine = yield* store.getRoutine(id);
    if (routine === null) return yield* boardError("That routine no longer exists.");
    const task = yield* createRoutineTask(routine);
    yield* store.upsertRoutine({ ...routine, lastTaskId: task.id, updatedAt: yield* store.now });
    yield* notify(routine.companyId);
    return task;
  });

  /**
   * Creates each due routine's task. A routine whose previous task is still open skips this
   * turn rather than piling up copies, and runs missed while the server was down collapse
   * into one.
   */
  const runDueRoutines = Effect.fn("BoardService.runDueRoutines")(function* () {
    const at = yield* store.now;
    for (const routine of yield* store.listDueRoutines(at)) {
      const previous =
        routine.lastTaskId === null ? null : yield* store.getTask(routine.lastTaskId);
      let lastTaskId = routine.lastTaskId;
      if (previous === null || previous.task.status === "done") {
        lastTaskId = (yield* createRoutineTask(routine)).id;
      }
      const period = routine.everyDays * 24 * 60 * 60 * 1000;
      let next = Date.parse(routine.nextRunAt);
      while (next <= Date.parse(at)) next += period;
      yield* store.upsertRoutine({
        ...routine,
        nextRunAt: DateTime.formatIso(DateTime.makeUnsafe(next)),
        lastTaskId,
        updatedAt: at,
      });
      yield* notify(routine.companyId);
    }
  });

  const updateSettings = Effect.fn("BoardService.updateSettings")(function* (
    input: BoardSettingsUpdateInput,
  ) {
    yield* requireCompany(input.companyId);
    const current = yield* store.getSettings(input.companyId);
    const next: BoardSettings = {
      ...current,
      ...(input.autoDispatch === undefined ? {} : { autoDispatch: input.autoDispatch }),
      ...(input.maxConcurrentRuns === undefined
        ? {}
        : { maxConcurrentRuns: input.maxConcurrentRuns }),
      ...(input.useWorktrees === undefined ? {} : { useWorktrees: input.useWorktrees }),
      ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      ...(input.monthlyTokenLimit === undefined
        ? {}
        : { monthlyTokenLimit: input.monthlyTokenLimit }),
    };
    yield* store.upsertSettings(next);
    yield* notify(input.companyId);
    return next;
  });

  const promptContext = Effect.fn("BoardService.promptContext")(function* (
    company: BoardCompany,
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
    const comments = yield* store.listComments(task.id);
    // Files attached to a task above this one are usually what its subtasks work on.
    const files = (yield* Effect.forEach([task, ...ancestors], (owner) =>
      store
        .listWorkLinks(owner.id)
        .pipe(
          Effect.map((links) =>
            links
              .filter((link) => link.kind === "file")
              .map((link) => ({ taskId: owner.id, taskTitle: owner.title, path: link.url })),
          ),
        ),
    )).flat();
    const boardComments = (yield* Effect.forEach([task, ...ancestors], (owner) =>
      (owner.id === task.id ? Effect.succeed(comments) : store.listComments(owner.id)).pipe(
        Effect.map((list) =>
          list
            .filter((comment) => comment.authorKind === "user")
            .map((comment) => ({
              taskId: owner.id,
              taskTitle: owner.title,
              body: comment.body,
              createdAt: comment.createdAt,
            })),
        ),
      ),
    ))
      .flat()
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
    return {
      company,
      agent,
      agents,
      skills: yield* store.listSkills(company.id),
      task,
      ancestors,
      subtasks: allTasks.filter((candidate) => candidate.parentTaskId === task.id),
      comments,
      boardComments,
      files,
    } satisfies BoardPromptContext;
  });

  const worktreeAvailable = Effect.fn("BoardService.worktreeAvailable")(function* (
    task: BoardTask,
    settings: BoardSettings,
  ) {
    if (!settings.useWorktrees) return false;
    // A project that is not a git repository, has no commit yet, or whose base ref no longer
    // resolves still gets its agent; it just shares the project checkout. checkWorktreeBase
    // lets the first two through, since it only checks base refs in a repository with commits.
    const project = yield* projects
      .getById(task.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return false;
    const hasCommit = yield* git
      .hasCommit({ cwd: project.value.workspaceRoot, refName: "HEAD" })
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasCommit) return false;
    return yield* threadLaunch
      .checkWorktreeBase({
        projectId: task.projectId,
        workspaceStrategy: { type: "worktree", baseRef: settings.baseRef },
      })
      .pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
  });

  /**
   * Where a card's work run happens: how to launch it there, how its prompt describes the
   * place, and the branch and base the card records once it starts.
   */
  const planWorkspace = Effect.fn("BoardService.planWorkspace")(function* (input: {
    readonly stored: BoardStore.StoredTask;
    readonly threadId: ThreadId;
    readonly allTasks: ReadonlyArray<BoardTask>;
    readonly settings: BoardSettings;
  }) {
    const { stored } = input;
    const task = stored.task;
    const parent = task.parentTaskId === null ? null : yield* store.getTask(task.parentTaskId);
    const siblings = input.allTasks.filter(
      (other) =>
        task.parentTaskId !== null &&
        other.parentTaskId === task.parentTaskId &&
        other.id !== task.id &&
        other.status !== "done",
    );
    const projectFolder = Effect.fn("BoardService.projectFolder")(function* () {
      const project = yield* projects
        .getById(task.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      return Option.match(project, { onNone: () => null, onSome: (found) => found.workspaceRoot });
    });
    const inProjectCheckout = Effect.fn("BoardService.inProjectCheckout")(function* () {
      const prompt: BoardWorkspace = {
        folder: yield* projectFolder(),
        branch: null,
        baseRef: null,
        owner: "project",
        sharedWith: input.allTasks.filter(
          (other) =>
            other.id !== task.id && other.activeRunKind !== null && other.worktreePath === null,
        ),
      };
      return prompt;
    });

    // Rework continues in the folder the card already has.
    if (task.threadId !== null) {
      const owner =
        task.worktreePath === null
          ? "project"
          : parent !== null && parent.task.worktreePath === task.worktreePath
            ? "parent"
            : "card";
      const prompt: BoardWorkspace =
        owner === "project"
          ? yield* inProjectCheckout()
          : {
              folder: task.worktreePath,
              branch: stored.branch,
              baseRef: stored.baseRef,
              owner,
              sharedWith: owner === "parent" ? siblings : [],
            };
      return { strategy: null, prompt, branch: stored.branch, baseRef: stored.baseRef };
    }
    // Subtasks work in their parent card's worktree, so the parent's branch ends up holding
    // the combined result for whoever finishes the parent.
    if (parent !== null && parent.task.worktreePath !== null) {
      return {
        strategy: { type: "existing_worktree", worktreePath: parent.task.worktreePath } as const,
        prompt: {
          folder: parent.task.worktreePath,
          branch: parent.branch,
          baseRef: parent.baseRef,
          owner: "parent",
          sharedWith: siblings,
        } satisfies BoardWorkspace,
        branch: parent.branch,
        baseRef: parent.baseRef,
      };
    }
    if (yield* worktreeAvailable(task, input.settings)) {
      // Naming the branch up front lets the prompt state it, and keeps it from being renamed
      // under the agent.
      const branch = cardBranchName(task, input.threadId);
      const baseRef = input.settings.baseRef;
      return {
        strategy: { type: "worktree", baseRef, branch } as const,
        prompt: {
          folder: null,
          branch,
          baseRef,
          owner: "card",
          sharedWith: [],
        } satisfies BoardWorkspace,
        branch,
        baseRef,
      };
    }
    return {
      strategy: { type: "root" } as const,
      prompt: yield* inProjectCheckout(),
      branch: null,
      baseRef: null,
    };
  });

  const startRun = Effect.fn("BoardService.startRun")(function* (input: {
    readonly company: BoardCompany;
    readonly stored: BoardStore.StoredTask;
    readonly kind: BoardRunKind;
    readonly agent: BoardAgent;
    readonly agents: ReadonlyArray<BoardAgent>;
    readonly allTasks: ReadonlyArray<BoardTask>;
    readonly settings: BoardSettings;
    /** For a reply: subtasks that became blocked since the task last ran. */
    readonly blockedSubtasks?: ReadonlyArray<BoardTask>;
    /** For a review: the reviewer's own thread on the parent task, to continue in. */
    readonly reviewThread?: ThreadId | null;
  }) {
    const { company, stored, kind, agent } = input;
    const task = stored.task;
    const context = yield* promptContext(company, task, agent, input.agents, input.allTasks);
    const attempt = (yield* store.countRuns(task.id)) + 1;
    const key = `${task.id}:${kind}:${attempt}`;
    const commandId = CommandId.make(`board:${key}`);
    const messageId = MessageId.make(`board-message:${key}`);

    // One thread per employee per task keeps context, so later messages carry only what is new.
    // Work and the assignee's replies share the task's thread in the task's workspace. A
    // subtask's review continues in the reviewer's thread on the parent, so a manager doesn't
    // open a thread for every subtask it checks.
    const ownsTaskThread = kind === "work" || agent.id === task.assigneeAgentId;
    const agentThread = yield* store.latestAgentThread(
      task.id,
      agent.id,
      kind === "review" ? "review" : undefined,
    );
    // A reassigned task's thread holds someone else's conversation; the new assignee starts
    // its own thread in the same workspace.
    const previousThread = ownsTaskThread
      ? task.threadId !== null && agentThread === task.threadId
        ? task.threadId
        : null
      : (input.reviewThread ?? agentThread);
    const reuseThread =
      previousThread !== null &&
      (yield* threads.getThreadShell(previousThread).pipe(
        Effect.map((shell) => shell !== null),
        Effect.orElseSucceed(() => false),
      ));
    const threadId = reuseThread
      ? (previousThread as ThreadId)
      : ThreadId.make(yield* store.newId("board-thread"));
    // Read before this run is recorded, so "since" means since the previous run.
    const replySince = kind === "reply" ? yield* store.lastRunEndedAt(task.id) : null;
    const reworkSince = yield* store.lastRunEndedAt(task.id, "work");
    const reviewSince = yield* store.lastRunEndedAt(task.id, "review");
    const workedBefore = (yield* store.lastRunStartedAt(task.id, "work")) !== null;
    const runId = yield* store.insertRun({ taskId: task.id, agentId: agent.id, threadId, kind });
    if (kind === "work") yield* store.updateTask(task.id, { status: "in_progress" });
    // A reply announces itself with the reply; a system line would only add noise.
    if (kind !== "reply") {
      const parentTitle = input.allTasks.find((other) => other.id === task.parentTaskId)?.title;
      const continuing = !reuseThread
        ? ""
        : threadId === input.reviewThread
          ? ` (in their thread for "${parentTitle ?? "the parent task"}")`
          : " (continuing in the same thread)";
      yield* systemComment(
        task.id,
        kind === "work"
          ? `${agent.name} started working${continuing}.`
          : `${agent.name} started reviewing${continuing}.`,
      );
    }
    yield* notify(company.id);

    const blocked: ReadonlyArray<BlockedSubtask> = yield* Effect.forEach(
      input.blockedSubtasks ?? [],
      (subtask) =>
        store.listComments(subtask.id).pipe(
          Effect.map((comments): BlockedSubtask => {
            const said = comments.filter((comment) => comment.authorKind !== "user");
            const reason =
              said.findLast((comment) => comment.authorKind === "agent") ?? said.at(-1) ?? null;
            return { task: subtask, reason: reason?.body ?? null };
          }),
        ),
    );
    const reviewWorkspace = {
      worktreePath: task.worktreePath,
      baseRef: stored.baseRef ?? (input.settings.useWorktrees ? input.settings.baseRef : null),
    };
    const launched = yield* Effect.exit(
      Effect.gen(function* () {
        const plan =
          ownsTaskThread && kind !== "review"
            ? yield* planWorkspace({
                stored,
                threadId,
                allTasks: input.allTasks,
                settings: input.settings,
              })
            : null;
        if (reuseThread) {
          yield* threads.sendToThread({
            projectId: task.projectId,
            commandId,
            threadId,
            messageId,
            text:
              kind === "reply"
                ? buildReplyPrompt(context, replySince, { freshThread: false, blocked })
                : kind === "review"
                  ? // Its earlier review of this task is already in this thread.
                    agentThread === threadId
                    ? buildReReviewPrompt(context, reviewSince, reviewWorkspace)
                    : buildReviewPrompt(context, reviewWorkspace, { freshThread: false })
                  : // A thread opened for a reply has not had the work prompt yet.
                    workedBefore
                    ? buildReworkPrompt(context, reworkSince, plan!.prompt)
                    : buildWorkPrompt(context, plan!.prompt),
            attachments: [],
            mode: "queue",
            createdBy: "system",
            creationSource: "server",
          });
          return null;
        }
        const workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy =
          plan?.strategy ??
          (task.worktreePath !== null
            ? { type: "existing_worktree", worktreePath: task.worktreePath }
            : { type: "root" });
        const prompt =
          kind === "reply"
            ? buildReplyPrompt(context, replySince, { freshThread: true, blocked })
            : kind === "review"
              ? buildReviewPrompt(context, reviewWorkspace, { freshThread: true })
              : buildWorkPrompt(context, plan!.prompt);
        const result = yield* threadLaunch.launch({
          commandId,
          threadId,
          projectId: task.projectId,
          title: `${kind === "review" ? `Review (${agent.name})` : agent.name}: ${task.title}`,
          generateTitle: false,
          modelSelection: agent.modelSelection,
          runtimeMode: agent.runtimeMode,
          interactionMode: "default",
          workspaceStrategy,
          initialMessage: { messageId, text: prompt, attachments: [] },
          createdBy: "system",
          creationSource: "server",
        });
        return {
          worktreePath: result.projection.thread.worktreePath,
          branch: result.projection.thread.branch ?? plan?.branch ?? null,
          baseRef: plan?.baseRef ?? null,
        };
      }),
    );

    if (launched._tag === "Failure") {
      yield* Effect.logWarning("Board could not start an agent", {
        taskId: task.id,
        cause: launched.cause,
      });
      yield* store.endRun(runId, "failed");
      if (kind === "reply") {
        yield* systemComment(
          task.id,
          `${agent.name} could not be started to reply. Check the agent's provider and model.`,
        );
        return;
      }
      yield* store.updateTask(task.id, { status: "blocked" });
      yield* systemComment(
        task.id,
        `${agent.name} could not be started. Check the agent's provider and model, then move the task back.`,
      );
      return;
    }
    if (ownsTaskThread && kind !== "review" && launched.value !== null) {
      yield* store.setTaskThread(task.id, threadId, launched.value);
      // The task's branch is the first thing people look for, so it is linked from the start.
      if (launched.value.branch !== null) {
        yield* store.upsertWorkLink({
          taskId: task.id,
          kind: "branch",
          title: launched.value.branch,
          url: launched.value.branch,
          status: null,
          agentId: null,
        });
      }
      yield* notify(company.id);
    }
  });

  /** Picks the agent that should run next on a card, or null when the card should wait. */
  const nextRunFor = Effect.fn("BoardService.nextRunFor")(function* (
    company: BoardCompany,
    stored: BoardStore.StoredTask,
    agents: ReadonlyArray<BoardAgent>,
    options: {
      readonly manual: boolean;
      /** Work and reviews wait for a free slot; replies do not. */
      readonly slotFree: boolean;
      readonly awaitingReply: boolean;
      readonly blockedSubtasks: ReadonlyArray<BoardTask>;
      /** Agents over a monthly limit are not started, even by hand. */
      readonly overLimit: (agent: BoardAgent) => boolean;
    },
  ) {
    const { manual } = options;
    const task = stored.task;
    // A person's own card is theirs alone: comments on it are notes, not questions for the CEO.
    if (task.activeRunKind !== null || task.assignedToUser) return null;
    const ready = (id: BoardAgentId | null) => {
      const agent = agents.find((candidate) => candidate.id === id);
      return agent === undefined || (agent.paused && !manual) || options.overLimit(agent)
        ? null
        : agent;
    };
    // Work and review prompts carry the board's comments, so they answer them too.
    if (task.status === "todo" && options.slotFree) {
      const agent = ready(task.assigneeAgentId);
      if (agent !== null) return { kind: "work" as const, agent };
    }
    if (task.status === "review" && options.slotFree) {
      // One review per visit to the Review column: a reviewer that ends without deciding
      // hands the card to a human instead of being restarted forever.
      const lastReview = yield* store.lastRunStartedAt(task.id, "review");
      const agent = ready(task.reviewerAgentId);
      if (
        agent !== null &&
        (lastReview === null || lastReview < stored.statusChangedAt || manual)
      ) {
        // A thread takes one run at a time, so a review bound for a busy parent-task thread
        // waits its turn there, unless a person asked for it now.
        const reviewThread =
          task.parentTaskId === null
            ? null
            : yield* store.latestAgentThread(task.parentTaskId, agent.id);
        const busy =
          reviewThread !== null &&
          (yield* store.runForThread(reviewThread))?.run.status === "running";
        if (!busy) return { kind: "review" as const, agent, reviewThread };
        if (manual) return { kind: "review" as const, agent, reviewThread: null };
      }
    }
    if (!options.awaitingReply && options.blockedSubtasks.length === 0) return null;
    // The task's owner answers; a task nobody owns goes to the CEO.
    const responder =
      ready(task.assigneeAgentId) ??
      (task.assigneeAgentId === null ? ready(company.ceoAgentId) : null);
    return responder === null
      ? null
      : { kind: "reply" as const, agent: responder, blockedSubtasks: options.blockedSubtasks };
  });

  const dispatchCompany = Effect.fn("BoardService.dispatchCompany")(function* (
    companyId: BoardCompanyId,
    options: { readonly onlyTaskId?: BoardTaskId } = {},
  ) {
    const company = yield* store.getCompany(companyId);
    if (company === null) return;
    const settings = yield* store.getSettings(companyId);
    if (!settings.autoDispatch && options.onlyTaskId === undefined) return;
    const agents = yield* store.listAgents(companyId);
    const tasks = yield* store.listTasks(companyId);
    const allTasks = tasks.map((stored) => stored.task);
    const awaitingReply = yield* store.listTasksAwaitingReply(companyId);
    const usage = yield* monthlyUsage(companyId, settings, agents);
    const blockedByParent = new Map<BoardTaskId, Array<BoardTask>>();
    for (const { parentId, taskId } of yield* store.listNewlyBlockedSubtasks(companyId)) {
      const subtask = allTasks.find((candidate) => candidate.id === taskId);
      if (subtask !== undefined) {
        blockedByParent.set(parentId, [...(blockedByParent.get(parentId) ?? []), subtask]);
      }
    }
    let slots = settings.maxConcurrentRuns - (yield* store.countRunningRuns(companyId));
    for (const stored of tasks) {
      if (options.onlyTaskId !== undefined && stored.task.id !== options.onlyTaskId) continue;
      const manual = options.onlyTaskId !== undefined;
      const next = yield* nextRunFor(company, stored, agents, {
        manual,
        slotFree: slots > 0 || manual,
        // A person or a stuck teammate is waiting on these, so they do not queue for a slot.
        awaitingReply: awaitingReply.has(stored.task.id),
        blockedSubtasks: blockedByParent.get(stored.task.id) ?? [],
        overLimit: (agent) => limitReached(usage, settings, agent) !== null,
      });
      if (next === null) continue;
      yield* startRun({ company, stored, ...next, agents, allTasks, settings });
      if (next.kind !== "reply") slots -= 1;
    }
  });

  // Every board change triggers a pass, and a pass only publishes a change when it starts a
  // run (inside startRun), so passes settle instead of feeding each other.
  const dispatch = (companyId: BoardCompanyId, options?: { readonly onlyTaskId?: BoardTaskId }) =>
    dispatchLock
      .withPermits(1)(dispatchCompany(companyId, options))
      .pipe(
        Effect.catch((cause) => Effect.logWarning("Board dispatch failed", { companyId, cause })),
      );

  const startTask = Effect.fn("BoardService.startTask")(function* (id: BoardTaskId) {
    const current = yield* requireTask(id);
    const task = current.task;
    if (task.activeRunKind !== null) {
      return yield* boardError("An agent is already working on this task.");
    }
    if (task.status === "done") return yield* boardError("Move the task out of Done to rework it.");
    if (task.assignedToUser) {
      return yield* boardError("This task is yours. Assign an agent to have it start the work.");
    }
    if (task.status === "review" && task.reviewerAgentId === null) {
      return yield* boardError("Set a reviewer before starting the review.");
    }
    if (task.status !== "review" && task.assigneeAgentId === null) {
      return yield* boardError("Assign an agent before starting the task.");
    }
    // Starting by hand explains a limit instead of quietly leaving the task waiting.
    const starter = yield* store.getAgent(
      (task.status === "review" ? task.reviewerAgentId : task.assigneeAgentId)!,
    );
    if (starter !== null) {
      const settings = yield* store.getSettings(task.companyId);
      const agents = yield* store.listAgents(task.companyId);
      const reason = limitReached(
        yield* monthlyUsage(task.companyId, settings, agents),
        settings,
        starter,
      );
      if (reason !== null) {
        return yield* boardError(`${reason} Raise it to start this task.`);
      }
    }
    if (task.status !== "review") {
      yield* updateTask({ id, status: "todo" }, { kind: "user" });
    }
    yield* dispatch(task.companyId, { onlyTaskId: id });
    return (yield* requireTask(id)).task;
  });

  /** Settles a card when the agent's thread has gone idle without moving it. */
  const settleRun = Effect.fn("BoardService.settleRun")(function* (
    running: BoardStore.RunningRun,
    runStatus: OrchestrationV2Run["status"],
  ) {
    const { run } = running;
    const succeeded = runStatus === "completed";
    yield* store.endRun(
      run.id,
      succeeded ? "completed" : runStatus === "failed" ? "failed" : "cancelled",
    );
    const stored = yield* store.getTask(run.taskId);
    if (stored === null) return;
    const name = (yield* store.getAgent(run.agentId))?.name ?? "The agent";
    if (run.kind === "work" && stored.task.status === "in_progress") {
      const next: BoardTaskStatus = succeeded ? "review" : "blocked";
      yield* store.updateTask(stored.task.id, { status: next });
      yield* systemComment(
        stored.task.id,
        succeeded
          ? `${name} finished without moving the task; moved it to Review.`
          : `${name}'s run ended (${runStatus}); moved the task to Blocked.`,
      );
    } else if (run.kind === "review" && stored.task.status === "review") {
      yield* systemComment(
        stored.task.id,
        `${name} finished reviewing without a decision; waiting for a human.`,
      );
    }
    // The published change starts the next pass; dispatching here would re-enter the lock.
    yield* notify(running.companyId);
  });

  const onRunUpdated = Effect.fn("BoardService.onRunUpdated")(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
  ) {
    if (!ThreadManagementService.isTerminalRunStatus(run.status)) return;
    const running = yield* store.runForThread(threadId);
    if (running === null || running.run.status !== "running") return;
    // A queued follow-up keeps the agent working; settle once the thread is idle.
    const shell = yield* threads.getThreadShell(threadId);
    if (shell !== null && shell.activeRunId !== null && shell.activeRunId !== run.id) return;
    yield* settleRun(running, run.status);
  });

  // Runs that ended while the server was down never produce a live event. Only runs left from
  // before this start count: one launched since may not have reached its thread yet.
  const leftoverRuns = yield* store.listRunningRuns();
  const settleLeftoverRun = Effect.fn("BoardService.settleLeftoverRun")(function* (
    leftover: BoardStore.RunningRun,
  ) {
    const running = yield* store.runForThread(leftover.run.threadId);
    if (running === null || running.run.id !== leftover.run.id) return;
    if (running.run.status !== "running") return;
    const shell = yield* threads.getThreadShell(running.run.threadId);
    if (shell !== null && shell.activeRunId !== null) return;
    yield* settleRun(running, shell?.status === "failed" ? "failed" : "completed");
  });
  const recoverRuns = Effect.fn("BoardService.recoverRuns")(function* () {
    for (const leftover of leftoverRuns) {
      yield* dispatchLock.withPermits(1)(settleLeftoverRun(leftover));
    }
    for (const companyId of yield* store.listCompanyIds()) yield* dispatch(companyId);
  });

  yield* forkParked(
    recoverRuns().pipe(
      Effect.catch((cause) => Effect.logWarning("Board run recovery failed", { cause })),
      Effect.andThen(
        Stream.runForEach(threads.streamDomainEvents, (event) => {
          switch (event.type) {
            case "run.updated":
              return dispatchLock
                .withPermits(1)(onRunUpdated(event.threadId, event.payload))
                .pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Board could not settle a run", {
                      threadId: event.threadId,
                      cause,
                    }),
                  ),
                );
            case "thread.pull-request-link-updated":
              return onPullRequestUpdated(event.threadId, event.payload).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Board could not sync a pull request", {
                    threadId: event.threadId,
                    cause,
                  }),
                ),
              );
            default:
              return Effect.void;
          }
        }),
      ),
    ),
  );

  // Routines are checked every minute; a task created a little late is fine.
  yield* forkParked(
    runDueRoutines().pipe(
      Effect.catch((cause) => Effect.logWarning("Board routines failed", { cause })),
      Effect.repeat(Schedule.spaced("1 minute")),
    ),
  );

  // Card changes from people and agents can make work startable. Subscribing here, before the
  // service is returned, means no change published after construction is missed.
  const dispatchTriggers = yield* PubSub.subscribe(changes);
  yield* forkParked(
    Stream.runForEach(Stream.fromSubscription(dispatchTriggers), (companyId) =>
      companyId === null ? Effect.void : dispatch(companyId),
    ),
  );

  const runCommand: BoardService["Service"]["runCommand"] = (command, actor) => {
    switch (command.type) {
      case "company.create":
        return createCompany(command.company).pipe(Effect.map((company) => ({ company })));
      case "company.update":
        return updateCompany(command.company).pipe(Effect.map((company) => ({ company })));
      case "company.delete":
        return deleteCompany(command.id).pipe(Effect.as({}));
      case "company.clone":
        return cloneCompany(command.company).pipe(Effect.map((company) => ({ company })));
      case "skill.upsert":
        return upsertSkill(command.skill).pipe(Effect.map((skill) => ({ skill })));
      case "skill.delete":
        return deleteSkill(command.id).pipe(Effect.as({}));
      case "agent.upsert":
        return upsertAgent(command.agent).pipe(Effect.map((agent) => ({ agent })));
      case "agent.delete":
        return deleteAgent(command.id).pipe(Effect.as({}));
      case "hire.decide":
        return decideHire(command.hire).pipe(
          Effect.map((agent) => (agent === null ? {} : { agent })),
        );
      case "task.create":
        return createTask(command.task, actor).pipe(Effect.map((task) => ({ task })));
      case "task.update":
        return updateTask(command.task, actor).pipe(Effect.map((task) => ({ task })));
      case "task.delete":
        return deleteTask(command.id).pipe(Effect.as({}));
      case "task.start":
        return startTask(command.id).pipe(Effect.map((task) => ({ task })));
      case "task.ship":
        return shipTask(command.id, command.method);
      case "comment.add":
        return addComment(command.comment, actor).pipe(Effect.map((comment) => ({ comment })));
      case "link.add":
        return linkWork({ ...command.link, status: null }, actor).pipe(Effect.as({}));
      case "link.delete":
        return deleteWorkLink(command.id).pipe(Effect.as({}));
      case "settings.update":
        return updateSettings(command.settings).pipe(Effect.map((settings) => ({ settings })));
      case "routine.upsert":
        return upsertRoutine(command.routine).pipe(Effect.map((routine) => ({ routine })));
      case "routine.delete":
        return deleteRoutine(command.id).pipe(Effect.as({}));
      case "routine.run":
        return runRoutineNow(command.id).pipe(Effect.map((task) => ({ task })));
    }
  };

  return BoardService.of({
    snapshot,
    subscribe,
    taskDetail,
    subscribeTaskDetail,
    dashboard,
    companiesForProject,
    createTask,
    updateTask,
    addComment,
    linkWork,
    requestHire,
    remember,
    rewriteMemory,
    searchCards,
    runCommand,
    assignmentForThread,
  });
});

export const layer = Layer.effect(BoardService, make);
