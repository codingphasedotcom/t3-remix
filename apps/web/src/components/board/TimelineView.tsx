import type {
  BoardSnapshot,
  BoardTaskId,
  BoardTimelineCommit,
  BoardTimelineEvent,
  BoardTimelineGit,
  BoardTimelineView,
  BoardWorkLink,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import {
  ChartGanttIcon,
  CircleDotIcon,
  ClipboardPlusIcon,
  FileTextIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GlobeIcon,
  HistoryIcon,
  LinkIcon,
  ListIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { boardLive } from "../../state/board";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { AgentFace } from "./AgentAvatar";
import { agentById, boardStatusLabel } from "./board.logic";
import { useCompanyProjects } from "./CompanyWorkspaceField";
import { TimelineChart } from "./TimelineChart";
import {
  REMIX_CARD,
  REMIX_COLUMN_TONES,
  REMIX_SHELL,
  RemixBubble,
  RemixButton,
  RemixChip,
  RemixIconTile,
  type RemixTone,
} from "./RemixSurface";

const dayKey = (at: string) => new Date(at).toLocaleDateString("en-CA");
const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function dayLabel(key: string): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key === dayKey(today.toISOString())) return "Today";
  if (key === dayKey(yesterday.toISOString())) return "Yesterday";
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(year === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Items in local days, keeping the newest-first order they arrive in. */
function byDay<Item extends { readonly at: string }>(items: ReadonlyArray<Item>) {
  const days: Array<{ readonly key: string; readonly items: Array<Item> }> = [];
  for (const item of items) {
    const key = dayKey(item.at);
    const last = days.at(-1);
    if (last?.key === key) last.items.push(item);
    else days.push({ key, items: [item] });
  }
  return days;
}

const VIEWS: ReadonlyArray<{
  readonly view: BoardTimelineView;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
}> = [
  {
    view: "tasks",
    label: "Tasks",
    icon: ChartGanttIcon,
    description: "Each task from when it was created until it was done.",
  },
  {
    view: "updates",
    label: "Updates",
    icon: ListIcon,
    description: "What happened on every task, in the last 30 days.",
  },
  {
    view: "git",
    label: "Git",
    icon: GitCommitHorizontalIcon,
    description: "How the code moved: what landed, and what is waiting to merge.",
  },
];

/** The company's story: its tasks over time, what happened day by day, or how its code moved. */
export function TimelineView(props: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const [view, setView] = useState<BoardTimelineView>("tasks");
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const companyId = props.snapshot.company?.id ?? null;
  const query = useEnvironmentQuery(
    companyId === null
      ? null
      : boardLive({
          environmentId: props.environmentId,
          input: {
            companyId,
            timeline: { view, ...(projectId === null ? {} : { projectId }) },
          },
        }),
  );
  const snapshot = query.data ?? props.snapshot;
  const timeline = query.data?.timeline?.view === view ? query.data.timeline : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-(--workspace-gutter-start) pt-1 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <RemixIconTile tone="purple" size="lg">
          <HistoryIcon />
        </RemixIconTile>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-xl font-semibold">Timeline</h2>
          <span className="text-sm text-(--remix-text-muted)">
            {VIEWS.find((entry) => entry.view === view)?.description}
          </span>
        </div>
        <div role="tablist" aria-label="Timeline view" className="flex gap-2">
          {VIEWS.map((entry) => (
            <RemixButton
              key={entry.view}
              role="tab"
              aria-selected={view === entry.view}
              variant={view === entry.view ? "active" : "paper"}
              onClick={() => setView(entry.view)}
            >
              <entry.icon />
              {entry.label}
            </RemixButton>
          ))}
        </div>
      </div>

      {query.error !== null ? (
        <p
          data-remix-tone="pink"
          className={cn(REMIX_CARD, "bg-(--tone-wash) px-3 py-2 text-sm font-medium")}
        >
          Could not load the timeline: {query.error}
        </p>
      ) : timeline === null ? (
        <span className="px-1 text-sm text-(--remix-text-muted)">Loading the timeline…</span>
      ) : timeline.view === "tasks" ? (
        <TimelineChart snapshot={snapshot} spans={timeline.spans} onOpenCard={props.onOpenCard} />
      ) : timeline.git !== null ? (
        <GitTimeline
          environmentId={props.environmentId}
          snapshot={snapshot}
          git={timeline.git}
          onProjectChange={setProjectId}
          onOpenCard={props.onOpenCard}
        />
      ) : (
        <UpdatesTimeline
          snapshot={snapshot}
          events={timeline.events}
          onOpenCard={props.onOpenCard}
        />
      )}
    </div>
  );
}

function TaskButton(props: {
  readonly snapshot: BoardSnapshot;
  readonly taskId: BoardTaskId;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const task = props.snapshot.tasks.find((candidate) => candidate.id === props.taskId);
  if (task === undefined) {
    return <span className="text-xs text-(--remix-text-muted)">a removed task</span>;
  }
  return (
    <button
      type="button"
      onClick={() => props.onOpenCard(task.id)}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-start text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-(--remix-blue) focus-visible:ring-inset"
    >
      <span className="min-w-0 truncate">{task.title}</span>
      <RemixChip tone={REMIX_COLUMN_TONES[task.status]} variant="wash">
        {task.archivedAt === null ? boardStatusLabel(task.status) : "Archived"}
      </RemixChip>
    </button>
  );
}

const LINK_ICONS: Record<BoardWorkLink["kind"], LucideIcon> = {
  pull_request: PullRequestGlyph.pullRequest,
  branch: GitBranchIcon,
  preview: GlobeIcon,
  commit: GitCommitHorizontalIcon,
  document: FileTextIcon,
  other: LinkIcon,
  file: FileTextIcon,
};

const LINK_TONES: Record<BoardWorkLink["kind"], RemixTone> = {
  pull_request: "purple",
  branch: "teal",
  preview: "blue",
  commit: "teal",
  document: "orange",
  other: "gray",
  file: "gray",
};

function eventLook(event: BoardTimelineEvent): {
  readonly icon: LucideIcon;
  readonly tone: RemixTone;
} {
  if (event.kind === "created") return { icon: ClipboardPlusIcon, tone: "yellow" };
  if (event.link !== null) {
    return event.link.kind === "pull_request" && event.link.status === "merged"
      ? { icon: PullRequestGlyph.merged, tone: "green" }
      : { icon: LINK_ICONS[event.link.kind], tone: LINK_TONES[event.link.kind] };
  }
  if (/moved .* to Done|merged/i.test(event.text)) return { icon: CircleDotIcon, tone: "green" };
  if (/Blocked|could not|failed/i.test(event.text)) return { icon: CircleDotIcon, tone: "pink" };
  return { icon: CircleDotIcon, tone: "blue" };
}

function UpdatesTimeline(props: {
  readonly snapshot: BoardSnapshot;
  readonly events: ReadonlyArray<BoardTimelineEvent>;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  if (props.events.length === 0) {
    return <EmptyTimeline title="Nothing happened in the last 30 days" />;
  }
  return (
    <div className="flex flex-col gap-3">
      {byDay(props.events).map((day) => (
        <section key={day.key} data-remix-tone="blue" className={cn(REMIX_SHELL, "gap-3 p-3 pt-4")}>
          <div className="flex items-center justify-between gap-3 px-1">
            <RemixBubble tone="blue">{dayLabel(day.key)}</RemixBubble>
            <span className="text-xs text-(--remix-text-muted) tabular-nums">
              {day.items.length} {day.items.length === 1 ? "event" : "events"}
            </span>
          </div>
          <ol className={cn(REMIX_CARD, "gap-0 p-2")}>
            {day.items.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                snapshot={props.snapshot}
                onOpenCard={props.onOpenCard}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EventRow(props: {
  readonly event: BoardTimelineEvent;
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const { event } = props;
  const look = eventLook(event);
  const Icon = look.icon;
  // The board's updates name who acted first, such as "Grace started working."
  const agent =
    agentById(props.snapshot.agents, event.agentId) ??
    (event.kind === "update"
      ? (props.snapshot.agents.find((candidate) => event.text.startsWith(`${candidate.name} `)) ??
        null)
      : null);
  const href = event.link !== null && /^https?:\/\//.test(event.link.url) ? event.link.url : null;
  const what =
    event.kind === "created" ? (
      <span>{agent === null ? "Task created" : `${agent.name} created a task`}</span>
    ) : event.link !== null ? (
      <span className="flex min-w-0 items-center gap-2">
        {href === null ? (
          <span className="min-w-0 truncate font-mono text-xs">{event.text}</span>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate hover:underline"
          >
            {event.text}
          </a>
        )}
        {event.link.status === null ? null : (
          <RemixChip tone={event.link.status === "merged" ? "green" : "gray"} variant="wash">
            {event.link.status}
          </RemixChip>
        )}
      </span>
    ) : (
      <span className="min-w-0">{event.text}</span>
    );
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-lg px-2 py-2 hover:bg-(--remix-inset)">
      <span className="w-14 shrink-0 pt-1 text-end text-xs text-(--remix-text-muted) tabular-nums">
        {timeOf(event.at)}
      </span>
      <RemixIconTile tone={look.tone} size="md">
        <Icon />
      </RemixIconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {agent !== null ? <AgentFace agent={agent} name={agent.name} size="xs" /> : null}
          {what}
        </div>
        <TaskButton snapshot={props.snapshot} taskId={event.taskId} onOpenCard={props.onOpenCard} />
      </div>
    </li>
  );
}

function GitTimeline(props: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly git: BoardTimelineGit;
  readonly onProjectChange: (projectId: ProjectId) => void;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const { git, snapshot } = props;
  const allProjects = useCompanyProjects(props.environmentId);
  const used = new Set([
    snapshot.company?.projectId,
    ...snapshot.tasks.map((task) => task.projectId),
  ]);
  const projects = allProjects.filter((project) => used.has(project.id));
  const project = projects.find((candidate) => candidate.id === git.projectId) ?? null;
  const openPullRequests = git.pullRequests.filter(
    (link) => link.status === "open" || link.status === "draft",
  );
  const prUrl = (number: number) =>
    git.pullRequests.find((link) => new RegExp(`/pull/${number}(?:$|[/?#])`).test(link.url))?.url ??
    null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {projects.length > 1 ? (
          <Select
            value={git.projectId}
            onValueChange={(value) => props.onProjectChange(value as ProjectId)}
          >
            <SelectTrigger size="sm" className="w-auto max-w-72">
              <SelectValue>{project?.title ?? "Project"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id} label={candidate.title}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : (
          <span className="font-semibold">{project?.title ?? "Home project"}</span>
        )}
        {git.branch !== null ? (
          <RemixChip tone="teal" variant="wash">
            <GitBranchIcon className="size-3" />
            {git.branch}
          </RemixChip>
        ) : null}
      </div>

      {git.problem !== null ? (
        <EmptyTimeline title={git.problem} warning />
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-12">
          <section
            data-remix-tone="orange"
            className={cn(REMIX_SHELL, "gap-3 p-3 pt-4 xl:col-span-4")}
          >
            <div className="flex items-center justify-between gap-3 px-1">
              <RemixBubble tone="orange">Waiting to merge</RemixBubble>
              <span className="text-xs text-(--remix-text-muted) tabular-nums">
                {openPullRequests.length + git.unmerged.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {openPullRequests.map((link) => (
                <WaitingRow
                  key={link.id}
                  icon={<PullRequestGlyph.pullRequest />}
                  tone="purple"
                  title={
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate hover:underline"
                    >
                      {link.title}
                    </a>
                  }
                  at={link.createdAt}
                  taskId={link.taskId}
                  snapshot={snapshot}
                  onOpenCard={props.onOpenCard}
                />
              ))}
              {git.unmerged.map((branch) => (
                <WaitingRow
                  key={branch.name}
                  icon={<GitBranchIcon />}
                  tone="teal"
                  title={<span className="min-w-0 truncate font-mono text-xs">{branch.name}</span>}
                  at={branch.at}
                  taskId={branch.taskId}
                  snapshot={snapshot}
                  onOpenCard={props.onOpenCard}
                />
              ))}
              {openPullRequests.length + git.unmerged.length === 0 ? (
                <span className={cn(REMIX_CARD, "text-sm text-(--remix-text-muted)")}>
                  Every task's work is merged.
                </span>
              ) : null}
            </div>
          </section>

          <section
            data-remix-tone="green"
            className={cn(REMIX_SHELL, "gap-3 p-3 pt-4 xl:col-span-8")}
          >
            <div className="flex items-center justify-between gap-3 px-1">
              <RemixBubble tone="green">History</RemixBubble>
              <span className="text-xs text-(--remix-text-muted) tabular-nums">
                {git.commits.length} commits
              </span>
            </div>
            {git.commits.length === 0 ? (
              <span className={cn(REMIX_CARD, "text-sm text-(--remix-text-muted)")}>
                No commits yet.
              </span>
            ) : (
              byDay(git.commits).map((day) => (
                <div key={day.key} className="flex flex-col gap-1.5">
                  <span className="px-1 text-xs font-semibold text-(--remix-text-muted)">
                    {dayLabel(day.key)}
                  </span>
                  <ol className={cn(REMIX_CARD, "gap-0 p-2")}>
                    {day.items.map((commit, index) => (
                      <CommitRow
                        key={commit.sha}
                        commit={commit}
                        last={index === day.items.length - 1}
                        prUrl={commit.pullRequest === null ? null : prUrl(commit.pullRequest)}
                        snapshot={snapshot}
                        onOpenCard={props.onOpenCard}
                      />
                    ))}
                  </ol>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function WaitingRow(props: {
  readonly icon: ReactNode;
  readonly tone: RemixTone;
  readonly title: ReactNode;
  readonly at: string;
  readonly taskId: BoardTaskId;
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  return (
    <div className={cn(REMIX_CARD, "flex-row items-start gap-3 p-3 text-sm")}>
      <RemixIconTile tone={props.tone} size="md">
        {props.icon}
      </RemixIconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {props.title}
          <span className="ms-auto shrink-0 text-xs text-(--remix-text-muted) tabular-nums">
            {formatRelativeTimeLabel(props.at)}
          </span>
        </div>
        <TaskButton snapshot={props.snapshot} taskId={props.taskId} onOpenCard={props.onOpenCard} />
      </div>
    </div>
  );
}

function CommitRow(props: {
  readonly commit: BoardTimelineCommit;
  readonly last: boolean;
  readonly prUrl: string | null;
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const { commit } = props;
  const landed = commit.merge || commit.taskId !== null;
  return (
    <li className="relative flex min-w-0 items-start gap-3 rounded-lg px-2 py-2 hover:bg-(--remix-inset)">
      {/* The line that joins each commit to the one before it. */}
      {props.last ? null : (
        <span
          aria-hidden
          className="absolute top-9 bottom-0 left-[1.4rem] w-0.5 bg-(--remix-card-line)"
        />
      )}
      {landed ? (
        <RemixIconTile tone="green" size="md">
          <PullRequestGlyph.merged />
        </RemixIconTile>
      ) : (
        <RemixIconTile tone="gray" size="md">
          <GitCommitHorizontalIcon />
        </RemixIconTile>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className={cn("min-w-0 truncate", landed && "font-medium")}>{commit.subject}</span>
          {commit.pullRequest !== null ? (
            props.prUrl === null ? (
              <RemixChip tone="purple" variant="wash">
                #{commit.pullRequest}
              </RemixChip>
            ) : (
              <a href={props.prUrl} target="_blank" rel="noreferrer" className="shrink-0">
                <RemixChip tone="purple" variant="wash">
                  #{commit.pullRequest}
                </RemixChip>
              </a>
            )
          ) : null}
          <span className="ms-auto shrink-0 text-xs text-(--remix-text-muted) tabular-nums">
            {timeOf(commit.at)}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-(--remix-text-muted)">
          <span className="font-mono">{commit.sha.slice(0, 7)}</span>
          <span className="truncate">{commit.author}</span>
        </div>
        {commit.taskId !== null ? (
          <TaskButton
            snapshot={props.snapshot}
            taskId={commit.taskId}
            onOpenCard={props.onOpenCard}
          />
        ) : null}
      </div>
    </li>
  );
}

function EmptyTimeline(props: { readonly title: string; readonly warning?: boolean }) {
  return (
    <div className={cn(REMIX_CARD, "flex-row items-center gap-3 text-sm")}>
      <RemixIconTile tone={props.warning === true ? "yellow" : "gray"} size="md">
        {props.warning === true ? <TriangleAlertIcon /> : <HistoryIcon />}
      </RemixIconTile>
      <span>{props.title}</span>
    </div>
  );
}
