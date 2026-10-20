import {
  OrchestratorMcpFailure,
  type BoardCompanyId,
  type BoardError,
  type BoardTaskId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as BoardService from "../../../board/BoardService.ts";
import { assignableBy } from "../../../board/boardOrg.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { BoardToolkit } from "./tools.ts";

const boardFailure = (error: BoardError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const make = Effect.gen(function* () {
  const board = yield* BoardService.BoardService;

  /**
   * The board a tool call means: the one named, else the company of the caller's card, else
   * the only company working in the caller's project.
   */
  const callerContext = Effect.fn("mcp.board.callerContext")(function* (
    companyId?: BoardCompanyId,
  ) {
    const context = yield* readCaller();
    const assignment =
      context.caller === undefined
        ? null
        : yield* board.assignmentForThread(context.caller.id).pipe(Effect.mapError(boardFailure));
    if (companyId !== undefined) return { context, companyId, assignment };
    if (assignment !== null) return { context, companyId: assignment.companyId, assignment };
    const candidates =
      context.caller === undefined
        ? []
        : yield* board
            .companiesForProject(context.caller.projectId)
            .pipe(Effect.mapError(boardFailure));
    const [only] = candidates;
    if (candidates.length === 1 && only !== undefined) {
      return { context, companyId: only, assignment };
    }
    return yield* new OrchestratorMcpFailure({
      code: "target_required",
      message:
        candidates.length === 0
          ? "Pass companyId: no company works in this project."
          : `Pass companyId: several companies work in this project (${candidates.join(", ")}).`,
    });
  });

  const actor = Effect.fn("mcp.board.actor")(function* () {
    const context = yield* readCaller();
    if (context.caller === undefined) {
      return yield* new OrchestratorMcpFailure({
        code: "thread_credential_required",
        message: "Board changes must come from an agent running in a T3 thread.",
      });
    }
    return { kind: "agent", threadId: context.caller.id } as const;
  });

  const ownTaskId = Effect.fn("mcp.board.ownTaskId")(function* (taskId: BoardTaskId | undefined) {
    if (taskId !== undefined) return taskId;
    const context = yield* readCaller();
    const assignment =
      context.caller === undefined
        ? null
        : yield* board.assignmentForThread(context.caller.id).pipe(Effect.mapError(boardFailure));
    if (assignment === null) {
      return yield* new OrchestratorMcpFailure({
        code: "target_required",
        message: "Pass taskId: this thread was not started for a board card.",
      });
    }
    return assignment.taskId;
  });

  const you = (assignment: BoardService.BoardAssignment | null) =>
    assignment === null
      ? null
      : { agentId: assignment.agentId, taskId: assignment.taskId, kind: assignment.kind };

  const companyBoard = Effect.fn("mcp.board.companyBoard")(function* (companyId: BoardCompanyId) {
    const snapshot = yield* board.snapshot(companyId).pipe(Effect.mapError(boardFailure));
    if (snapshot.company === null) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `Company ${companyId} was not found.`,
      });
    }
    return { ...snapshot, company: snapshot.company };
  });

  return {
    board_list_agents: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { companyId, assignment } = yield* callerContext(input.companyId);
        const snapshot = yield* companyBoard(companyId);
        const me =
          assignment === null || assignment.companyId !== companyId
            ? undefined
            : snapshot.agents.find((agent) => agent.id === assignment.agentId);
        const skillName = (id: string) => snapshot.skills.find((skill) => skill.id === id)?.name;
        return {
          company: {
            id: snapshot.company.id,
            name: snapshot.company.name,
            mission: snapshot.company.mission,
          },
          ceoAgentId: snapshot.company.ceoAgentId,
          agents: snapshot.agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            title: agent.title,
            reportsToAgentId: agent.reportsToAgentId,
            skills: agent.skillIds.map(skillName).filter((name) => name !== undefined),
            paused: agent.paused,
          })),
          skills: snapshot.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
          })),
          you: you(assignment),
          canAssignTo: (me === undefined
            ? snapshot.agents
            : assignableBy(snapshot.company, snapshot.agents, me)
          ).map((agent) => agent.id),
        };
      }),
    ),

    board_list_tasks: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { companyId, assignment } = yield* callerContext(input.companyId);
        const snapshot = yield* companyBoard(companyId);
        const tasks = snapshot.tasks.filter(
          (task) =>
            (input.status === undefined || task.status === input.status) &&
            (input.assigneeAgentId === undefined || task.assigneeAgentId === input.assigneeAgentId),
        );
        return { tasks, you: you(assignment) };
      }),
    ),

    board_read_task: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const taskId = yield* ownTaskId(input.taskId);
        const detail = yield* board.taskDetail(taskId).pipe(Effect.mapError(boardFailure));
        const snapshot = yield* companyBoard(detail.task.companyId);
        return {
          task: detail.task,
          comments: detail.comments,
          parent: snapshot.tasks.find((task) => task.id === detail.task.parentTaskId) ?? null,
          subtasks: snapshot.tasks.filter((task) => task.parentTaskId === detail.task.id),
        };
      }),
    ),

    board_create_task: McpToolAccess.writes((input) =>
      Effect.gen(function* () {
        const { companyId } = yield* callerContext(input.companyId);
        const task = yield* board
          .createTask(
            {
              companyId,
              title: input.title,
              ...(input.description === undefined ? {} : { description: input.description }),
              ...(input.parentTaskId === undefined ? {} : { parentTaskId: input.parentTaskId }),
              ...(input.assigneeAgentId === undefined
                ? {}
                : { assigneeAgentId: input.assigneeAgentId }),
              ...(input.reviewerAgentId === undefined
                ? {}
                : { reviewerAgentId: input.reviewerAgentId }),
              ...(input.status === undefined ? {} : { status: input.status }),
            },
            yield* actor(),
          )
          .pipe(Effect.mapError(boardFailure));
        return { task };
      }),
    ),

    board_update_task: McpToolAccess.writes((input) =>
      Effect.gen(function* () {
        const task = yield* board
          .updateTask(
            {
              id: input.taskId,
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.description === undefined ? {} : { description: input.description }),
              ...(input.assigneeAgentId === undefined
                ? {}
                : { assigneeAgentId: input.assigneeAgentId }),
              ...(input.reviewerAgentId === undefined
                ? {}
                : { reviewerAgentId: input.reviewerAgentId }),
            },
            yield* actor(),
          )
          .pipe(Effect.mapError(boardFailure));
        return { task };
      }),
    ),

    board_add_comment: McpToolAccess.writes((input) =>
      Effect.gen(function* () {
        const taskId = yield* ownTaskId(input.taskId);
        const comment = yield* board
          .addComment({ taskId, body: input.body }, yield* actor())
          .pipe(Effect.mapError(boardFailure));
        return { comment };
      }),
    ),

    board_request_hire: McpToolAccess.writes((input) =>
      Effect.gen(function* () {
        const { companyId } = yield* callerContext(input.companyId);
        const hire = yield* board
          .requestHire(
            {
              companyId,
              name: input.name,
              title: input.title,
              reportsToAgentId: input.reportsToAgentId ?? null,
              skillIds: input.skillIds ?? [],
              instructions: input.instructions,
              reason: input.reason,
            },
            yield* actor(),
          )
          .pipe(Effect.mapError(boardFailure));
        return { hire };
      }),
    ),

    board_remember: McpToolAccess.writes((input) =>
      Effect.gen(function* () {
        return yield* board
          .remember({ scope: input.scope ?? "self", note: input.note }, yield* actor())
          .pipe(Effect.mapError(boardFailure));
      }),
    ),

    board_rewrite_memory: McpToolAccess.writes((input) =>
      Effect.gen(function* () {
        return yield* board
          .rewriteMemory({ scope: input.scope ?? "self", content: input.content }, yield* actor())
          .pipe(Effect.mapError(boardFailure));
      }),
    ),

    board_search_cards: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { companyId } = yield* callerContext(input.companyId);
        const matches = yield* board
          .searchCards(companyId, input.query)
          .pipe(Effect.mapError(boardFailure));
        return { matches };
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof BoardToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(BoardToolkit, make);
