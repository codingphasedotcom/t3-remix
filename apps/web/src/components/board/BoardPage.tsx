import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useAtomValue } from "@effect/atom-react";
import type {
  BoardCommand,
  BoardSnapshot,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  CircleDotIcon,
  ListTreeIcon,
  MessageSquareIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { cn } from "../../lib/utils";
import { boardCommand, boardLive } from "../../state/board";
import { useProjects } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Label } from "../ui/label";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardCardSheet } from "./BoardCardSheet";
import { BoardNewCardDialog } from "./BoardNewCardDialog";
import { BoardTeamDialog } from "./BoardTeamDialog";
import {
  BOARD_COLUMNS,
  agentById,
  agentInitials,
  dropPosition,
  groupTasksByStatus,
  subtaskProgress,
  type BoardPlacement,
} from "./board.logic";

export interface BoardPageProps {
  readonly environmentId?: EnvironmentId | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly card?: BoardTaskId | undefined;
}

export type RunBoardCommand = (command: BoardCommand) => Promise<boolean>;

export function BoardPage(props: BoardPageProps) {
  useEscapeToGoBack();
  const navigate = useNavigate();
  const projects = useProjects().filter((project) => project.isScratch !== true);
  const selected =
    projects.find(
      (project) => project.environmentId === props.environmentId && project.id === props.projectId,
    ) ?? projects[0];

  const selectProject = (key: string) => {
    const next = projects.find((project) => `${project.environmentId}:${project.id}` === key);
    if (next === undefined) return;
    void navigate({
      to: "/board",
      search: { environmentId: next.environmentId, projectId: next.id },
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {selected === undefined ? (
          <>
            <WorkspacePageHeader electron={isElectron}>
              <span className="text-sm font-medium">Board</span>
            </WorkspacePageHeader>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListTreeIcon />
                </EmptyMedia>
                <EmptyTitle>No projects yet</EmptyTitle>
                <EmptyDescription>Add a project to give its agents a board.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </>
        ) : (
          <ProjectBoard
            key={`${selected.environmentId}:${selected.id}`}
            environmentId={selected.environmentId}
            projectId={selected.id}
            projectKey={`${selected.environmentId}:${selected.id}`}
            projectOptions={projects.map((project) => ({
              key: `${project.environmentId}:${project.id}`,
              title: project.title,
            }))}
            onSelectProject={selectProject}
            openCardId={props.card ?? null}
            onOpenCard={(cardId) =>
              void navigate({
                to: "/board",
                search: {
                  environmentId: selected.environmentId,
                  projectId: selected.id,
                  ...(cardId === null ? {} : { card: cardId }),
                },
              })
            }
          />
        )}
      </div>
    </SidebarInset>
  );
}

function ProjectBoard(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectKey: string;
  readonly projectOptions: ReadonlyArray<{ readonly key: string; readonly title: string }>;
  readonly onSelectProject: (key: string) => void;
  readonly openCardId: BoardTaskId | null;
  readonly onOpenCard: (cardId: BoardTaskId | null) => void;
}) {
  const environment = useEnvironment(props.environmentId);
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const boardQuery = useEnvironmentQuery(
    connected
      ? boardLive({ environmentId: props.environmentId, input: { projectId: props.projectId } })
      : null,
  );
  const canOperate = useAtomValue(boardCommand.permissionAtom(props.environmentId));
  const command = useAtomCommand(boardCommand, { label: "board update" });
  const runCommand: RunBoardCommand = async (input) => {
    const result = await command({ environmentId: props.environmentId, input });
    return result._tag === "Success";
  };
  const [teamOpen, setTeamOpen] = useState(false);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const snapshot = boardQuery.data;
  const currentTitle =
    props.projectOptions.find((option) => option.key === props.projectKey)?.title ?? "Project";

  const header = (
    <WorkspacePageHeader electron={isElectron}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-sm font-medium">Board</span>
        <Select
          value={props.projectKey}
          onValueChange={(key) => props.onSelectProject(String(key))}
        >
          <SelectTrigger size="sm" className="w-auto max-w-64">
            <SelectValue>
              <span className="truncate">{currentTitle}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {props.projectOptions.map((option) => (
              <SelectItem key={option.key} value={option.key} label={option.title}>
                {option.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {snapshot !== null ? (
        <div className="flex shrink-0 items-center gap-2">
          <BoardSettingsMenu snapshot={snapshot} disabled={!canOperate} runCommand={runCommand} />
          <Button size="sm" variant="outline" onClick={() => setTeamOpen(true)}>
            <UsersIcon />
            Team
            <Badge variant="secondary" size="sm">
              {snapshot.agents.length}
            </Badge>
          </Button>
          <Button size="sm" disabled={!canOperate} onClick={() => setNewCardOpen(true)}>
            <PlusIcon />
            New card
          </Button>
        </div>
      ) : null}
    </WorkspacePageHeader>
  );

  const openTask =
    props.openCardId === null
      ? null
      : (snapshot?.tasks.find((task) => task.id === props.openCardId) ?? null);

  return (
    <>
      {header}
      {!connected ? (
        <BoardMessage title="Environment offline" description="Reconnect to see this board." />
      ) : boardQuery.error !== null && snapshot === null ? (
        <BoardMessage title="Could not load the board" description={boardQuery.error} />
      ) : snapshot === null ? (
        <BoardMessage title="Loading board" description="" />
      ) : (
        <>
          {snapshot.agents.length === 0 ? (
            <div className="mx-(--workspace-gutter-start) mb-3 flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Add agents to your team, then assign cards to them. A card in To do with an assignee
                starts that agent in its own thread and worktree.
              </span>
              <Button size="sm" variant="outline" onClick={() => setTeamOpen(true)}>
                <BotIcon />
                Add agents
              </Button>
            </div>
          ) : null}
          <BoardColumns
            snapshot={snapshot}
            canOperate={canOperate}
            runCommand={runCommand}
            onOpenCard={props.onOpenCard}
          />
        </>
      )}
      {snapshot !== null ? (
        <>
          <BoardTeamDialog
            open={teamOpen}
            onOpenChange={setTeamOpen}
            environmentId={props.environmentId}
            projectId={props.projectId}
            agents={snapshot.agents}
            canOperate={canOperate}
            runCommand={runCommand}
          />
          <BoardNewCardDialog
            open={newCardOpen}
            onOpenChange={setNewCardOpen}
            projectId={props.projectId}
            agents={snapshot.agents}
            runCommand={runCommand}
          />
          <BoardCardSheet
            environmentId={props.environmentId}
            task={openTask}
            snapshot={snapshot}
            canOperate={canOperate}
            runCommand={runCommand}
            onOpenCard={props.onOpenCard}
          />
        </>
      ) : null}
    </>
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

function BoardSettingsMenu(props: {
  readonly snapshot: BoardSnapshot;
  readonly disabled: boolean;
  readonly runCommand: RunBoardCommand;
}) {
  const { settings } = props.snapshot;
  const update = (patch: {
    autoDispatch?: boolean;
    maxConcurrentRuns?: number;
    useWorktrees?: boolean;
  }) =>
    void props.runCommand({
      type: "settings.update",
      settings: { projectId: settings.projectId, ...patch },
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

/**
 * Columns are tall, so corner distance picks the wrong one; use what is under the pointer.
 * A card wins over the column it sits in so a drop lands before that card.
 */
const boardCollisionDetection: CollisionDetection = (args) => {
  const ownCard = `card:${String(args.active.id)}`;
  const underPointer = pointerWithin(args).filter((collision) => collision.id !== ownCard);
  const collisions =
    underPointer.length > 0
      ? underPointer
      : rectIntersection(args).filter((collision) => collision.id !== ownCard);
  return collisions.toSorted(
    (left, right) =>
      Number(String(right.id).startsWith("card:")) - Number(String(left.id).startsWith("card:")),
  );
};

function BoardColumns(props: {
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const [placements, setPlacements] = useState<ReadonlyMap<BoardTaskId, BoardPlacement>>(
    () => new Map(),
  );
  const [draggingId, setDraggingId] = useState<BoardTaskId | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const columns = groupTasksByStatus(props.snapshot.tasks, placements);
  const dragging =
    draggingId === null
      ? null
      : (props.snapshot.tasks.find((task) => task.id === draggingId) ?? null);

  const onDragStart = (event: DragStartEvent) => setDraggingId(event.active.id as BoardTaskId);

  const onDragEnd = async (event: DragEndEvent) => {
    setDraggingId(null);
    const taskId = event.active.id as BoardTaskId;
    const over = event.over;
    const task = props.snapshot.tasks.find((candidate) => candidate.id === taskId);
    if (over === null || task === undefined) return;
    const overData = over.data.current as
      | { readonly status: BoardTaskStatus; readonly taskId?: BoardTaskId }
      | undefined;
    if (overData === undefined) return;
    const target = columns[overData.status].filter((candidate) => candidate.id !== taskId);
    const beforeTaskId = overData.taskId === taskId ? null : (overData.taskId ?? null);
    const position = dropPosition(target, beforeTaskId);
    if (overData.status === task.status && beforeTaskId === null && overData.taskId === taskId) {
      return;
    }
    setPlacements((current) => new Map(current).set(taskId, { status: overData.status, position }));
    await props.runCommand({
      type: "task.update",
      task: {
        id: taskId,
        position,
        ...(overData.status === task.status ? {} : { status: overData.status }),
      },
    });
    setPlacements((current) => {
      const next = new Map(current);
      next.delete(taskId);
      return next;
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={onDragStart}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={(event) => void onDragEnd(event)}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-(--workspace-gutter-start) pb-4">
        {BOARD_COLUMNS.map((column) => (
          <BoardColumnView
            key={column.status}
            status={column.status}
            label={column.label}
            hint={column.hint}
            tasks={columns[column.status]}
            snapshot={props.snapshot}
            canDrag={props.canOperate}
            onOpenCard={props.onOpenCard}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging !== null ? (
          <BoardCardFace task={dragging} snapshot={props.snapshot} lifted />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumnView(props: {
  readonly status: BoardTaskStatus;
  readonly label: string;
  readonly hint: string;
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly snapshot: BoardSnapshot;
  readonly canDrag: boolean;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${props.status}`,
    data: { status: props.status },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={props.label}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30",
        isOver && "border-primary/50 bg-muted/60",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{props.label}</span>
          <span className="truncate text-xs text-muted-foreground">{props.hint}</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{props.tasks.length}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {props.tasks.map((task) => (
          <DraggableBoardCard
            key={task.id}
            task={task}
            snapshot={props.snapshot}
            canDrag={props.canDrag}
            onOpen={() => props.onOpenCard(task.id)}
          />
        ))}
      </div>
    </section>
  );
}

function DraggableBoardCard(props: {
  readonly task: BoardTask;
  readonly snapshot: BoardSnapshot;
  readonly canDrag: boolean;
  readonly onOpen: () => void;
}) {
  // The card face is the focusable button that opens the card; moving cards from the
  // keyboard goes through the Column field in its detail panel.
  const draggable = useDraggable({
    id: props.task.id,
    disabled: !props.canDrag,
    data: { status: props.task.status, taskId: props.task.id },
    attributes: { role: "listitem", tabIndex: -1 },
  });
  // The card is also a drop target so a drop lands before it rather than at the column's end.
  const droppable = useDroppable({
    id: `card:${props.task.id}`,
    data: { status: props.task.status, taskId: props.task.id },
  });
  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      className={cn(
        "rounded-lg",
        draggable.isDragging && "opacity-40",
        droppable.isOver && !draggable.isDragging && "ring-2 ring-primary/40",
      )}
      {...draggable.attributes}
      {...draggable.listeners}
    >
      <BoardCardFace task={props.task} snapshot={props.snapshot} onOpen={props.onOpen} />
    </div>
  );
}

function BoardCardFace(props: {
  readonly task: BoardTask;
  readonly snapshot: BoardSnapshot;
  readonly onOpen?: () => void;
  readonly lifted?: boolean;
}) {
  const { task, snapshot } = props;
  const assignee = agentById(snapshot.agents, task.assigneeAgentId);
  const reviewer = agentById(snapshot.agents, task.reviewerAgentId);
  const progress = subtaskProgress(snapshot.tasks, task.id);
  const parent =
    task.parentTaskId === null
      ? null
      : (snapshot.tasks.find((candidate) => candidate.id === task.parentTaskId) ?? null);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onOpen?.();
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-3 text-left text-card-foreground shadow-xs hover:border-foreground/20",
        props.lifted && "shadow-lg",
      )}
    >
      {parent !== null ? (
        <span className="truncate text-xs text-muted-foreground">↳ {parent.title}</span>
      ) : null}
      <span className="line-clamp-3 text-sm font-medium">{task.title}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {task.activeRunKind !== null ? (
          <Badge variant="info" size="sm">
            <CircleDotIcon />
            {task.activeRunKind === "review" ? "Reviewing" : "Working"}
          </Badge>
        ) : null}
        {progress.total > 0 ? (
          <Badge variant="outline" size="sm">
            <ListTreeIcon />
            {progress.done}/{progress.total}
          </Badge>
        ) : null}
        {task.commentCount > 0 ? (
          <Badge variant="outline" size="sm">
            <MessageSquareIcon />
            {task.commentCount}
          </Badge>
        ) : null}
        <span className="ms-auto flex items-center gap-1">
          {assignee !== null ? <AgentAvatar name={assignee.name} title="Assignee" /> : null}
          {reviewer !== null ? <AgentAvatar name={reviewer.name} title="Reviewer" muted /> : null}
        </span>
      </div>
    </div>
  );
}

export function AgentAvatar(props: {
  readonly name: string;
  readonly title: string;
  readonly muted?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${props.title}: ${props.name}`}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full text-3xs font-semibold",
              props.muted ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            {agentInitials(props.name)}
          </span>
        }
      />
      <TooltipPopup side="top">
        {props.title}: {props.name}
      </TooltipPopup>
    </Tooltip>
  );
}
