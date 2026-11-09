import type { BoardAgent, BoardSnapshot, BoardTaskId, EnvironmentId } from "@t3tools/contracts";
import { ArrowLeftIcon, FolderGit2Icon } from "lucide-react";

import { cn } from "../../lib/utils";
import { boardLive } from "../../state/board";
import { useEnvironmentQuery } from "../../state/query";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { AgentFace } from "./AgentAvatar";
import { agentById, boardStatusLabel } from "./board.logic";
import { worktreeGroups, type WorktreeGroup, type WorktreeTaskRow } from "./dashboard.logic";
import {
  REMIX_CARD,
  REMIX_COLUMN_TONES,
  REMIX_SHELL,
  RemixBubble,
  RemixButton,
  RemixChip,
  RemixHeading,
  RemixIconTile,
  RemixTitle,
  type RemixTone,
} from "./RemixSurface";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Which tasks are keeping the company's worktrees on disk. */
export function WorktreesView(props: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
  readonly onBack: () => void;
}) {
  const companyId = props.snapshot.company?.id ?? null;
  const query = useEnvironmentQuery(
    companyId === null
      ? null
      : boardLive({
          environmentId: props.environmentId,
          input: { companyId, worktrees: true },
        }),
  );
  const snapshot = query.data ?? props.snapshot;
  const worktrees = query.data?.worktrees ?? null;
  const groups = worktrees === null ? [] : worktreeGroups(snapshot.tasks, worktrees);
  const waiting = groups.filter((group) => group.toFinish > 0);
  const ready = groups.filter((group) => group.toFinish === 0);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-1 pb-14">
        <RemixHeading
          icon={<FolderGit2Icon />}
          tone="purple"
          title={<RemixTitle>Open worktrees</RemixTitle>}
          description="A worktree is removed at the next cleanup once its main task and every subtask are Done, or the main task is archived."
          actions={
            <RemixButton onClick={props.onBack}>
              <ArrowLeftIcon />
              Dashboard
            </RemixButton>
          }
        />
        {query.error !== null ? (
          <p
            data-remix-tone="pink"
            className={cn(REMIX_CARD, "bg-(--tone-wash) px-3 py-2 text-sm font-medium")}
          >
            Could not load worktrees: {query.error}
          </p>
        ) : worktrees === null ? (
          <Skeleton className="h-24 w-full" />
        ) : groups.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <RemixIconTile tone="teal" size="lg">
                  <FolderGit2Icon />
                </RemixIconTile>
              </EmptyMedia>
              <EmptyTitle>No open worktrees</EmptyTitle>
              <EmptyDescription>This company's tasks have no worktrees on disk.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <WorktreeSection
              title="Waiting on tasks"
              tone="orange"
              groups={waiting}
              snapshot={snapshot}
              onOpenCard={props.onOpenCard}
            />
            <WorktreeSection
              title="Ready for cleanup"
              tone="green"
              note="Worktrees with uncommitted changes are kept. Settings > Storage shows why."
              groups={ready}
              snapshot={snapshot}
              onOpenCard={props.onOpenCard}
            />
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function WorktreeSection(props: {
  readonly title: string;
  readonly tone: RemixTone;
  readonly note?: string;
  readonly groups: ReadonlyArray<WorktreeGroup>;
  readonly snapshot: BoardSnapshot;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  if (props.groups.length === 0) return null;
  return (
    <section data-remix-tone={props.tone} className={cn(REMIX_SHELL, "gap-3 p-3 pt-4")}>
      <div className="flex flex-wrap items-center gap-3 px-1">
        <RemixBubble tone={props.tone}>
          {props.title}: {props.groups.length}
        </RemixBubble>
        {props.note === undefined ? null : (
          <span className="text-xs text-(--remix-text-muted)">{props.note}</span>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {props.groups.map((group) => (
          <li key={group.rows[0]?.task.id} className={cn(REMIX_CARD, "gap-0 p-2")}>
            <span className="px-2 py-1 text-xs text-(--remix-text-muted)">
              {plural(group.worktrees, "worktree")}
              {group.toFinish > 0 ? ` · ${plural(group.toFinish, "task")} to finish` : ""}
            </span>
            {group.rows.map((row) => (
              <TaskRow
                key={row.task.id}
                row={row}
                agent={agentById(props.snapshot.agents, row.task.assigneeAgentId) ?? null}
                onOpen={() => props.onOpenCard(row.task.id)}
              />
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskRow(props: {
  readonly row: WorktreeTaskRow;
  readonly agent: BoardAgent | null;
  readonly onOpen: () => void;
}) {
  const { task, depth, worktrees } = props.row;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      style={{ paddingInlineStart: `${0.5 + depth * 1.25}rem` }}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg py-1.5 pe-2 text-start outline-none hover:bg-(--remix-inset) focus-visible:ring-2 focus-visible:ring-(--remix-blue) focus-visible:ring-inset"
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          depth === 0 && "font-semibold",
          task.status === "done" && "text-(--remix-text-muted)",
        )}
      >
        {task.title}
      </span>
      {worktrees > 0 ? (
        <span className="shrink-0 text-xs text-(--remix-text-muted) tabular-nums max-sm:hidden">
          {plural(worktrees, "worktree")}
        </span>
      ) : null}
      {props.agent !== null ? (
        <AgentFace agent={props.agent} name={props.agent.name} size="xs" />
      ) : null}
      {task.archivedAt !== null && depth === 0 ? (
        <RemixChip tone="gray" variant="wash">
          Archived
        </RemixChip>
      ) : null}
      <RemixChip tone={REMIX_COLUMN_TONES[task.status]} variant="wash">
        {boardStatusLabel(task.status)}
      </RemixChip>
    </button>
  );
}
