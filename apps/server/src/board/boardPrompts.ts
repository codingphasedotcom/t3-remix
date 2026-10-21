import type {
  BoardAgent,
  BoardAgentId,
  BoardComment,
  BoardCompany,
  BoardSkill,
  BoardTask,
} from "@t3tools/contracts";

import { assignableBy, chainOfCommand, departmentName, directReports } from "./boardOrg.ts";

const STATUS_LABELS: Record<BoardTask["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

export function boardStatusLabel(status: BoardTask["status"]): string {
  return STATUS_LABELS[status];
}

export interface BoardPromptContext {
  readonly company: BoardCompany;
  readonly agent: BoardAgent;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly skills: ReadonlyArray<BoardSkill>;
  readonly task: BoardTask;
  readonly ancestors: ReadonlyArray<BoardTask>;
  readonly subtasks: ReadonlyArray<BoardTask>;
  readonly comments: ReadonlyArray<BoardComment>;
  /** People's comments on this task and the tasks above it, oldest first. */
  readonly boardComments: ReadonlyArray<BoardInstruction>;
}

export interface BoardInstruction {
  readonly taskId: BoardTask["id"];
  readonly taskTitle: string;
  readonly body: string;
  readonly createdAt: string;
}

/** Where the agent's session runs, as its prompt describes it. */
export interface BoardWorkspace {
  /** Null for a worktree git has not created yet: its path is chosen at launch. */
  readonly folder: string | null;
  readonly branch: string | null;
  readonly baseRef: string | null;
  /** The card's own worktree, its parent card's worktree, or the project's checkout. */
  readonly owner: "card" | "parent" | "project";
  /** Other open cards working in the same folder right now. */
  readonly sharedWith: ReadonlyArray<BoardTask>;
}

const MAX_PROMPT_COMMENTS = 20;
const MAX_PARENT_DESCRIPTION_CHARS = 600;

function agentName(agents: ReadonlyArray<BoardAgent>, id: BoardAgentId | null): string {
  if (id === null) return "nobody";
  return agents.find((agent) => agent.id === id)?.name ?? "a removed agent";
}

function describe(agent: BoardAgent): string {
  return agent.title.length > 0 ? `${agent.name} (${agent.title})` : agent.name;
}

function describeWithDepartment(context: BoardPromptContext, agent: BoardAgent): string {
  const department = departmentName(context.company, agent.departmentId);
  const parts = [agent.title, department].filter((part) => part !== null && part.length > 0);
  return parts.length > 0 ? `${agent.name} (${parts.join(", ")})` : agent.name;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function isCeo(context: BoardPromptContext): boolean {
  return context.company.ceoAgentId === context.agent.id;
}

function identityBlock(context: BoardPromptContext): string {
  const { agent, company } = context;
  const role = isCeo(context)
    ? "the CEO"
    : agent.title.length > 0
      ? `a ${agent.title}`
      : "an employee";
  const department = departmentName(company, agent.departmentId);
  const lines = [
    `You are ${agent.name}, ${role}${department === null ? "" : ` in ${department}`} at ${company.name}, an AI-run company.`,
  ];
  if (company.mission.trim().length > 0) {
    lines.push("", `Company mission: ${company.mission.trim()}`);
  }
  return lines.join("\n");
}

function orgBlock(context: BoardPromptContext): string {
  const { agent, agents } = context;
  const lines = ["## Your place in the company"];
  const chain = chainOfCommand(agents, agent);
  const manager = chain[0];
  lines.push(
    isCeo(context)
      ? "You report to the board: the people who own this company. They review what you finish."
      : manager === undefined
        ? "You report directly to the board."
        : `You report to ${describe(manager)}.`,
  );
  lines.push(
    "",
    `Departments: ${context.company.departments
      .map((department) => {
        const members = agents.filter((member) => member.departmentId === department.id);
        return `${department.name} (${members.length > 0 ? members.map((member) => member.name).join(", ") : "nobody yet"})`;
      })
      .join("; ")}.`,
  );
  const reports = directReports(agents, agent.id);
  if (reports.length > 0) {
    lines.push("", "Your direct reports:");
    for (const report of reports) {
      const skillNames = report.skillIds
        .map((id) => context.skills.find((skill) => skill.id === id)?.name)
        .filter((name) => name !== undefined);
      lines.push(
        `- ${describeWithDepartment(context, report)}: ${report.id}${skillNames.length > 0 ? ` — skills: ${skillNames.join(", ")}` : ""}${report.paused ? " (paused)" : ""}`,
      );
    }
  }
  const assignable = assignableBy(context.company, agents, agent).filter(
    (candidate) => candidate.id !== agent.id && !reports.includes(candidate),
  );
  if (assignable.length > 0) {
    lines.push("", "Others in your organization you may assign work to:");
    for (const other of assignable) {
      lines.push(`- ${describeWithDepartment(context, other)}: ${other.id}`);
    }
  }
  return lines.join("\n");
}

/** Skills short enough to inline cost less than a tool call to read them. */
const MAX_INLINE_SKILL_CHARS = 2_000;

function skillsBlock(context: BoardPromptContext): string | null {
  const skills = context.agent.skillIds
    .map((id) => context.skills.find((skill) => skill.id === id))
    .filter((skill) => skill !== undefined);
  if (skills.length === 0) return null;
  const total = skills.reduce((sum, skill) => sum + skill.instructions.length, 0);
  if (total > MAX_INLINE_SKILL_CHARS) {
    return [
      "## Your skills",
      "Read each skill that applies to this task with board_read_skill before you start.",
      ...skills.map(
        (skill) =>
          `- ${skill.name}${skill.description.trim() ? `: ${skill.description.trim()}` : ""}`,
      ),
    ].join("\n");
  }
  return [
    "## Your skills",
    ...skills.map((skill) =>
      [`### ${skill.name}`, skill.description.trim(), skill.instructions.trim()]
        .filter((part) => part.length > 0)
        .join("\n\n"),
    ),
  ].join("\n\n");
}

function memoryBlock(context: BoardPromptContext): string | null {
  const company = context.company.memory.trim();
  const own = context.agent.memory.trim();
  if (company.length === 0 && own.length === 0) return null;
  const lines = [
    "## What you remember",
    "Lessons kept from earlier tasks. Trust them unless the code says otherwise.",
  ];
  if (company.length > 0) lines.push("", "Company memory:", company);
  if (own.length > 0) lines.push("", "Your memory:", own);
  return lines.join("\n");
}

/** Agents' and the system's comments; people's comments have their own block. */
function commentLines(context: BoardPromptContext, since?: string): ReadonlyArray<string> {
  return context.comments
    .filter((comment) => comment.authorKind !== "user")
    .filter((comment) => since === undefined || comment.createdAt > since)
    .slice(-MAX_PROMPT_COMMENTS)
    .map((comment) => {
      const author =
        comment.authorKind === "user"
          ? "Board (human)"
          : comment.authorKind === "system"
            ? "System"
            : agentName(context.agents, comment.authorAgentId);
      return `- [${author}] ${comment.body}`;
    });
}

const MAX_BOARD_COMMENT_CHARS = 2_000;

/**
 * What people said on this task and every task above it. Subtasks see their parents'
 * instructions, and later runs see earlier ones, so a direction is given once.
 */
function boardCommentsBlock(context: BoardPromptContext, newSince?: string): string | null {
  if (context.boardComments.length === 0) return null;
  const lines = [
    "## What the board told you",
    "The people who own this company left these comments on this task and the tasks above it. They outrank everything else in this prompt: follow them exactly, and when one conflicts with your plan, ask on the board instead of guessing.",
  ];
  for (const comment of context.boardComments.slice(-MAX_PROMPT_COMMENTS)) {
    const where = comment.taskId === context.task.id ? "On this task" : `On "${comment.taskTitle}"`;
    const fresh = newSince !== undefined && comment.createdAt > newSince ? " (new)" : "";
    lines.push(`- ${where}${fresh}: ${truncate(comment.body.trim(), MAX_BOARD_COMMENT_CHARS)}`);
  }
  return lines.join("\n");
}

function taskBlock(context: BoardPromptContext): string {
  const { task } = context;
  const lines = [
    `## Task: ${task.title}`,
    `Task id: ${task.id}`,
    `Column: ${boardStatusLabel(task.status)}`,
    `Assignee: ${agentName(context.agents, task.assigneeAgentId)} · Reviewer: ${task.reviewerAgentId === null ? "the board (a human)" : agentName(context.agents, task.reviewerAgentId)}`,
    "",
    task.description.trim().length > 0 ? task.description.trim() : "(No description.)",
  ];
  if (context.ancestors.length > 0) {
    lines.push("", "## Why this task exists (parent tasks, nearest first)");
    for (const ancestor of context.ancestors) {
      const description = truncate(ancestor.description.trim(), MAX_PARENT_DESCRIPTION_CHARS);
      lines.push(`- ${ancestor.title} (${ancestor.id})${description ? `: ${description}` : ""}`);
    }
  }
  if (context.subtasks.length > 0) {
    lines.push("", "## Subtasks");
    for (const subtask of context.subtasks) {
      lines.push(
        `- [${boardStatusLabel(subtask.status)}] ${subtask.title} (${subtask.id}) → ${agentName(context.agents, subtask.assigneeAgentId)}`,
      );
    }
  }
  return lines.join("\n");
}

const SHARED_FOLDER_RULE =
  "Touch only what your task needs; never revert, reformat, stash, or reset changes you did not make, and do not switch branches.";

/** Boards default to HEAD, which means "whatever the project has checked out". */
function baseLabel(baseRef: string | null): string {
  if (baseRef === null) return "the base branch";
  return baseRef === "HEAD" ? "the project's checked-out branch (HEAD)" : baseRef;
}

function workspaceBlock(context: BoardPromptContext, workspace: BoardWorkspace): string {
  const { branch, baseRef, folder } = workspace;
  const parent = context.ancestors[0];
  const lines = ["## Where you work"];
  if (folder === null) {
    lines.push(
      "- Folder: a new git worktree made for this task. It is the directory you start in; run `pwd` to see its full path.",
    );
  } else {
    const whose =
      workspace.owner === "card"
        ? "this task's git worktree"
        : workspace.owner === "parent"
          ? `the git worktree of your parent task "${parent?.title ?? "parent"}"`
          : "the project's own checkout, not a worktree";
    lines.push(`- Folder: ${folder} (${whose}). Run every command there.`);
  }
  if (workspace.owner === "project") {
    lines.push(
      `- Branch: ${branch ?? "whatever the project has checked out"}. This task has no branch of its own.`,
      "- Base: none; changes go straight into the project checkout.",
    );
  } else {
    lines.push(
      `- Branch: ${branch ?? "the worktree's current branch"}${workspace.owner === "parent" ? ", your parent task's branch" : ", made for this task"}.`,
      `- Base: ${baseLabel(baseRef)}. The branch started from its commit when ${workspace.owner === "parent" ? "your parent task" : "this task"} began.`,
    );
  }
  const others = workspace.sharedWith.map(
    (other) =>
      `"${other.title}" (${agentName(context.agents, other.assigneeAgentId)}, ${boardStatusLabel(other.status)})`,
  );
  if (workspace.owner === "card") {
    lines.push(
      "- Shared: no other task works here. Subtasks of this task work in this same folder and branch, so their changes land here.",
    );
  } else if (workspace.owner === "parent") {
    lines.push(
      others.length > 0
        ? `- Shared: yes, with your parent task and its other subtasks: ${others.join(", ")}. They may be editing files at the same time. ${SHARED_FOLDER_RULE}`
        : `- Shared: yes, with your parent task and any other subtasks it gets; none are open right now. ${SHARED_FOLDER_RULE}`,
    );
  } else {
    lines.push(
      `- Shared: yes, with every agent working without a worktree and with the people who own the project${others.length > 0 ? `, including ${others.join(", ")}` : ""}. ${SHARED_FOLDER_RULE}`,
    );
  }
  const missing =
    workspace.owner === "project"
      ? "work other tasks did in their own worktrees, until someone merges it into the branch checked out here."
      : `work from other tasks that has not been merged into ${baseLabel(baseRef)}. Other tasks work on their own branches, and their changes reach this folder only after someone merges them.`;
  lines.push(
    `- Not here: ${missing} Do not redo that work or go looking for it; if your task depends on it, say so in a comment and move the task to "blocked".`,
  );
  return lines.join("\n");
}

// Every tool describes itself, and Claude and Codex threads also get the board section of the
// t3-code instructions, so prompts only point at the tools instead of listing them again.
const BOARD_TOOLS =
  "Coordinate through the t3-code board tools (board_*) instead of messaging other agents.";

const REMEMBER_RULE =
  'Before you finish, record up to three lessons that will help on future tasks with board_remember: conventions, commands, gotchas, and the board\'s preferences. Skip anything only true for this task. Managers record team-wide decisions with scope "company".';

function rulesBlock(context: BoardPromptContext): string {
  const reports = directReports(context.agents, context.agent.id);
  const manages = reports.length > 0 || isCeo(context);
  const finish =
    'Link each pull request, branch, or preview you create with board_link_work, and mark a pull request "merged" once it merges. When the task is complete, add a short summary comment (what was done and how you verified it), then move it to "review". If you cannot proceed, comment why and move it to "blocked".';
  if (!manages) {
    return `## How you work
You are an individual contributor: do this task's work yourself, in this workspace. ${finish} ${REMEMBER_RULE}`;
  }
  const team =
    reports.length > 0
      ? "Prefer delegating over doing the work yourself"
      : "You have no reports yet, so do the work yourself, and request hires with board_request_hire when the work needs people you do not have";
  return `## How you work
You manage work. ${team}. To delegate, split this task into focused subtasks with board_create_task: set parentTaskId to this task, write what done looks like, assign the best-suited person, and use status "todo" so they start. Then comment with your plan and move this task to "blocked". You review each subtask when it is finished: approve it by moving it to "done", or move it back to "todo" with precise changes. Once every subtask is done this task returns to "todo" and you continue here: check that the pieces add up. ${finish} ${REMEMBER_RULE}`;
}

export function buildWorkPrompt(context: BoardPromptContext, workspace: BoardWorkspace): string {
  const sections = [identityBlock(context), orgBlock(context)];
  if (context.agent.instructions.trim().length > 0) {
    sections.push(`## Your standing instructions\n${context.agent.instructions.trim()}`);
  }
  const skills = skillsBlock(context);
  if (skills !== null) sections.push(skills);
  const memory = memoryBlock(context);
  if (memory !== null) sections.push(memory);
  sections.push(taskBlock(context));
  const board = boardCommentsBlock(context);
  if (board !== null) sections.push(board);
  const comments = commentLines(context);
  if (comments.length > 0) sections.push(["## Comments so far", ...comments].join("\n"));
  sections.push(workspaceBlock(context, workspace), rulesBlock(context), BOARD_TOOLS);
  return sections.join("\n\n");
}

export function buildReworkPrompt(
  context: BoardPromptContext,
  since: string | null,
  workspace: BoardWorkspace,
): string {
  const comments = commentLines(context, since ?? undefined);
  return [
    `The task "${context.task.title}" (${context.task.id}) is back in "To do" for you.`,
    comments.length > 0
      ? ["New comments since your last run:", ...comments].join("\n")
      : "There are no new comments from agents; re-read the task with board_read_task to see what changed.",
    boardCommentsBlock(context, since ?? undefined) ?? "",
    context.subtasks.length > 0
      ? [
          "Subtasks:",
          ...context.subtasks.map(
            (subtask) => `- [${boardStatusLabel(subtask.status)}] ${subtask.title} (${subtask.id})`,
          ),
        ].join("\n")
      : "",
    workspaceBlock(context, workspace),
    'Continue the work, add a summary comment, then move the task to "review" (or "blocked" if you cannot proceed). Record any new lasting lesson with board_remember first.',
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function buildReviewPrompt(context: BoardPromptContext, workspace: ReviewWorkspace): string {
  const assignee = agentName(context.agents, context.task.assigneeAgentId);
  const sections = [identityBlock(context), `You are reviewing a task that ${assignee} finished.`];
  if (context.agent.instructions.trim().length > 0) {
    sections.push(`## Your standing instructions\n${context.agent.instructions.trim()}`);
  }
  const skills = skillsBlock(context);
  if (skills !== null) sections.push(skills);
  const memory = memoryBlock(context);
  if (memory !== null) sections.push(memory);
  sections.push(taskBlock(context));
  const board = boardCommentsBlock(context);
  if (board !== null) sections.push(board);
  const comments = commentLines(context);
  if (comments.length > 0) sections.push(["## Comments so far", ...comments].join("\n"));
  sections.push(reviewRules(context, workspace), BOARD_TOOLS);
  return sections.join("\n\n");
}

interface ReviewWorkspace {
  readonly worktreePath: string | null;
  readonly baseRef: string | null;
}

function reviewRules(context: BoardPromptContext, workspace: ReviewWorkspace): string {
  const assignee = agentName(context.agents, context.task.assigneeAgentId);
  return [
    "## How to review",
    workspace.worktreePath !== null
      ? `You are in the task's worktree (${workspace.worktreePath}). Inspect the change with git status and git diff${workspace.baseRef ? ` against ${workspace.baseRef}` : ""}, and run the relevant checks.`
      : "Inspect the working tree with git status and git diff, and run the relevant checks.",
    "Judge the result against the task's description and the company's mission, starting from the work linked on the task (board_read_task lists it). Do not redo the work yourself unless a fix is trivial.",
    '- Approve: comment your verdict, then move the task to "done" with board_update_task.',
    `- Request changes: comment each required change precisely, then move the task to "todo". ${assignee} resumes automatically.`,
    "If the review taught you something worth keeping (a recurring mistake, a standard you enforce), record it with board_remember.",
  ].join("\n");
}

/** Sent into the reviewer's own thread when the task comes back for another review. */
export function buildReReviewPrompt(
  context: BoardPromptContext,
  since: string | null,
  workspace: ReviewWorkspace,
): string {
  const assignee = agentName(context.agents, context.task.assigneeAgentId);
  const comments = commentLines(context, since ?? undefined);
  return [
    `${assignee} sent the task "${context.task.title}" (${context.task.id}) back for review.`,
    comments.length > 0 ? ["New comments since your last review:", ...comments].join("\n") : "",
    boardCommentsBlock(context, since ?? undefined) ?? "",
    reviewRules(context, workspace),
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

const REPLY_RULES = `## Reply now
The board just commented (marked new above) and is waiting for your answer. Right away, reply on the board with board_add_comment: answer the question, or say exactly how you will act on the instruction. Check the facts first if you need to (the code, git, the task's comments), and keep the reply short.
Do not do the task's work in this reply. If the comment asks for work on this task, reply, then move the task to "todo" with board_update_task: you will be started on it next, with the comment in view. Otherwise leave the task where it is.`;

/**
 * Starts an agent that answers a person's comment on a task nobody is working. Its own thread
 * already knows the task, so only the new comment goes there.
 */
/** A subtask stuck on something its manager may be able to settle. */
export interface BlockedSubtask {
  readonly task: BoardTask;
  /** The last thing said on it, usually why it is blocked. */
  readonly reason: string | null;
}

const MAX_BLOCKED_REASON_CHARS = 800;

function blockedBlock(context: BoardPromptContext, blocked: ReadonlyArray<BlockedSubtask>): string {
  return [
    "## Blocked below you",
    "These subtasks of your task are blocked and need you:",
    ...blocked.map(
      ({ task, reason }) =>
        `- "${task.title}" (${task.id}), ${agentName(context.agents, task.assigneeAgentId)}: ${reason === null ? "no reason given" : truncate(reason.trim(), MAX_BLOCKED_REASON_CHARS)}`,
    ),
    'Unblock each one you can: answer its question in a comment on that subtask and move it back to "todo", reassign it, or narrow its scope. If only the board (a human) can unblock it, comment on your own task saying exactly what you need from them. Do not do the subtask\'s work yourself, and leave your own task where it is.',
  ].join("\n");
}

/**
 * Starts an agent that answers a person's comment, or settles blocked subtasks, on a task
 * nobody is working. Its own thread already knows the task, so only what is new goes there.
 */
export function buildReplyPrompt(
  context: BoardPromptContext,
  newSince: string | null,
  options: { readonly freshThread: boolean; readonly blocked: ReadonlyArray<BlockedSubtask> },
): string {
  // With no earlier run on the task, everything the board said is new.
  const since = newSince ?? "";
  const commented = context.boardComments.some(
    (comment) => comment.taskId === context.task.id && comment.createdAt > since,
  );
  const board = boardCommentsBlock(context, since);
  const asks = [
    commented ? REPLY_RULES : "",
    options.blocked.length > 0 ? blockedBlock(context, options.blocked) : "",
  ].filter((section) => section.length > 0);
  if (!options.freshThread) {
    return [
      commented
        ? `The board (a human) commented on the task "${context.task.title}" (${context.task.id}), which is in "${boardStatusLabel(context.task.status)}".`
        : `Work under your task "${context.task.title}" (${context.task.id}) is blocked.`,
      board ?? "",
      ...asks,
    ]
      .filter((section) => section.length > 0)
      .join("\n\n");
  }
  // A reply needs the task and the conversation, not the org chart or memory; those arrive
  // with the full work prompt if this thread goes on to work the task.
  const sections = [identityBlock(context), taskBlock(context)];
  if (board !== null) sections.push(board);
  const comments = commentLines(context);
  if (comments.length > 0) sections.push(["## Comments so far", ...comments].join("\n"));
  sections.push(...asks, BOARD_TOOLS);
  return sections.join("\n\n");
}

export function buildUserCommentMessage(task: BoardTask, body: string): string {
  return `The board (a human) commented on your task "${task.title}" (${task.id}):\n\n${body}\n\nReply on the board with board_add_comment right away: answer it, or say how you will act on it. Then follow it.`;
}
