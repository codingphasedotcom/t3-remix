import {
  OrchestratorMcpFailure,
  type BoardError,
  type BoardTaskId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as BoardService from "../../../board/BoardService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, resolveProjectId } from "../../threadAccess.ts";
import { BoardToolkit } from "./tools.ts";

const boardFailure = (error: BoardError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const make = Effect.gen(function* () {
  const board = yield* BoardService.BoardService;

  const callerContext = Effect.fn("mcp.board.callerContext")(function* (projectId?: ProjectId) {
    const context = yield* readCaller();
    const resolvedProjectId = yield* resolveProjectId(context, projectId);
    const assignment =
      context.caller === undefined
        ? null
        : yield* board.assignmentForThread(context.caller.id).pipe(Effect.mapError(boardFailure));
    return { context, projectId: resolvedProjectId, assignment };
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
    const { assignment } = yield* callerContext();
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

  return {
    board_list_agents: McpToolAccess.reads(() =>
      Effect.gen(function* () {
        const context = yield* readCaller();
        const assignment =
          context.caller === undefined
            ? null
            : yield* board
                .assignmentForThread(context.caller.id)
                .pipe(Effect.mapError(boardFailure));
        const agents = yield* board.listAgents().pipe(Effect.mapError(boardFailure));
        return {
          agents: agents.map((agent) => ({ id: agent.id, name: agent.name, role: agent.role })),
          you: you(assignment),
        };
      }),
    ),

    board_list_tasks: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { projectId, assignment } = yield* callerContext(input.projectId);
        const snapshot = yield* board.snapshot(projectId).pipe(Effect.mapError(boardFailure));
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
        const snapshot = yield* board
          .snapshot(detail.task.projectId)
          .pipe(Effect.mapError(boardFailure));
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
        const { projectId } = yield* callerContext(input.projectId);
        const task = yield* board
          .createTask(
            {
              projectId,
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
  } satisfies McpToolAccess.Handlers<typeof BoardToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(BoardToolkit, make);
