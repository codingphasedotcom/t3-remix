import type {
  BoardAgentId,
  BoardComment,
  BoardRun,
  BoardSnapshot,
  BoardTask,
  BoardTaskId,
  BoardTaskStatus,
  EnvironmentId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { cn } from "../../lib/utils";
import { boardTaskDetailLive } from "../../state/board";
import { useEnvironmentQuery } from "../../state/query";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Textarea } from "../ui/textarea";
import { AgentSelect } from "./AgentSelect";
import type { RunBoardCommand } from "./BoardPage";
import { BOARD_COLUMNS, agentById, boardStatusLabel } from "./board.logic";

export function BoardCardSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly task: BoardTask | null;
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onOpenCard: (cardId: BoardTaskId | null) => void;
}) {
  return (
    <Sheet
      open={props.task !== null}
      onOpenChange={(open) => {
        if (!open) props.onOpenCard(null);
      }}
    >
      <SheetPopup side="right" className="max-w-xl">
        {props.task !== null ? (
          <BoardCardDetail key={props.task.id} {...props} task={props.task} />
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}

function BoardCardDetail(props: {
  readonly environmentId: EnvironmentId;
  readonly task: BoardTask;
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onOpenCard: (cardId: BoardTaskId | null) => void;
}) {
  const { task, snapshot } = props;
  const navigate = useNavigate();
  const detail = useEnvironmentQuery(
    boardTaskDetailLive({ environmentId: props.environmentId, input: { taskId: task.id } }),
  );

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const descriptionDirty = description !== task.description;
  const parent = snapshot.tasks.find((candidate) => candidate.id === task.parentTaskId) ?? null;
  const subtasks = snapshot.tasks.filter((candidate) => candidate.parentTaskId === task.id);
  const disabled = !props.canOperate;

  const update = (patch: {
    title?: string;
    description?: string;
    status?: BoardTaskStatus;
    assigneeAgentId?: BoardAgentId | null;
    reviewerAgentId?: BoardAgentId | null;
  }) => props.runCommand({ type: "task.update", task: { id: task.id, ...patch } });

  const openThread = (threadId: string) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(
        scopeThreadRef(props.environmentId, threadId as NonNullable<BoardTask["threadId"]>),
      ),
    });

  const postComment = async () => {
    const body = comment.trim();
    if (body.length === 0) return;
    setPosting(true);
    const posted = await props.runCommand({
      type: "comment.add",
      comment: { taskId: task.id, body },
    });
    setPosting(false);
    if (posted !== null) setComment("");
  };

  const deleteCard = async () => {
    const message = `Delete "${task.title}"?\nIts comments go with it; agent threads stay.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    if ((await props.runCommand({ type: "task.delete", id: task.id })) !== null) {
      props.onOpenCard(null);
    }
  };

  const canStart =
    task.activeRunKind === null &&
    (task.status === "review"
      ? task.reviewerAgentId !== null
      : task.status !== "done" && task.assigneeAgentId !== null);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="sr-only">{task.title}</SheetTitle>
        <SheetDescription className="sr-only">Board task details</SheetDescription>
        <Input
          value={title}
          disabled={disabled}
          aria-label="Task title"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next.length > 0 && next !== task.title) void update({ title: next });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {task.activeRunKind !== null ? (
            <Badge variant="info">
              {task.activeRunKind === "review" ? "Reviewer working" : "Agent working"}
            </Badge>
          ) : null}
          {canStart ? (
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => void props.runCommand({ type: "task.start", id: task.id })}
            >
              <PlayIcon />
              {task.status === "review" ? "Start review" : "Start agent"}
            </Button>
          ) : null}
          {task.threadId !== null ? (
            <Button size="sm" variant="outline" onClick={() => openThread(task.threadId ?? "")}>
              <ExternalLinkIcon />
              Open thread
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost-destructive"
            disabled={disabled}
            onClick={() => void deleteCard()}
          >
            <Trash2Icon />
            Delete
          </Button>
        </div>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 px-6 pb-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label>Column</Label>
              <Select
                value={task.status}
                disabled={disabled}
                onValueChange={(value) => void update({ status: value as BoardTaskStatus })}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{boardStatusLabel(task.status)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {BOARD_COLUMNS.map((column) => (
                    <SelectItem key={column.status} value={column.status} label={column.label}>
                      {column.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Assignee</Label>
              <AgentSelect
                agents={snapshot.agents}
                value={task.assigneeAgentId}
                disabled={disabled}
                onChange={(assigneeAgentId) => void update({ assigneeAgentId })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Reviewer</Label>
              <AgentSelect
                agents={snapshot.agents}
                noneLabel="The board (you)"
                value={task.reviewerAgentId}
                disabled={disabled}
                onChange={(reviewerAgentId) => void update({ reviewerAgentId })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="board-card-detail-description">Description</Label>
            <Textarea
              id="board-card-detail-description"
              value={description}
              rows={6}
              disabled={disabled}
              placeholder="What done looks like."
              onChange={(event) => setDescription(event.target.value)}
            />
            {descriptionDirty ? (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDescription(task.description)}>
                  Discard
                </Button>
                <Button size="sm" onClick={() => void update({ description })}>
                  Save description
                </Button>
              </div>
            ) : null}
          </div>

          {parent !== null || subtasks.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Label>Related tasks</Label>
              {parent !== null ? (
                <RelatedCard
                  prefix="Parent"
                  task={parent}
                  onOpen={() => props.onOpenCard(parent.id)}
                />
              ) : null}
              {subtasks.map((subtask) => (
                <RelatedCard
                  key={subtask.id}
                  prefix="Subtask"
                  task={subtask}
                  onOpen={() => props.onOpenCard(subtask.id)}
                />
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="board-card-comment">Activity</Label>
            <div className="flex flex-col gap-2">
              {(detail.data?.comments ?? []).map((entry) => (
                <CommentRow key={entry.id} comment={entry} snapshot={snapshot} />
              ))}
              {detail.data !== null && detail.data.comments.length === 0 ? (
                <span className="text-sm text-muted-foreground">No activity yet.</span>
              ) : null}
            </div>
            <Textarea
              id="board-card-comment"
              value={comment}
              rows={3}
              disabled={disabled}
              placeholder={
                task.activeRunKind !== null
                  ? "Comment — the working agent receives it right away"
                  : "Comment for the next agent run or a teammate"
              }
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void postComment();
                }
              }}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={disabled || posting || comment.trim().length === 0}
                onClick={() => void postComment()}
              >
                Comment
              </Button>
            </div>
          </div>

          {(detail.data?.runs.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-2">
              <Label>Agent runs</Label>
              {(detail.data?.runs ?? []).toReversed().map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  snapshot={snapshot}
                  onOpenThread={() => openThread(run.threadId)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </>
  );
}

function RelatedCard(props: {
  readonly prefix: string;
  readonly task: BoardTask;
  readonly onOpen: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" onClick={props.onOpen}>
      <span className="text-muted-foreground">{props.prefix}</span>
      <span className="min-w-0 flex-1 truncate text-start">{props.task.title}</span>
      <Badge variant="outline" size="sm">
        {boardStatusLabel(props.task.status)}
      </Badge>
    </Button>
  );
}

function CommentRow(props: { readonly comment: BoardComment; readonly snapshot: BoardSnapshot }) {
  const { comment } = props;
  const author =
    comment.authorKind === "user"
      ? "You"
      : comment.authorKind === "system"
        ? null
        : (agentById(props.snapshot.agents, comment.authorAgentId)?.name ?? "Agent");
  const time = formatRelativeTimeLabel(comment.createdAt);
  if (author === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {comment.body} · {time}
      </span>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2",
        comment.authorKind === "agent" && "bg-muted/40",
      )}
    >
      <span className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{author}</span> · {time}
      </span>
      <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
    </div>
  );
}

function RunRow(props: {
  readonly run: BoardRun;
  readonly snapshot: BoardSnapshot;
  readonly onOpenThread: () => void;
}) {
  const agent = agentById(props.snapshot.agents, props.run.agentId);
  const time = formatRelativeTimeLabel(props.run.startedAt);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate">
        {agent?.name ?? "Removed agent"} · {props.run.kind === "review" ? "review" : "work"} ·{" "}
        <span className="text-muted-foreground">{time}</span>
      </span>
      <Badge
        size="sm"
        variant={
          props.run.status === "running"
            ? "info"
            : props.run.status === "completed"
              ? "success"
              : "warning"
        }
      >
        {props.run.status}
      </Badge>
      <Button size="xs" variant="ghost" onClick={props.onOpenThread}>
        Thread
      </Button>
    </div>
  );
}
