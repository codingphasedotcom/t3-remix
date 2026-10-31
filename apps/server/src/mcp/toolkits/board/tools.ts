import {
  BoardAgentId,
  BoardComment,
  BoardCompanyId,
  BoardDepartment,
  BoardDepartmentId,
  BoardHire,
  BoardHireId,
  BoardRunKind,
  BoardSkill,
  BoardSkillId,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
  BoardWorkLink,
  BoardWorkLinkKind,
  BoardWorkLinkStatus,
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
    "Company whose board to use. Defaults to the company of the task this thread works on.",
});

const BoardCaller = Schema.NullOr(
  Schema.Struct({
    agentId: BoardAgentId,
    taskId: BoardTaskId,
    kind: BoardRunKind,
  }),
).annotate({
  description: "Who you are on this board and which task started you; null for an ordinary thread.",
});

const OrgMember = Schema.Struct({
  id: BoardAgentId,
  name: Schema.String,
  title: Schema.String,
  department: Schema.String,
  reportsToAgentId: Schema.NullOr(BoardAgentId),
  skills: Schema.Array(Schema.String),
  paused: Schema.Boolean,
});

const SkillSummary = Schema.Struct({
  id: BoardSkillId,
  name: Schema.String,
  description: Schema.String,
});

const PendingHire = Schema.Struct({
  id: BoardHireId,
  name: Schema.String,
  title: Schema.String,
  reportsToAgentId: Schema.NullOr(BoardAgentId),
  reportsToHireId: Schema.NullOr(BoardHireId),
});

const BoardListAgentsTool = Tool.make("board_list_agents", {
  ...shared,
  description:
    "Show the company's org chart: every agent with title, department, manager, and skills, the departments, the skills library, hire requests waiting for approval, who you are, and who you may assign work to.",
  parameters: Schema.Struct({ companyId: CompanyIdParam }),
  success: Schema.Struct({
    company: Schema.Struct({ id: BoardCompanyId, name: Schema.String, mission: Schema.String }),
    departments: Schema.Array(BoardDepartment),
    ceoAgentId: Schema.NullOr(BoardAgentId),
    agents: Schema.Array(OrgMember),
    skills: Schema.Array(SkillSummary),
    pendingHires: Schema.Array(PendingHire),
    you: BoardCaller,
    canAssignTo: Schema.Array(BoardAgentId),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const BoardListTasksTool = Tool.make("board_list_tasks", {
  ...shared,
  description:
    "List tasks on the company's board, ordered by column position. Filter by column or assignee.",
  parameters: Schema.Struct({
    companyId: CompanyIdParam,
    status: Schema.optional(BoardTaskStatus),
    assigneeAgentId: Schema.optional(BoardAgentId).annotate({
      description: "Only tasks assigned to this agent.",
    }),
  }),
  success: Schema.Struct({ tasks: Schema.Array(BoardTask), you: BoardCaller }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const BoardReadTaskTool = Tool.make("board_read_task", {
  ...shared,
  description:
    "Read one task with its comments, linked work (pull requests, branches, previews), parent, and subtasks. Omit taskId to read the task this thread was started for.",
  parameters: Schema.Struct({ taskId: Schema.optional(BoardTaskId) }),
  success: Schema.Struct({
    task: BoardTask,
    comments: Schema.Array(BoardComment),
    links: Schema.Array(BoardWorkLink),
    parent: Schema.NullOr(BoardTask),
    subtasks: Schema.Array(BoardTask),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const BoardCreateTaskTool = Tool.make("board_create_task", {
  ...shared,
  description:
    'Create a task. Set parentTaskId to split your task into subtasks and assign someone in your reporting line. A task in "todo" with an assignee starts that agent right away; you review it unless you name another reviewer. "backlog" (the Ideas column) waits for a human.',
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
    'Move or edit a task. Move your own task to "review" when done, "blocked" when stuck or waiting on subtasks. Reviewers move tasks to "done" to approve or "todo" to request changes.',
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
    "Add a comment to a task: progress, decisions, review findings, or questions for the board and teammates. Omit taskId to comment on this thread's task.",
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
    departmentId: Schema.optional(BoardDepartmentId).annotate({
      description: "Their department (board_list_agents lists them); defaults to their manager's.",
    }),
    reportsToAgentId: Schema.optional(BoardAgentId).annotate({
      description: "Their manager; defaults to you.",
    }),
    reportsToHireId: Schema.optional(BoardHireId).annotate({
      description:
        "Instead of reportsToAgentId: a pending hire request who will manage them. Request the manager first.",
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
    "Save a lasting lesson to memory so future tasks start with it: a convention, a command, a gotcha, or the board's preference. Not a log of this task.",
  parameters: Schema.Struct({
    scope: Schema.optional(MemoryScope),
    note: TrimmedNonEmptyString.annotate({
      description: "One short, self-contained lesson. The date and your name are added for you.",
    }),
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

const BoardSearchTasksTool = Tool.make("board_search_tasks", {
  ...shared,
  description:
    "Search the company's tasks (titles, descriptions, comments) to see how earlier work was done. Returns each task with the last summary an agent left; read its thread with t3_thread_read for detail.",
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

const BoardLinkWorkTool = Tool.make("board_link_work", {
  ...shared,
  description:
    'Link something a task produced, such as a pull request, branch, or preview, so people can find it on the task. Linking the same URL again updates it; set status to "merged" once a pull request merges.',
  parameters: Schema.Struct({
    taskId: Schema.optional(BoardTaskId).annotate({
      description: "Defaults to the task this thread was started for.",
    }),
    kind: BoardWorkLinkKind,
    title: TrimmedNonEmptyString.annotate({
      description: 'Such as "PR #12: Add the pricing page".',
    }),
    url: TrimmedNonEmptyString.annotate({
      description: "The URL, or the branch name for a branch.",
    }),
    status: Schema.optional(BoardWorkLinkStatus).annotate({
      description: 'For pull requests; defaults to "open".',
    }),
  }),
  success: Schema.Struct({ link: BoardWorkLink }),
}).annotate(Tool.Destructive, false);

const BoardReadSkillTool = Tool.make("board_read_skill", {
  ...shared,
  description:
    "Read a skill's full instructions. Your prompt lists your skills by name; read the ones that apply before you use them.",
  parameters: Schema.Struct({
    companyId: CompanyIdParam,
    skill: TrimmedNonEmptyString.annotate({ description: "The skill's name or id." }),
  }),
  success: Schema.Struct({ skill: BoardSkill }),
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
  BoardSearchTasksTool,
  BoardReadSkillTool,
  BoardLinkWorkTool,
);
