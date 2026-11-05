import type {
  BoardAgentId,
  BoardRoutine,
  BoardRoutineId,
  BoardSnapshot,
  BoardTaskId,
} from "@t3tools/contracts";
import { PencilIcon, PlayIcon, PlusIcon, RepeatIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { AgentName, YouName } from "./AgentAvatar";
import { AgentSelect } from "./AgentSelect";
import type { RunBoardCommand } from "./BoardPage";
import {
  agentById,
  boardStatusLabel,
  localDateTimeInput,
  repeatLabel,
  ROUTINE_REPEATS,
} from "./board.logic";
import {
  REMIX_CARD,
  REMIX_INSET,
  REMIX_SHELL,
  RemixBubble,
  RemixButton,
  RemixHeading,
  RemixIconTile,
  RemixTitle,
} from "./RemixSurface";

interface RoutineDraft {
  readonly id: BoardRoutineId | null;
  readonly title: string;
  readonly description: string;
  readonly assigneeAgentId: BoardAgentId | null;
  readonly assignedToUser: boolean;
  readonly everyDays: number;
  /** A `datetime-local` value in the viewer's time zone. */
  readonly nextRun: string;
  readonly enabled: boolean;
}

function draftFromRoutine(routine: BoardRoutine): RoutineDraft {
  return {
    id: routine.id,
    title: routine.title,
    description: routine.description,
    assigneeAgentId: routine.assigneeAgentId,
    assignedToUser: routine.assignedToUser,
    everyDays: routine.everyDays,
    nextRun: localDateTimeInput(new Date(routine.nextRunAt)),
    enabled: routine.enabled,
  };
}

export function RoutinesView(props: {
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onOpenCard: (taskId: BoardTaskId) => void;
}) {
  const { snapshot } = props;
  const company = snapshot.company;
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  if (company === null) return null;

  const save = (routine: BoardRoutine, changes: Partial<RoutineDraft>) =>
    props.runCommand({
      type: "routine.upsert",
      routine: {
        id: routine.id,
        companyId: company.id,
        title: routine.title,
        description: routine.description,
        assigneeAgentId: routine.assigneeAgentId,
        assignedToUser: routine.assignedToUser,
        everyDays: routine.everyDays,
        nextRunAt: routine.nextRunAt,
        enabled: changes.enabled ?? routine.enabled,
      },
    });

  const remove = async (routine: BoardRoutine) => {
    const message = `Delete the "${routine.title}" routine?\nTasks it already created stay on the board.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await props.runCommand({ type: "routine.delete", id: routine.id });
  };

  // New routines start tomorrow at 9:00, a typical time for a recurring check-in.
  const newDraft = (): RoutineDraft => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    return {
      id: null,
      title: "",
      description: "",
      assigneeAgentId: company.ceoAgentId,
      assignedToUser: false,
      everyDays: 7,
      nextRun: localDateTimeInput(start),
      enabled: true,
    };
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-1 pb-14">
        <div className={cn(REMIX_CARD, "p-3 shadow-(--remix-lift)")}>
          <RemixHeading
            icon={<RepeatIcon />}
            tone="teal"
            title={<RemixTitle>Routines</RemixTitle>}
            description="A routine adds a task on a schedule, such as a weekly review. If the last one is still open, it waits for the next turn instead of adding another."
            actions={
              <RemixButton
                variant="go"
                disabled={!props.canOperate}
                onClick={() => setDraft(newDraft())}
              >
                <PlusIcon />
                New routine
              </RemixButton>
            }
          />
        </div>
        <div data-remix-tone="teal" className={cn(REMIX_SHELL, "gap-2.5 p-2.5 pb-3")}>
          <div className="flex pb-1">
            <RemixBubble tone="teal" size="sm">
              Routines: {snapshot.routines.length}
            </RemixBubble>
          </div>
          {snapshot.routines.length === 0 ? (
            <div className={cn(REMIX_CARD, "text-sm text-(--remix-text-muted)")}>
              No routines yet
            </div>
          ) : null}
          {snapshot.routines.map((routine) => {
            const assignee = agentById(snapshot.agents, routine.assigneeAgentId);
            // The task it last created dates the last run; a routine keeps no other history.
            const lastTask = snapshot.tasks.find((task) => task.id === routine.lastTaskId) ?? null;
            return (
              <div
                key={routine.id}
                className={cn(
                  REMIX_CARD,
                  "flex-row items-start border-(--tone) shadow-(--tone-lift)",
                )}
              >
                <RemixIconTile tone={routine.enabled ? "teal" : "gray"}>
                  <RepeatIcon />
                </RemixIconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm leading-snug font-semibold">{routine.title}</span>
                  <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-(--remix-text-muted)">
                    {repeatLabel(routine.everyDays)} ·{" "}
                    {routine.assignedToUser ? (
                      <YouName />
                    ) : assignee !== null ? (
                      <AgentName agent={assignee} />
                    ) : (
                      "Ideas, unassigned"
                    )}{" "}
                    · next {new Date(routine.nextRunAt).toLocaleString()}
                  </span>
                  {routine.description ? (
                    <p className="line-clamp-2 whitespace-pre-wrap text-xs text-(--remix-text-muted)">
                      {routine.description}
                    </p>
                  ) : null}
                  <span className="text-xs text-(--remix-text-muted)">
                    {lastTask !== null ? (
                      <>
                        Last run {formatRelativeTimeLabel(lastTask.createdAt)}:{" "}
                        <Button
                          size="xs"
                          variant="link"
                          onClick={() => props.onOpenCard(lastTask.id)}
                        >
                          {lastTask.title}
                        </Button>{" "}
                        ({boardStatusLabel(lastTask.status)})
                      </>
                    ) : routine.lastTaskId !== null ? (
                      "The task it last created was deleted."
                    ) : (
                      "Hasn't run yet."
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RemixButton
                    size="sm"
                    disabled={!props.canOperate}
                    onClick={() => void props.runCommand({ type: "routine.run", id: routine.id })}
                  >
                    <PlayIcon />
                    Run now
                  </RemixButton>
                  <Switch
                    aria-label={`${routine.enabled ? "Pause" : "Resume"} ${routine.title}`}
                    checked={routine.enabled}
                    disabled={!props.canOperate}
                    onCheckedChange={(enabled) => void save(routine, { enabled })}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${routine.title}`}
                    disabled={!props.canOperate}
                    onClick={() => setDraft(draftFromRoutine(routine))}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost-destructive"
                    aria-label={`Delete ${routine.title}`}
                    disabled={!props.canOperate}
                    onClick={() => void remove(routine)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogPopup className="max-w-xl">
          {draft !== null ? (
            <RoutineForm
              draft={draft}
              snapshot={snapshot}
              onClose={() => setDraft(null)}
              onSave={async (next) => {
                const saved = await props.runCommand({
                  type: "routine.upsert",
                  routine: {
                    ...(next.id === null ? {} : { id: next.id }),
                    companyId: company.id,
                    title: next.title.trim(),
                    description: next.description,
                    assigneeAgentId: next.assigneeAgentId,
                    assignedToUser: next.assignedToUser,
                    everyDays: next.everyDays,
                    nextRunAt: new Date(next.nextRun).toISOString(),
                    enabled: next.enabled,
                  },
                });
                if (saved !== null) setDraft(null);
              }}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </ScrollArea>
  );
}

function RoutineForm(props: {
  readonly draft: RoutineDraft;
  readonly snapshot: BoardSnapshot;
  readonly onClose: () => void;
  readonly onSave: (draft: RoutineDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.draft);
  const [saving, setSaving] = useState(false);
  const repeats = ROUTINE_REPEATS.includes(draft.everyDays)
    ? ROUTINE_REPEATS
    : [...ROUTINE_REPEATS, draft.everyDays];
  const validTime = !Number.isNaN(new Date(draft.nextRun).getTime());
  return (
    <>
      <DialogHeader>
        <RemixHeading
          icon={<RepeatIcon />}
          tone="teal"
          title={<DialogTitle>{draft.id === null ? "New routine" : "Edit routine"}</DialogTitle>}
          description={
            <DialogDescription>
              Each time it comes due, the routine adds this task to the board and starts its
              assignee.
            </DialogDescription>
          }
        />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <div className={REMIX_INSET}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-routine-title">Task title</Label>
              <Input
                id="board-routine-title"
                value={draft.title}
                autoFocus
                placeholder="Weekly numbers review"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-routine-description">Description</Label>
              <Textarea
                id="board-routine-description"
                value={draft.description}
                rows={4}
                placeholder="What to check and what to report back"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
          </div>
          <div className={REMIX_INSET}>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <Label>Assignee</Label>
                <AgentSelect
                  agents={props.snapshot.agents}
                  value={draft.assigneeAgentId}
                  noneLabel="Nobody (Ideas)"
                  you={{
                    selected: draft.assignedToUser,
                    onSelect: () => setDraft({ ...draft, assignedToUser: true }),
                  }}
                  onChange={(assigneeAgentId) =>
                    setDraft({ ...draft, assigneeAgentId, assignedToUser: false })
                  }
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label>Repeats</Label>
                <Select
                  value={String(draft.everyDays)}
                  onValueChange={(value) => setDraft({ ...draft, everyDays: Number(value) })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>{repeatLabel(draft.everyDays)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {repeats.map((days) => (
                      <SelectItem key={days} value={String(days)} label={repeatLabel(days)}>
                        {repeatLabel(days)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="board-routine-next">Next run</Label>
                <Input
                  id="board-routine-next"
                  size="sm"
                  type="datetime-local"
                  value={draft.nextRun}
                  onChange={(event) => setDraft({ ...draft, nextRun: event.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="board-routine-enabled">On</Label>
              <Switch
                id="board-routine-enabled"
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </div>
          </div>
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <RemixButton onClick={props.onClose}>Cancel</RemixButton>
        <RemixButton
          variant="go"
          disabled={saving || draft.title.trim().length === 0 || !validTime}
          onClick={async () => {
            setSaving(true);
            await props.onSave(draft);
            setSaving(false);
          }}
        >
          {draft.id === null ? "Add routine" : "Save"}
        </RemixButton>
      </DialogFooter>
    </>
  );
}
