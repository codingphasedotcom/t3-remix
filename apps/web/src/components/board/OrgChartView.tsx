import type { BoardAgent, BoardHire, BoardSnapshot } from "@t3tools/contracts";
import { PencilIcon, Trash2Icon, UserPlusIcon } from "lucide-react";

import { requestConfirmDialog } from "../../confirmDialog";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { draftFromAgent, newEmployeeDraft, type AgentDraft } from "./AgentDialog";
import type { RunBoardCommand } from "./BoardPage";
import { agentById } from "./board.logic";
import { faceFor, unusedFaceKey } from "./faces";

/** Each level of the chart gets its own accent, like a printed org chart. */
const ACCENTS = {
  violet: {
    ring: "ring-violet-500",
    band: "bg-violet-500",
    name: "text-violet-700 dark:text-violet-300",
  },
  orange: {
    ring: "ring-orange-500",
    band: "bg-orange-500",
    name: "text-orange-700 dark:text-orange-300",
  },
  sky: {
    ring: "ring-sky-500",
    band: "bg-sky-500",
    name: "text-sky-700 dark:text-sky-300",
  },
  emerald: {
    ring: "ring-emerald-500",
    band: "bg-emerald-500",
    name: "text-emerald-700 dark:text-emerald-300",
  },
} as const;

type Accent = (typeof ACCENTS)[keyof typeof ACCENTS];

function accentFor(depth: number, siblingIndex: number): Accent {
  if (depth === 0) return ACCENTS.violet;
  if (depth === 1) return ACCENTS.orange;
  return siblingIndex % 2 === 0 ? ACCENTS.sky : ACCENTS.emerald;
}

interface OrgChartActions {
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly onAddReport: (manager: BoardAgent) => void;
  readonly onEdit: (agent: BoardAgent) => void;
  readonly onRemove: (agent: BoardAgent) => void;
}

export function OrgChartView(props: {
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onEditAgent: (draft: AgentDraft) => void;
}) {
  const { snapshot } = props;
  const company = snapshot.company;
  if (company === null) return null;
  const pendingHires = snapshot.hires.filter((hire) => hire.status === "pending");
  const ceo = agentById(snapshot.agents, company.ceoAgentId);
  // Anyone whose manager chain is broken still shows, as an extra root beside the CEO.
  const roots = snapshot.agents.filter(
    (agent) =>
      agent.id === company.ceoAgentId ||
      agent.reportsToAgentId === null ||
      !snapshot.agents.some((candidate) => candidate.id === agent.reportsToAgentId),
  );

  const remove = async (agent: BoardAgent) => {
    const message = `Remove ${agent.name} from ${company.name}?\nTheir reports move up to their manager and their cards become unassigned.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await props.runCommand({ type: "agent.delete", id: agent.id });
  };

  const newReport = (manager: BoardAgent | null) => {
    const draft = newEmployeeDraft(
      manager?.id ?? company.ceoAgentId,
      manager?.modelSelection ?? ceo?.modelSelection ?? null,
    );
    props.onEditAgent({
      ...draft,
      avatar: unusedFaceKey(snapshot.agents, `${company.id}:${snapshot.agents.length}`),
    });
  };

  const actions: OrgChartActions = {
    snapshot,
    canOperate: props.canOperate,
    onAddReport: newReport,
    onEdit: (agent) => props.onEditAgent(draftFromAgent(agent)),
    onRemove: (agent) => void remove(agent),
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex min-w-max flex-col gap-6 px-6 pb-10">
        {pendingHires.length > 0 ? (
          <section className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            <h2 className="text-sm font-medium">Hire requests</h2>
            {pendingHires.map((hire) => (
              <HireRequest
                key={hire.id}
                hire={hire}
                snapshot={snapshot}
                disabled={!props.canOperate}
                runCommand={props.runCommand}
              />
            ))}
          </section>
        ) : null}

        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold tracking-tight">Organizational chart</h2>
            <span className="text-xs text-muted-foreground">
              {snapshot.agents.length} {snapshot.agents.length === 1 ? "person" : "people"} at{" "}
              {company.name}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canOperate}
            onClick={() => newReport(ceo)}
          >
            <UserPlusIcon />
            Add employee
          </Button>
        </div>

        <div className="flex items-start justify-center gap-8 pt-2">
          {roots.map((root) => (
            <OrgBranch key={root.id} agent={root} depth={0} siblingIndex={0} actions={actions} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

/** One person and, beneath them, the subtree of everyone who reports to them. */
function OrgBranch(props: {
  readonly agent: BoardAgent;
  readonly depth: number;
  readonly siblingIndex: number;
  readonly actions: OrgChartActions;
}) {
  const reports = props.actions.snapshot.agents.filter(
    (candidate) => candidate.reportsToAgentId === props.agent.id,
  );
  return (
    <div className="flex flex-col items-center">
      <OrgCard
        agent={props.agent}
        accent={accentFor(props.depth, props.siblingIndex)}
        actions={props.actions}
      />
      {reports.length > 0 ? (
        <>
          <div className="h-6 w-px bg-muted-foreground/40" />
          <div className="flex items-start">
            {reports.map((report, index) => (
              <div key={report.id} className="flex flex-col items-center">
                {/* Each child draws its half of the bar that joins the siblings. */}
                <div className="flex h-px w-full">
                  <div className={cn("h-px flex-1", index > 0 && "bg-muted-foreground/40")} />
                  <div
                    className={cn(
                      "h-px flex-1",
                      index < reports.length - 1 && "bg-muted-foreground/40",
                    )}
                  />
                </div>
                <div className="flex flex-col items-center px-3">
                  <div className="h-6 w-px bg-muted-foreground/40" />
                  <OrgBranch
                    agent={report}
                    depth={props.depth + 1}
                    siblingIndex={index}
                    actions={props.actions}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function OrgCard(props: {
  readonly agent: BoardAgent;
  readonly accent: Accent;
  readonly actions: OrgChartActions;
}) {
  const { agent, accent, actions } = props;
  const { snapshot } = actions;
  const isCeo = snapshot.company?.ceoAgentId === agent.id;
  const face = faceFor(agent);
  const skills = agent.skillIds
    .map((id) => snapshot.skills.find((skill) => skill.id === id)?.name)
    .filter((name) => name !== undefined);
  const lessons = agent.memory.split("\n").filter((line) => line.trim().length > 0).length;
  const openCards = snapshot.tasks.filter(
    (task) => task.assigneeAgentId === agent.id && task.status !== "done",
  ).length;
  const working = snapshot.tasks.some(
    (task) =>
      task.activeRunKind !== null &&
      (task.activeRunKind === "review"
        ? task.reviewerAgentId === agent.id
        : task.assigneeAgentId === agent.id),
  );
  return (
    <div className="relative w-56 pt-9">
      <div
        className={cn(
          "absolute top-0 left-1/2 z-10 size-18 -translate-x-1/2 overflow-hidden rounded-full bg-background ring-4",
          accent.ring,
          agent.paused && "opacity-60 grayscale",
        )}
      >
        {face !== null ? (
          <img
            src={face.url}
            alt={`${agent.name}'s face`}
            className="size-full"
            draggable={false}
          />
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className={cn("h-2.5", accent.band)} />
        <div className="flex flex-col items-center gap-1 px-3 pt-10 pb-3 text-center">
          <span className={cn("max-w-full truncate text-sm font-semibold", accent.name)}>
            {agent.name}
          </span>
          <span className="max-w-full truncate text-xs font-medium text-foreground">
            {isCeo ? "Chief Executive Officer" : agent.title || "Employee"}
          </span>
          <span className="max-w-full truncate text-2xs text-muted-foreground">
            {agent.modelSelection.model}
          </span>
          {skills.length > 0 ? (
            <span className="line-clamp-2 text-2xs leading-snug text-muted-foreground">
              {skills.join(" · ")}
            </span>
          ) : null}
          <div className="flex flex-wrap justify-center gap-1 pt-1">
            {agent.paused ? (
              <Badge variant="warning" size="sm">
                Paused
              </Badge>
            ) : working ? (
              <Badge variant="info" size="sm">
                Working
              </Badge>
            ) : null}
            {openCards > 0 ? (
              <Badge variant="outline" size="sm">
                {openCards} open
              </Badge>
            ) : null}
            {lessons > 0 ? (
              <Badge variant="outline" size="sm">
                {lessons} {lessons === 1 ? "lesson" : "lessons"}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center justify-center gap-1 pt-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Add a report under ${agent.name}`}
              disabled={!actions.canOperate}
              onClick={() => actions.onAddReport(agent)}
            >
              <UserPlusIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Edit ${agent.name}`}
              disabled={!actions.canOperate}
              onClick={() => actions.onEdit(agent)}
            >
              <PencilIcon />
            </Button>
            {isCeo ? null : (
              <Button
                size="icon-xs"
                variant="ghost-destructive"
                aria-label={`Remove ${agent.name}`}
                disabled={!actions.canOperate}
                onClick={() => actions.onRemove(agent)}
              >
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HireRequest(props: {
  readonly hire: BoardHire;
  readonly snapshot: BoardSnapshot;
  readonly disabled: boolean;
  readonly runCommand: RunBoardCommand;
}) {
  const { hire, snapshot } = props;
  const requester = agentById(snapshot.agents, hire.requestedByAgentId);
  const manager = agentById(snapshot.agents, hire.reportsToAgentId);
  const skills = hire.skillIds
    .map((id) => snapshot.skills.find((skill) => skill.id === id)?.name)
    .filter((name) => name !== undefined);
  const decide = (approve: boolean) =>
    void props.runCommand({ type: "hire.decide", hire: { id: hire.id, approve } });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{hire.name}</span>
        <span className="text-xs text-muted-foreground">
          {hire.title}
          {manager !== null ? ` · reports to ${manager.name}` : ""}
          {requester !== null ? ` · requested by ${requester.name}` : ""}
        </span>
      </div>
      {hire.reason ? <p className="text-sm">{hire.reason}</p> : null}
      {skills.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {skills.map((skill) => (
            <Badge key={skill} variant="secondary" size="sm">
              {skill}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => decide(false)}>
          Decline
        </Button>
        <Button size="sm" disabled={props.disabled} onClick={() => decide(true)}>
          Hire {hire.name}
        </Button>
      </div>
    </div>
  );
}
