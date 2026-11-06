import type {
  BoardAgent,
  BoardAgentThread,
  BoardDashboard,
  BoardDashboardDay,
  BoardDepartmentId,
  BoardRunKind,
  BoardRunStatus,
  BoardSnapshot,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
} from "@t3tools/shared/usageFormat";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  BotIcon,
  CircleCheckIcon,
  EyeIcon,
  GaugeIcon,
  InboxIcon,
  KanbanSquareIcon,
  LightbulbIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PlayIcon,
  PlusIcon,
  UserPlusIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { boardLive } from "../../state/board";
import { useEnvironmentQuery } from "../../state/query";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { niceScale } from "../usage/UsageProviderChart";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentAvatar, AgentFace, AgentName, YouName } from "./AgentAvatar";
import { agentById, boardStatusLabel, limitProgress } from "./board.logic";
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
import {
  attentionItems,
  averageRunMs,
  browserUtcOffsetMinutes,
  cachedShare,
  cardsByColumn,
  departmentRows,
  employeeRows,
  formatSpan,
  hasAttentionItems,
  priorityTasks,
  recentThreads,
  successRate,
  totalTokens,
  type ActivityMetric,
  type AttentionItems,
  type EmployeeActivity,
} from "./dashboard.logic";

// Neighbours alternate warm and cool so they stay apart under colour blindness. The ninth
// department starts over.
const DEPARTMENT_TONES: ReadonlyArray<RemixTone> = [
  "blue",
  "orange",
  "purple",
  "green",
  "pink",
  "yellow",
  "teal",
  "red",
];

const METRICS: ReadonlyArray<{
  readonly id: ActivityMetric;
  readonly label: string;
  readonly tone: RemixTone;
}> = [
  { id: "runs", label: "Runs", tone: "blue" },
  { id: "tasksFinished", label: "Tasks finished", tone: "green" },
  { id: "tokens", label: "Tokens", tone: "purple" },
];

const percentOrDash = (share: number | null) => (share === null ? "–" : formatPercent(share, 0));
const spanOrDash = (ms: number | null) => (ms === null ? "–" : formatSpan(ms));

export function DashboardView(props: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
  readonly onOpenBoard: () => void;
  readonly onOpenOrgChart: () => void;
  readonly onNewTask: () => void;
}) {
  // Fixed for the page's life so the live query keeps one subscription.
  const [utcOffsetMinutes] = useState(browserUtcOffsetMinutes);
  const [metric, setMetric] = useState<ActivityMetric>("runs");
  const companyId = props.snapshot.company?.id ?? null;
  const query = useEnvironmentQuery(
    companyId === null
      ? null
      : boardLive({
          environmentId: props.environmentId,
          input: { companyId, dashboard: { utcOffsetMinutes } },
        }),
  );
  // Until the board with its dashboard arrives, the page's own board fills in.
  const snapshot = query.data ?? props.snapshot;
  const dashboard = query.data?.dashboard ?? null;
  const employees = employeeRows(snapshot, dashboard);
  const columns = cardsByColumn(snapshot.tasks);
  const attention = attentionItems(snapshot);
  const navigate = useNavigate();
  const openThread = (threadId: ThreadId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
    });
  const totals = dashboard?.totals ?? null;
  const openCards = snapshot.tasks.filter((task) => task.status !== "done").length;
  const blocked = columns.find((column) => column.status === "blocked")?.count ?? 0;
  const inReview = columns.find((column) => column.status === "review")?.count ?? 0;
  const doneAllTime = columns.find((column) => column.status === "done")?.count ?? 0;
  const finishedRecently =
    dashboard?.days.reduce((total, day) => total + day.tasksFinished, 0) ?? null;
  const paused = snapshot.agents.filter((agent) => agent.paused).length;
  const departments = snapshot.company?.departments ?? [];
  const departmentTone = (departmentId: BoardDepartmentId | null) => {
    const index = departments.findIndex((department) => department.id === departmentId);
    return index === -1 ? null : (DEPARTMENT_TONES[index % DEPARTMENT_TONES.length] ?? null);
  };
  const loading = (value: ReactNode) => (dashboard === null ? null : value);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-(--workspace-gutter-start) pt-1 pb-14">
      {query.error !== null ? (
        <p
          data-remix-tone="pink"
          className={cn(REMIX_CARD, "bg-(--tone-wash) px-3 py-2 text-sm font-medium")}
        >
          Could not load run history: {query.error}
        </p>
      ) : null}

      <Greeting
        name={snapshot.company?.name ?? "your company"}
        today={dashboard?.days.at(-1)?.day ?? null}
        summary={`${formatCount(totals?.running ?? 0)} working now · ${formatCount(blocked + inReview)} waiting on you · ${formatCount(finishedRecently ?? 0)} finished in 14 days`}
      />

      <div className="grid gap-3 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-3 xl:col-span-5">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Open tasks"
              icon={ListTodoIcon}
              tone="orange"
              value={formatCount(openCards)}
              total={formatCount(snapshot.tasks.length)}
              detail={`${blocked} blocked · ${inReview} in review`}
              linkLabel="Open the board"
              onOpen={props.onOpenBoard}
            />
            <StatTile
              label="Working now"
              icon={BotIcon}
              tone="blue"
              value={loading(formatCount(totals?.running ?? 0))}
              total={formatCount(snapshot.agents.length)}
              detail={`${paused} paused`}
              linkLabel="Open the org chart"
              onOpen={props.onOpenOrgChart}
            />
            <StatTile
              label="Finished, 14 days"
              icon={CircleCheckIcon}
              tone="green"
              value={loading(formatCount(finishedRecently ?? 0))}
              detail={`${formatCount(doneAllTime)} done all time · median ${spanOrDash(dashboard?.medianCycleMs ?? null)}`}
              linkLabel="Open the board"
              onOpen={props.onOpenBoard}
            />
            <StatTile
              label="Run success"
              icon={GaugeIcon}
              tone="teal"
              value={loading(percentOrDash(totals === null ? null : successRate(totals)))}
              detail={
                totals === null ? "" : `${totals.failed} failed of ${formatCount(totals.runs)}`
              }
            />
          </div>
          <TokenBudget snapshot={snapshot} dashboard={dashboard} />
        </div>

        <Panel
          className="xl:col-span-7"
          title="Tasks"
          tone="orange"
          count={openCards}
          aside={
            <div className="flex items-center gap-1.5">
              <RemixButton size="sm" onClick={props.onOpenBoard}>
                <KanbanSquareIcon />
                Open board
              </RemixButton>
              <RemixButton
                size="sm"
                variant="go"
                disabled={!props.canOperate}
                onClick={props.onNewTask}
              >
                <PlusIcon />
                New task
              </RemixButton>
            </div>
          }
        >
          <TaskTable snapshot={snapshot} onOpenCard={props.onOpenCard} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Activity, last 14 days"
          tone="blue"
          aside={
            <div role="group" aria-label="Activity metric" className="flex flex-wrap gap-1.5">
              {METRICS.map((option) => (
                <RemixButton
                  key={option.id}
                  size="sm"
                  variant={metric === option.id ? "active" : "paper"}
                  aria-pressed={metric === option.id}
                  onClick={() => setMetric(option.id)}
                >
                  {option.label}
                </RemixButton>
              ))}
            </div>
          }
        >
          {dashboard === null ? (
            <Skeleton className="h-48" />
          ) : (
            <ActivityChart days={dashboard.days} metric={metric} />
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-3">
          {hasAttentionItems(attention) ? (
            <Panel
              title="Needs attention"
              tone="pink"
              count={
                attention.blocked.length +
                attention.unassigned.length +
                attention.failed.length +
                (attention.pendingHires > 0 ? 1 : 0)
              }
            >
              <AttentionList
                attention={attention}
                agents={snapshot.agents}
                tasks={snapshot.tasks}
                onOpenCard={props.onOpenCard}
                onOpenOrgChart={props.onOpenOrgChart}
                onOpenThread={openThread}
              />
            </Panel>
          ) : null}
          <Panel className="flex-1" title="Recent runs" tone="teal">
            <RecentRuns snapshot={snapshot} onOpenCard={props.onOpenCard} />
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
        <Panel className="lg:col-span-2 xl:col-span-6" title="Models" tone="purple">
          {dashboard === null ? (
            <Skeleton className="h-32" />
          ) : (
            <ModelsTable dashboard={dashboard} agents={snapshot.agents} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title="Departments" tone="orange">
          <BarList
            rows={departmentRows(snapshot, employees).map((department) => ({
              key: department.id,
              label: department.name,
              value: department.openCards,
              display: `${department.openCards} open · ${department.headcount} ${department.headcount === 1 ? "person" : "people"}`,
              tone: departmentTone(department.id) ?? "gray",
            }))}
          />
        </Panel>

        <Panel className="xl:col-span-3" title="Tasks by column" tone="yellow">
          <BarList
            rows={columns.map((column) => ({
              key: column.status,
              label: column.label,
              value: column.count,
              display: formatCount(column.count),
              tone: REMIX_COLUMN_TONES[column.status],
            }))}
          />
        </Panel>
      </div>

      <Panel title="Employees" tone="green" count={employees.length}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Status</TableHead>
              <NumberHead>Open</NumberHead>
              <NumberHead>Done</NumberHead>
              <NumberHead>Runs</NumberHead>
              <NumberHead>Success</NumberHead>
              <NumberHead>Avg run</NumberHead>
              <NumberHead>Tokens</NumberHead>
              <NumberHead>Last run</NumberHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((row) => (
              <TableRow key={row.agent.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <AgentAvatar
                      agent={row.agent}
                      name={row.agent.name}
                      title={row.role}
                      muted={row.agent.paused}
                    />
                    <span className="flex flex-col leading-tight">
                      <span className="text-sm font-semibold">{row.agent.name}</span>
                      <span className="text-(--remix-text-muted)">{row.role}</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <DepartmentName
                    name={row.department}
                    tone={departmentTone(row.agent.departmentId)}
                  />
                </TableCell>
                <TableCell>
                  <ModelName model={row.agent.modelSelection.model} />
                </TableCell>
                <TableCell>
                  <ActivityBadge activity={row.activity} />
                </TableCell>
                <NumberCell>{formatCount(row.openCards)}</NumberCell>
                <NumberCell>{formatCount(row.doneCards)}</NumberCell>
                <NumberCell>{loading(formatCount(row.stats.runs))}</NumberCell>
                <NumberCell>{loading(percentOrDash(successRate(row.stats)))}</NumberCell>
                <NumberCell>{loading(spanOrDash(averageRunMs(row.stats)))}</NumberCell>
                <NumberCell>{loading(formatTokens(totalTokens(row.stats.tokens)))}</NumberCell>
                <NumberCell>
                  {loading(
                    row.stats.lastRunAt === null
                      ? "–"
                      : formatRelativeTimeLabel(row.stats.lastRunAt),
                  )}
                </NumberCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}

function Panel(props: {
  readonly title: string;
  readonly count?: number;
  readonly tone: RemixTone;
  readonly aside?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section data-remix-tone={props.tone} className={cn(REMIX_SHELL, props.className)}>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 px-2.5 pt-2.5 pb-3">
        <h2 className="flex">
          <RemixBubble tone={props.tone} size="sm">
            {props.title}
            {props.count === undefined ? null : `: ${formatCount(props.count)}`}
          </RemixBubble>
        </h2>
        {props.aside}
      </div>
      <div className="mx-1.5 mb-1.5 flex min-w-0 flex-1 flex-col gap-3 rounded-(--remix-well-radius) bg-(--remix-surface) p-3">
        {props.children}
      </div>
    </section>
  );
}

function StatTile(props: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: RemixTone;
  readonly value: ReactNode;
  /** The whole this value is out of, shown small beside it. */
  readonly total?: string;
  readonly detail: string;
  readonly linkLabel?: string;
  readonly onOpen?: () => void;
}) {
  const Icon = props.icon;
  return (
    <div
      data-remix-tone={props.tone}
      className={cn(REMIX_CARD, "gap-2 rounded-2xl p-3 shadow-(--remix-card-lift)")}
    >
      <span className="truncate text-xs font-semibold text-(--remix-text-muted)">
        {props.label}
      </span>
      <div className="flex items-center gap-2">
        <RemixIconTile tone={props.tone} size="md">
          <Icon />
        </RemixIconTile>
        {props.value === null ? (
          <Skeleton className="h-12 w-20" />
        ) : (
          <span className="flex min-w-0 items-baseline gap-0.5 tabular-nums">
            <span className="text-5xl leading-none font-semibold">{props.value}</span>
            {props.total === undefined ? null : (
              <span className="text-lg font-medium text-(--remix-text-muted)">/{props.total}</span>
            )}
          </span>
        )}
        {props.onOpen === undefined ? null : (
          <RemixButton
            size="icon"
            className="ms-auto"
            aria-label={props.linkLabel}
            onClick={props.onOpen}
          >
            <ArrowUpRightIcon />
          </RemixButton>
        )}
      </div>
      <span className="truncate text-xs text-(--remix-text-muted)">{props.detail}</span>
    </div>
  );
}

/** The page's opening line: today's date, the company, and what needs a look. */
function Greeting(props: {
  readonly name: string;
  /** Today in the viewer's time zone, from the dashboard; null until it arrives. */
  readonly today: string | null;
  readonly summary: string;
}) {
  const [month, day] = props.today === null ? [] : formatDayShort(props.today).split(" ");
  return (
    <div
      className={cn(
        REMIX_CARD,
        "flex-row flex-wrap items-center gap-3 p-3 shadow-(--remix-card-lift)",
      )}
    >
      <div className="flex w-12 shrink-0 flex-col overflow-hidden rounded-lg border border-(--remix-card-line) text-center">
        <span className="bg-(--remix-blue) text-2xs leading-4 font-semibold text-white uppercase">
          {month ?? "–"}
        </span>
        <span className="text-lg leading-7 font-semibold tabular-nums">{day ?? "–"}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-xl font-semibold">Hello, {props.name}</h1>
        <span className="truncate text-sm text-(--remix-text-muted)">{props.summary}</span>
      </div>
    </div>
  );
}

function TokenBudget(props: {
  readonly snapshot: BoardSnapshot;
  readonly dashboard: BoardDashboard | null;
}) {
  // The server reads monthly usage only when a limit is set, so null means unknown, not zero.
  const used = props.snapshot.usage?.companyTokens ?? null;
  const limit = props.snapshot.settings?.monthlyTokenLimit ?? null;
  const progress = limitProgress(used ?? 0, limit);
  const totals = props.dashboard?.totals ?? null;
  const recent = props.dashboard?.days.reduce((total, day) => total + day.tokens, 0) ?? null;
  return (
    <Panel className="flex-1" title="Token budget" tone="purple">
      <div className="grid grid-cols-3 gap-2">
        {used === null ? (
          <BudgetFigure label="Last 14 days" value={recent === null ? "–" : formatTokens(recent)} />
        ) : (
          <BudgetFigure label="Used this month" value={formatTokens(used)} />
        )}
        <BudgetFigure label="Monthly limit" value={limit === null ? "None" : formatTokens(limit)} />
        {limit === null ? (
          <BudgetFigure
            label="Input cached"
            value={percentOrDash(totals === null ? null : cachedShare(totals.tokens))}
          />
        ) : (
          <BudgetFigure label="Remaining" value={formatTokens(Math.max(0, limit - (used ?? 0)))} />
        )}
      </div>
      {progress === null ? null : (
        <div className="h-2.5 overflow-hidden rounded-full border-(length:--remix-line-thin) border-(--remix-ink) bg-(--tone-wash)">
          <div
            className="h-full rounded-full bg-(--tone)"
            style={{ width: `${Math.min(1, progress.share) * 100}%` }}
          />
        </div>
      )}
      {props.dashboard === null ? (
        <Skeleton className="h-14" />
      ) : (
        <Sparkline
          values={props.dashboard.days.map((day) => day.tokens)}
          label="Tokens per day, last 14 days"
        />
      )}
    </Panel>
  );
}

function BudgetFigure(props: { readonly label: string; readonly value: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-xs text-(--remix-text-muted)">{props.label}</span>
      <span className="truncate text-lg font-semibold tabular-nums">{props.value}</span>
    </span>
  );
}

function Sparkline(props: { readonly values: ReadonlyArray<number>; readonly label: string }) {
  const peak = Math.max(1, ...props.values);
  const step = 100 / Math.max(1, props.values.length - 1);
  const line = props.values
    .map((value, index) => `${index * step},${28 - (value / peak) * 26}`)
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="w-full grow basis-14"
    >
      <polygon points={`0,30 ${line} 100,30`} className="fill-(--tone-wash)" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-(--tone)"
      />
    </svg>
  );
}

const TASK_ROWS = 6;

const COLUMN_ICONS: Record<BoardTaskStatus, LucideIcon> = {
  backlog: LightbulbIcon,
  todo: ListTodoIcon,
  in_progress: PlayIcon,
  review: EyeIcon,
  blocked: AlertTriangleIcon,
  done: CircleCheckIcon,
};

const TASK_RUN_LABELS: Record<BoardRunKind, string> = {
  work: "Working now",
  review: "Reviewing now",
  reply: "Replying now",
};

/** The open tasks that matter most right now, each one click from its card. */
function TaskTable(props: {
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const tasks = priorityTasks(props.snapshot.tasks, TASK_ROWS);
  if (tasks.length === 0) {
    return <p className="py-8 text-center text-sm text-(--remix-text-muted)">No open tasks</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-(--remix-ink)/15">
      {tasks.map((task) => {
        const Icon = COLUMN_ICONS[task.status];
        const tone = REMIX_COLUMN_TONES[task.status];
        const owner = agentById(props.snapshot.agents, task.assigneeAgentId);
        const parent = props.snapshot.tasks.find((candidate) => candidate.id === task.parentTaskId);
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => props.onOpenCard(task.id)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-start outline-none hover:bg-(--remix-paper-hover) focus-visible:ring-2 focus-visible:ring-(--remix-blue) focus-visible:ring-inset"
            >
              <RemixIconTile tone={tone} size="md">
                <Icon />
              </RemixIconTile>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{task.title}</span>
                <span className="flex min-w-0 items-center gap-1 text-xs text-(--remix-text-muted)">
                  <span className="truncate">
                    {parent === undefined ? "Updated" : `↳ ${parent.title} ·`}{" "}
                    {formatRelativeTimeLabel(task.updatedAt)}
                  </span>
                  {task.commentCount > 0 ? (
                    <span className="flex shrink-0 items-center gap-0.5 tabular-nums">
                      · <MessageSquareIcon className="size-3" /> {task.commentCount}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="hidden w-36 shrink-0 text-xs md:block">
                {owner !== null ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentFace agent={owner} name={owner.name} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-semibold">{owner.name}</span>
                      <span className="truncate text-(--remix-text-muted)">
                        {owner.title || "Employee"}
                      </span>
                    </span>
                  </span>
                ) : task.assignedToUser ? (
                  <YouName size="sm" />
                ) : (
                  <span className="text-(--remix-text-muted)">Unassigned</span>
                )}
              </span>
              <span className="flex w-28 shrink-0 justify-end">
                <RemixChip tone={task.activeRunKind === null ? tone : "blue"}>
                  {task.activeRunKind === null
                    ? boardStatusLabel(task.status)
                    : TASK_RUN_LABELS[task.activeRunKind]}
                </RemixChip>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const RECENT_RUNS = 6;

const RUN_PHRASES: Record<BoardRunKind, Record<BoardRunStatus, string>> = {
  work: {
    running: "is working on",
    completed: "finished",
    failed: "failed on",
    cancelled: "stopped",
  },
  review: {
    running: "is reviewing",
    completed: "reviewed",
    failed: "failed reviewing",
    cancelled: "stopped reviewing",
  },
  reply: {
    running: "is replying on",
    completed: "replied on",
    failed: "failed replying on",
    cancelled: "stopped replying on",
  },
};

const RUN_TONES: Record<BoardRunStatus, RemixTone> = {
  running: "blue",
  completed: "green",
  failed: "red",
  cancelled: "gray",
};

/** Who ran what most recently, newest first. */
function RecentRuns(props: {
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const threads = recentThreads(props.snapshot.threads, RECENT_RUNS);
  if (threads.length === 0) {
    return <p className="text-sm text-(--remix-text-muted)">No runs yet</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {threads.map((thread) => {
        const agent = agentById(props.snapshot.agents, thread.agentId);
        const task = props.snapshot.tasks.find((candidate) => candidate.id === thread.taskId);
        return (
          <li key={thread.threadId}>
            <button
              type="button"
              disabled={task === undefined}
              onClick={() => props.onOpenCard(thread.taskId)}
              className="flex w-full cursor-pointer items-start gap-2 rounded-lg p-1 text-start text-xs outline-none hover:bg-(--remix-paper-hover) focus-visible:ring-2 focus-visible:ring-(--remix-blue) focus-visible:ring-inset disabled:cursor-default"
            >
              <span
                aria-hidden
                data-remix-tone={RUN_TONES[thread.status]}
                className="mt-1.5 size-2.5 shrink-0 rounded-full border-(length:--remix-line-thin) border-(--remix-ink) bg-(--tone)"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1">
                  {agent === null ? (
                    <span className="font-semibold">A former employee</span>
                  ) : (
                    <AgentName agent={agent} className="font-semibold" />
                  )}
                  <span className="shrink-0 text-(--remix-text-muted)">
                    {RUN_PHRASES[thread.kind][thread.status]}
                  </span>
                </span>
                <span className="truncate font-medium">{task?.title ?? "a removed task"}</span>
              </span>
              <span className="shrink-0 text-(--remix-text-muted) tabular-nums">
                {formatRelativeTimeLabel(thread.startedAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const CHART_TICKS = 4;

function ActivityChart(props: {
  readonly days: ReadonlyArray<BoardDashboardDay>;
  readonly metric: ActivityMetric;
}) {
  const values = props.days.map((day) => day[props.metric]);
  const format = props.metric === "tokens" ? formatTokens : formatCount;
  const scale = niceScale(Math.max(0, ...values), CHART_TICKS);
  const option = METRICS.find((entry) => entry.id === props.metric);
  const label = option?.label ?? "";
  const first = props.days[0];
  const middle = props.days[Math.floor(props.days.length / 2)];
  const last = props.days.at(-1);
  if (scale.max === 0) {
    return (
      <div className="flex min-h-48 flex-1 items-center justify-center text-sm font-medium text-(--remix-text-muted)">
        No {label.toLowerCase()} in the last 14 days
      </div>
    );
  }
  return (
    <div data-remix-tone={option?.tone ?? "gray"} className="flex flex-1 flex-col gap-1">
      <div className="flex min-h-48 flex-1 gap-2 pt-5">
        <div className="relative w-10 shrink-0">
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-2xs font-medium tabular-nums text-(--remix-text-muted)"
              style={{ top: `${100 - (tick / scale.max) * 100}%` }}
            >
              {tick === 0 ? "0" : format(tick)}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={`${label} per day: ${props.days.map((day) => `${formatDayShort(day.day)} ${format(day[props.metric])}`).join(", ")}`}
          className="relative flex min-w-0 flex-1 items-end gap-1.5"
        >
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-(--remix-card-line)"
              style={{ top: `${100 - (tick / scale.max) * 100}%` }}
            />
          ))}
          {props.days.map((day) => (
            <Tooltip key={day.day}>
              <TooltipTrigger
                render={
                  <div className="relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-lg hover:bg-(--tone-wash)" />
                }
              >
                {day[props.metric] === 0 ? null : (
                  <div
                    className="relative w-3/5 rounded-t-lg bg-linear-to-t from-(--tone-shell) to-(--tone)"
                    style={{ height: `${(day[props.metric] / scale.max) * 100}%` }}
                  >
                    <span className="absolute -top-4.5 left-1/2 -translate-x-1/2 text-2xs font-semibold whitespace-nowrap tabular-nums">
                      {format(day[props.metric])}
                    </span>
                  </div>
                )}
              </TooltipTrigger>
              <TooltipPopup>
                {formatDayShort(day.day)} · {format(day[props.metric])} {label.toLowerCase()}
              </TooltipPopup>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="flex justify-between ps-12 pt-1 text-2xs font-medium text-(--remix-text-muted)">
        <span>{first === undefined ? "" : formatDayShort(first.day)}</span>
        <span>{middle === undefined ? "" : formatDayShort(middle.day)}</span>
        <span>{last === undefined ? "" : formatDayShort(last.day)}</span>
      </div>
    </div>
  );
}

function BarList(props: {
  readonly rows: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: number;
    readonly display: string;
    readonly tone: RemixTone;
  }>;
}) {
  const peak = Math.max(1, ...props.rows.map((row) => row.value));
  return (
    <div className="flex flex-col gap-2.5">
      {props.rows.map((row) => (
        <div key={row.key} data-remix-tone={row.tone} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-semibold">{row.label}</span>
            <span className="shrink-0 text-xs font-medium tabular-nums text-(--remix-text-muted)">
              {row.display}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full border-(length:--remix-line-thin) border-(--remix-ink) bg-(--tone-wash)">
            <div
              className="h-full rounded-full bg-(--tone)"
              style={{ width: `${(row.value / peak) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function AttentionList(props: {
  readonly attention: AttentionItems;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
  readonly onOpenOrgChart: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { attention } = props;
  return (
    <div className="flex flex-wrap gap-2">
      {attention.pendingHires > 0 ? (
        <RemixButton size="sm" className="max-w-full" onClick={props.onOpenOrgChart}>
          <UserPlusIcon className="text-(--remix-purple)" />
          <span className="min-w-0 truncate">
            {attention.pendingHires} hire {attention.pendingHires === 1 ? "request" : "requests"} to
            review
          </span>
        </RemixButton>
      ) : null}
      {attention.blocked.map((task) => (
        <RemixButton
          key={task.id}
          size="sm"
          className="max-w-full"
          onClick={() => props.onOpenCard(task.id)}
        >
          <AlertTriangleIcon className="text-(--remix-pink)" />
          <span className="min-w-0 truncate">Blocked: {task.title}</span>
        </RemixButton>
      ))}
      {attention.unassigned.map((task) => (
        <RemixButton
          key={task.id}
          size="sm"
          className="max-w-full"
          onClick={() => props.onOpenCard(task.id)}
        >
          <InboxIcon className="text-(--remix-orange)" />
          <span className="min-w-0 truncate">No assignee: {task.title}</span>
        </RemixButton>
      ))}
      {attention.failed.map((thread) => (
        <RemixButton
          key={thread.threadId}
          size="sm"
          className="max-w-full"
          onClick={() => props.onOpenThread(thread.threadId)}
        >
          <XCircleIcon className="text-(--remix-red)" />
          <span className="min-w-0 truncate">
            {failedThreadLabel(thread, props.agents, props.tasks)}
          </span>
        </RemixButton>
      ))}
    </div>
  );
}

const FAILED_RUN_LABELS: Record<BoardRunKind, string> = {
  work: "run",
  review: "review",
  reply: "reply",
};

function failedThreadLabel(
  thread: BoardAgentThread,
  agents: ReadonlyArray<BoardAgent>,
  tasks: ReadonlyArray<BoardTask>,
): string {
  const who = agentById(agents, thread.agentId)?.name ?? "A former employee";
  const task = tasks.find((candidate) => candidate.id === thread.taskId);
  return `${who}'s ${FAILED_RUN_LABELS[thread.kind]} failed: ${task?.title ?? "a removed task"}`;
}

function ModelsTable(props: {
  readonly dashboard: BoardDashboard;
  readonly agents: ReadonlyArray<BoardAgent>;
}) {
  const { models, totals } = props.dashboard;
  if (models.length === 0) {
    return <p className="text-sm font-medium text-(--remix-text-muted)">No runs yet</p>;
  }
  const allTokens = totalTokens(totals.tokens);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead>Employees</TableHead>
          <NumberHead>Runs</NumberHead>
          <NumberHead>Success</NumberHead>
          <NumberHead>Avg run</NumberHead>
          <NumberHead>Tokens</NumberHead>
          <TableHead>Share of tokens</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((entry) => {
          const tokens = totalTokens(entry.stats.tokens);
          const share = allTokens === 0 ? 0 : tokens / allTokens;
          return (
            <TableRow key={`${entry.modelSelection.instanceId}:${entry.modelSelection.model}`}>
              <TableCell>
                <span className="flex flex-col leading-tight">
                  <ModelName model={entry.modelSelection.model} />
                  <span className="text-(--remix-text-muted)">
                    {entry.modelSelection.instanceId}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center -space-x-1.5">
                  {entry.agentIds.map((agentId) => {
                    const agent = agentById(props.agents, agentId);
                    return agent === null ? null : (
                      <AgentAvatar
                        key={agentId}
                        agent={agent}
                        name={agent.name}
                        title={agent.title}
                      />
                    );
                  })}
                </span>
              </TableCell>
              <NumberCell>{formatCount(entry.stats.runs)}</NumberCell>
              <NumberCell>{percentOrDash(successRate(entry.stats))}</NumberCell>
              <NumberCell>{spanOrDash(averageRunMs(entry.stats))}</NumberCell>
              <NumberCell>{formatTokens(tokens)}</NumberCell>
              <TableCell>
                <span data-remix-tone="purple" className="flex items-center gap-2">
                  <span className="h-2.5 min-w-10 flex-1 overflow-hidden rounded-full border-(length:--remix-line-thin) border-(--remix-ink) bg-(--tone-wash)">
                    <span
                      className="block h-full rounded-full bg-(--tone)"
                      style={{ width: `${share * 100}%` }}
                    />
                  </span>
                  <span className="font-medium tabular-nums text-(--remix-text-muted)">
                    {formatPercent(share, 0)}
                  </span>
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ModelName(props: { readonly model: string }) {
  return <span className="font-mono">{props.model}</span>;
}

function DepartmentName(props: { readonly name: string | null; readonly tone: RemixTone | null }) {
  if (props.name === null) return "–";
  return (
    <span className="flex items-center gap-2 font-medium">
      {props.tone === null ? null : (
        <span
          aria-hidden
          data-remix-tone={props.tone}
          className="size-2.5 shrink-0 rounded-full border-(length:--remix-line-thin) border-(--remix-ink) bg-(--tone)"
        />
      )}
      {props.name}
    </span>
  );
}

function ActivityBadge(props: { readonly activity: EmployeeActivity }) {
  if (props.activity === "working") return <RemixChip tone="blue">Working</RemixChip>;
  if (props.activity === "paused") {
    return (
      <RemixChip tone="gray" variant="wash">
        Paused
      </RemixChip>
    );
  }
  return <span className="font-medium text-(--remix-text-muted)">Idle</span>;
}

function NumberHead(props: { readonly children: ReactNode }) {
  return (
    <TableHead>
      <span className="block text-right">{props.children}</span>
    </TableHead>
  );
}

function NumberCell(props: { readonly children: ReactNode }) {
  return (
    <TableCell>
      {props.children === null ? (
        <Skeleton className="ms-auto h-4 w-10" />
      ) : (
        <span className="block text-right tabular-nums">{props.children}</span>
      )}
    </TableCell>
  );
}
