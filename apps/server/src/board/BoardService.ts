import {
  BoardAgentId,
  BoardCompanyId,
  BoardDepartmentId,
  BoardError,
  BoardSkillId,
  MAX_AGENT_MEMORY_CHARS,
  MAX_COMPANY_MEMORY_CHARS,
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
  type BoardCompanyCreateInput,
  type BoardCompanyUpdateInput,
  type BoardDepartment,
  type BoardHire,
  type BoardHireDecisionInput,
  type BoardRunKind,
  type BoardSettings,
  type BoardSettingsUpdateInput,
  type BoardSkill,
  type BoardSkillUpsertInput,
  type BoardSnapshot,
  type BoardTask,
  type BoardTaskCreateInput,
  type BoardTaskDetail,
  type BoardTaskId,
  type BoardTaskStatus,
  type BoardTaskUpdateInput,
  type OrchestrationV2Run,
  type ProjectId,
} from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as BoardStore from "./BoardStore.ts";
import { DEFAULT_DEPARTMENT_NAMES, assignableBy, createsReportingCycle } from "./boardOrg.ts";
import {
  boardStatusLabel,
  buildReviewPrompt,
  buildReworkPrompt,
  buildUserCommentMessage,
  buildWorkPrompt,
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
    readonly subscribe: (
      companyId: BoardCompanyId | null,
    ) => Stream.Stream<BoardSnapshot, BoardError>;
    readonly taskDetail: (taskId: BoardTaskId) => Effect.Effect<BoardTaskDetail, BoardError>;
    readonly subscribeTaskDetail: (
      taskId: BoardTaskId,
    ) => Stream.Stream<BoardTaskDetail, BoardError>;
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

function boardError(message: string, cause?: unknown): BoardError {
  return new BoardError({ message, ...(cause === undefined ? {} : { cause }) });
}

const make = Effect.gen(function* () {
  const store = yield* BoardStore.BoardStore;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projectFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;

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
    if (stored === null) return yield* boardError(`Board card ${id} was not found.`);
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
        } satisfies BoardSnapshot;
      }
      return {
        companies,
        company,
        settings: yield* store.getSettings(company.id),
        agents: yield* store.listAgents(company.id),
        skills: yield* store.listSkills(company.id),
        hires: yield* store.listHires(company.id),
        tasks: (yield* store.listTasks(company.id)).map((stored) => stored.task),
        threads: yield* store.listAgentThreads(company.id),
      } satisfies BoardSnapshot;
    },
  );

  const subscribe: BoardService["Service"]["subscribe"] = (companyId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the first snapshot so a change in between is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(snapshot(companyId)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === null || changed === companyId),
            Stream.mapEffect(() => snapshot(companyId)),
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

  const createCompany = Effect.fn("BoardService.createCompany")(function* (
    input: BoardCompanyCreateInput,
  ) {
    const projectId: ProjectId =
      input.workspace.type === "existing"
        ? input.workspace.projectId
        : (yield* projectFolders
            .createNamedProject({ name: input.workspace.folderName })
            .pipe(
              Effect.mapError((cause) =>
                boardError("Could not create the company's project folder.", cause),
              ),
            )).projectId;
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
    const next: BoardCompany = {
      ...current,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.mission === undefined ? {} : { mission: input.mission }),
      ...(input.memory === undefined ? {} : { memory: input.memory }),
      ...(input.departments === undefined
        ? {}
        : { departments: yield* nextDepartments(current, input.departments) }),
      updatedAt: yield* store.now,
    };
    if (next.memory.length > MAX_COMPANY_MEMORY_CHARS) {
      return yield* boardError(
        `Company memory is limited to ${MAX_COMPANY_MEMORY_CHARS} characters.`,
      );
    }
    yield* store.updateCompany(next);
    yield* notify(null);
    return next;
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
      yield* store.decideHire(hire.id, "rejected");
      yield* notify(hire.companyId);
      return null;
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
    yield* store.decideHire(hire.id, "approved");
    yield* notify(company.id);
    return agent;
  });

  const requestHire: BoardService["Service"]["requestHire"] = Effect.fn("BoardService.requestHire")(
    function* (input, actor) {
      const company = yield* requireCompany(input.companyId);
      const agents = yield* store.listAgents(company.id);
      const actingAs = yield* actingAgent(actor, company.id);
      const reportsToAgentId = input.reportsToAgentId ?? actingAs?.id ?? company.ceoAgentId;
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
          return yield* boardError("A subtask must belong to its parent card's company.");
        }
      }
      const assigneeAgentId = input.assigneeAgentId ?? null;
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
        status: input.status ?? (assigneeAgentId !== null ? "todo" : "backlog"),
        assigneeAgentId,
        reviewerAgentId,
        parentTaskId: input.parentTaskId ?? null,
        createdByAgentId: actingAs?.id ?? null,
      });
      if (actor.kind === "agent") {
        yield* systemComment(id, `Created by ${actorLabel(actingAs, actor)}.`);
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
      return yield* boardError("Only company agents working a card have a memory.");
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
          "Only the CEO and managers write company memory. Keep it in your own memory, or comment on your card so your manager can record it.",
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
      const note = input.note.trim().replaceAll("\n", " ");
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
            "You can only change cards you work on, review, created, or that belong to your reports.",
          );
        }
        if (input.assigneeAgentId !== undefined) {
          yield* assertMayAssign(company, agents, actingAs, [input.assigneeAgentId]);
        }
      }
      const statusChanged = yield* store.updateTask(input.id, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.position === undefined ? {} : { position: input.position }),
        ...(input.assigneeAgentId === undefined ? {} : { assigneeAgentId: input.assigneeAgentId }),
        ...(input.reviewerAgentId === undefined ? {} : { reviewerAgentId: input.reviewerAgentId }),
      });
      if (statusChanged && input.status !== undefined) {
        yield* systemComment(
          input.id,
          `${actorLabel(actingAs, actor)} moved this card from ${boardStatusLabel(before.status)} to ${boardStatusLabel(input.status)}.`,
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
      yield* notify(current.task.companyId);
      return comment;
    },
  );

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
    return {
      company,
      agent,
      agents,
      skills: yield* store.listSkills(company.id),
      task,
      ancestors,
      subtasks: allTasks.filter((candidate) => candidate.parentTaskId === task.id),
      comments: yield* store.listComments(task.id),
    } satisfies BoardPromptContext;
  });

  const worktreeAvailable = Effect.fn("BoardService.worktreeAvailable")(function* (
    task: BoardTask,
    settings: BoardSettings,
  ) {
    if (!settings.useWorktrees) return false;
    // A project that is not a git repository, or a base ref that no longer resolves, still
    // gets its agent; it just shares the project checkout.
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
  }) {
    const { company, stored, kind, agent } = input;
    const task = stored.task;
    const context = yield* promptContext(company, task, agent, input.agents, input.allTasks);
    const attempt = (yield* store.countRuns(task.id)) + 1;
    const key = `${task.id}:${kind}:${attempt}`;
    const commandId = CommandId.make(`board:${key}`);
    const messageId = MessageId.make(`board-message:${key}`);

    // Rework continues the assignee's own thread so it keeps its context.
    const reuseThread = kind === "work" && task.threadId !== null;
    const threadId = reuseThread
      ? (task.threadId as ThreadId)
      : ThreadId.make(yield* store.newId("board-thread"));
    const runId = yield* store.insertRun({ taskId: task.id, agentId: agent.id, threadId, kind });
    if (kind === "work") yield* store.updateTask(task.id, { status: "in_progress" });
    yield* systemComment(
      task.id,
      kind === "work"
        ? `${agent.name} started working${reuseThread ? " (continuing in the same thread)" : ""}.`
        : `${agent.name} started reviewing.`,
    );
    yield* notify(company.id);

    const launched = yield* Effect.exit(
      Effect.gen(function* () {
        const plan =
          kind === "work"
            ? yield* planWorkspace({
                stored,
                threadId,
                allTasks: input.allTasks,
                settings: input.settings,
              })
            : null;
        if (reuseThread) {
          const since = yield* store.lastRunEndedAt(task.id, "work");
          yield* threads.sendToThread({
            projectId: task.projectId,
            commandId,
            threadId,
            messageId,
            text: buildReworkPrompt(context, since, plan!.prompt),
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
          plan !== null
            ? buildWorkPrompt(context, plan.prompt)
            : buildReviewPrompt(context, {
                worktreePath: task.worktreePath,
                baseRef:
                  stored.baseRef ?? (input.settings.useWorktrees ? input.settings.baseRef : null),
              });
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
      yield* store.updateTask(task.id, { status: "blocked" });
      yield* systemComment(
        task.id,
        `${agent.name} could not be started. Check the agent's provider and model, then move the card back.`,
      );
      return;
    }
    if (kind === "work" && !reuseThread && launched.value !== null) {
      yield* store.setTaskThread(task.id, threadId, launched.value);
      yield* notify(company.id);
    }
  });

  /** Picks the agent that should run next on a card, or null when the card should wait. */
  const nextRunFor = Effect.fn("BoardService.nextRunFor")(function* (
    stored: BoardStore.StoredTask,
    agents: ReadonlyArray<BoardAgent>,
    manual: boolean,
  ) {
    const task = stored.task;
    if (task.activeRunKind !== null) return null;
    const ready = (id: BoardAgentId | null) => {
      const agent = agents.find((candidate) => candidate.id === id);
      return agent === undefined || (agent.paused && !manual) ? null : agent;
    };
    if (task.status === "todo") {
      const agent = ready(task.assigneeAgentId);
      return agent === null ? null : { kind: "work" as const, agent };
    }
    if (task.status === "review") {
      // One review per visit to the Review column: a reviewer that ends without deciding
      // hands the card to a human instead of being restarted forever.
      const lastReview = yield* store.lastRunStartedAt(task.id, "review");
      if (lastReview !== null && lastReview >= stored.statusChangedAt && !manual) return null;
      const agent = ready(task.reviewerAgentId);
      return agent === null ? null : { kind: "review" as const, agent };
    }
    return null;
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
    let slots = settings.maxConcurrentRuns - (yield* store.countRunningRuns(companyId));
    for (const stored of tasks) {
      if (options.onlyTaskId !== undefined && stored.task.id !== options.onlyTaskId) continue;
      if (slots <= 0 && options.onlyTaskId === undefined) break;
      const next = yield* nextRunFor(stored, agents, options.onlyTaskId !== undefined);
      if (next === null) continue;
      yield* startRun({ company, stored, ...next, agents, allTasks, settings });
      slots -= 1;
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
      return yield* boardError("An agent is already working on this card.");
    }
    if (task.status === "done") return yield* boardError("Move the card out of Done to rework it.");
    if (task.status === "review" && task.reviewerAgentId === null) {
      return yield* boardError("Set a reviewer before starting the review.");
    }
    if (task.status !== "review" && task.assigneeAgentId === null) {
      return yield* boardError("Assign an agent before starting the card.");
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
          ? `${name} finished without moving the card; moved it to Review.`
          : `${name}'s run ended (${runStatus}); moved the card to Blocked.`,
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

  // Runs that ended while the server was down never produce a live event.
  const recoverRuns = Effect.fn("BoardService.recoverRuns")(function* () {
    for (const running of yield* store.listRunningRuns()) {
      const shell = yield* threads.getThreadShell(running.run.threadId);
      if (shell !== null && shell.activeRunId !== null) continue;
      yield* settleRun(running, shell?.status === "failed" ? "failed" : "completed");
    }
    for (const companyId of yield* store.listCompanyIds()) yield* dispatch(companyId);
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
      case "comment.add":
        return addComment(command.comment, actor).pipe(Effect.map((comment) => ({ comment })));
      case "settings.update":
        return updateSettings(command.settings).pipe(Effect.map((settings) => ({ settings })));
    }
  };

  return BoardService.of({
    snapshot,
    subscribe,
    taskDetail,
    subscribeTaskDetail,
    companiesForProject,
    createTask,
    updateTask,
    addComment,
    requestHire,
    remember,
    rewriteMemory,
    searchCards,
    runCommand,
    assignmentForThread,
  });
});

export const layer = Layer.effect(BoardService, make);
