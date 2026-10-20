import { useAtomValue } from "@effect/atom-react";
import type {
  BoardCommand,
  BoardCommandResult,
  BoardCompany,
  BoardCompanyId,
  BoardSnapshot,
  BoardTaskId,
  EnvironmentId,
} from "@t3tools/contracts";
import { Navigate, useNavigate } from "@tanstack/react-router";
import {
  Building2Icon,
  EllipsisIcon,
  KanbanSquareIcon,
  NetworkIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { isElectron } from "../../env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
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
import { AgentDialog, type AgentDraft } from "./AgentDialog";
import { BoardCardSheet } from "./BoardCardSheet";
import { BoardColumns } from "./BoardColumns";
import { BoardNewCardDialog } from "./BoardNewCardDialog";
import { CompanyDialog } from "./CompanyDialog";
import { OrgChartView } from "./OrgChartView";
import { SkillsView } from "./SkillsView";
import { agentById } from "./board.logic";

export type BoardTab = "board" | "org" | "skills";

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
            <BoardMessage title="No environment" description="Connect T3 Code to a server." />
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
    return result._tag === "Success" ? result.value : null;
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
        <BoardMessage title="Environment offline" description="Reconnect to see your companies." />
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
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>Start your first company</EmptyTitle>
            <EmptyDescription>
              Give it a mission and a CEO. You hand the CEO cards; the CEO splits them into work for
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
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Select
            value={company.id}
            onValueChange={(value) => go({ company: value as BoardCompanyId, tab })}
          >
            <SelectTrigger size="sm" className="w-auto max-w-56">
              <SelectValue>
                <span className="flex items-center gap-2 truncate">
                  <Building2Icon className="size-4 shrink-0" />
                  {company.name}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {snapshot.companies.map((summary) => (
                <SelectItem key={summary.id} value={summary.id} label={summary.name}>
                  <span className="flex flex-col">
                    <span>{summary.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {summary.agentCount} agents · {summary.openTaskCount} open cards
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
                Edit name and mission
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
          <div className="ms-2 flex items-center gap-1">
            <Button
              size="sm"
              variant={tab === "board" ? "secondary" : "ghost"}
              onClick={() => go({ company: company.id, tab: "board" })}
            >
              <KanbanSquareIcon />
              Board
            </Button>
            <Button
              size="sm"
              variant={tab === "org" ? "secondary" : "ghost"}
              onClick={() => go({ company: company.id, tab: "org" })}
            >
              <NetworkIcon />
              Org chart
              {pendingHires > 0 ? (
                <Badge variant="warning" size="sm">
                  {pendingHires}
                </Badge>
              ) : null}
            </Button>
            <Button
              size="sm"
              variant={tab === "skills" ? "secondary" : "ghost"}
              onClick={() => go({ company: company.id, tab: "skills" })}
            >
              <SparklesIcon />
              Skills
            </Button>
          </div>
        </div>
        {tab === "board" ? (
          <div className="flex shrink-0 items-center gap-2">
            <BoardSettingsMenu snapshot={snapshot} disabled={!canOperate} runCommand={runCommand} />
            <Button size="sm" disabled={!canOperate} onClick={() => setNewCardOpen(true)}>
              <PlusIcon />
              New card
            </Button>
          </div>
        ) : null}
      </WorkspacePageHeader>

      {tab === "board" ? (
        <>
          <MissionBanner company={company} ceoName={ceo?.name ?? null} />
          <BoardColumns
            snapshot={snapshot}
            canOperate={canOperate}
            runCommand={runCommand}
            onOpenCard={(cardId) => go({ company: company.id, card: cardId })}
          />
        </>
      ) : tab === "org" ? (
        <OrgChartView
          snapshot={snapshot}
          canOperate={canOperate}
          runCommand={runCommand}
          onEditAgent={setAgentDraft}
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
          go({ company: company.id, ...(cardId === null ? {} : { card: cardId }) })
        }
      />
    </>
  );
}

function MissionBanner(props: { readonly company: BoardCompany; readonly ceoName: string | null }) {
  if (props.company.mission.trim().length === 0 && props.ceoName === null) return null;
  return (
    <div className="mx-(--workspace-gutter-start) mb-3 flex items-center gap-3 text-sm">
      {props.company.mission.trim().length > 0 ? (
        <span className="min-w-0 truncate text-muted-foreground">
          <span className="font-medium text-foreground">Mission:</span> {props.company.mission}
        </span>
      ) : null}
      {props.ceoName !== null ? (
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
          New cards go to {props.ceoName}, the CEO
        </span>
      ) : null}
    </div>
  );
}

function BoardMessage(props: { readonly title: string; readonly description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.description ? <EmptyDescription>{props.description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function EditCompanyDialog(props: {
  readonly company: BoardCompany | null;
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

function EditCompanyForm(props: {
  readonly company: BoardCompany;
  readonly onClose: () => void;
  readonly runCommand: RunBoardCommand;
}) {
  const [name, setName] = useState(props.company.name);
  const [mission, setMission] = useState(props.company.mission);
  const save = async () => {
    const saved = await props.runCommand({
      type: "company.update",
      company: { id: props.company.id, name: name.trim(), mission: mission.trim() },
    });
    if (saved !== null) props.onClose();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit company</DialogTitle>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
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
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
        <Button size="sm" disabled={name.trim().length === 0} onClick={() => void save()}>
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
        <div className="flex w-72 flex-col gap-4 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="board-auto-dispatch">Auto-run agents</Label>
              <span className="text-xs text-muted-foreground">
                Start assignees and reviewers as soon as their cards are ready.
              </span>
            </div>
            <Switch
              id="board-auto-dispatch"
              checked={settings.autoDispatch}
              disabled={props.disabled}
              onCheckedChange={(checked) => update({ autoDispatch: checked })}
            />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="board-worktrees">Worktree per card</Label>
              <span className="text-xs text-muted-foreground">
                Isolate each card on its own branch from {settings.baseRef}.
              </span>
            </div>
            <Switch
              id="board-worktrees"
              checked={settings.useWorktrees}
              disabled={props.disabled}
              onCheckedChange={(checked) => update({ useWorktrees: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>Agents at once</Label>
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
