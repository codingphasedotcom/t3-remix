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
import type { BoardSnapshot, BoardTask, BoardTaskId, BoardTaskStatus } from "@t3tools/contracts";
import { CircleDotIcon, ListTreeIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { AgentAvatar } from "./AgentAvatar";
import type { RunBoardCommand } from "./BoardPage";
import {
  BOARD_COLUMNS,
  agentById,
  dropPosition,
  groupTasksByStatus,
  subtaskProgress,
  type BoardPlacement,
} from "./board.logic";

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
            {task.activeRunKind === "review"
              ? "Reviewing"
              : task.activeRunKind === "reply"
                ? "Replying"
                : "Working"}
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
          {assignee !== null ? (
            <AgentAvatar agent={assignee} name={assignee.name} title="Assignee" />
          ) : null}
          {reviewer !== null ? (
            <AgentAvatar agent={reviewer} name={reviewer.name} title="Reviewer" />
          ) : null}
        </span>
      </div>
    </div>
  );
}
