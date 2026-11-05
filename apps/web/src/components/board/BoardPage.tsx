import { useAtomValue } from "@effect/atom-react";
import { MAX_COMPANY_MEMORY_CHARS } from "@t3tools/contracts";
import type {
  BoardAgent,
  BoardCommand,
  BoardCommandResult,
  BoardCompany,
  BoardCompanyId,
  BoardDepartmentId,
  BoardSnapshot,
  BoardTaskId,
  EnvironmentId,
} from "@t3tools/contracts";
import { Navigate, useNavigate, useRouter } from "@tanstack/react-router";
import {
  Building2Icon,
  EllipsisIcon,
  FolderIcon,
  GaugeIcon,
  GitBranchIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  ServerOffIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { registerCommands } from "../../shortcuts/dispatcher";
import { boardCommand, boardLive } from "../../state/board";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useRunBoardCommand } from "./useRunBoardCommand";
import { CloneCompanyDialog } from "./CloneCompanyDialog";
import {
  CompanyWorkspaceField,
  useCompanyProjects,
  workspaceInput,
  type WorkspaceChoice,
} from "./CompanyWorkspaceField";
import { AgentName } from "./AgentAvatar";
import { AgentDialog, MemoryCount, type AgentDraft } from "./AgentDialog";
import { BoardCardSheet } from "./BoardCardSheet";
import { BoardColumns } from "./BoardColumns";
import { BoardNewCardDialog } from "./BoardNewCardDialog";
import { CompanyDialog } from "./CompanyDialog";
import { DashboardView } from "./DashboardView";
import { OrgChartView } from "./OrgChartView";
import { RoutinesView } from "./RoutinesView";
import { SkillsView } from "./SkillsView";
import { TokenLimitField } from "./TokenLimitField";
import { agentById, limitProgress } from "./board.logic";
import {
  REMIX_CARD,
  RemixButton,
  RemixChip,
  RemixFieldGroup,
  RemixHeading,
  RemixIconTile,
  RemixPage,
  RemixTab,
  type RemixTone,
} from "./RemixSurface";

export type BoardTab = "board" | "dashboard" | "org" | "skills" | "routines";

export interface BoardPageProps {
  readonly environmentId?: EnvironmentId | undefined;
  readonly company?: BoardCompanyId | undefined;
  readonly card?: BoardTaskId | undefined;
  readonly tab?: BoardTab | undefined;
}

/** Runs one board change; resolves to its result, or null when it failed (already reported). */
export type RunBoardCommand = (command: BoardCommand) => Promise<BoardCommandResult | null>;

// Escape leaves the board when no scope (a dialog, a menu) claimed it.
function useEscapeLeavesBoard() {
  const router = useRouter();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds a shortcut dispatcher observer while the board is mounted
  useEffect(
    () =>
      registerCommands(
        {},
        {
          observe: (event, consumed) => {
            if (consumed || event.repeat || event.isComposing || event.key !== "Escape") return;
            event.preventDefault();
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement) activeElement.blur();
            if (router.state.location.state.__TSR_index !== 0) {
              window.history.back();
              return;
            }
            void router.navigate({ to: "/" });
          },
        },
      ),
    [router],
  );
}

export function BoardPage(props: BoardPageProps) {
  useEscapeLeavesBoard();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = props.environmentId ?? primaryEnvironmentId;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <RemixPage>
        {environmentId === null ? (
          <>
            <WorkspacePageHeader electron={isElectron}>
              <span className="text-sm font-medium">Companies</span>
            </WorkspacePageHeader>
            <BoardMessage
              icon={<ServerOffIcon />}
              tone="gray"
              title="No environment"
              description="Connect T3 Code to a server"
            />
          </>
        ) : (
          <CompanyWorkspace key={environmentId} {...props} environmentId={environmentId} />
        )}
      </RemixPage>
    </SidebarInset>
  );
}

function CompanyWorkspace(props: BoardPageProps & { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const navigate = useNavigate();
  const environment = useEnvironment(environmentId);
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const boardQuery = useEnvironmentQuery(
    connected ? boardLive({ environmentId, input: { companyId: props.company ?? null } }) : null,
  );
  const canOperate = useAtomValue(boardCommand.permissionAtom(environmentId));
  const runCommand = useRunBoardCommand(environmentId);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState(false);
  const [cloningCompany, setCloningCompany] = useState(false);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const projects = useCompanyProjects(environmentId);
  const snapshot = boardQuery.data;
  const tab = props.tab ?? "board";

  const go = (search: {
    readonly company?: BoardCompanyId;
    readonly card?: BoardTaskId;
    readonly tab?: BoardTab;
  }) =>
    void navigate({
      to: "/board",
      search: {
        ...(props.environmentId === undefined ? {} : { environmentId: props.environmentId }),
        ...search,
      },
    });

  const companyDialog = (
    <CompanyDialog
      open={companyDialogOpen}
      onOpenChange={setCompanyDialogOpen}
      environmentId={environmentId}
      runCommand={runCommand}
      onCreated={(companyId) => go({ company: companyId, tab: "org" })}
    />
  );

  if (!connected) {
    return (
      <>
        <WorkspacePageHeader electron={isElectron}>
          <span className="text-sm font-medium">Companies</span>
        </WorkspacePageHeader>
        <BoardMessage
          icon={<WifiOffIcon />}
          tone="gray"
          title="Environment offline"
          description="Reconnect to see your companies"
        />
      </>
    );
  }
  if (snapshot === null) {
    return (
      <>
        <WorkspacePageHeader electron={isElectron}>
          <span className="text-sm font-medium">Companies</span>
        </WorkspacePageHeader>
        <BoardMessage
          icon={boardQuery.error === null ? <Building2Icon /> : <TriangleAlertIcon />}
          tone={boardQuery.error === null ? "gray" : "red"}
          title={boardQuery.error === null ? "Loading companies" : "Could not load companies"}
          description={boardQuery.error ?? ""}
        />
      </>
    );
  }
  // Without a company in the URL, open the first one so the board is one click away.
  const firstCompany = snapshot.companies[0];
  if (snapshot.company === null && firstCompany !== undefined) {
    return (
      <Navigate
        to="/board"
        replace
        search={{
          ...(props.environmentId === undefined ? {} : { environmentId: props.environmentId }),
          company: firstCompany.id,
        }}
      />
    );
  }
  if (snapshot.company === null) {
    return (
      <>
        <WorkspacePageHeader electron={isElectron}>
          <span className="text-sm font-medium">Companies</span>
        </WorkspacePageHeader>
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <RemixIconTile tone="teal" size="lg">
                <Building2Icon />
              </RemixIconTile>
            </EmptyMedia>
            <EmptyTitle>Start your first company</EmptyTitle>
            <EmptyDescription>
              Give it a mission and a CEO. You hand the CEO tasks; the CEO splits them into work for
              employees, who each have a role and skills.
            </EmptyDescription>
          </EmptyHeader>
          <Button disabled={!canOperate} onClick={() => setCompanyDialogOpen(true)}>
            <PlusIcon />
            New company
          </Button>
        </Empty>
        {companyDialog}
      </>
    );
  }

  const company = snapshot.company;
  const pendingHires = snapshot.hires.filter((hire) => hire.status === "pending").length;
  const ceo = agentById(snapshot.agents, company.ceoAgentId);
  const home = projects.find((project) => project.id === company.projectId) ?? null;
  const openTask =
    props.card === undefined
      ? null
      : (snapshot.tasks.find((task) => task.id === props.card) ?? null);

  const deleteCompany = async () => {
    const message = `Delete ${company.name}?\nIts board, agents, and skills are removed. Agent threads and files stay.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    if ((await runCommand({ type: "company.delete", id: company.id })) !== null) go({});
  };

  return (
    <>
      <WorkspacePageHeader electron={isElectron}>
        <div className="@container flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-0.5 pt-1 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-0 shrink items-center gap-0.5 rounded-full border-2 border-(--remix-ink) bg-(--remix-surface) p-0.5 shadow-(--remix-lift)">
            <Select
              value={company.id}
              onValueChange={(value) => go({ company: value as BoardCompanyId, tab })}
            >
              <SelectTrigger size="sm" variant="ghost" className="w-auto max-w-56">
                <SelectValue>
                  <span className="flex items-center gap-2 truncate">
                    <RemixIconTile tone="blue">
                      <Building2Icon />
                    </RemixIconTile>
                    <span className="truncate font-semibold text-(--remix-text)">
                      {company.name}
                    </span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {snapshot.companies.map((summary) => (
                  <SelectItem key={summary.id} value={summary.id} label={summary.name}>
                    <span className="flex flex-col">
                      <span>{summary.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {summary.agentCount} agents · {summary.openTaskCount} open tasks
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="New company"
              disabled={!canOperate}
              onClick={() => setCompanyDialogOpen(true)}
            >
              <PlusIcon />
            </Button>
            <Menu>
              <MenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="Company actions" />}
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="start">
                <MenuItem disabled={!canOperate} onClick={() => setEditingCompany(true)}>
                  Edit company
                </MenuItem>
                <MenuItem disabled={!canOperate} onClick={() => setCloningCompany(true)}>
                  Clone company
                </MenuItem>
                <MenuItem
                  variant="destructive"
                  disabled={!canOperate}
                  onClick={() => void deleteCompany()}
                >
                  Delete company
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
          <nav aria-label="Company views" className="flex min-w-0 items-center gap-1.5">
            <RemixTab
              active={tab === "dashboard"}
              icon={<LayoutDashboardIcon />}
              label="Dashboard"
              onClick={() => go({ company: company.id, tab: "dashboard" })}
            />
            <RemixTab
              active={tab === "board"}
              icon={<KanbanSquareIcon />}
              label="Board"
              onClick={() => go({ company: company.id, tab: "board" })}
            />
            <RemixTab
              active={tab === "org"}
              icon={<NetworkIcon />}
              label="Org chart"
              badge={pendingHires > 0 ? <RemixChip tone="yellow">{pendingHires}</RemixChip> : null}
              onClick={() => go({ company: company.id, tab: "org" })}
            />
            <RemixTab
              active={tab === "skills"}
              icon={<SparklesIcon />}
              label="Skills"
              onClick={() => go({ company: company.id, tab: "skills" })}
            />
            <RemixTab
              active={tab === "routines"}
              icon={<RepeatIcon />}
              label="Routines"
              onClick={() => go({ company: company.id, tab: "routines" })}
            />
          </nav>
        </div>
        {tab === "board" ? (
          <div className="flex shrink-0 items-center gap-2">
            <BoardSettingsMenu snapshot={snapshot} disabled={!canOperate} runCommand={runCommand} />
            <RemixButton variant="go" disabled={!canOperate} onClick={() => setNewCardOpen(true)}>
              <PlusIcon />
              New task
            </RemixButton>
          </div>
        ) : null}
      </WorkspacePageHeader>

      {tab === "board" ? (
        <>
          <MissionBanner company={company} ceo={ceo ?? null} home={home} />
          <CompanyLimitBanner snapshot={snapshot} />
          <BoardColumns
            snapshot={snapshot}
            canOperate={canOperate}
            runCommand={runCommand}
            onOpenCard={(cardId) => go({ company: company.id, card: cardId })}
          />
        </>
      ) : tab === "dashboard" ? (
        <DashboardView
          environmentId={environmentId}
          snapshot={snapshot}
          onOpenCard={(cardId) => go({ company: company.id, card: cardId, tab })}
          onOpenOrgChart={() => go({ company: company.id, tab: "org" })}
        />
      ) : tab === "org" ? (
        <OrgChartView
          snapshot={snapshot}
          canOperate={canOperate}
          runCommand={runCommand}
          onEditAgent={setAgentDraft}
        />
      ) : tab === "routines" ? (
        <RoutinesView
          snapshot={snapshot}
          canOperate={canOperate}
          runCommand={runCommand}
          onOpenCard={(cardId) => go({ company: company.id, card: cardId, tab })}
        />
      ) : (
        <SkillsView snapshot={snapshot} canOperate={canOperate} runCommand={runCommand} />
      )}

      {companyDialog}
      <AgentDialog
        draft={agentDraft}
        onClose={() => setAgentDraft(null)}
        environmentId={environmentId}
        snapshot={snapshot}
        runCommand={runCommand}
      />
      <CloneCompanyDialog
        open={cloningCompany}
        onOpenChange={setCloningCompany}
        environmentId={environmentId}
        snapshot={snapshot}
        runCommand={runCommand}
        onCloned={(companyId) => {
          setCloningCompany(false);
          go({ company: companyId, tab: "org" });
        }}
      />
      <EditCompanyDialog
        environmentId={environmentId}
        company={editingCompany ? company : null}
        snapshot={snapshot}
        agents={snapshot.agents}
        onClose={() => setEditingCompany(false)}
        runCommand={runCommand}
      />
      <BoardNewCardDialog
        open={newCardOpen}
        onOpenChange={setNewCardOpen}
        snapshot={snapshot}
        runCommand={runCommand}
      />
      <BoardCardSheet
        environmentId={environmentId}
        task={openTask}
        snapshot={snapshot}
        canOperate={canOperate}
        runCommand={runCommand}
        onOpenCard={(cardId) =>
          go({ company: company.id, tab, ...(cardId === null ? {} : { card: cardId }) })
        }
      />
    </>
  );
}

function CompanyLimitBanner(props: { readonly snapshot: BoardSnapshot }) {
  const progress = limitProgress(
    props.snapshot.usage?.companyTokens ?? 0,
    props.snapshot.settings?.monthlyTokenLimit ?? null,
  );
  if (progress === null || (!progress.nearing && !progress.reached)) return null;
  return (
    <div
      data-remix-tone="yellow"
      className={cn(
        REMIX_CARD,
        "mx-(--workspace-gutter-start) mb-3 flex-row items-center gap-2.5 bg-(--tone-wash) px-2.5 py-1.5 text-sm font-medium shadow-(--remix-lift)",
      )}
    >
      <RemixIconTile tone="yellow">
        <GaugeIcon />
      </RemixIconTile>
      <span className="min-w-0">
        {progress.reached
          ? "This company used its monthly token limit. Agents won't start until you raise it under Edit company or the month ends."
          : `This company has used ${Math.round(progress.share * 100)}% of its monthly token limit.`}
      </span>
    </div>
  );
}

function MissionBanner(props: {
  readonly company: BoardCompany;
  readonly ceo: BoardAgent | null;
  readonly home: { readonly title: string; readonly workspaceRoot: string } | null;
}) {
  if (props.company.mission.trim().length === 0 && props.ceo === null && props.home === null) {
    return null;
  }
  return (
    <div
      className={cn(
        REMIX_CARD,
        "mx-(--workspace-gutter-start) mb-3 flex-row items-center gap-2.5 px-2 py-1.5 text-sm shadow-(--remix-lift)",
      )}
    >
      {props.company.mission.trim().length > 0 ? (
        <>
          <RemixChip tone="green">Mission</RemixChip>
          <span className="min-w-0 truncate font-medium">{props.company.mission}</span>
        </>
      ) : null}
      {props.home !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs font-semibold" />
            }
          >
            <RemixIconTile tone="green">
              <FolderIcon />
            </RemixIconTile>
            {props.home.title}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{props.home.workspaceRoot}</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.ceo !== null ? (
        <span
          className={cn(
            "shrink-0 text-xs whitespace-nowrap text-(--remix-text-muted)",
            props.home === null && "ms-auto",
          )}
        >
          {"New tasks go to "}
          <AgentName agent={props.ceo} className="font-semibold text-(--remix-text)" />
          {", the CEO"}
        </span>
      ) : null}
    </div>
  );
}

function BoardMessage(props: {
  readonly icon: ReactNode;
  readonly tone: RemixTone;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <RemixIconTile tone={props.tone} size="lg">
            {props.icon}
          </RemixIconTile>
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.description ? <EmptyDescription>{props.description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function EditCompanyDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly company: BoardCompany | null;
  readonly snapshot: BoardSnapshot;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly onClose: () => void;
  readonly runCommand: RunBoardCommand;
}) {
  return (
    <Dialog
      open={props.company !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        {props.company !== null ? <EditCompanyForm {...props} company={props.company} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

interface DepartmentDraft {
  readonly key: string;
  readonly id: BoardDepartmentId | null;
  readonly name: string;
}

function EditCompanyForm(props: {
  readonly environmentId: EnvironmentId;
  readonly company: BoardCompany;
  readonly snapshot: BoardSnapshot;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly onClose: () => void;
  readonly runCommand: RunBoardCommand;
}) {
  const [name, setName] = useState(props.company.name);
  const [mission, setMission] = useState(props.company.mission);
  const [memory, setMemory] = useState(props.company.memory);
  const [departments, setDepartments] = useState<ReadonlyArray<DepartmentDraft>>(() =>
    props.company.departments.map((department) => ({ key: department.id, ...department })),
  );
  const [nextKey, setNextKey] = useState(0);
  const savedLimit = props.snapshot.settings?.monthlyTokenLimit ?? null;
  const [tokenLimit, setTokenLimit] = useState(savedLimit);
  const [limitValid, setLimitValid] = useState(true);
  // Null keeps the current project; a choice moves the company once saved.
  const [workspace, setWorkspace] = useState<WorkspaceChoice | null>(null);
  const home =
    useCompanyProjects(props.environmentId).find(
      (project) => project.id === props.company.projectId,
    ) ?? null;
  const nextHome = workspace === null ? undefined : workspaceInput(workspace, name);
  const moves =
    nextHome !== undefined &&
    nextHome !== null &&
    !(nextHome.type === "existing" && nextHome.projectId === props.company.projectId);
  const save = async () => {
    if (tokenLimit !== savedLimit) {
      const limited = await props.runCommand({
        type: "settings.update",
        settings: { companyId: props.company.id, monthlyTokenLimit: tokenLimit },
      });
      if (limited === null) return;
    }
    const saved = await props.runCommand({
      type: "company.update",
      company: {
        id: props.company.id,
        name: name.trim(),
        mission: mission.trim(),
        memory,
        departments: departments.map((department) =>
          department.id === null
            ? { name: department.name.trim() }
            : { id: department.id, name: department.name.trim() },
        ),
        ...(moves && nextHome !== undefined && nextHome !== null ? { workspace: nextHome } : {}),
      },
    });
    if (saved !== null) props.onClose();
  };
  const renameDepartment = (key: string, value: string) =>
    setDepartments(
      departments.map((department) =>
        department.key === key ? { ...department, name: value } : department,
      ),
    );
  const addDepartment = () => {
    setDepartments([...departments, { key: `new-${nextKey}`, id: null, name: "" }]);
    setNextKey(nextKey + 1);
  };
  const canSave =
    limitValid &&
    nextHome !== null &&
    name.trim().length > 0 &&
    memory.length <= MAX_COMPANY_MEMORY_CHARS &&
    departments.length > 0 &&
    departments.every((department) => department.name.trim().length > 0);
  return (
    <>
      <DialogHeader>
        <RemixHeading
          icon={<Building2Icon />}
          tone="teal"
          title={<DialogTitle>Edit company</DialogTitle>}
        />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <RemixFieldGroup label="Company" tone="teal">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-edit-company-name">Name</Label>
              <Input
                id="board-edit-company-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-edit-company-mission">Mission</Label>
              <Textarea
                id="board-edit-company-mission"
                value={mission}
                rows={4}
                onChange={(event) => setMission(event.target.value)}
              />
            </div>
          </RemixFieldGroup>
          <RemixFieldGroup
            label="Workspace"
            tone="green"
            action={
              workspace === null ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setWorkspace({ type: "existing", projectId: props.company.projectId })
                  }
                >
                  Change
                </Button>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => setWorkspace(null)}>
                  Keep current
                </Button>
              )
            }
          >
            {workspace === null ? (
              <div className={cn(REMIX_CARD, "flex-row items-center gap-3 rounded-xl p-3")}>
                <RemixIconTile tone="green">
                  <FolderIcon />
                </RemixIconTile>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {home?.title ?? "Project not found"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {home?.workspaceRoot ?? "Choose a project for this company."}
                  </span>
                </span>
              </div>
            ) : (
              <>
                <CompanyWorkspaceField
                  environmentId={props.environmentId}
                  value={workspace}
                  onChange={setWorkspace}
                  companyName={name}
                />
                <span className="text-xs text-muted-foreground">
                  New tasks start in the new project. Tasks that already started stay where they
                  are.
                </span>
              </>
            )}
          </RemixFieldGroup>
          <RemixFieldGroup
            label="Departments"
            tone="purple"
            action={
              <Button size="xs" variant="outline" onClick={addDepartment}>
                <PlusIcon />
                Add department
              </Button>
            }
          >
            <div className="flex flex-col gap-2">
              {departments.map((department) => {
                const members = props.agents.filter(
                  (agent) => department.id !== null && agent.departmentId === department.id,
                ).length;
                return (
                  <div
                    key={department.key}
                    className={cn(REMIX_CARD, "flex-row items-center gap-2 rounded-xl p-2")}
                  >
                    <Input
                      size="sm"
                      value={department.name}
                      aria-label="Department name"
                      placeholder="Department name"
                      autoFocus={department.id === null}
                      onChange={(event) => renameDepartment(department.key, event.target.value)}
                    />
                    <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      <RemixIconTile tone="purple">
                        <UsersIcon />
                      </RemixIconTile>
                      {members} {members === 1 ? "person" : "people"}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost-destructive"
                      aria-label={`Remove ${department.name || "department"}`}
                      disabled={members > 0 || departments.length === 1}
                      onClick={() =>
                        setDepartments(
                          departments.filter((candidate) => candidate.key !== department.key),
                        )
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                );
              })}
            </div>
            <span className="text-xs text-muted-foreground">
              Every employee belongs to one department. Move people out of a department before
              removing it.
            </span>
          </RemixFieldGroup>
          <RemixFieldGroup label="Limits" tone="yellow">
            <TokenLimitField
              id="board-edit-company-token-limit"
              label="Monthly token limit for the company"
              value={tokenLimit}
              used={props.snapshot.usage?.companyTokens ?? null}
              onChange={setTokenLimit}
              onValidityChange={setLimitValid}
            />
          </RemixFieldGroup>
          <RemixFieldGroup label="Memory" tone="gray">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="board-edit-company-memory">Company memory</Label>
                <MemoryCount length={memory.length} limit={MAX_COMPANY_MEMORY_CHARS} />
              </div>
              <Textarea
                id="board-edit-company-memory"
                value={memory}
                rows={6}
                placeholder="Decisions and conventions every agent should know. Managers add to it as they learn."
                onChange={(event) => setMemory(event.target.value)}
              />
            </div>
          </RemixFieldGroup>
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose render={<RemixButton />}>Cancel</DialogClose>
        <RemixButton variant="go" disabled={!canSave} onClick={() => void save()}>
          Save
        </RemixButton>
      </DialogFooter>
    </>
  );
}

function BoardSettingsMenu(props: {
  readonly snapshot: BoardSnapshot;
  readonly disabled: boolean;
  readonly runCommand: RunBoardCommand;
}) {
  const settings = props.snapshot.settings;
  if (settings === null) return null;
  const update = (patch: {
    autoDispatch?: boolean;
    maxConcurrentRuns?: number;
    useWorktrees?: boolean;
  }) =>
    void props.runCommand({
      type: "settings.update",
      settings: { companyId: settings.companyId, ...patch },
    });
  return (
    <Menu>
      <MenuTrigger render={<RemixButton aria-label="Board settings" />}>
        <SettingsIcon />
        {settings.autoDispatch ? "Auto-run on" : "Auto-run off"}
      </MenuTrigger>
      <MenuPopup align="end">
        <div className="flex w-80 flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <RemixIconTile tone="blue">
              <PlayIcon />
            </RemixIconTile>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
              <Label htmlFor="board-auto-dispatch">Auto-run agents</Label>
              <span className="text-xs text-muted-foreground">
                Start assignees and reviewers as soon as their tasks are ready
              </span>
            </div>
            <Switch
              id="board-auto-dispatch"
              className="mt-1"
              checked={settings.autoDispatch}
              disabled={props.disabled}
              onCheckedChange={(checked) => update({ autoDispatch: checked })}
            />
          </div>
          <div className="flex items-start gap-3">
            <RemixIconTile tone="purple">
              <GitBranchIcon />
            </RemixIconTile>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
              <Label htmlFor="board-worktrees">Worktree per task</Label>
              <span className="text-xs text-muted-foreground">
                Isolate each task on its own branch from {settings.baseRef}.
              </span>
            </div>
            <Switch
              id="board-worktrees"
              className="mt-1"
              checked={settings.useWorktrees}
              disabled={props.disabled}
              onCheckedChange={(checked) => update({ useWorktrees: checked })}
            />
          </div>
          <div className="flex items-center gap-3">
            <RemixIconTile tone="purple">
              <UsersIcon />
            </RemixIconTile>
            <Label className="flex-1">Agents at once</Label>
            <Select
              value={String(settings.maxConcurrentRuns)}
              disabled={props.disabled}
              onValueChange={(value) => update({ maxConcurrentRuns: Number(value) })}
            >
              <SelectTrigger size="sm" className="w-20">
                <SelectValue>{settings.maxConcurrentRuns}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {[1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
                  <SelectItem key={count} value={String(count)} label={String(count)}>
                    {count}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
      </MenuPopup>
    </Menu>
  );
}
