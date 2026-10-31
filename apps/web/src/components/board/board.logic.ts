import type {
  BoardAgent,
  BoardAgentId,
  BoardCompany,
  BoardDepartment,
  BoardDepartmentId,
  BoardTask,
  BoardTaskCreateInput,
  BoardTaskId,
  BoardTaskStatus,
} from "@t3tools/contracts";

export interface BoardColumn {
  readonly status: BoardTaskStatus;
  readonly label: string;
  readonly hint: string;
}

export const BOARD_COLUMNS: ReadonlyArray<BoardColumn> = [
  { status: "backlog", label: "Ideas", hint: "Waits for a human to schedule it." },
  { status: "todo", label: "To do", hint: "Tasks with an assignee start automatically." },
  { status: "in_progress", label: "In progress", hint: "An agent is working the task." },
  { status: "review", label: "Review", hint: "The reviewer starts when one is set." },
  { status: "blocked", label: "Blocked", hint: "Needs a decision or its subtasks." },
  { status: "done", label: "Done", hint: "Approved work." },
];

export function boardStatusLabel(status: BoardTaskStatus): string {
  return BOARD_COLUMNS.find((column) => column.status === status)?.label ?? status;
}

export interface BoardPlacement {
  readonly status: BoardTaskStatus;
  readonly position: number;
}

/** Cards per column, ordered by position, with pending drops applied. */
export function groupTasksByStatus(
  tasks: ReadonlyArray<BoardTask>,
  placements: ReadonlyMap<BoardTaskId, BoardPlacement>,
): Record<BoardTaskStatus, ReadonlyArray<BoardTask>> {
  const groups: Record<BoardTaskStatus, Array<BoardTask>> = {
    backlog: [],
    todo: [],
    in_progress: [],
    review: [],
    blocked: [],
    done: [],
  };
  for (const task of tasks) {
    const placement = placements.get(task.id);
    const placed = placement === undefined ? task : { ...task, ...placement };
    groups[placed.status].push(placed);
  }
  for (const column of Object.values(groups)) {
    column.sort((left, right) => left.position - right.position);
  }
  return groups;
}

/**
 * Position for a card dropped into `column` just before `beforeTaskId`, or at the end when
 * that is null. Positions are fractional so one move never renumbers its neighbours.
 */
export function dropPosition(
  column: ReadonlyArray<BoardTask>,
  beforeTaskId: BoardTaskId | null,
): number {
  if (beforeTaskId === null) {
    const last = column.at(-1);
    return last === undefined ? 1 : last.position + 1;
  }
  const index = column.findIndex((task) => task.id === beforeTaskId);
  const before = column[index];
  if (index === -1 || before === undefined) return (column.at(-1)?.position ?? 0) + 1;
  const previous = column[index - 1];
  return previous === undefined ? before.position - 1 : (previous.position + before.position) / 2;
}

export function agentById(
  agents: ReadonlyArray<BoardAgent>,
  id: BoardAgentId | null,
): BoardAgent | null {
  if (id === null) return null;
  return agents.find((agent) => agent.id === id) ?? null;
}

export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** A finished top-level task nobody is working on; its subtasks are archived with it. */
export function canArchiveTask(task: BoardTask): boolean {
  return (
    task.status === "done" &&
    task.parentTaskId === null &&
    task.archivedAt === null &&
    task.activeRunKind === null
  );
}

export function subtaskProgress(
  tasks: ReadonlyArray<BoardTask>,
  taskId: BoardTaskId,
): { readonly done: number; readonly total: number } {
  const subtasks = tasks.filter((task) => task.parentTaskId === taskId);
  return {
    done: subtasks.filter((task) => task.status === "done").length,
    total: subtasks.length,
  };
}

/** The org chart as nested rows: the CEO first, each manager followed by its reports. */
export function orgChartRows(
  agents: ReadonlyArray<BoardAgent>,
  ceoAgentId: BoardAgentId | null,
): ReadonlyArray<{ readonly agent: BoardAgent; readonly depth: number }> {
  const rows: Array<{ agent: BoardAgent; depth: number }> = [];
  const placed = new Set<BoardAgentId>();
  const visit = (agent: BoardAgent, depth: number) => {
    if (placed.has(agent.id)) return;
    placed.add(agent.id);
    rows.push({ agent, depth });
    for (const report of agents.filter((candidate) => candidate.reportsToAgentId === agent.id)) {
      visit(report, depth + 1);
    }
  };
  const ceo = agents.find((agent) => agent.id === ceoAgentId);
  if (ceo !== undefined) visit(ceo, 0);
  // Anyone left over (a broken chain) still shows, at the top level.
  for (const agent of agents) visit(agent, 0);
  return rows;
}

export interface SkillPreset {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

export const SKILL_PRESETS: ReadonlyArray<SkillPreset> = [
  {
    name: "Planning and delegation",
    description: "Turn a goal into small, assignable tasks.",
    instructions:
      'Read the goal and the codebase before planning. Split work into tasks that one person can finish and verify in a single sitting, each with a concrete definition of done. Assign each task to the teammate whose skills fit it best, and say what to hand back. Avoid tasks that only say "investigate" unless the answer decides what to build.',
  },
  {
    name: "Code review",
    description: "Approve only changes you would merge.",
    instructions:
      "Read the full diff. Check correctness, edge cases, error handling, tests that would catch a regression, and changes outside the task's scope. Run the tests. When requesting changes, list each one with the file, the problem, and what would fix it.",
  },
  {
    name: "Testing",
    description: "Prove behavior with automated tests.",
    instructions:
      "Write tests for the behavior the task asks for, including the failure and edge cases. Prefer tests that exercise real behavior over mocks of the code under test. Run the whole relevant test suite before reporting done, and paste the result into your comment.",
  },
  {
    name: "Frontend",
    description: "Build UI that matches the existing app.",
    instructions:
      "Follow the app's existing components, styles, and patterns before inventing new ones. Handle loading, empty, and error states. Keep the UI accessible: labels, keyboard use, and focus. Describe how you checked the result in the browser.",
  },
  {
    name: "Backend and APIs",
    description: "Change servers, data, and APIs safely.",
    instructions:
      "Validate inputs at the boundary, keep error messages useful, and never break an existing API without saying so. When you change stored data, think about existing rows. Cover new endpoints with tests.",
  },
  {
    name: "Writing",
    description: "Clear docs, copy, and release notes.",
    instructions:
      "Write for the reader's task: lead with what they need to do, keep sentences short, and cut anything that does not help. Match the project's existing voice and terminology.",
  },
];

export interface EmployeePreset {
  readonly title: string;
  readonly name: string;
  /** Matched by name against the company's departments, which a person may have renamed. */
  readonly department: string;
  readonly instructions: string;
  readonly skills: ReadonlyArray<string>;
}

export const EMPLOYEE_PRESETS: ReadonlyArray<EmployeePreset> = [
  {
    title: "CTO",
    department: "Engineering",
    name: "Grace",
    instructions:
      "You own the technical direction. Break engineering work into tasks for your engineers, review what they deliver, and keep the codebase consistent. Do small fixes yourself; delegate anything larger.",
    skills: ["Planning and delegation", "Code review"],
  },
  {
    title: "Software engineer",
    department: "Engineering",
    name: "Linus",
    instructions:
      "You implement tasks end to end: read the relevant code first, make focused changes in the codebase's style, add tests, and run the checks. Commit on the task's branch with a clear message.",
    skills: ["Testing", "Backend and APIs"],
  },
  {
    title: "Frontend engineer",
    department: "Engineering",
    name: "Ada",
    instructions:
      "You build and polish the user interface. Match the existing design, cover interactive behavior with tests, and describe how you verified it.",
    skills: ["Frontend", "Testing"],
  },
  {
    title: "QA engineer",
    department: "Engineering",
    name: "Margaret",
    instructions:
      "You verify that features work the way a user expects. Reproduce, test edge cases, write regression tests, and report failures with exact steps.",
    skills: ["Testing", "Code review"],
  },
  {
    title: "Technical writer",
    department: "Engineering",
    name: "Mary",
    instructions:
      "You write and maintain docs, READMEs, and release notes for what the team ships.",
    skills: ["Writing"],
  },
  {
    title: "Product designer",
    department: "Design",
    name: "Dieter",
    instructions:
      "You design how the product looks and behaves. Work within the existing design language, specify states and edge cases, and build or refine the UI yourself when the change is small.",
    skills: ["Frontend"],
  },
  {
    title: "Marketing lead",
    department: "Marketing",
    name: "Peggy",
    instructions:
      "You explain the product to the people it is for: landing pages, announcements, and launch copy. Ground every claim in what the product actually does.",
    skills: ["Writing"],
  },
  {
    title: "Support specialist",
    department: "Customer Support",
    name: "Sam",
    instructions:
      "You help users succeed: write help articles and replies, reproduce reported problems, and turn real bugs into clear tasks for engineering.",
    skills: ["Writing"],
  },
];

/** The company department with this name, ignoring case, if it still exists. */
export function departmentNamed(
  departments: ReadonlyArray<BoardDepartment>,
  name: string,
): BoardDepartmentId | null {
  const wanted = name.toLowerCase();
  return departments.find((department) => department.name.toLowerCase() === wanted)?.id ?? null;
}

export function departmentLabel(
  departments: ReadonlyArray<BoardDepartment>,
  id: BoardDepartmentId | null,
): string | null {
  return departments.find((department) => department.id === id)?.name ?? null;
}

export interface CompanyTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Employees by title, each with the title of its manager; "CEO" is the CEO. */
  readonly team: ReadonlyArray<{ readonly title: string; readonly reportsTo: string }>;
  /** The CEO starts on a task to propose the team, which a person approves hire by hire. */
  readonly recommendHires?: boolean;
}

export const COMPANY_TEMPLATES: ReadonlyArray<CompanyTemplate> = [
  {
    id: "ceo-only",
    label: "Just a CEO",
    description: "Start with a CEO and add employees yourself.",
    team: [],
  },
  {
    id: "ceo-recommends",
    label: "CEO recommends the team",
    description: "The CEO proposes who to hire for the mission; you approve each one.",
    team: [],
    recommendHires: true,
  },
  {
    id: "software",
    label: "Software team",
    description: "CTO, two engineers, and QA, with starter skills.",
    team: [
      { title: "CTO", reportsTo: "CEO" },
      { title: "Software engineer", reportsTo: "CTO" },
      { title: "Frontend engineer", reportsTo: "CTO" },
      { title: "QA engineer", reportsTo: "CTO" },
    ],
  },
];

export const DEFAULT_CEO_INSTRUCTIONS =
  "You run the company toward its mission. When the board gives you a task, decide what success means, split it into work for your team, and hold the result to a high bar. Do not do large pieces of work yourself when you have people for it. Keep the board informed with short comments.";

/** Has the CEO propose the hires the company is missing; nobody joins until a person approves. */
export function recommendHiresTask(
  company: Pick<BoardCompany, "id" | "name">,
  ceoAgentId: BoardAgentId,
): BoardTaskCreateInput {
  return {
    companyId: company.id,
    title: "Recommend who to hire",
    description: [
      `Propose the team ${company.name} needs for its mission. Check who is already here with board_list_agents, which also lists hire requests still waiting, and propose only the roles that are missing. Keep the team as small as the mission allows.`,
      "Request each person with board_request_hire and fill everything in: name, job title, department, manager, skills from the library, standing instructions (what they own and how they work), and why the team needs them. Request a manager before their reports, and set each report's reportsToHireId to their manager's request.",
      "Don't start the work itself or create subtasks. Nobody joins until I approve their request on the org chart. When you're done, comment with the org chart you proposed and move this task to review.",
    ].join("\n\n"),
    status: "todo",
    assigneeAgentId: ceoAgentId,
  };
}

/**
 * The board titles threads "Name: card" and "Review (Name): card"; under the employee's own
 * name the prefix only repeats what the tree already shows.
 */
export function employeeThreadTitle(title: string, agentName: string): string {
  const reviewPrefix = `Review (${agentName}): `;
  if (title.startsWith(reviewPrefix)) return `Review: ${title.slice(reviewPrefix.length)}`;
  const workPrefix = `${agentName}: `;
  return title.startsWith(workPrefix) ? title.slice(workPrefix.length) : title;
}

/** How much of a monthly token limit is spent; null when there is no limit. */
export function limitProgress(
  used: number,
  limit: number | null,
): { readonly share: number; readonly nearing: boolean; readonly reached: boolean } | null {
  if (limit === null) return null;
  const share = used / limit;
  return { share, nearing: share >= 0.8 && share < 1, reached: share >= 1 };
}

/** "5M", "250k", or "1,500,000" as a token count; empty means no limit, and junk is invalid. */
export function parseTokenLimit(text: string): number | null | "invalid" {
  const trimmed = text.trim().replaceAll(",", "").replaceAll("_", "").toLowerCase();
  if (trimmed.length === 0) return null;
  const match = /^(\d+(?:\.\d+)?)\s*([km]?)$/.exec(trimmed);
  if (match === null) return "invalid";
  const scale = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const value = Math.round(Number(match[1]) * scale);
  return value >= 1 ? value : "invalid";
}

/** The repeat choices a routine offers, in days. */
export const ROUTINE_REPEATS: ReadonlyArray<number> = [1, 7, 14, 30];

export function repeatLabel(everyDays: number): string {
  if (everyDays === 1) return "Every day";
  if (everyDays === 7) return "Every week";
  if (everyDays % 7 === 0) return `Every ${everyDays / 7} weeks`;
  return `Every ${everyDays} days`;
}

/** A date as a `datetime-local` input value, in the viewer's time zone. */
export function localDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
