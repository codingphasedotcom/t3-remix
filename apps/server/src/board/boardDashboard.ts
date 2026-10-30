import type {
  BoardAgent,
  BoardAgentId,
  BoardCompanyId,
  BoardDashboard,
  BoardDashboardDay,
  BoardRun,
  BoardRunStats,
  BoardTokenTotals,
  ModelSelection,
  ThreadId,
} from "@t3tools/contracts";

import * as DateTime from "effect/DateTime";

import type { RunFact, StoredTask, ThreadTokenDay } from "./BoardStore.ts";

const DASHBOARD_DAYS = 14;

const DAY_MS = 86_400_000;

const millis = (instant: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(instant));
const dayAt = (epochMillis: number) => DateTime.formatIsoDateUtc(DateTime.makeUnsafe(epochMillis));

/** The calendar day an instant falls on for a viewer `utcOffsetMinutes` from UTC. */
function localDay(instant: string, utcOffsetMinutes: number): string {
  return dayAt(millis(instant) + utcOffsetMinutes * 60_000);
}

interface MutableStats {
  runs: number;
  reviews: number;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  finishedRunMs: number;
  tokens: { input: number; cachedInput: number; output: number };
  lastRunAt: string | null;
}

const emptyStats = (): MutableStats => ({
  runs: 0,
  reviews: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  running: 0,
  finishedRunMs: 0,
  tokens: { input: 0, cachedInput: 0, output: 0 },
  lastRunAt: null,
});

function addRun(stats: MutableStats, run: BoardRun): void {
  stats.runs += 1;
  if (run.kind === "review") stats.reviews += 1;
  stats[run.status] += 1;
  if (run.endedAt !== null) {
    stats.finishedRunMs += Math.max(0, millis(run.endedAt) - millis(run.startedAt));
  }
  if (stats.lastRunAt === null || run.startedAt > stats.lastRunAt) stats.lastRunAt = run.startedAt;
}

function addTokens(stats: MutableStats, tokens: BoardTokenTotals): void {
  stats.tokens.input += tokens.input;
  stats.tokens.cachedInput += tokens.cachedInput;
  stats.tokens.output += tokens.output;
}

const finish = (stats: MutableStats): BoardRunStats => ({ ...stats, tokens: { ...stats.tokens } });

const modelKey = (selection: ModelSelection) => `${selection.instanceId}\u0000${selection.model}`;

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Rolls a company's runs, finished cards, and token spend into the dashboard. A thread belongs to
 * one employee, so its tokens count toward that employee and the model the thread ran.
 */
export function buildDashboard(input: {
  readonly companyId: BoardCompanyId;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly tasks: ReadonlyArray<StoredTask>;
  readonly runs: ReadonlyArray<RunFact>;
  readonly tokenDays: ReadonlyArray<ThreadTokenDay>;
  readonly now: string;
  readonly utcOffsetMinutes: number;
}): BoardDashboard {
  const { utcOffsetMinutes } = input;
  const totals = emptyStats();
  const byAgent = new Map<BoardAgentId, MutableStats>(
    input.agents.map((agent) => [agent.id, emptyStats()]),
  );
  const agentModels = new Map(input.agents.map((agent) => [agent.id, agent.modelSelection]));
  const byModel = new Map<
    string,
    { modelSelection: ModelSelection; agentIds: Set<BoardAgentId>; stats: MutableStats }
  >();
  const threadOwners = new Map<
    ThreadId,
    { agentId: BoardAgentId; modelSelection: ModelSelection | null }
  >();

  const modelEntry = (selection: ModelSelection) => {
    const key = modelKey(selection);
    let entry = byModel.get(key);
    if (entry === undefined) {
      entry = { modelSelection: selection, agentIds: new Set(), stats: emptyStats() };
      byModel.set(key, entry);
    }
    return entry;
  };

  const firstDayMs = millis(localDay(input.now, utcOffsetMinutes)) - (DASHBOARD_DAYS - 1) * DAY_MS;
  const days = new Map<string, { runs: number; tasksFinished: number; tokens: number }>();
  for (let index = 0; index < DASHBOARD_DAYS; index += 1) {
    days.set(dayAt(firstDayMs + index * DAY_MS), { runs: 0, tasksFinished: 0, tokens: 0 });
  }

  for (const { run, modelSelection } of input.runs) {
    addRun(totals, run);
    const agentStats = byAgent.get(run.agentId);
    if (agentStats !== undefined) addRun(agentStats, run);
    const selection = modelSelection ?? agentModels.get(run.agentId) ?? null;
    if (selection !== null) {
      const entry = modelEntry(selection);
      entry.agentIds.add(run.agentId);
      addRun(entry.stats, run);
    }
    if (!threadOwners.has(run.threadId)) {
      threadOwners.set(run.threadId, { agentId: run.agentId, modelSelection: selection });
    }
    const day = days.get(localDay(run.startedAt, utcOffsetMinutes));
    if (day !== undefined) day.runs += 1;
  }

  for (const row of input.tokenDays) {
    addTokens(totals, row);
    const owner = threadOwners.get(row.threadId);
    if (owner !== undefined) {
      const agentStats = byAgent.get(owner.agentId);
      if (agentStats !== undefined) addTokens(agentStats, row);
      if (owner.modelSelection !== null) addTokens(modelEntry(owner.modelSelection).stats, row);
    }
    const day = row.day === null ? undefined : days.get(row.day);
    if (day !== undefined) day.tokens += row.input + row.output;
  }

  const cycleTimes: Array<number> = [];
  for (const { task, statusChangedAt } of input.tasks) {
    if (task.status !== "done") continue;
    cycleTimes.push(Math.max(0, millis(statusChangedAt) - millis(task.createdAt)));
    const day = days.get(localDay(statusChangedAt, utcOffsetMinutes));
    if (day !== undefined) day.tasksFinished += 1;
  }

  return {
    companyId: input.companyId,
    totals: finish(totals),
    agents: [...byAgent].map(([agentId, stats]) => ({ agentId, stats: finish(stats) })),
    models: [...byModel.values()]
      .map((entry) => ({
        modelSelection: entry.modelSelection,
        agentIds: [...entry.agentIds],
        stats: finish(entry.stats),
      }))
      .toSorted(
        (a, b) =>
          b.stats.runs - a.stats.runs ||
          b.stats.tokens.input +
            b.stats.tokens.output -
            (a.stats.tokens.input + a.stats.tokens.output),
      ),
    days: [...days].map(([day, counts]): BoardDashboardDay => ({ day, ...counts })),
    medianCycleMs: median(cycleTimes),
  };
}
