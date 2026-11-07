import type {
  BoardAgentId,
  BoardComment,
  BoardRun,
  BoardTask,
  BoardTaskId,
  BoardTimelineBranch,
  BoardTimelineCommit,
  BoardTimelineEvent,
  BoardTimelineGit,
  BoardTimelineSpan,
  BoardWorkLink,
  ProjectId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export const TIMELINE_DAYS = 30;
const MAX_TIMELINE_EVENTS = 500;
const MAX_TIMELINE_COMMITS = 200;
const MAX_TIMELINE_SPANS = 300;

/**
 * Each top-level task outside Ideas, from creation until it was done, newest first. Subtasks fold
 * into their top-level task, which gathers everyone who ran on any of them.
 */
export function timelineSpans(input: {
  readonly tasks: ReadonlyArray<{ readonly task: BoardTask; readonly statusChangedAt: string }>;
  readonly runs: ReadonlyArray<BoardRun>;
}): ReadonlyArray<BoardTimelineSpan> {
  const byId = new Map(input.tasks.map(({ task }) => [task.id, task]));
  const rootOf = (task: BoardTask) => {
    let current = task;
    for (let depth = 0; current.parentTaskId !== null && depth < byId.size; depth++) {
      const parent = byId.get(current.parentTaskId);
      if (parent === undefined) break;
      current = parent;
    }
    return current.id;
  };
  const subtasks = new Map<BoardTaskId, number>();
  for (const { task } of input.tasks) {
    if (task.parentTaskId === null) continue;
    const root = rootOf(task);
    subtasks.set(root, (subtasks.get(root) ?? 0) + 1);
  }
  const agents = new Map<BoardTaskId, Array<BoardAgentId>>();
  for (const run of input.runs.toSorted((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  )) {
    const task = byId.get(run.taskId);
    if (task === undefined) continue;
    const root = rootOf(task);
    const list = agents.get(root) ?? [];
    if (!list.includes(run.agentId)) list.push(run.agentId);
    agents.set(root, list);
  }
  return input.tasks
    .filter(({ task }) => task.parentTaskId === null && task.status !== "backlog")
    .map(({ task, statusChangedAt }) => ({
      taskId: task.id,
      start: task.createdAt,
      end: task.status === "done" ? statusChangedAt : null,
      agentIds:
        agents.get(task.id) ?? (task.assigneeAgentId === null ? [] : [task.assigneeAgentId]),
      subtasks: subtasks.get(task.id) ?? 0,
    }))
    .toSorted((left, right) => right.start.localeCompare(left.start))
    .slice(0, MAX_TIMELINE_SPANS);
}

/** Task creations, the board's updates, and linked work since `since`, newest first. */
export function timelineEvents(input: {
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly updates: ReadonlyArray<BoardComment>;
  readonly links: ReadonlyArray<BoardWorkLink>;
  readonly since: string;
}): ReadonlyArray<BoardTimelineEvent> {
  const events: Array<BoardTimelineEvent> = [];
  for (const task of input.tasks) {
    if (task.createdAt < input.since) continue;
    events.push({
      id: `created:${task.id}`,
      kind: "created",
      taskId: task.id,
      agentId: task.createdByAgentId,
      text: "",
      link: null,
      at: task.createdAt,
    });
  }
  for (const update of input.updates) {
    events.push({
      id: `update:${update.id}`,
      kind: "update",
      taskId: update.taskId,
      agentId: update.authorAgentId,
      text: update.body,
      link: null,
      at: update.createdAt,
    });
  }
  for (const link of input.links) {
    if (link.kind === "file" || link.createdAt < input.since) continue;
    events.push({
      id: `link:${link.id}`,
      kind: "link",
      taskId: link.taskId,
      agentId: link.agentId,
      text: link.title,
      link: { kind: link.kind, url: link.url, status: link.status },
      at: link.createdAt,
    });
  }
  return events
    .toSorted((left, right) => right.at.localeCompare(left.at))
    .slice(0, MAX_TIMELINE_EVENTS);
}

export interface TaskBranch {
  readonly taskId: BoardTaskId;
  readonly branch: string;
  /** When the task was created; its branch can't hold work from before then. */
  readonly createdAt: string;
}

/** Which task each branch name and pull request number belongs to, within one project. */
export interface GitTaskIndex {
  readonly branches: ReadonlyMap<string, TaskBranch>;
  readonly pullRequests: ReadonlyMap<number, BoardTaskId>;
}

export function gitTaskIndex(input: {
  readonly branches: ReadonlyArray<TaskBranch>;
  readonly links: ReadonlyArray<BoardWorkLink>;
}): GitTaskIndex {
  const pullRequests = new Map<number, BoardTaskId>();
  for (const link of input.links) {
    const number = link.kind === "pull_request" ? /\/pull\/(\d+)/.exec(link.url)?.[1] : undefined;
    if (number !== undefined) pullRequests.set(Number(number), link.taskId);
  }
  return {
    branches: new Map(input.branches.map((entry) => [entry.branch, entry])),
    pullRequests,
  };
}

const FIELD = "\u001f";
const RECORD = "\u001e";
const GIT_LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e";
const UNMERGED_FORMAT = "%(refname:short)%1f%(committerdate:iso-strict)%1f%(subject)%1e";

const toIso = (at: string) =>
  Option.getOrNull(Option.map(DateTime.make(at), (value) => DateTime.formatIso(value)));

/** GitHub's "Merge pull request #12 from …" and squash merges' "Title (#12)". */
function pullRequestOf(subject: string): number | null {
  const number =
    /^Merge pull request #(\d+)\b/.exec(subject)?.[1] ?? /\(#(\d+)\)\s*$/.exec(subject)?.[1];
  return number === undefined ? null : Number(number);
}

/** The branch a merge commit's subject names: GitHub's, git's own, and the board's "Merge x: …". */
function mergedBranchOf(subject: string): string | null {
  return (
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)?.[1] ??
    /^Merge branch '([^']+)'/.exec(subject)?.[1] ??
    /^Merge (\S+): /.exec(subject)?.[1] ??
    null
  );
}

/** Parses `git log --format=GIT_LOG_FORMAT`, matching each commit to the task it landed. */
export function parseGitLog(
  output: string,
  index: GitTaskIndex,
): ReadonlyArray<BoardTimelineCommit> {
  return output.split(RECORD).flatMap((record): Array<BoardTimelineCommit> => {
    const [sha = "", parents = "", author = "", date = "", refs = "", subject = ""] = record
      .trim()
      .split(FIELD);
    const at = toIso(date);
    if (sha.length === 0 || at === null) return [];
    const pullRequest = pullRequestOf(subject);
    const merged = mergedBranchOf(subject);
    // A branch that fast-forwarded leaves its name on the commit it ended at. One that never got
    // a commit names the commit it started from, which is older than its task. The checked-out
    // branch is never a task's own.
    const fastForwarded = refs
      .split(", ")
      .filter((ref) => !ref.startsWith("HEAD -> "))
      .map((ref) => index.branches.get(ref))
      .find((entry) => entry !== undefined && entry.createdAt <= at);
    const taskId =
      (pullRequest === null ? undefined : index.pullRequests.get(pullRequest)) ??
      (merged === null ? undefined : index.branches.get(merged)?.taskId) ??
      fastForwarded?.taskId ??
      null;
    return [
      {
        sha,
        subject,
        author,
        at,
        merge: parents.split(" ").filter((parent) => parent.length > 0).length > 1,
        taskId,
        pullRequest,
      },
    ];
  });
}

/** "host/owner/repo" from a remote URL or a pull request's URL, so the two can be compared. */
export function repositoryOf(url: string): string | null {
  const match =
    /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:[/?#]|$)/i.exec(
      url.trim(),
    );
  return match === null ? null : `${match[1]}/${match[2]}/${match[3]}`.toLowerCase();
}

/** Parses `git for-each-ref --format=UNMERGED_FORMAT`, keeping only tasks' branches. */
export function parseUnmergedBranches(
  output: string,
  index: GitTaskIndex,
): ReadonlyArray<BoardTimelineBranch> {
  return output
    .split(RECORD)
    .flatMap((record): Array<BoardTimelineBranch> => {
      const [name = "", date = "", subject = ""] = record.trim().split(FIELD);
      const taskId = index.branches.get(name)?.taskId;
      const at = toIso(date);
      return taskId === undefined || at === null ? [] : [{ name, taskId, subject, at }];
    })
    .toSorted((left, right) => right.at.localeCompare(left.at));
}

/** Reads the checked-out branch's history and the tasks' unmerged branches in a project folder. */
export const makeReadGitTimeline = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  return Effect.fn("BoardTimeline.readGit")(function* (input: {
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly branches: ReadonlyArray<TaskBranch>;
    /** Every link on the company's tasks. */
    readonly links: ReadonlyArray<BoardWorkLink>;
    /** The tasks in this project, for pull requests when the folder has no remote to match. */
    readonly inProject: ReadonlySet<BoardTaskId>;
  }) {
    const run = (operation: string, args: ReadonlyArray<string>) =>
      git.execute({
        operation: `BoardTimeline.${operation}`,
        cwd: input.workspaceRoot,
        args,
        allowNonZeroExit: true,
      });
    // Two projects can be checkouts of one repository, so pull requests follow the repository.
    const remote = yield* run("remote", ["remote", "get-url", "origin"]);
    const repository = remote.exitCode === 0 ? repositoryOf(remote.stdout) : null;
    const pullRequests = input.links
      .filter(
        (link) =>
          link.kind === "pull_request" &&
          (repository === null
            ? input.inProject.has(link.taskId)
            : repositoryOf(link.url) === repository),
      )
      .toReversed();
    const index = gitTaskIndex({ branches: input.branches, links: pullRequests });
    const empty = (problem: string | null, branch: string | null = null): BoardTimelineGit => ({
      projectId: input.projectId,
      branch,
      commits: [],
      unmerged: [],
      pullRequests,
      problem,
    });
    const head = yield* run("branch", ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (head.exitCode !== 0) {
      return empty("The project folder isn't a git repository with a commit yet.");
    }
    const branch = head.stdout.trim() === "HEAD" ? null : head.stdout.trim();
    const log = yield* run("log", [
      "log",
      "--first-parent",
      `--max-count=${MAX_TIMELINE_COMMITS}`,
      `--format=${GIT_LOG_FORMAT}`,
      "HEAD",
    ]);
    if (log.exitCode !== 0) return empty("Git could not read the project's history.", branch);
    const unmerged = yield* run("unmerged", [
      "for-each-ref",
      "--no-merged=HEAD",
      `--format=${UNMERGED_FORMAT}`,
      "refs/heads",
    ]);
    return {
      ...empty(null, branch),
      commits: parseGitLog(log.stdout, index),
      unmerged: unmerged.exitCode === 0 ? parseUnmergedBranches(unmerged.stdout, index) : [],
    } satisfies BoardTimelineGit;
  });
});
