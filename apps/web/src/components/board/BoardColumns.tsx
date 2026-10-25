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
import type {
  BoardRunKind,
  BoardSnapshot,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
} from "@t3tools/contracts";
import { ChevronRightIcon, ClockIcon, ListTreeIcon, MessageSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentAvatar, AgentName } from "./AgentAvatar";
import type { RunBoardCommand } from "./BoardPage";
import {
  BOARD_COLUMNS,
  agentById,
  dropPosition,
  groupTasksByStatus,
  subtaskProgress,
  type BoardPlacement,
} from "./board.logic";
import { COLUMN_TONES } from "./boardTones";
import { OFFICE_CARD, OFFICE_PANEL, OfficePill, statusPillVariant } from "./OfficeSurface";

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
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-(--workspace-gutter-start) pb-4">
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
      className={cn(OFFICE_PANEL, "w-80 shrink-0 gap-0 p-0", isOver && "ring-2 ring-primary/30")}
    >
      <header className="flex px-4 pt-4 pb-3">
        <Tooltip>
          <TooltipTrigger render={<span className="flex" />}>
            <OfficePill tone={COLUMN_TONES[props.status]} variant={statusPillVariant(props.status)}>
              {props.label}: {props.tasks.length}
            </OfficePill>
          </TooltipTrigger>
          <TooltipPopup side="top">{props.hint}</TooltipPopup>
        </Tooltip>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
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
        "rounded-2xl",
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
  const live = task.activeRunKind !== null;
  // The meta line names one person; the footer shows anyone else on the card.
  const named = task.activeRunKind === "review" ? reviewer : assignee;
  const others = [
    { agent: assignee, title: "Assignee" },
    { agent: reviewer, title: "Reviewer" },
  ].filter((entry) => entry.agent !== null && entry.agent.id !== named?.id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onOpen?.();
      }}
      className={cn(
        "cursor-pointer text-left",
        live
          ? "flex flex-col gap-3 rounded-2xl bg-primary p-4 text-primary-foreground shadow-lg shadow-primary/25"
          : cn(OFFICE_CARD, "hover:shadow-md"),
        props.lifted && "shadow-xl",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 text-xs",
          live ? "text-primary-foreground/75" : "text-muted-foreground",
        )}
      >
        {named !== null ? (
          <AgentName agent={named}>
            {task.activeRunKind === null
              ? named.name
              : `${named.name} · ${RUN_LABELS[task.activeRunKind]}`}
          </AgentName>
        ) : (
          <span className="truncate">
            {task.activeRunKind === null ? "Unassigned" : RUN_LABELS[task.activeRunKind]}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {formatRelativeTimeLabel(task.updatedAt)}
          <ClockIcon className="size-3.5" />
        </span>
      </div>
      {parent !== null ? (
        <span
          className={cn(
            "-mb-2 truncate text-xs",
            live ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          ↳ {parent.title}
        </span>
      ) : null}
      <span className="line-clamp-3 text-base leading-snug font-medium">{task.title}</span>
      <div className="flex items-center gap-3">
        {progress.total > 0 ? (
          <CardStat
            icon={<ListTreeIcon />}
            value={`${progress.done}/${progress.total}`}
            label="subtasks done"
            live={live}
            tileClassName={progress.done === progress.total ? "bg-success" : "bg-warning"}
          />
        ) : null}
        {task.commentCount > 0 ? (
          <CardStat
            icon={<MessageSquareIcon />}
            value={String(task.commentCount)}
            label={task.commentCount === 1 ? "comment" : "comments"}
            live={live}
            tileClassName="bg-info"
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
              />
            ),
          )}
        </span>
        {live ? (
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-xl bg-primary-foreground/20"
          >
            <ChevronRightIcon className="size-4" />
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
  readonly tileClassName: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium tabular-nums",
        props.live ? "text-primary-foreground/85" : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-6 items-center justify-center rounded-md text-white [&_svg]:size-3.5",
          props.live ? "bg-primary-foreground/20" : props.tileClassName,
        )}
      >
        {props.icon}
      </span>
      {props.value}
      <span className="sr-only">{props.label}</span>
    </span>
  );
}
