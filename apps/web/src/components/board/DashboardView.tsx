import type {
  BoardAgent,
  BoardDashboard,
  BoardDashboardDay,
  BoardSnapshot,
  BoardTaskId,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
} from "@t3tools/shared/usageFormat";
import { AlertTriangleIcon, InboxIcon, UserPlusIcon, XCircleIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { boardLive } from "../../state/board";
import { useEnvironmentQuery } from "../../state/query";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { niceScale } from "../usage/UsageProviderChart";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentAvatar } from "./AgentAvatar";
import { agentById } from "./board.logic";
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
  successRate,
  totalTokens,
  type ActivityMetric,
  type AttentionItems,
  type EmployeeActivity,
} from "./dashboard.logic";

const METRICS: ReadonlyArray<{ readonly id: ActivityMetric; readonly label: string }> = [
  { id: "runs", label: "Runs" },
  { id: "tasksFinished", label: "Tasks finished" },
  { id: "tokens", label: "Tokens" },
];

const percentOrDash = (share: number | null) => (share === null ? "—" : formatPercent(share, 0));
const spanOrDash = (ms: number | null) => (ms === null ? "—" : formatSpan(ms));

export function DashboardView(props: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
  readonly onOpenOrgChart: () => void;
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
  const attention = attentionItems(snapshot, dashboard);
  const totals = dashboard?.totals ?? null;
  const openCards = snapshot.tasks.filter((task) => task.status !== "done").length;
  const blocked = columns.find((column) => column.status === "blocked")?.count ?? 0;
  const inReview = columns.find((column) => column.status === "review")?.count ?? 0;
  const doneAllTime = columns.find((column) => column.status === "done")?.count ?? 0;
  const finishedRecently =
    dashboard?.days.reduce((total, day) => total + day.tasksFinished, 0) ?? null;
  const paused = snapshot.agents.filter((agent) => agent.paused).length;
  const loading = (value: ReactNode) => (dashboard === null ? null : value);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-(--workspace-gutter-start) pb-6">
      {query.error !== null ? (
        <p className="text-sm text-destructive-foreground">
          Could not load run history: {query.error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Open tasks"
          value={formatCount(openCards)}
          detail={`${blocked} blocked · ${inReview} in review`}
        />
        <StatTile
          label="Finished, 14 days"
          value={loading(formatCount(finishedRecently ?? 0))}
          detail={`${formatCount(doneAllTime)} done all time`}
        />
        <StatTile
          label="Working now"
          value={loading(formatCount(totals?.running ?? 0))}
          detail={`${snapshot.agents.length} employees · ${paused} paused`}
        />
        <StatTile
          label="Run success"
          value={loading(percentOrDash(totals === null ? null : successRate(totals)))}
          detail={totals === null ? "" : `${totals.failed} failed of ${formatCount(totals.runs)}`}
        />
        <StatTile
          label="Time to done"
          value={loading(spanOrDash(dashboard?.medianCycleMs ?? null))}
          detail="Median, created to done"
        />
        <StatTile
          label="Tokens"
          value={loading(formatTokens(totals === null ? 0 : totalTokens(totals.tokens)))}
          detail={
            totals === null ? "" : `${percentOrDash(cachedShare(totals.tokens))} of input cached`
          }
        />
      </div>

      {hasAttentionItems(attention) ? (
        <Panel title="Needs attention">
          <AttentionList
            attention={attention}
            agents={snapshot.agents}
            onOpenCard={props.onOpenCard}
            onOpenOrgChart={props.onOpenOrgChart}
          />
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <Panel
          className="lg:col-span-2"
          title="Activity, last 14 days"
          aside={
            <ToggleGroup
              aria-label="Activity metric"
              size="segmented"
              variant="segmented"
              value={[metric]}
              onValueChange={(next) => {
                const chosen = METRICS.find((option) => option.id === next[0]);
                if (chosen !== undefined) setMetric(chosen.id);
              }}
            >
              {METRICS.map((option) => (
                <Toggle key={option.id} value={option.id}>
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
          }
        >
          {dashboard === null ? (
            <Skeleton className="h-48" />
          ) : (
            <ActivityChart days={dashboard.days} metric={metric} />
          )}
        </Panel>

        <Panel title="Tasks by column">
          <BarList
            rows={columns.map((column) => ({
              key: column.status,
              label: column.label,
              value: column.count,
              display: formatCount(column.count),
            }))}
          />
        </Panel>

        <Panel className="lg:col-span-2" title="Models">
          {dashboard === null ? (
            <Skeleton className="h-32" />
          ) : (
            <ModelsTable dashboard={dashboard} agents={snapshot.agents} />
          )}
        </Panel>

        <Panel title="Departments">
          <BarList
            rows={departmentRows(snapshot, employees).map((department) => ({
              key: department.id,
              label: department.name,
              value: department.openCards,
              display: `${department.openCards} open · ${department.headcount} ${department.headcount === 1 ? "person" : "people"}`,
            }))}
          />
        </Panel>

        <Panel className="lg:col-span-3" title="Employees">
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
                        <span className="text-sm text-foreground">{row.agent.name}</span>
                        <span className="text-muted-foreground">{row.role}</span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>{row.department ?? "—"}</TableCell>
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
                        ? "—"
                        : formatRelativeTimeLabel(row.stats.lastRunAt),
                    )}
                  </NumberCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}

function Panel(props: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4", props.className)}
    >
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">{props.title}</h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

function StatTile(props: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border bg-card p-4">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      {props.value === null ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <span className="text-2xl font-semibold tabular-nums text-foreground">{props.value}</span>
      )}
      <span className="truncate text-xs text-muted-foreground">{props.detail}</span>
    </div>
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
  const label = METRICS.find((option) => option.id === props.metric)?.label ?? "";
  const first = props.days[0];
  const middle = props.days[Math.floor(props.days.length / 2)];
  const last = props.days.at(-1);
  if (scale.max === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No {label.toLowerCase()} in the last 14 days.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-48 gap-2">
        <div className="relative w-10 shrink-0">
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-3xs tabular-nums text-muted-foreground"
              style={{ top: `${100 - (tick / scale.max) * 100}%` }}
            >
              {tick === 0 ? "0" : format(tick)}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={`${label} per day: ${props.days.map((day) => `${formatDayShort(day.day)} ${format(day[props.metric])}`).join(", ")}`}
          className="relative flex min-w-0 flex-1 items-end gap-0.5"
        >
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-border"
              style={{ top: `${100 - (tick / scale.max) * 100}%` }}
            />
          ))}
          {props.days.map((day) => (
            <Tooltip key={day.day}>
              <TooltipTrigger
                render={
                  <div className="relative flex h-full min-w-0 flex-1 items-end hover:bg-muted/60" />
                }
              >
                <div
                  className="w-full rounded-t-xs bg-primary"
                  style={{ height: `${(day[props.metric] / scale.max) * 100}%` }}
                />
              </TooltipTrigger>
              <TooltipPopup>
                {formatDayShort(day.day)} · {format(day[props.metric])} {label.toLowerCase()}
              </TooltipPopup>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="flex justify-between ps-12 text-3xs uppercase text-muted-foreground">
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
  }>;
}) {
  const peak = Math.max(1, ...props.rows.map((row) => row.value));
  return (
    <div className="flex flex-col gap-2.5">
      {props.rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-foreground">{row.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{row.display}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
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
  readonly onOpenCard: (cardId: BoardTaskId) => void;
  readonly onOpenOrgChart: () => void;
}) {
  const { attention } = props;
  return (
    <div className="flex flex-wrap gap-1">
      {attention.pendingHires > 0 ? (
        <Button variant="outline" size="sm" className="max-w-full" onClick={props.onOpenOrgChart}>
          <UserPlusIcon />
          <span className="truncate">
            {attention.pendingHires} hire {attention.pendingHires === 1 ? "request" : "requests"} to
            review
          </span>
        </Button>
      ) : null}
      {attention.blocked.map((task) => (
        <Button
          key={task.id}
          variant="outline"
          size="sm"
          className="max-w-full"
          onClick={() => props.onOpenCard(task.id)}
        >
          <AlertTriangleIcon />
          <span className="truncate">Blocked: {task.title}</span>
        </Button>
      ))}
      {attention.unassigned.map((task) => (
        <Button
          key={task.id}
          variant="outline"
          size="sm"
          className="max-w-full"
          onClick={() => props.onOpenCard(task.id)}
        >
          <InboxIcon />
          <span className="truncate">No assignee: {task.title}</span>
        </Button>
      ))}
      {attention.failing.map((entry) => (
        <div key={entry.agentId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
          <XCircleIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {agentById(props.agents, entry.agentId)?.name ?? "A former employee"} had {entry.failed}{" "}
            failed {entry.failed === 1 ? "run" : "runs"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ModelsTable(props: {
  readonly dashboard: BoardDashboard;
  readonly agents: ReadonlyArray<BoardAgent>;
}) {
  const { models, totals } = props.dashboard;
  if (models.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs yet.</p>;
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
                  <span className="text-muted-foreground">{entry.modelSelection.instanceId}</span>
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
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-24 rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${share * 100}%` }}
                    />
                  </span>
                  <span className="tabular-nums text-muted-foreground">
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
  return <span className="font-mono text-foreground">{props.model}</span>;
}

function ActivityBadge(props: { readonly activity: EmployeeActivity }) {
  if (props.activity === "working") return <Badge variant="info">Working</Badge>;
  if (props.activity === "paused") return <Badge variant="secondary">Paused</Badge>;
  return <span className="text-muted-foreground">Idle</span>;
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
