import type {
  BoardAgent,
  BoardAgentThread,
  BoardCompanyId,
  BoardCompanySummary,
  BoardSnapshot,
  EnvironmentId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  Building2Icon,
  ChevronRightIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
} from "lucide-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { boardLive } from "../../state/board";
import { useThreadShell } from "../../state/entities";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";
import { AgentAvatar } from "../board/AgentAvatar";
import { employeeThreadTitle, orgChartRows } from "../board/board.logic";
import { Button } from "../ui/button";
import { SidebarGroup, SidebarMenuSubButton, useSidebar } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const SIDEBAR_VIEW_STORAGE_KEY = "t3code:sidebar:view";
export const SidebarViewSchema = Schema.Literals(["threads", "companies"]);
type SidebarView = typeof SidebarViewSchema.Type;

/** Switches the sidebar list between every thread and threads grouped by company employee. */
export function SidebarViewSwitch(props: {
  readonly view: SidebarView;
  readonly onChange: (view: SidebarView) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Sidebar view"
      className="mb-2 w-full *:flex-1"
      value={[props.view]}
      onValueChange={(next) => {
        const view = next[0];
        if (view === "threads" || view === "companies") props.onChange(view);
      }}
    >
      <Toggle value="threads">Threads</Toggle>
      <Toggle value="companies">Companies</Toggle>
    </ToggleGroup>
  );
}

const COLLAPSED_KEY = "t3code:sidebar:companies-collapsed";
const CollapsedIds = Schema.Array(Schema.String);
const THREADS_PER_EMPLOYEE = 5;

/** Ids the person has collapsed; companies and employees start expanded. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useLocalStorage<ReadonlyArray<string>, ReadonlyArray<string>>(
    COLLAPSED_KEY,
    [],
    CollapsedIds,
  );
  const toggle = (id: string) =>
    setCollapsed((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  return { isCollapsed: (id: string) => collapsed.includes(id), toggle };
}

export function SidebarCompanies() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) {
    return <SidebarEmpty text="Connect an environment to see companies." />;
  }
  return <CompaniesForEnvironment environmentId={environmentId} />;
}

function CompaniesForEnvironment(props: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const environment = useEnvironment(props.environmentId);
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const companies = useEnvironmentQuery(
    connected
      ? boardLive({ environmentId: props.environmentId, input: { companyId: null } })
      : null,
  ).data?.companies;
  const collapsed = useCollapsed();

  if (companies === undefined) {
    return <SidebarEmpty text={connected ? "Loading companies…" : "Environment offline."} />;
  }
  if (companies.length === 0) {
    return (
      <SidebarGroup className="flex-1">
        <div className="flex flex-col items-start gap-2 px-2 py-3 text-sm text-muted-foreground">
          <span>No companies yet. A company has a CEO and employees who work your cards.</span>
          <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/board" })}>
            <Building2Icon />
            Create a company
          </Button>
        </div>
      </SidebarGroup>
    );
  }
  return (
    <SidebarGroup className="flex-1" role="tree" aria-label="Companies">
      <div className="flex flex-col gap-1">
        {companies.map((company) => (
          <CompanyNode
            key={company.id}
            environmentId={props.environmentId}
            company={company}
            collapsed={collapsed}
          />
        ))}
      </div>
    </SidebarGroup>
  );
}

function CompanyNode(props: {
  readonly environmentId: EnvironmentId;
  readonly company: BoardCompanySummary;
  readonly collapsed: ReturnType<typeof useCollapsed>;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const open = !props.collapsed.isCollapsed(props.company.id);
  const openBoard = (companyId: BoardCompanyId, tab?: "dashboard") => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/board", search: { company: companyId, ...(tab ? { tab } : {}) } });
  };
  return (
    <div role="treeitem" aria-expanded={open} aria-selected={false}>
      <div className="group/company flex items-center gap-1 rounded-lg pe-1 hover:bg-sidebar-row-hover">
        <button
          type="button"
          aria-label={`${open ? "Collapse" : "Expand"} ${props.company.name}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1.5 text-start text-sm font-medium text-sidebar-foreground"
          onClick={() => props.collapsed.toggle(props.company.id)}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <Building2Icon className="size-4 shrink-0 text-sidebar-muted-foreground" />
          <span className="truncate">{props.company.name}</span>
          {props.company.pendingHireCount > 0 ? (
            <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-3xs text-warning">
              {props.company.pendingHireCount} hire
            </span>
          ) : null}
        </button>
        <Button
          size="xs"
          variant="outline"
          aria-label={`Open ${props.company.name}'s board`}
          className="shrink-0"
          onClick={() => openBoard(props.company.id)}
        >
          <KanbanSquareIcon />
          Board
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="outline"
                aria-label={`Open ${props.company.name}'s dashboard`}
                className="shrink-0"
                onClick={() => openBoard(props.company.id, "dashboard")}
              />
            }
          >
            <LayoutDashboardIcon />
          </TooltipTrigger>
          <TooltipPopup>Dashboard</TooltipPopup>
        </Tooltip>
      </div>
      {open ? (
        <CompanyEmployees
          environmentId={props.environmentId}
          companyId={props.company.id}
          collapsed={props.collapsed}
        />
      ) : null}
    </div>
  );
}

function CompanyEmployees(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: BoardCompanyId;
  readonly collapsed: ReturnType<typeof useCollapsed>;
}) {
  const snapshot = useEnvironmentQuery(
    boardLive({ environmentId: props.environmentId, input: { companyId: props.companyId } }),
  ).data;
  if (snapshot === null || snapshot.company === null) {
    return <div className="ps-8 py-1 text-xs text-muted-foreground">Loading…</div>;
  }
  const rows = orgChartRows(snapshot.agents, snapshot.company.ceoAgentId);
  return (
    <div role="group" className="flex flex-col">
      {rows.map(({ agent, depth }) => (
        <EmployeeNode
          key={agent.id}
          environmentId={props.environmentId}
          agent={agent}
          depth={depth}
          snapshot={snapshot}
          collapsed={props.collapsed}
        />
      ))}
    </div>
  );
}

function EmployeeNode(props: {
  readonly environmentId: EnvironmentId;
  readonly agent: BoardAgent;
  readonly depth: number;
  readonly snapshot: BoardSnapshot;
  readonly collapsed: ReturnType<typeof useCollapsed>;
}) {
  const { agent, snapshot } = props;
  const threads = snapshot.threads.filter((thread) => thread.agentId === agent.id);
  const open = threads.length > 0 && !props.collapsed.isCollapsed(agent.id);
  const working = threads.some((thread) => thread.status === "running");
  const isCeo = snapshot.company?.ceoAgentId === agent.id;
  return (
    <div
      role="treeitem"
      aria-expanded={threads.length > 0 ? open : undefined}
      aria-selected={false}
    >
      <button
        type="button"
        // Indent follows the org chart's depth, which is data rather than a fixed step.
        style={{ paddingInlineStart: `${1 + props.depth * 0.875}rem` }}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg py-1 pe-2 text-start hover:bg-sidebar-row-hover disabled:cursor-default"
        disabled={threads.length === 0}
        aria-label={`${agent.name}, ${isCeo ? "CEO" : agent.title || "employee"}, ${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}
        onClick={() => props.collapsed.toggle(agent.id)}
      >
        <AgentAvatar
          agent={agent}
          name={agent.name}
          title={isCeo ? "CEO" : agent.title || "Employee"}
          muted={agent.paused}
        />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm text-sidebar-foreground">{agent.name}</span>
          <span className="truncate text-xs text-sidebar-muted-foreground">
            {isCeo ? "CEO" : agent.title || "Employee"}
            {agent.paused ? " · paused" : working ? " · working" : ""}
          </span>
        </span>
        {threads.length > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
            {threads.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="group" className="flex flex-col">
          {threads.slice(0, THREADS_PER_EMPLOYEE).map((thread) => (
            <EmployeeThread
              key={thread.threadId}
              environmentId={props.environmentId}
              thread={thread}
              agentName={agent.name}
              depth={props.depth}
              snapshot={snapshot}
            />
          ))}
          {threads.length > THREADS_PER_EMPLOYEE ? (
            <span
              style={{ paddingInlineStart: `${3 + props.depth * 0.875}rem` }}
              className="py-0.5 text-xs text-sidebar-muted-foreground"
            >
              {threads.length - THREADS_PER_EMPLOYEE} older in the Threads view
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EmployeeThread(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: BoardAgentThread;
  readonly agentName: string;
  readonly depth: number;
  readonly snapshot: BoardSnapshot;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const ref = scopeThreadRef(props.environmentId, props.thread.threadId);
  const shell = useThreadShell(ref);
  const routeRef = useThreadRouteRef();
  const isActive =
    routeRef !== null &&
    routeRef.environmentId === props.environmentId &&
    routeRef.threadId === props.thread.threadId;
  const card = props.snapshot.tasks.find((task) => task.id === props.thread.taskId);
  const title =
    shell !== null
      ? employeeThreadTitle(shell.title, props.agentName)
      : `${props.thread.kind === "review" ? "Review: " : ""}${card?.title ?? "Thread"}`;
  const pill = shell === null ? null : resolveThreadStatusPill({ thread: shell });
  const open = () => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  return (
    <div
      role="treeitem"
      aria-selected={isActive}
      // Indent follows the org chart's depth, which is data rather than a fixed step.
      style={{ paddingInlineStart: `${2.25 + props.depth * 0.875}rem` }}
      className="min-w-0"
    >
      <SidebarMenuSubButton
        size="sm"
        isActive={isActive}
        render={<button type="button" />}
        className="w-full"
        onClick={open}
      >
        {pill !== null ? (
          <ThreadStatusLabel status={pill} compact />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-start">{title}</span>
        <span className="shrink-0 text-sidebar-muted-foreground">
          {formatRelativeTimeLabel(props.thread.startedAt)}
        </span>
      </SidebarMenuSubButton>
    </div>
  );
}

function SidebarEmpty(props: { readonly text: string }) {
  return (
    <SidebarGroup className="flex-1">
      <span className="px-2 py-3 text-sm text-muted-foreground">{props.text}</span>
    </SidebarGroup>
  );
}
