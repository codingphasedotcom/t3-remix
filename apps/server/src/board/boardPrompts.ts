import type { BoardAgent, BoardComment, BoardTask } from "@t3tools/contracts";

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
  readonly agent: BoardAgent;
  readonly task: BoardTask;
  readonly ancestors: ReadonlyArray<BoardTask>;
  readonly subtasks: ReadonlyArray<BoardTask>;
  readonly comments: ReadonlyArray<BoardComment>;
  readonly agents: ReadonlyArray<BoardAgent>;
}

const MAX_PROMPT_COMMENTS = 20;
const MAX_PARENT_DESCRIPTION_CHARS = 600;

function agentName(agents: ReadonlyArray<BoardAgent>, id: string | null): string {
  if (id === null) return "nobody";
  return agents.find((agent) => agent.id === id)?.name ?? "a removed agent";
}

function identity(agent: BoardAgent): string {
  return agent.role.length > 0 ? `${agent.name}, the team's ${agent.role}` : agent.name;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function commentLines(context: BoardPromptContext, since?: string): ReadonlyArray<string> {
  const relevant = context.comments
    .filter((comment) => since === undefined || comment.createdAt > since)
    .slice(-MAX_PROMPT_COMMENTS);
  return relevant.map((comment) => {
    const author =
      comment.authorKind === "user"
        ? "Human"
        : comment.authorKind === "system"
          ? "Board"
          : agentName(context.agents, comment.authorAgentId);
    return `- [${author}] ${comment.body}`;
  });
}

function taskBlock(context: BoardPromptContext): string {
  const { task } = context;
  const lines = [
    `## Card: ${task.title}`,
    `Card id: ${task.id}`,
    `Column: ${boardStatusLabel(task.status)}`,
    `Assignee: ${agentName(context.agents, task.assigneeAgentId)} · Reviewer: ${agentName(context.agents, task.reviewerAgentId)}`,
    "",
    task.description.trim().length > 0 ? task.description.trim() : "(No description.)",
  ];
  if (context.ancestors.length > 0) {
    lines.push("", "## Why this card exists (parent goals, nearest first)");
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

function teamBlock(context: BoardPromptContext): string {
  const teammates = context.agents.filter((agent) => agent.id !== context.agent.id);
  if (teammates.length === 0) return "## Team\nYou are the only agent on this board.";
  return [
    "## Team (assign cards to them by id)",
    ...teammates.map(
      (agent) => `- ${agent.name}${agent.role ? ` (${agent.role})` : ""}: ${agent.id}`,
    ),
  ].join("\n");
}

const WORK_RULES = `## Working with the board
The board is how this team coordinates. Use the t3-code board tools rather than asking teammates directly:
- board_read_task re-reads a card with its comments and subtasks.
- board_add_comment records progress, decisions, and questions for humans and teammates.
- board_create_task splits work: set parentTaskId to this card and assign a teammate. A card created in "todo" with an assignee starts that agent automatically.
- board_update_task moves cards between columns.

When you finish, add a short summary comment (what changed, how you verified it), then move this card to "review". If you are blocked, comment why and move it to "blocked". If you split this card into subtasks and need their results before continuing, move it to "blocked"; it returns to "todo" and you resume here once every subtask is done.`;

export function buildWorkPrompt(context: BoardPromptContext): string {
  const sections = [
    `You are ${identity(context.agent)}, working a card on this project's agent board.`,
  ];
  if (context.agent.instructions.trim().length > 0) {
    sections.push(`## Your standing instructions\n${context.agent.instructions.trim()}`);
  }
  sections.push(taskBlock(context));
  const comments = commentLines(context);
  if (comments.length > 0) sections.push(["## Comments so far", ...comments].join("\n"));
  sections.push(teamBlock(context), WORK_RULES);
  return sections.join("\n\n");
}

export function buildReworkPrompt(context: BoardPromptContext, since: string | null): string {
  const comments = commentLines(context, since ?? undefined);
  return [
    `The card "${context.task.title}" (${context.task.id}) is back in "To do" for you.`,
    comments.length > 0
      ? ["New comments since your last run:", ...comments].join("\n")
      : "There are no new comments; re-read the card with board_read_task to see what changed.",
    context.subtasks.length > 0
      ? [
          "Subtasks:",
          ...context.subtasks.map(
            (subtask) => `- [${boardStatusLabel(subtask.status)}] ${subtask.title} (${subtask.id})`,
          ),
        ].join("\n")
      : "",
    'Address the feedback, add a summary comment, then move the card to "review" (or "blocked" if you cannot proceed).',
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function buildReviewPrompt(
  context: BoardPromptContext,
  workspace: { readonly worktreePath: string | null; readonly baseRef: string | null },
): string {
  const assignee = agentName(context.agents, context.task.assigneeAgentId);
  const sections = [
    `You are ${identity(context.agent)}, reviewing a card on this project's agent board. ${assignee} did the work.`,
  ];
  if (context.agent.instructions.trim().length > 0) {
    sections.push(`## Your standing instructions\n${context.agent.instructions.trim()}`);
  }
  sections.push(taskBlock(context));
  const comments = commentLines(context);
  if (comments.length > 0) sections.push(["## Comments so far", ...comments].join("\n"));
  sections.push(
    [
      "## How to review",
      workspace.worktreePath !== null
        ? `You are in the card's worktree (${workspace.worktreePath}). Inspect the change with git status and git diff${workspace.baseRef ? ` against ${workspace.baseRef}` : ""}, and run the relevant checks.`
        : "Inspect the working tree with git status and git diff, and run the relevant checks.",
      "Do not rewrite the work yourself unless a fix is trivial.",
      `- Approve: add a comment with your verdict, then move the card to "done" with board_update_task.`,
      `- Request changes: add a comment listing each required change precisely, then move the card to "todo". ${assignee} resumes automatically.`,
    ].join("\n"),
  );
  return sections.join("\n\n");
}

export function buildUserCommentMessage(task: BoardTask, body: string): string {
  return `A human commented on your board card "${task.title}" (${task.id}):\n\n${body}`;
}
