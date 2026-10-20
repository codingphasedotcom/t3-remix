import {
  BoardAgentId,
  BoardComment,
  BoardRunKind,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
  OrchestratorMcpFailure,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const ProjectIdParam = Schema.optional(ProjectId).annotate({
  description: "Project whose board to use. Defaults to the calling thread's project.",
});

const BoardAgentSummary = Schema.Struct({
  id: BoardAgentId,
  name: Schema.String,
  role: Schema.String,
});

const BoardCaller = Schema.NullOr(
  Schema.Struct({
    agentId: BoardAgentId,
    taskId: BoardTaskId,
    kind: BoardRunKind,
  }),
).annotate({
  description: "The card and role this thread was started for, or null for an ordinary thread.",
});

const BoardListAgentsTool = Tool.make("board_list_agents", {
  ...shared,
  description:
    "List the agents on the board team with their ids and roles. Use an id to assign or review a card.",
  // No `parameters`: the default empty params serialize as an object root.
  success: Schema.Struct({ agents: Schema.Array(BoardAgentSummary), you: BoardCaller }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const BoardListTasksTool = Tool.make("board_list_tasks", {
  ...shared,
  description:
    "List cards on the project's agent board, ordered by column position. Filter by column or assignee.",
  parameters: Schema.Struct({
    projectId: ProjectIdParam,
    status: Schema.optional(BoardTaskStatus),
    assigneeAgentId: Schema.optional(BoardAgentId).annotate({
      description: "Only cards assigned to this agent.",
    }),
  }),
  success: Schema.Struct({ tasks: Schema.Array(BoardTask), you: BoardCaller }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const BoardReadTaskTool = Tool.make("board_read_task", {
  ...shared,
  description:
    "Read one card with its comments, parent, and subtasks. Omit taskId to read the card this thread was started for.",
  parameters: Schema.Struct({ taskId: Schema.optional(BoardTaskId) }),
  success: Schema.Struct({
    task: BoardTask,
    comments: Schema.Array(BoardComment),
    parent: Schema.NullOr(BoardTask),
    subtasks: Schema.Array(BoardTask),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const BoardCreateTaskTool = Tool.make("board_create_task", {
  ...shared,
  description:
    'Create a card. Set parentTaskId to split your card into subtasks. A card created in "todo" with an assignee starts that agent automatically; "backlog" waits for a human.',
  parameters: Schema.Struct({
    projectId: ProjectIdParam,
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String).annotate({
      description: "What done looks like, with any context the assignee needs.",
    }),
    parentTaskId: Schema.optional(BoardTaskId),
    assigneeAgentId: Schema.optional(BoardAgentId),
    reviewerAgentId: Schema.optional(BoardAgentId),
    status: Schema.optional(Schema.Literals(["backlog", "todo"])),
  }),
  success: Schema.Struct({ task: BoardTask }),
}).annotate(Tool.Destructive, false);

const BoardUpdateTaskTool = Tool.make("board_update_task", {
  ...shared,
  description:
    'Move a card or edit it. Move your own card to "review" when done, "blocked" when stuck. Reviewers move cards to "done" to approve or "todo" to request changes.',
  parameters: Schema.Struct({
    taskId: BoardTaskId,
    status: Schema.optional(BoardTaskStatus),
    title: Schema.optional(TrimmedNonEmptyString),
    description: Schema.optional(Schema.String),
    assigneeAgentId: Schema.optional(Schema.NullOr(BoardAgentId)),
    reviewerAgentId: Schema.optional(Schema.NullOr(BoardAgentId)),
  }),
  success: Schema.Struct({ task: BoardTask }),
}).annotate(Tool.Destructive, false);

const BoardAddCommentTool = Tool.make("board_add_comment", {
  ...shared,
  description:
    "Add a comment to a card: progress, decisions, review findings, or questions for humans and teammates. Omit taskId to comment on this thread's card.",
  parameters: Schema.Struct({
    taskId: Schema.optional(BoardTaskId),
    body: TrimmedNonEmptyString,
  }),
  success: Schema.Struct({ comment: BoardComment }),
}).annotate(Tool.Destructive, false);

export const BoardToolkit = Toolkit.make(
  BoardListAgentsTool,
  BoardListTasksTool,
  BoardReadTaskTool,
  BoardCreateTaskTool,
  BoardUpdateTaskTool,
  BoardAddCommentTool,
);
