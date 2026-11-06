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
import {
  boardTaskWaitingOn,
  type BoardRunKind,
  type BoardSnapshot,
  type BoardTask,
  type BoardTaskId,
  type BoardTaskStatus,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ChevronRightIcon,
  ClockIcon,
  HourglassIcon,
  ListTreeIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentAvatar, AgentName, YouName } from "./AgentAvatar";
import type { RunBoardCommand } from "./BoardPage";
import {
  BOARD_COLUMNS,
  agentById,
  canArchiveTask,
  dropPosition,
  groupTasksByStatus,
  subtaskProgress,
  type BoardPlacement,
} from "./board.logic";
import { ColumnArt, RocketArt } from "./RemixArt";
import {
  REMIX_CARD,
  REMIX_COLUMN_TONES,
  REMIX_SHELL,
  REMIX_WELL,
  RemixBubble,
  RemixButton,
  RemixIconTile,
  type RemixTone,
} from "./RemixSurface";

const EMPTY_TITLES: Record<BoardTaskStatus, string> = {
  backlog: "No ideas yet",
  todo: "Nothing to do",
  in_progress: "No tasks in progress",
  review: "Nothing to review",
  blocked: "Nothing blocked",
  done: "Nothing done yet",
};

const RUN_LABELS: Record<BoardRunKind, string> = {
  work: "Working now",
  review: "Reviewing now",
  reply: "Replying now",
};

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

export function BoardColumns(props: {
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const [placements, setPlacements] = useState<ReadonlyMap<BoardTaskId, BoardPlacement>>(
    () => new Map(),
  );
  const [draggingId, setDraggingId] = useState<BoardTaskId | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const archivedCount = props.snapshot.tasks.filter((task) => task.archivedAt !== null).length;
  const columns = groupTasksByStatus(
    showArchived
      ? props.snapshot.tasks
      : props.snapshot.tasks.filter((task) => task.archivedAt === null),
    placements,
  );
  const archivable = props.snapshot.tasks.filter(canArchiveTask);
  const archiveAll = async () => {
    for (const task of archivable) {
      if (
        (await props.runCommand({ type: "task.archive", id: task.id, archived: true })) === null
      ) {
        return;
      }
    }
  };
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
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-(--workspace-gutter-start) pt-1 pb-8">
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
            actions={
              column.status === "done" && (archivable.length > 0 || archivedCount > 0) ? (
                <>
                  {archivable.length > 0 ? (
                    <RemixButton
                      size="sm"
                      disabled={!props.canOperate}
                      onClick={() => void archiveAll()}
                    >
                      <ArchiveIcon />
                      Archive all
                    </RemixButton>
                  ) : null}
                  {archivedCount > 0 ? (
                    <RemixButton
                      size="sm"
                      variant={showArchived ? "active" : "paper"}
                      aria-pressed={showArchived}
                      onClick={() => setShowArchived((current) => !current)}
                    >
                      {showArchived ? "Hide archived" : `${archivedCount} archived`}
                    </RemixButton>
                  ) : null}
                </>
              ) : null
            }
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
  readonly actions?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${props.status}`,
    data: { status: props.status },
  });
  const tone = REMIX_COLUMN_TONES[props.status];
  return (
    <section
      ref={setNodeRef}
      aria-label={props.label}
      data-remix-tone={tone}
      className={cn(REMIX_SHELL, "w-72 shrink-0", isOver && "ring-3 ring-white/80")}
    >
      <header className="flex items-center gap-2 px-2.5 pt-2.5 pb-3">
        <Tooltip>
          <TooltipTrigger render={<span className="me-auto flex" />}>
            <RemixBubble tone={tone}>
              {props.label}: {props.tasks.filter((task) => task.archivedAt === null).length}
            </RemixBubble>
          </TooltipTrigger>
          <TooltipPopup side="top">{props.hint}</TooltipPopup>
        </Tooltip>
        <ColumnArt status={props.status} className="size-7" />
      </header>
      {props.actions ? (
        <div className="flex justify-end gap-1.5 px-2.5 pb-2.5">{props.actions}</div>
      ) : null}
      <div className={cn(REMIX_WELL, "mx-1.5 mb-1.5 min-h-24 flex-1 gap-2 overflow-y-auto p-1.5")}>
        {props.tasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-4 py-4 text-center">
            {props.status === "in_progress" ? (
              <RocketArt className="mb-2 w-32" />
            ) : (
              <ColumnArt status={props.status} className="mb-2 size-9 opacity-70" />
            )}
            <span className="text-sm font-semibold">{EMPTY_TITLES[props.status]}</span>
            <span className="text-xs text-(--remix-text-muted)">
              {props.status === "in_progress" ? "Drag a task here to get started." : props.hint}
            </span>
          </div>
        ) : (
          props.tasks.map((task) => (
            <DraggableBoardCard
              key={task.id}
              task={task}
              snapshot={props.snapshot}
              canDrag={props.canDrag}
              onOpen={() => props.onOpenCard(task.id)}
            />
          ))
        )}
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
        "rounded-2xl",
        props.task.archivedAt !== null && "opacity-60",
        draggable.isDragging && "opacity-40",
        droppable.isOver && !draggable.isDragging && "ring-2 ring-(--remix-ink)/30",
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
  // A card you keep never goes to a reviewer, so a leftover one isn't shown.
  const reviewer = task.assignedToUser ? null : agentById(snapshot.agents, task.reviewerAgentId);
  const progress = subtaskProgress(snapshot.tasks, task.id);
  const waiting = task.status === "todo" ? boardTaskWaitingOn(task, snapshot.tasks) : [];
  const parent =
    task.parentTaskId === null
      ? null
      : (snapshot.tasks.find((candidate) => candidate.id === task.parentTaskId) ?? null);
  const live = task.activeRunKind !== null;
  // The meta line names one person; the footer shows anyone else on the card.
  const named = task.activeRunKind === "review" ? reviewer : assignee;
  const others = [
    { agent: assignee, title: "Assignee" },
    { agent: reviewer, title: "Reviewer" },
  ].filter((entry) => entry.agent !== null && entry.agent.id !== named?.id);
  const muted = live ? "text-(--tone-on)/80" : "text-(--remix-text-muted)";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onOpen?.();
      }}
      data-remix-tone={live ? "blue" : REMIX_COLUMN_TONES[task.status]}
      className={cn(
        REMIX_CARD,
        "cursor-pointer gap-1.5 p-2.5 text-left outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-(--remix-ink)/40 focus-visible:ring-inset",
        live
          ? "bg-(--tone) text-(--tone-on) shadow-(--remix-card-lift)"
          : "border-(--tone) shadow-(--tone-lift) hover:-translate-y-0.5",
        props.lifted && "rotate-1 shadow-lg",
      )}
    >
      <div className={cn("flex items-center justify-between gap-3 text-xs font-medium", muted)}>
        {named !== null ? (
          <AgentName
            agent={named}
            size="xs"
            className={cn("text-xs", live ? "text-(--tone-on)" : "text-(--remix-text)")}
          >
            {task.activeRunKind === null
              ? named.name
              : `${named.name} · ${RUN_LABELS[task.activeRunKind]}`}
          </AgentName>
        ) : task.assignedToUser && task.activeRunKind === null ? (
          <YouName />
        ) : (
          <span className="truncate">
            {task.activeRunKind === null ? "Unassigned" : RUN_LABELS[task.activeRunKind]}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {formatRelativeTimeLabel(task.updatedAt)}
          <ClockIcon className="size-3" />
        </span>
      </div>
      {parent !== null ? (
        <span className={cn("-mb-0.5 truncate text-xs", muted)}>↳ {parent.title}</span>
      ) : null}
      <span className="line-clamp-3 text-sm leading-snug font-semibold">{task.title}</span>
      {waiting.length > 0 ? (
        <span className={cn("-mt-0.5 flex min-w-0 items-center gap-1.5 text-xs", muted)}>
          <HourglassIcon className="size-3 shrink-0" />
          <span className="truncate">
            Waits on {waiting[0]!.title}
            {waiting.length > 1 ? ` and ${waiting.length - 1} more` : ""}
          </span>
        </span>
      ) : null}
      <div className="flex items-center gap-2.5">
        {progress.total > 0 ? (
          <CardStat
            icon={<ListTreeIcon />}
            value={`${progress.done}/${progress.total}`}
            label="subtasks done"
            live={live}
            tone={progress.done === progress.total ? "green" : "orange"}
          />
        ) : null}
        {task.commentCount > 0 ? (
          <CardStat
            icon={<MessageSquareIcon />}
            value={String(task.commentCount)}
            label={task.commentCount === 1 ? "comment" : "comments"}
            live={live}
            tone="blue"
          />
        ) : null}
        <span className="ms-auto flex items-center -space-x-1.5">
          {others.map((entry) =>
            entry.agent === null ? null : (
              <AgentAvatar
                key={entry.title}
                agent={entry.agent}
                name={entry.agent.name}
                title={entry.title}
                size="xs"
              />
            ),
          )}
        </span>
        {live ? (
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-lg border-(length:--remix-line-thin) border-(--remix-ink) bg-white/25"
          >
            <ChevronRightIcon className="size-3.5" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CardStat(props: {
  readonly icon: ReactNode;
  readonly value: string;
  readonly label: string;
  readonly live: boolean;
  readonly tone: RemixTone;
}) {
  return (
    <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
      {props.live ? (
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-md bg-white/25 [&_svg]:size-3"
        >
          {props.icon}
        </span>
      ) : (
        <RemixIconTile tone={props.tone}>{props.icon}</RemixIconTile>
      )}
      {props.value}
      <span className="sr-only">{props.label}</span>
    </span>
  );
}
