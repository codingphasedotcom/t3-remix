import type {
  BoardAgent,
  BoardAgentId,
  BoardComment,
  BoardCompany,
  BoardSkill,
  BoardTask,
} from "@t3tools/contracts";

import { assignableBy, chainOfCommand, directReports } from "./boardOrg.ts";

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
  const lines = [`You are ${agent.name}, ${role} at ${company.name}, an AI-run company.`];
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
  const reports = directReports(agents, agent.id);
  if (reports.length > 0) {
    lines.push("", "Your direct reports:");
    for (const report of reports) {
      const skillNames = report.skillIds
        .map((id) => context.skills.find((skill) => skill.id === id)?.name)
        .filter((name) => name !== undefined);
      lines.push(
        `- ${describe(report)}: ${report.id}${skillNames.length > 0 ? ` — skills: ${skillNames.join(", ")}` : ""}${report.paused ? " (paused)" : ""}`,
      );
    }
  }
  const assignable = assignableBy(context.company, agents, agent).filter(
    (candidate) => candidate.id !== agent.id && !reports.includes(candidate),
  );
  if (assignable.length > 0) {
    lines.push("", "Others in your organization you may assign work to:");
    for (const other of assignable) lines.push(`- ${describe(other)}: ${other.id}`);
  }
  return lines.join("\n");
}

function skillsBlock(context: BoardPromptContext): string | null {
  const skills = context.agent.skillIds
    .map((id) => context.skills.find((skill) => skill.id === id))
    .filter((skill) => skill !== undefined);
  if (skills.length === 0) return null;
  return [
    "## Your skills",
    ...skills.map((skill) =>
      [`### ${skill.name}`, skill.description.trim(), skill.instructions.trim()]
        .filter((part) => part.length > 0)
        .join("\n\n"),
    ),
  ].join("\n\n");
}

function commentLines(context: BoardPromptContext, since?: string): ReadonlyArray<string> {
  return context.comments
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

function taskBlock(context: BoardPromptContext): string {
  const { task } = context;
  const lines = [
    `## Card: ${task.title}`,
    `Card id: ${task.id}`,
    `Column: ${boardStatusLabel(task.status)}`,
    `Assignee: ${agentName(context.agents, task.assigneeAgentId)} · Reviewer: ${task.reviewerAgentId === null ? "the board (a human)" : agentName(context.agents, task.reviewerAgentId)}`,
    "",
    task.description.trim().length > 0 ? task.description.trim() : "(No description.)",
  ];
  if (context.ancestors.length > 0) {
    lines.push("", "## Why this card exists (parent cards, nearest first)");
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

const BOARD_TOOLS = `## Working with the board
The board is how this company coordinates. Use the t3-code board tools instead of messaging other agents:
- board_read_task re-reads a card with its comments and subtasks; board_list_tasks shows the board.
- board_list_agents shows the org chart and the skills each person has.
- board_add_comment records progress, decisions, and questions. The board (humans) reads them.
- board_create_task creates a card. A card in "todo" with an assignee starts that agent right away. You review cards you assign to others unless you name a different reviewer.
- board_update_task moves cards between columns.
- board_request_hire asks the board to add someone to your team. A human approves it before they exist.`;

function rulesBlock(context: BoardPromptContext): string {
  const reports = directReports(context.agents, context.agent.id);
  const manages = reports.length > 0 || isCeo(context);
  const finish =
    'When the card is complete, add a short summary comment (what was done and how you verified it), then move it to "review". If you cannot proceed, comment why and move it to "blocked".';
  if (!manages) {
    return `## How you work
You are an individual contributor: do this card's work yourself, in this workspace. ${finish}`;
  }
  const team =
    reports.length > 0
      ? "Prefer delegating over doing the work yourself"
      : "You have no reports yet, so do the work yourself, and request hires with board_request_hire when the work needs people you do not have";
  return `## How you work
You manage work. ${team}. To delegate, split this card into focused subtasks with board_create_task: set parentTaskId to this card, write what done looks like, assign the best-suited person, and use status "todo" so they start. Then comment with your plan and move this card to "blocked". You review each subtask when it is finished: approve it by moving it to "done", or move it back to "todo" with precise changes. Once every subtask is done this card returns to "todo" and you continue here: check that the pieces add up. ${finish}`;
}

export function buildWorkPrompt(context: BoardPromptContext): string {
  const sections = [identityBlock(context), orgBlock(context)];
  if (context.agent.instructions.trim().length > 0) {
    sections.push(`## Your standing instructions\n${context.agent.instructions.trim()}`);
  }
  const skills = skillsBlock(context);
  if (skills !== null) sections.push(skills);
  sections.push(taskBlock(context));
  const comments = commentLines(context);
  if (comments.length > 0) sections.push(["## Comments so far", ...comments].join("\n"));
  sections.push(rulesBlock(context), BOARD_TOOLS);
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
    'Continue the work, add a summary comment, then move the card to "review" (or "blocked" if you cannot proceed).',
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function buildReviewPrompt(
  context: BoardPromptContext,
  workspace: { readonly worktreePath: string | null; readonly baseRef: string | null },
): string {
  const assignee = agentName(context.agents, context.task.assigneeAgentId);
  const sections = [identityBlock(context), `You are reviewing a card that ${assignee} finished.`];
  if (context.agent.instructions.trim().length > 0) {
    sections.push(`## Your standing instructions\n${context.agent.instructions.trim()}`);
  }
  const skills = skillsBlock(context);
  if (skills !== null) sections.push(skills);
  sections.push(taskBlock(context));
  const comments = commentLines(context);
  if (comments.length > 0) sections.push(["## Comments so far", ...comments].join("\n"));
  sections.push(
    [
      "## How to review",
      workspace.worktreePath !== null
        ? `You are in the card's worktree (${workspace.worktreePath}). Inspect the change with git status and git diff${workspace.baseRef ? ` against ${workspace.baseRef}` : ""}, and run the relevant checks.`
        : "Inspect the working tree with git status and git diff, and run the relevant checks.",
      "Judge the result against the card's description and the company's mission. Do not redo the work yourself unless a fix is trivial.",
      '- Approve: comment your verdict, then move the card to "done" with board_update_task.',
      `- Request changes: comment each required change precisely, then move the card to "todo". ${assignee} resumes automatically.`,
    ].join("\n"),
    BOARD_TOOLS,
  );
  return sections.join("\n\n");
}

export function buildUserCommentMessage(task: BoardTask, body: string): string {
  return `The board (a human) commented on your card "${task.title}" (${task.id}):\n\n${body}`;
}
