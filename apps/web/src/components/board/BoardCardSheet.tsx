import {
  boardShipBlocker,
  boardTaskWaitingOn,
  type BoardAgentId,
  type BoardComment,
  type BoardRun,
  type BoardShipMethod,
  type BoardSnapshot,
  type BoardTask,
  type BoardTaskId,
  type BoardTaskStatus,
  type BoardWorkLink,
  type EnvironmentId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GlobeIcon,
  LinkIcon,
  MessagesSquareIcon,
  PaperclipIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { cn } from "../../lib/utils";
import { boardTaskDetailLive } from "../../state/board";
import { useProject } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Textarea } from "../ui/textarea";
import { AgentSelect } from "./AgentSelect";
import { FilePicker } from "./FilePicker";
import type { RunBoardCommand } from "./BoardPage";
import { AgentFace, AgentName } from "./AgentAvatar";
import { CommentFiles, DraftFileChips, useCommentDraftFiles } from "./CommentFiles";
import { WaitsOnField } from "./WaitsOnField";
import { BOARD_COLUMNS, agentById, boardStatusLabel, canArchiveTask } from "./board.logic";
import {
  REMIX_CARD,
  REMIX_INSET,
  RemixButton,
  RemixHeading,
  RemixIconTile,
  RemixChip,
  REMIX_COLUMN_TONES,
  type RemixTone,
} from "./RemixSurface";
import "./office.css";

type PanelTab = "activity" | "details";

export function BoardCardSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly task: BoardTask | null;
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onOpenCard: (cardId: BoardTaskId | null) => void;
}) {
  // Null until someone picks a tab; the choice then holds for every task opened after.
  const [tab, setTab] = useState<PanelTab | null>(null);
  return (
    <Sheet
      open={props.task !== null}
      onOpenChange={(open) => {
        if (!open) props.onOpenCard(null);
      }}
    >
      <SheetPopup side="right" className="max-w-xl">
        {props.task !== null ? (
          <BoardCardDetail
            key={props.task.id}
            {...props}
            task={props.task}
            tab={tab}
            onTabChange={setTab}
          />
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
  readonly tab: PanelTab | null;
  readonly onTabChange: (tab: PanelTab) => void;
}) {
  const { task, snapshot } = props;
  const navigate = useNavigate();
  const detail = useEnvironmentQuery(
    boardTaskDetailLive({ environmentId: props.environmentId, input: { taskId: task.id } }),
  );

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const files = (detail.data?.links ?? []).filter((link) => link.kind === "file");
  const workLinks = (detail.data?.links ?? []).filter((link) => link.kind !== "file");
  const branchLink = workLinks.find((link) => link.kind === "branch") ?? null;
  const descriptionDirty = description !== task.description;
  const parent = snapshot.tasks.find((candidate) => candidate.id === task.parentTaskId) ?? null;
  const subtasks = snapshot.tasks.filter((candidate) => candidate.parentTaskId === task.id);
  const neededBy = snapshot.tasks.filter((candidate) => candidate.waitsOnTaskIds.includes(task.id));
  const waiting = boardTaskWaitingOn(task, snapshot.tasks);
  // A subtask in its parent's worktree works on the parent's branch, which ships with the parent.
  const ownsBranch =
    branchLink !== null && task.worktreePath !== null && parent?.worktreePath !== task.worktreePath;
  const disabled = !props.canOperate;

  const update = (patch: {
    title?: string;
    description?: string;
    status?: BoardTaskStatus;
    assigneeAgentId?: BoardAgentId | null;
    assignedToUser?: boolean;
    reviewerAgentId?: BoardAgentId | null;
    waitsOnTaskIds?: Array<BoardTaskId>;
  }) => props.runCommand({ type: "task.update", task: { id: task.id, ...patch } });

  const openThread = (threadId: string) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(
        scopeThreadRef(props.environmentId, threadId as NonNullable<BoardTask["threadId"]>),
      ),
    });

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
    !task.assignedToUser &&
    (task.status === "review"
      ? task.reviewerAgentId !== null
      : task.status !== "done" && task.assigneeAgentId !== null && waiting.length === 0);
  const inReview = task.status === "review" && task.activeRunKind === null;
  const merger = task.assignedToUser ? null : agentById(snapshot.agents, task.assigneeAgentId);
  const shown: PanelTab =
    props.tab ?? (task.threadId !== null || task.commentCount > 0 ? "activity" : "details");

  const mergeAndFinish = async () => {
    if (merger === null) return;
    const message = `Have ${merger.name} merge "${task.title}"?\n${merger.name} merges its pull request or branch, and the task moves to Done once that lands.`;
    const confirmed = (await requestConfirmDialog(message)) ?? window.confirm(message);
    if (!confirmed) return;
    if ((await props.runCommand({ type: "task.merge", id: task.id })) !== null) {
      props.onTabChange("activity");
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="sr-only">{task.title}</SheetTitle>
        <SheetDescription className="sr-only">Board task details</SheetDescription>
        {/* Keeps the title clear of the sheet's close button in the corner. */}
        <div className="pe-8">
          <RemixHeading
            icon={<ClipboardListIcon />}
            tone={REMIX_COLUMN_TONES[task.status]}
            title={
              <Input
                size="lg"
                value={title}
                disabled={disabled}
                aria-label="Task title"
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  const next = title.trim();
                  if (next.length > 0 && next !== task.title) void update({ title: next });
                }}
              />
            }
            description={
              <div className="flex flex-wrap items-center gap-2">
                <RemixChip tone={REMIX_COLUMN_TONES[task.status]}>
                  {boardStatusLabel(task.status)}
                </RemixChip>
                {task.archivedAt !== null ? (
                  <RemixChip tone="gray" variant="wash">
                    Archived
                  </RemixChip>
                ) : null}
                {task.activeRunKind !== null ? (
                  <RemixChip tone="blue">{ACTIVE_RUN_LABELS[task.activeRunKind]}</RemixChip>
                ) : null}
              </div>
            }
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {inReview && merger !== null ? (
            <Button size="sm" disabled={disabled} onClick={() => void mergeAndFinish()}>
              <PullRequestGlyph.merged />
              Merge and finish
            </Button>
          ) : null}
          {inReview ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void update({ status: "done" })}
            >
              <CheckIcon />
              Mark done
            </Button>
          ) : null}
          {canStart ? (
            <Button
              size="sm"
              variant={task.status === "review" ? "outline" : "default"}
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
          {canArchiveTask(task) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void props.runCommand({ type: "task.archive", id: task.id, archived: true })
              }
            >
              <ArchiveIcon />
              Archive
            </Button>
          ) : task.archivedAt !== null && (parent === null || parent.archivedAt === null) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void props.runCommand({ type: "task.archive", id: task.id, archived: false })
              }
            >
              <ArchiveRestoreIcon />
              Restore
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
        <div role="tablist" aria-label="Task panel" className="mt-2 flex gap-2">
          <RemixButton
            role="tab"
            aria-selected={shown === "activity"}
            variant={shown === "activity" ? "active" : "paper"}
            onClick={() => props.onTabChange("activity")}
          >
            <MessagesSquareIcon />
            Activity
            {task.commentCount > 0 ? (
              <span className="tabular-nums opacity-75">{task.commentCount}</span>
            ) : null}
          </RemixButton>
          <RemixButton
            role="tab"
            aria-selected={shown === "details"}
            variant={shown === "details" ? "active" : "paper"}
            onClick={() => props.onTabChange("details")}
          >
            <FileTextIcon />
            Details
          </RemixButton>
        </div>
      </SheetHeader>
      {/* Both stay mounted, so a half-written comment survives a look at the details. */}
      <ActivityPanel
        hidden={shown !== "activity"}
        environmentId={props.environmentId}
        task={task}
        snapshot={snapshot}
        comments={detail.data?.comments ?? null}
        disabled={disabled}
        runCommand={props.runCommand}
      />
      <div
        role="tabpanel"
        aria-label="Details"
        className={cn("min-h-0 flex-1 flex-col", shown === "details" ? "flex" : "hidden")}
      >
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 px-6 pb-6">
            <div
              className={cn(
                REMIX_INSET,
                "grid gap-3",
                task.assignedToUser ? "grid-cols-2" : "grid-cols-3",
              )}
            >
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
                  you={{
                    selected: task.assignedToUser,
                    onSelect: () => void update({ assignedToUser: true }),
                  }}
                  onChange={(assigneeAgentId) =>
                    void update({ assigneeAgentId, assignedToUser: false })
                  }
                />
              </div>
              {/* No agent touches a card you keep, so nobody reviews it but you. */}
              {task.assignedToUser ? null : (
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
              )}
            </div>

            <section className={REMIX_INSET}>
              <div className="flex min-h-7 items-center justify-between gap-3">
                <SectionTitle label="Description" htmlFor="board-card-detail-description" />
                {editingDescription ? null : (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      setDescription(task.description);
                      setEditingDescription(true);
                    }}
                  >
                    <PencilIcon />
                    Edit
                  </Button>
                )}
              </div>
              {editingDescription ? (
                <>
                  <Textarea
                    id="board-card-detail-description"
                    value={description}
                    rows={12}
                    autoFocus
                    disabled={disabled}
                    placeholder="What done looks like. Markdown works."
                    onChange={(event) => setDescription(event.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingDescription(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={disabled || !descriptionDirty}
                      onClick={async () => {
                        if ((await update({ description })) !== null) setEditingDescription(false);
                      }}
                    >
                      Save description
                    </Button>
                  </div>
                </>
              ) : task.description.trim().length > 0 ? (
                <div className={REMIX_CARD} data-office-markdown>
                  <ChatMarkdown
                    text={task.description}
                    cwd={task.worktreePath ?? undefined}
                    environmentId={props.environmentId}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">No description</span>
              )}
            </section>

            <section className={REMIX_INSET}>
              <SectionTitle label="Files" count={files.length} />
              <FilePicker
                disabled={disabled}
                onAdd={(paths) => {
                  for (const path of paths) {
                    void props.runCommand({
                      type: "link.add",
                      link: {
                        taskId: task.id,
                        kind: "file",
                        title: path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path,
                        url: path,
                      },
                    });
                  }
                }}
              >
                {files.map((link) => (
                  <WorkLinkRow
                    key={link.id}
                    link={link}
                    snapshot={snapshot}
                    disabled={disabled}
                    onRemove={() => void props.runCommand({ type: "link.delete", id: link.id })}
                  />
                ))}
              </FilePicker>
            </section>

            {task.status !== "done" || task.waitsOnTaskIds.length > 0 ? (
              <section className={REMIX_INSET}>
                <SectionTitle label="Waits on" tone="yellow" count={task.waitsOnTaskIds.length} />
                <WaitsOnField
                  tasks={snapshot.tasks}
                  value={task.waitsOnTaskIds}
                  self={task.id}
                  disabled={disabled}
                  onOpen={(id) => props.onOpenCard(id)}
                  onChange={(waitsOnTaskIds) =>
                    void update({ waitsOnTaskIds: [...waitsOnTaskIds] })
                  }
                />
                {waiting.length > 0 && task.status === "todo" ? (
                  <span className="text-xs text-muted-foreground">
                    Starts once {waiting.length === 1 ? "this task is" : "these tasks are"} done.
                  </span>
                ) : null}
              </section>
            ) : null}

            {ownsBranch ? (
              <ShipSection
                environmentId={props.environmentId}
                task={task}
                branch={branchLink.title}
                merged={branchLink.status === "merged"}
                blocker={boardShipBlocker(task, snapshot.tasks)}
                disabled={disabled}
                runCommand={props.runCommand}
              />
            ) : null}

            {workLinks.length > 0 ? (
              <section className={REMIX_INSET}>
                <SectionTitle label="Linked work" tone="purple" count={workLinks.length} />
                <div className="flex flex-col gap-2">
                  {workLinks.map((link) => (
                    <WorkLinkRow
                      key={link.id}
                      link={link}
                      snapshot={snapshot}
                      disabled={disabled}
                      onRemove={() => void props.runCommand({ type: "link.delete", id: link.id })}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {parent !== null || subtasks.length > 0 || neededBy.length > 0 ? (
              <section className={REMIX_INSET}>
                <SectionTitle
                  label="Related tasks"
                  tone="purple"
                  count={(parent === null ? 0 : 1) + subtasks.length + neededBy.length}
                />
                <div className="flex flex-col gap-2">
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
                  {neededBy.map((dependent) => (
                    <RelatedCard
                      key={dependent.id}
                      prefix="Needed by"
                      task={dependent}
                      onOpen={() => props.onOpenCard(dependent.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {(detail.data?.runs.length ?? 0) > 0 ? (
              <section className={REMIX_INSET}>
                <SectionTitle label="Agent runs" tone="teal" count={detail.data?.runs.length} />
                <div className="flex flex-col gap-2">
                  {(detail.data?.runs ?? []).toReversed().map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      snapshot={snapshot}
                      onOpenThread={() => openThread(run.threadId)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}

const ACTIVE_RUN_LABELS: Record<NonNullable<BoardTask["activeRunKind"]>, string> = {
  work: "Agent working",
  review: "Reviewer working",
  reply: "Agent replying",
  merge: "Agent merging",
};

/** Comments shown at first, and how many more each "Show earlier" adds. */
const ACTIVITY_PAGE = 30;
/** System lines in a row, such as "started working", fold into one line from this many. */
const FOLD_SYSTEM_LINES = 3;

type ActivityEntry =
  | { readonly kind: "comment"; readonly comment: BoardComment }
  | { readonly kind: "updates"; readonly id: string; readonly comments: Array<BoardComment> };

function activityEntries(comments: ReadonlyArray<BoardComment>): ReadonlyArray<ActivityEntry> {
  const entries: Array<ActivityEntry> = [];
  let updates: Array<BoardComment> = [];
  const flush = () => {
    if (updates.length >= FOLD_SYSTEM_LINES) {
      entries.push({ kind: "updates", id: updates[0]!.id, comments: updates });
    } else {
      entries.push(...updates.map((comment) => ({ kind: "comment" as const, comment })));
    }
    updates = [];
  };
  for (const comment of comments) {
    if (comment.authorKind === "system") {
      updates.push(comment);
      continue;
    }
    flush();
    entries.push({ kind: "comment", comment });
  }
  flush();
  return entries;
}

/** The conversation, newest at the bottom beside a comment box that stays in view. */
function ActivityPanel(props: {
  readonly hidden: boolean;
  readonly environmentId: EnvironmentId;
  readonly task: BoardTask;
  readonly snapshot: BoardSnapshot;
  readonly comments: ReadonlyArray<BoardComment> | null;
  readonly disabled: boolean;
  readonly runCommand: RunBoardCommand;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(ACTIVITY_PAGE);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const comments = props.comments ?? [];
  const hidden = Math.max(0, comments.length - limit);
  const entries = activityEntries(comments.slice(hidden));
  const cwd = props.task.worktreePath ?? undefined;

  return (
    <div
      role="tabpanel"
      aria-label="Activity"
      className={cn("min-h-0 flex-1 flex-col", props.hidden ? "hidden" : "flex")}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Reversed, so it opens on the newest message and stays there as new ones arrive. */}
        <div
          ref={scroller}
          role="log"
          aria-label="Comments and updates"
          className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-6"
          onScroll={(event) => {
            const away = event.currentTarget.scrollTop < -160;
            if (away !== awayFromLatest) setAwayFromLatest(away);
          }}
        >
          <div className="flex flex-col gap-2 pt-1 pb-4">
            {hidden > 0 ? (
              <div className="flex justify-center">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setLimit((current) => current + ACTIVITY_PAGE)}
                >
                  Show {Math.min(hidden, ACTIVITY_PAGE)} earlier
                </Button>
              </div>
            ) : null}
            {entries.map((entry) =>
              entry.kind === "comment" ? (
                <CommentRow
                  key={entry.comment.id}
                  comment={entry.comment}
                  snapshot={props.snapshot}
                  cwd={cwd}
                  environmentId={props.environmentId}
                />
              ) : (
                <UpdatesRow
                  key={entry.id}
                  comments={entry.comments}
                  snapshot={props.snapshot}
                  open={unfolded.has(entry.id)}
                  onToggle={() =>
                    setUnfolded((current) => {
                      const next = new Set(current);
                      if (!next.delete(entry.id)) next.add(entry.id);
                      return next;
                    })
                  }
                  cwd={cwd}
                  environmentId={props.environmentId}
                />
              ),
            )}
            {props.comments !== null && comments.length === 0 ? (
              <span className="px-1 text-sm text-muted-foreground">No activity yet</span>
            ) : null}
          </div>
        </div>
        {awayFromLatest ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="pointer-events-auto">
              <RemixButton size="sm" onClick={() => scroller.current?.scrollTo({ top: 0 })}>
                <ArrowDownIcon />
                Latest
              </RemixButton>
            </div>
          </div>
        ) : null}
      </div>
      <CommentComposer
        environmentId={props.environmentId}
        task={props.task}
        disabled={props.disabled}
        runCommand={props.runCommand}
        scroller={scroller}
      />
    </div>
  );
}

function UpdatesRow(props: {
  readonly comments: ReadonlyArray<BoardComment>;
  readonly snapshot: BoardSnapshot;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly cwd: string | undefined;
  readonly environmentId: EnvironmentId;
}) {
  const latest = props.comments.at(-1);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 text-start text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-3.5 [&_svg]:shrink-0"
      >
        {props.open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span className="shrink-0 font-medium">{props.comments.length} updates</span>
        {props.open || latest === undefined ? null : (
          <span className="min-w-0 truncate">· {latest.body}</span>
        )}
      </button>
      {props.open
        ? props.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              snapshot={props.snapshot}
              cwd={props.cwd}
              environmentId={props.environmentId}
            />
          ))
        : null}
    </div>
  );
}

function CommentComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly task: BoardTask;
  readonly disabled: boolean;
  readonly runCommand: RunBoardCommand;
  readonly scroller: RefObject<HTMLDivElement | null>;
}) {
  const { task, disabled } = props;
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const draftFiles = useCommentDraftFiles(props.environmentId);
  const filePicker = useRef<HTMLInputElement>(null);

  const postComment = async () => {
    const body = comment.trim();
    if (body.length === 0 && draftFiles.files.length === 0) return;
    setPosting(true);
    const attachments = await draftFiles.collect();
    const posted =
      attachments === null
        ? null
        : await props.runCommand({
            type: "comment.add",
            comment: { taskId: task.id, body, ...(attachments.length > 0 ? { attachments } : {}) },
          });
    setPosting(false);
    if (posted !== null) {
      setComment("");
      draftFiles.clear();
      props.scroller.current?.scrollTo({ top: 0 });
    }
  };

  return (
    <div
      className="flex flex-col gap-2 border-t px-6 pt-3 pb-5"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (disabled || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        draftFiles.add([...event.dataTransfer.files]);
      }}
    >
      <Label htmlFor="board-card-comment" className="sr-only">
        Comment
      </Label>
      <Textarea
        id="board-card-comment"
        value={comment}
        rows={2}
        disabled={disabled}
        onPaste={(event) => {
          const pasted = [...event.clipboardData.files];
          if (pasted.length === 0) return;
          event.preventDefault();
          draftFiles.add(pasted);
        }}
        placeholder={
          task.activeRunKind !== null
            ? "Comment, and the working agent receives it right away. Paste or drop pictures."
            : task.assignedToUser
              ? "Add a note for yourself"
              : "Comment, and the task's agent answers on the board. Paste or drop pictures."
        }
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void postComment();
          }
        }}
      />
      <DraftFileChips
        files={draftFiles.files}
        disabled={disabled || posting}
        onRemove={draftFiles.remove}
        onRetry={draftFiles.retry}
      />
      <div className="flex items-center justify-between gap-2">
        <input
          ref={filePicker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            draftFiles.add([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || posting}
          onClick={() => filePicker.current?.click()}
        >
          <PaperclipIcon />
          Attach
        </Button>
        <Button
          size="sm"
          disabled={
            disabled || posting || (comment.trim().length === 0 && draftFiles.files.length === 0)
          }
          onClick={() => void postComment()}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

// The board's column pills, so a status reads the same in the sheet as on the board.
/** A section's pill heading; with `htmlFor` it is the label of that field instead. */
function SectionTitle(props: {
  readonly label: string;
  readonly tone?: RemixTone;
  readonly count?: number | undefined;
  readonly htmlFor?: string;
}) {
  const pill = (
    <RemixChip tone={props.tone ?? "gray"} variant={props.tone === undefined ? "paper" : "wash"}>
      {props.label}
      {props.count === undefined ? null : (
        // A count inside a label would rename its field every time the count changes.
        <span aria-hidden={props.htmlFor !== undefined}>: {props.count}</span>
      )}
    </RemixChip>
  );
  return props.htmlFor === undefined ? (
    <h3 className="flex">{pill}</h3>
  ) : (
    <Label htmlFor={props.htmlFor}>{pill}</Label>
  );
}

function ShipSection(props: {
  readonly environmentId: EnvironmentId;
  readonly task: BoardTask;
  readonly branch: string;
  readonly merged: boolean;
  readonly blocker: string | null;
  readonly disabled: boolean;
  readonly runCommand: RunBoardCommand;
}) {
  const [shipping, setShipping] = useState<BoardShipMethod | null>(null);
  const project = useProject(scopeProjectRef(props.environmentId, props.task.projectId));
  // Merging goes into whatever the project folder has checked out, so the button names it.
  const projectStatus = useEnvironmentQuery(
    project === null
      ? null
      : vcsEnvironment.status({
          environmentId: props.environmentId,
          input: { cwd: project.workspaceRoot },
        }),
  );
  const target = projectStatus.data?.refName ?? null;
  const unavailable = props.disabled || props.blocker !== null || shipping !== null;

  const ship = async (method: BoardShipMethod) => {
    if (method === "merge") {
      const message = `Merge ${props.branch} into ${target ?? "the branch checked out in the project folder"}?\nThis merges on the computer running T3 Code and doesn't push.`;
      const confirmed = (await requestConfirmDialog(message)) ?? window.confirm(message);
      if (!confirmed) return;
    }
    setShipping(method);
    await props.runCommand({ type: "task.ship", id: props.task.id, method });
    setShipping(null);
  };

  return (
    <section className={REMIX_INSET}>
      <SectionTitle label="Ship" tone="green" />
      {/* The branch itself, with its merged status, is listed under Linked work. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={unavailable} onClick={() => void ship("pull_request")}>
          <PullRequestGlyph.pullRequest />
          {shipping === "pull_request" ? "Opening pull request..." : "Open pull request"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={unavailable || props.merged}
          onClick={() => void ship("merge")}
        >
          <PullRequestGlyph.merged />
          {shipping === "merge" ? "Merging..." : target === null ? "Merge" : `Merge into ${target}`}
        </Button>
      </div>
      {props.blocker !== null ? (
        <span className="text-xs text-muted-foreground">{props.blocker}</span>
      ) : null}
    </section>
  );
}

function RelatedCard(props: {
  readonly prefix: string;
  readonly task: BoardTask;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className={cn(
        REMIX_CARD,
        "cursor-pointer flex-row items-center gap-3 p-3 text-start text-sm outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <span className="text-muted-foreground">{props.prefix}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{props.task.title}</span>
      <RemixChip tone={REMIX_COLUMN_TONES[props.task.status]}>
        {boardStatusLabel(props.task.status)}
      </RemixChip>
    </button>
  );
}

const WORK_LINK_ICONS: Record<BoardWorkLink["kind"], LucideIcon> = {
  pull_request: PullRequestGlyph.pullRequest,
  branch: GitBranchIcon,
  preview: GlobeIcon,
  commit: GitCommitHorizontalIcon,
  document: FileTextIcon,
  other: LinkIcon,
  file: FileIcon,
};

const WORK_LINK_TONES: Record<BoardWorkLink["kind"], RemixTone> = {
  pull_request: "purple",
  branch: "teal",
  preview: "blue",
  commit: "teal",
  document: "orange",
  other: "gray",
  file: "gray",
};

const WORK_LINK_STATUS_TONES = {
  open: "blue",
  draft: "gray",
  merged: "green",
  closed: "gray",
} as const satisfies Record<NonNullable<BoardWorkLink["status"]>, RemixTone>;

function WorkLinkRow(props: {
  readonly link: BoardWorkLink;
  readonly snapshot: BoardSnapshot;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}) {
  const { link } = props;
  const Icon = WORK_LINK_ICONS[link.kind];
  const agent = agentById(props.snapshot.agents, link.agentId);
  const href = /^https?:\/\//.test(link.url) ? link.url : null;
  return (
    <div className={cn(REMIX_CARD, "flex-row items-center gap-3 p-3 text-sm")}>
      <RemixIconTile tone={WORK_LINK_TONES[link.kind]}>
        <Icon />
      </RemixIconTile>
      {href !== null ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-medium hover:underline"
        >
          {link.title}
        </a>
      ) : (
        <span className="min-w-0 truncate font-mono text-xs">{link.title}</span>
      )}
      {link.status !== null ? (
        <RemixChip tone={WORK_LINK_STATUS_TONES[link.status]} variant="wash">
          {link.status}
        </RemixChip>
      ) : null}
      {agent !== null ? (
        <AgentName agent={agent} className="ms-auto shrink-0 text-xs text-muted-foreground" />
      ) : (
        <span className="ms-auto" />
      )}
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`Remove link ${link.title}`}
        disabled={props.disabled}
        onClick={props.onRemove}
      >
        <XIcon />
      </Button>
    </div>
  );
}

function CommentRow(props: {
  readonly comment: BoardComment;
  readonly snapshot: BoardSnapshot;
  readonly cwd: string | undefined;
  readonly environmentId: EnvironmentId;
}) {
  const { comment } = props;
  const agent = agentById(props.snapshot.agents, comment.authorAgentId);
  const time = formatRelativeTimeLabel(comment.createdAt);
  if (comment.authorKind === "system") {
    // System events carry no author but start with who acted, such as "Grace started working."
    const actor =
      agent ??
      props.snapshot.agents.find((candidate) => comment.body.startsWith(`${candidate.name} `)) ??
      null;
    return (
      <span className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        {actor !== null ? <AgentFace agent={actor} name={actor.name} size="xs" /> : null}
        <span className="min-w-0">
          {comment.body} · {time}
        </span>
      </span>
    );
  }
  const authorName = comment.authorKind === "user" ? "You" : (agent?.name ?? "Agent");
  return (
    <div className={cn(REMIX_CARD, "gap-2.5")} data-office-markdown>
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {comment.authorKind === "user" ? (
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3.5"
          >
            <UserRoundIcon />
          </span>
        ) : (
          <AgentFace agent={agent ?? undefined} name={authorName} />
        )}
        <span className="truncate text-sm font-medium text-foreground">{authorName}</span>
        {agent?.title ? (
          <span className="truncate text-muted-foreground">{agent.title}</span>
        ) : null}
        <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">{time}</span>
      </div>
      {/* People type plain lines; agents write markdown with blank lines between paragraphs. */}
      {comment.body.length > 0 ? (
        <ChatMarkdown
          text={comment.body}
          cwd={props.cwd}
          environmentId={props.environmentId}
          lineBreaks={comment.authorKind === "user"}
        />
      ) : null}
      <CommentFiles environmentId={props.environmentId} attachments={comment.attachments} />
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
    <div className={cn(REMIX_CARD, "flex-row items-center gap-3 p-3 text-sm")}>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {agent !== null ? (
          <AgentName agent={agent} className="font-medium" />
        ) : (
          <span className="truncate">Removed agent</span>
        )}
        <span className="shrink-0 truncate text-muted-foreground">
          · {props.run.kind} · {time}
        </span>
      </span>
      {props.run.status === "running" ? (
        <RemixChip tone="blue">{props.run.status}</RemixChip>
      ) : (
        <RemixChip tone={props.run.status === "completed" ? "green" : "yellow"} variant="wash">
          {props.run.status}
        </RemixChip>
      )}
      <Button size="xs" variant="ghost" onClick={props.onOpenThread}>
        Thread
      </Button>
    </div>
  );
}
