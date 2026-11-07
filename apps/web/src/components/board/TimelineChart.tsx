import type {
  BoardAgent,
  BoardSnapshot,
  BoardTask,
  BoardTaskId,
  BoardTimelineSpan,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentFace } from "./AgentAvatar";
import { agentById, boardStatusLabel } from "./board.logic";
import {
  REMIX_CARD,
  REMIX_COLUMN_ICONS,
  REMIX_COLUMN_TONES,
  RemixButton,
  RemixChip,
  RemixIconTile,
} from "./RemixSurface";

const WINDOW_DAYS = 14;
/** Room after today, so open tasks reach the today line without touching the edge. */
const DAYS_AHEAD = 2;
const WEEK_MS = 7 * 86_400_000;
const MAX_FACES = 3;
/** A bar shorter than this many days can't hold its title, so the title sits beside it. */
const TITLE_INSIDE_DAYS = 2.5;

const DAY_LINES = {
  backgroundImage: "linear-gradient(to right, var(--remix-card-line) 1px, transparent 1px)",
  backgroundSize: `${100 / WINDOW_DAYS}% 100%`,
};
const DAY_COLUMNS = { gridTemplateColumns: `repeat(${WINDOW_DAYS}, minmax(0, 1fr))` };

const dayStart = (at: Date, offsetDays = 0) =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate() + offsetDays);

function rangeLabel(first: Date, last: Date): string {
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  return `${first.toLocaleDateString(undefined, { month: "short" })} – ${last.toLocaleDateString(
    undefined,
    { month: "short", year: "numeric" },
  )}`;
}

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

interface ChartRow {
  readonly span: BoardTimelineSpan;
  readonly task: BoardTask;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly start: number;
  readonly end: number;
}

/** Two weeks of the company's tasks as bars, from when each was created until it was done. */
export function TimelineChart(props: {
  readonly snapshot: BoardSnapshot;
  readonly spans: ReadonlyArray<BoardTimelineSpan>;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
}) {
  const [weeks, setWeeks] = useState(0);
  // The shared clock ticks once a minute, in UTC, which keeps the today line current.
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);
  const now = new Date(nowMs);
  const firstOfNow = dayStart(now, DAYS_AHEAD + 1 - WINDOW_DAYS);
  const first = dayStart(firstOfNow, weeks * 7);
  const days = Array.from({ length: WINDOW_DAYS }, (_, index) => dayStart(first, index));
  const from = first.getTime();
  const to = dayStart(first, WINDOW_DAYS).getTime();
  const percent = (at: number) => ((at - from) / (to - from)) * 100;
  const today = dayStart(now).getTime();
  const nowPercent = nowMs >= from && nowMs < to ? percent(nowMs) : null;
  const jumpTo = (at: number) =>
    setWeeks(Math.min(0, Math.floor((at - firstOfNow.getTime()) / WEEK_MS)));

  const tasks = new Map(props.snapshot.tasks.map((task) => [task.id, task]));
  const rows = props.spans
    .flatMap((span): Array<ChartRow> => {
      const task = tasks.get(span.taskId);
      if (task === undefined) return [];
      const start = Date.parse(span.start);
      const end = Math.max(start, span.end === null ? nowMs : Date.parse(span.end));
      if (start >= to || end < from) return [];
      const agents = span.agentIds.flatMap((id) => agentById(props.snapshot.agents, id) ?? []);
      return [{ span, task, agents, start, end }];
    })
    .toSorted((left, right) => left.start - right.start);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(REMIX_CARD, "flex-row items-center gap-2 px-3 py-1.5 font-semibold")}>
          <CalendarDaysIcon className="size-4 text-(--remix-text-muted)" />
          {rangeLabel(days[0] ?? first, days.at(-1) ?? first)}
        </span>
        <span className="text-sm text-(--remix-text-muted) tabular-nums">
          {rows.length} {rows.length === 1 ? "task" : "tasks"}
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          <RemixButton
            size="icon"
            aria-label="Earlier week"
            onClick={() => setWeeks((current) => current - 1)}
          >
            <ChevronLeftIcon />
          </RemixButton>
          <RemixButton disabled={weeks === 0} onClick={() => setWeeks(0)}>
            Today
          </RemixButton>
          <RemixButton
            size="icon"
            aria-label="Later week"
            disabled={weeks >= 0}
            onClick={() => setWeeks((current) => current + 1)}
          >
            <ChevronRightIcon />
          </RemixButton>
        </div>
      </div>

      <section
        aria-label="Task timeline"
        className={cn(
          REMIX_CARD,
          "scrollbar-gutter-stable min-h-80 flex-1 gap-0 overflow-auto p-0",
        )}
      >
        <div className="flex min-w-[46rem] flex-col">
          <div className="sticky top-0 z-20 flex border-b border-(--remix-card-line) bg-(--remix-surface)">
            <div className="sticky left-0 z-10 hidden w-60 shrink-0 items-center border-e border-(--remix-card-line) bg-(--remix-surface) px-4 text-sm font-semibold lg:flex">
              Tasks
            </div>
            <div className="grid flex-1 py-3" style={DAY_COLUMNS}>
              {days.map((day) => {
                const isToday = day.getTime() === today;
                const weekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <span key={day.getTime()} className="flex justify-center">
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold whitespace-nowrap tabular-nums",
                        isToday
                          ? "bg-(--remix-ink) text-white"
                          : weekend
                            ? "text-(--remix-text-muted)/70"
                            : "text-(--remix-text-muted)",
                      )}
                    >
                      {day.toLocaleDateString(undefined, { weekday: "narrow" })}
                      <span>{day.getDate()}</span>
                    </span>
                  </span>
                );
              })}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="relative flex min-h-48 flex-1" style={DAY_LINES}>
              <p className="m-auto rounded-lg bg-(--remix-surface) px-3 py-2 text-sm text-(--remix-text-muted)">
                {props.spans.length === 0
                  ? "No tasks yet. Tasks show up here once they leave Ideas."
                  : "No tasks in these two weeks."}
              </p>
            </div>
          ) : (
            rows.map((row) => (
              <ChartRowView
                key={row.task.id}
                row={row}
                from={from}
                to={to}
                percent={percent}
                nowPercent={nowPercent}
                onOpenCard={props.onOpenCard}
                onJump={jumpTo}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ChartRowView(props: {
  readonly row: ChartRow;
  readonly from: number;
  readonly to: number;
  readonly percent: (at: number) => number;
  readonly nowPercent: number | null;
  readonly onOpenCard: (cardId: BoardTaskId) => void;
  readonly onJump: (at: number) => void;
}) {
  const { task, agents, span, start, end } = props.row;
  const tone = REMIX_COLUMN_TONES[task.status];
  const Icon = REMIX_COLUMN_ICONS[task.status];
  const clippedStart = start < props.from;
  const clippedEnd = end > props.to;
  const left = Math.max(0, props.percent(start));
  const right = Math.min(100, props.percent(end));
  const inside = ((right - left) / 100) * WINDOW_DAYS >= TITLE_INSIDE_DAYS;
  const labelAfter = right <= 60;
  // Every bar keeps room for its icon and edge arrows, and stays inside the chart's right edge.
  const minWidth = 2.25 + (clippedStart ? 2 : 0) + (clippedEnd ? 2 : 0);
  const barStart = `min(${left}%, 100% - ${minWidth}rem)`;
  const barEnd = `max(${right}%, ${barStart} + ${minWidth}rem)`;
  const status = task.archivedAt === null ? boardStatusLabel(task.status) : "Archived";
  const open = () => props.onOpenCard(task.id);

  return (
    <div className="group/row flex h-14 hover:bg-(--remix-inset)/60">
      <button
        type="button"
        onClick={open}
        className="sticky left-0 z-10 hidden w-60 shrink-0 cursor-pointer items-center gap-2.5 border-e border-(--remix-card-line) bg-(--remix-surface) px-3 text-start outline-none group-hover/row:bg-(--remix-paper-hover) focus-visible:ring-2 focus-visible:ring-(--remix-blue) focus-visible:ring-inset lg:flex"
      >
        <RemixIconTile tone={tone} size="md">
          <Icon />
        </RemixIconTile>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{task.title}</span>
          <span className="truncate text-xs text-(--remix-text-muted)">
            {status}
            {span.subtasks > 0
              ? ` · ${span.subtasks} ${span.subtasks === 1 ? "subtask" : "subtasks"}`
              : ""}
          </span>
        </span>
      </button>

      <div className="relative flex-1" style={DAY_LINES}>
        {props.nowPercent === null ? null : (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-(--remix-pink)"
            style={{ left: `${props.nowPercent}%` }}
          />
        )}

        <div
          data-remix-tone={tone}
          style={{ left: barStart, width: `${right - left}%`, minWidth: `${minWidth}rem` }}
          className={cn(
            "absolute top-2.5 flex h-9 items-center gap-1 border-y-2 border-(--remix-ink) bg-(--tone) text-(--tone-on) shadow-(--remix-lift)",
            clippedStart ? "rounded-s-none" : "rounded-s-xl border-s-2",
            clippedEnd ? "rounded-e-none" : "rounded-e-xl border-e-2",
          )}
        >
          {clippedStart ? (
            <EdgeButton label="Show when it started" onClick={() => props.onJump(start)}>
              <ArrowLeftIcon />
            </EdgeButton>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={open}
                  aria-label={inside ? undefined : task.title}
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[inherit] px-2 text-start text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-inset"
                />
              }
            >
              <Icon className="size-3.5 shrink-0" />
              {inside ? <span className="min-w-0 truncate">{task.title}</span> : null}
            </TooltipTrigger>
            <TooltipPopup side="top">
              <span className="flex max-w-80 flex-col gap-0.5">
                <span className="font-semibold">{task.title}</span>
                <span>
                  {status} · {shortDate(start)} – {span.end === null ? "now" : shortDate(end)}
                </span>
                {agents.length > 0 ? (
                  <span>{agents.map((agent) => agent.name).join(", ")}</span>
                ) : null}
              </span>
            </TooltipPopup>
          </Tooltip>
          {inside && agents.length > 0 ? (
            <Faces agents={agents} ring="ring-(--tone)" className="pe-1" />
          ) : null}
          {clippedEnd ? (
            <EdgeButton
              label={span.end === null ? "Back to today" : "Show when it finished"}
              onClick={() => props.onJump(end)}
            >
              <ArrowRightIcon />
            </EdgeButton>
          ) : null}
        </div>

        {inside ? null : (
          <div
            aria-hidden
            style={
              labelAfter
                ? { left: `calc(${barEnd} + 0.5rem)`, maxWidth: `calc(100% - ${barEnd} - 0.75rem)` }
                : {
                    right: `calc(100% - ${barStart} + 0.5rem)`,
                    maxWidth: `calc(${barStart} - 0.75rem)`,
                  }
            }
            className={cn(
              "absolute top-2.5 flex h-9 min-w-0 items-center gap-2",
              !labelAfter && "flex-row-reverse",
            )}
          >
            {agents.length > 0 ? <Faces agents={agents} ring="ring-(--remix-surface)" /> : null}
            <span className="min-w-0 truncate text-sm font-medium">{task.title}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EdgeButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      className="mx-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-(--remix-surface) text-(--remix-text) outline-none hover:bg-(--remix-paper-hover) focus-visible:ring-2 focus-visible:ring-(--remix-blue) focus-visible:ring-inset [&_svg]:size-3.5"
    >
      {props.children}
    </button>
  );
}

function Faces(props: {
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly ring: string;
  readonly className?: string;
}) {
  const extra = props.agents.length - MAX_FACES;
  return (
    <span className={cn("flex shrink-0 items-center -space-x-1.5", props.className)}>
      {props.agents.slice(0, MAX_FACES).map((agent) => (
        <span key={agent.id} className={cn("flex rounded-full ring-2", props.ring)}>
          <AgentFace agent={agent} name={agent.name} size="sm" />
        </span>
      ))}
      {extra > 0 ? (
        <span className={cn("flex rounded-full ring-2", props.ring)}>
          <RemixChip tone="gray" variant="paper">
            +{extra}
          </RemixChip>
        </span>
      ) : null}
    </span>
  );
}
