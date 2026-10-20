import {
  BoardAgentId,
  BoardComment,
  BoardCompanyId,
  BoardHire,
  BoardRunKind,
  BoardSkillId,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
  OrchestratorMcpFailure,
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

const CompanyIdParam = Schema.optional(BoardCompanyId).annotate({
  description:
    "Company whose board to use. Defaults to the company of the card this thread works on.",
});

const BoardCaller = Schema.NullOr(
  Schema.Struct({
    agentId: BoardAgentId,
    taskId: BoardTaskId,
    kind: BoardRunKind,
  }),
).annotate({
  description: "Who you are on this board and which card started you; null for an ordinary thread.",
});

const OrgMember = Schema.Struct({
  id: BoardAgentId,
  name: Schema.String,
  title: Schema.String,
  reportsToAgentId: Schema.NullOr(BoardAgentId),
  skills: Schema.Array(Schema.String),
  paused: Schema.Boolean,
});

const SkillSummary = Schema.Struct({
  id: BoardSkillId,
  name: Schema.String,
  description: Schema.String,
});

const BoardListAgentsTool = Tool.make("board_list_agents", {
  ...shared,
  description:
    "Show the company's org chart: every agent with title, manager, and skills, the skills library, who you are, and who you may assign work to.",
  parameters: Schema.Struct({ companyId: CompanyIdParam }),
  success: Schema.Struct({
    company: Schema.Struct({ id: BoardCompanyId, name: Schema.String, mission: Schema.String }),
    ceoAgentId: Schema.NullOr(BoardAgentId),
    agents: Schema.Array(OrgMember),
    skills: Schema.Array(SkillSummary),
    you: BoardCaller,
    canAssignTo: Schema.Array(BoardAgentId),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const BoardListTasksTool = Tool.make("board_list_tasks", {
  ...shared,
  description:
    "List cards on the company's board, ordered by column position. Filter by column or assignee.",
  parameters: Schema.Struct({
    companyId: CompanyIdParam,
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
    'Create a card. Set parentTaskId to split your card into subtasks and assign someone in your reporting line. A card in "todo" with an assignee starts that agent right away; you review it unless you name another reviewer. "backlog" waits for a human.',
  parameters: Schema.Struct({
    companyId: CompanyIdParam,
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
    'Move or edit a card. Move your own card to "review" when done, "blocked" when stuck or waiting on subtasks. Reviewers move cards to "done" to approve or "todo" to request changes.',
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
    "Add a comment to a card: progress, decisions, review findings, or questions for the board and teammates. Omit taskId to comment on this thread's card.",
  parameters: Schema.Struct({
    taskId: Schema.optional(BoardTaskId),
    body: TrimmedNonEmptyString,
  }),
  success: Schema.Struct({ comment: BoardComment }),
}).annotate(Tool.Destructive, false);

const BoardRequestHireTool = Tool.make("board_request_hire", {
  ...shared,
  description:
    "Ask the board to add an agent to your team when the work needs a role nobody has. A human approves or rejects it in the app; the agent does not exist until then.",
  parameters: Schema.Struct({
    companyId: CompanyIdParam,
    name: TrimmedNonEmptyString,
    title: TrimmedNonEmptyString.annotate({ description: "Job title, such as Frontend engineer." }),
    reportsToAgentId: Schema.optional(BoardAgentId).annotate({
      description: "Their manager; defaults to you.",
    }),
    skillIds: Schema.optional(Schema.Array(BoardSkillId)).annotate({
      description: "Skills from the company library (board_list_agents lists them).",
    }),
    instructions: Schema.String.annotate({
      description: "Standing instructions: what they own and how they should work.",
    }),
    reason: TrimmedNonEmptyString.annotate({ description: "Why the team needs this person." }),
  }),
  success: Schema.Struct({ hire: BoardHire }),
}).annotate(Tool.Destructive, false);

const MemoryScope = Schema.Literals(["self", "company"]).annotate({
  description: '"self" for your own memory; "company" (managers only) for team-wide decisions.',
});

const MemoryResult = Schema.Struct({
  memory: Schema.String,
  remaining: Schema.Int.annotate({ description: "Characters left before the memory is full." }),
});

const BoardRememberTool = Tool.make("board_remember", {
  ...shared,
  description:
    "Save a lasting lesson to memory so future cards start with it: a convention, a command, a gotcha, or the board's preference. Not a log of this card.",
  parameters: Schema.Struct({
    scope: Schema.optional(MemoryScope),
    note: TrimmedNonEmptyString.annotate({ description: "One short, self-contained lesson." }),
  }),
  success: MemoryResult,
}).annotate(Tool.Destructive, false);

const BoardRewriteMemoryTool = Tool.make("board_rewrite_memory", {
  ...shared,
  description:
    "Replace a memory with a condensed version when it is getting full: merge duplicates, drop lessons that no longer hold, keep it a short list.",
  parameters: Schema.Struct({
    scope: Schema.optional(MemoryScope),
    content: Schema.String.annotate({ description: "The complete new memory." }),
  }),
  success: MemoryResult,
}).annotate(Tool.Destructive, true);

const BoardSearchCardsTool = Tool.make("board_search_cards", {
  ...shared,
  description:
    "Search the company's cards (titles, descriptions, comments) to see how earlier work was done. Returns each card with the last summary an agent left; read its thread with t3_thread_read for detail.",
  parameters: Schema.Struct({
    companyId: CompanyIdParam,
    query: TrimmedNonEmptyString,
  }),
  success: Schema.Struct({
    matches: Schema.Array(
      Schema.Struct({ task: BoardTask, summary: Schema.NullOr(Schema.String) }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const BoardToolkit = Toolkit.make(
  BoardListAgentsTool,
  BoardListTasksTool,
  BoardReadTaskTool,
  BoardCreateTaskTool,
  BoardUpdateTaskTool,
  BoardAddCommentTool,
  BoardRequestHireTool,
  BoardRememberTool,
  BoardRewriteMemoryTool,
  BoardSearchCardsTool,
);
