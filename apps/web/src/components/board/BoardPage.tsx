import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
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
import { Navigate, useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import {
  Building2Icon,
  EllipsisIcon,
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
import { useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { isElectron } from "../../env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { cn } from "../../lib/utils";
import { boardCommand, boardLive } from "../../state/board";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
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
import { toastManager } from "../ui/toast";
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
import type { Tone } from "./boardTones";
import {
  OFFICE_CARD,
  OFFICE_PANEL,
  OFFICE_TRACK,
  OfficeFieldGroup,
  OfficeHeading,
  OfficeIconTile,
  OfficePill,
  OfficeTab,
  OfficeTabs,
} from "./OfficeSurface";

export type BoardTab = "board" | "dashboard" | "org" | "skills" | "routines";

export interface BoardPageProps {
  readonly environmentId?: EnvironmentId | undefined;
  readonly company?: BoardCompanyId | undefined;
  readonly card?: BoardTaskId | undefined;
  readonly tab?: BoardTab | undefined;
}

/** Runs one board change; resolves to its result, or null when it failed (already reported). */
export type RunBoardCommand = (command: BoardCommand) => Promise<BoardCommandResult | null>;

export function BoardPage(props: BoardPageProps) {
  useEscapeToGoBack();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = props.environmentId ?? primaryEnvironmentId;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {environmentId === null ? (
          <>
            <WorkspacePageHeader electron={isElectron}>
              <span className="text-sm font-medium">Companies</span>
            </WorkspacePageHeader>
            <BoardMessage
              icon={<ServerOffIcon />}
              tone="gray"
              title="No environment"
              description="Connect T3 Code to a server."
            />
          </>
        ) : (
          <CompanyWorkspace key={environmentId} {...props} environmentId={environmentId} />
        )}
      </div>
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
  const command = useAtomCommand(boardCommand, { label: "board update" });
  const runCommand: RunBoardCommand = async (input) => {
    const result = await command({ environmentId, input });
    if (result._tag === "Success") return result.value;
    if (Cause.hasInterruptsOnly(result.cause)) return null;
    // The server says why it refused, such as a merge into a folder with uncommitted changes.
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "The board couldn't do that",
      ...(error instanceof Error ? { description: error.message } : {}),
    });
    return null;
  };
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState(false);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
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
          description="Reconnect to see your companies."
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
              <OfficeIconTile tone="teal" size="lg">
                <Building2Icon />
              </OfficeIconTile>
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
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className={cn(OFFICE_TRACK, "shrink")}>
            <Select
              value={company.id}
              onValueChange={(value) => go({ company: value as BoardCompanyId, tab })}
            >
              <SelectTrigger size="sm" variant="ghost" className="w-auto max-w-56">
                <SelectValue>
                  <span className="flex items-center gap-2 truncate">
                    <OfficeIconTile tone="teal">
                      <Building2Icon />
                    </OfficeIconTile>
                    <span className="truncate font-medium text-foreground">{company.name}</span>
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
          <OfficeTabs label="Company views">
            <OfficeTab
              active={tab === "board"}
              icon={<KanbanSquareIcon />}
              tone="sky"
              onClick={() => go({ company: company.id, tab: "board" })}
            >
              Board
            </OfficeTab>
            <OfficeTab
              active={tab === "dashboard"}
              icon={<LayoutDashboardIcon />}
              tone="emerald"
              onClick={() => go({ company: company.id, tab: "dashboard" })}
            >
              Dashboard
            </OfficeTab>
            <OfficeTab
              active={tab === "org"}
              icon={<NetworkIcon />}
              tone="violet"
              onClick={() => go({ company: company.id, tab: "org" })}
            >
              Org chart
              {pendingHires > 0 ? (
                <Badge variant="warning" size="sm">
                  {pendingHires}
                </Badge>
              ) : null}
            </OfficeTab>
            <OfficeTab
              active={tab === "skills"}
              icon={<SparklesIcon />}
              tone="indigo"
              onClick={() => go({ company: company.id, tab: "skills" })}
            >
              Skills
            </OfficeTab>
            <OfficeTab
              active={tab === "routines"}
              icon={<RepeatIcon />}
              tone="teal"
              onClick={() => go({ company: company.id, tab: "routines" })}
            >
              Routines
            </OfficeTab>
          </OfficeTabs>
        </div>
        {tab === "board" ? (
          <div className="flex shrink-0 items-center gap-2">
            <BoardSettingsMenu snapshot={snapshot} disabled={!canOperate} runCommand={runCommand} />
            <Button size="sm" disabled={!canOperate} onClick={() => setNewCardOpen(true)}>
              <PlusIcon />
              New task
            </Button>
          </div>
        ) : null}
      </WorkspacePageHeader>

      {tab === "board" ? (
        <>
          <MissionBanner company={company} ceo={ceo ?? null} />
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
      <EditCompanyDialog
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
    <div className="mx-(--workspace-gutter-start) mb-3 flex items-center gap-3 rounded-2xl bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
      <OfficeIconTile tone="amber">
        <GaugeIcon />
      </OfficeIconTile>
      <span className="min-w-0">
        {progress.reached
          ? "This company used its monthly token limit. Agents won't start until you raise it under Edit company or the month ends."
          : `This company has used ${Math.round(progress.share * 100)}% of its monthly token limit.`}
      </span>
    </div>
  );
}

function MissionBanner(props: { readonly company: BoardCompany; readonly ceo: BoardAgent | null }) {
  if (props.company.mission.trim().length === 0 && props.ceo === null) return null;
  return (
    <div
      className={cn(
        OFFICE_PANEL,
        "mx-(--workspace-gutter-start) mb-3 flex-row items-center rounded-2xl px-3 py-2 text-sm",
      )}
    >
      {props.company.mission.trim().length > 0 ? (
        <>
          <OfficePill tone="teal">Mission</OfficePill>
          <span className="min-w-0 truncate text-foreground">{props.company.mission}</span>
        </>
      ) : null}
      {props.ceo !== null ? (
        <span className="ms-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {"New tasks go to "}
          <AgentName agent={props.ceo} className="font-medium text-foreground" />
          {", the CEO"}
        </span>
      ) : null}
    </div>
  );
}

function BoardMessage(props: {
  readonly icon: ReactNode;
  readonly tone: Tone;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <OfficeIconTile tone={props.tone} size="lg">
            {props.icon}
          </OfficeIconTile>
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.description ? <EmptyDescription>{props.description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function EditCompanyDialog(props: {
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
    name.trim().length > 0 &&
    memory.length <= MAX_COMPANY_MEMORY_CHARS &&
    departments.length > 0 &&
    departments.every((department) => department.name.trim().length > 0);
  return (
    <>
      <DialogHeader>
        <OfficeHeading
          icon={<Building2Icon />}
          tone="teal"
          title={<DialogTitle>Edit company</DialogTitle>}
        />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <OfficeFieldGroup label="Company" tone="teal">
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
          </OfficeFieldGroup>
          <OfficeFieldGroup
            label="Departments"
            tone="violet"
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
                    className={cn(OFFICE_CARD, "flex-row items-center gap-2 rounded-xl p-2")}
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
                      <OfficeIconTile tone="violet">
                        <UsersIcon />
                      </OfficeIconTile>
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
          </OfficeFieldGroup>
          <OfficeFieldGroup label="Limits" tone="amber">
            <TokenLimitField
              id="board-edit-company-token-limit"
              label="Monthly token limit for the company"
              value={tokenLimit}
              used={props.snapshot.usage?.companyTokens ?? null}
              onChange={setTokenLimit}
              onValidityChange={setLimitValid}
            />
          </OfficeFieldGroup>
          <OfficeFieldGroup label="Memory" tone="gray">
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
          </OfficeFieldGroup>
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
        <Button size="sm" disabled={!canSave} onClick={() => void save()}>
          Save
        </Button>
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
      <MenuTrigger render={<Button size="sm" variant="outline" aria-label="Board settings" />}>
        <SettingsIcon />
        {settings.autoDispatch ? "Auto-run on" : "Auto-run off"}
      </MenuTrigger>
      <MenuPopup align="end">
        <div className="flex w-80 flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <OfficeIconTile tone="sky">
              <PlayIcon />
            </OfficeIconTile>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
              <Label htmlFor="board-auto-dispatch">Auto-run agents</Label>
              <span className="text-xs text-muted-foreground">
                Start assignees and reviewers as soon as their tasks are ready.
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
            <OfficeIconTile tone="violet">
              <GitBranchIcon />
            </OfficeIconTile>
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
            <OfficeIconTile tone="indigo">
              <UsersIcon />
            </OfficeIconTile>
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
