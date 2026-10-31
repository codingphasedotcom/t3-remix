import type { BoardAgent, BoardHire, BoardSnapshot } from "@t3tools/contracts";
import {
  LightbulbIcon,
  ListTodoIcon,
  NetworkIcon,
  PencilIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { AgentName } from "./AgentAvatar";
import { draftFromAgent, newEmployeeDraft, type AgentDraft } from "./AgentDialog";
import type { RunBoardCommand } from "./BoardPage";
import { agentById, departmentLabel, limitProgress, recommendHiresTask } from "./board.logic";
import { TONES, type Tone } from "./boardTones";
import { faceFor, unusedFaceKey } from "./faces";
import {
  OFFICE_CARD,
  OFFICE_PANEL,
  OfficeHeading,
  OfficeIconTile,
  OfficePill,
  OfficeTitle,
} from "./OfficeSurface";

/** Each level of the chart gets its own accent, like a printed org chart. */
function accentFor(depth: number, siblingIndex: number): Tone {
  if (depth === 0) return "violet";
  if (depth === 1) return "amber";
  return siblingIndex % 2 === 0 ? "sky" : "emerald";
}

const CONNECTOR = "bg-foreground/15";

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
  // Oldest first, so a proposed team reads in the order the CEO planned it.
  const pendingHires = snapshot.hires
    .filter((hire) => hire.status === "pending")
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const hireRoots = pendingHires.filter(
    (hire) => !pendingHires.some((manager) => manager.id === hire.reportsToHireId),
  );
  const ceo = agentById(snapshot.agents, company.ceoAgentId);
  // Anyone whose manager chain is broken still shows, as an extra root beside the CEO.
  const roots = snapshot.agents.filter(
    (agent) =>
      agent.id === company.ceoAgentId ||
      agent.reportsToAgentId === null ||
      !snapshot.agents.some((candidate) => candidate.id === agent.reportsToAgentId),
  );

  const remove = async (agent: BoardAgent) => {
    const message = `Remove ${agent.name} from ${company.name}?\nTheir reports move up to their manager and their tasks become unassigned.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await props.runCommand({ type: "agent.delete", id: agent.id });
  };

  const newReport = (manager: BoardAgent | null) => {
    const draft = newEmployeeDraft(manager ?? ceo);
    props.onEditAgent({
      ...draft,
      // The CEO's reports usually lead a department of their own, so they choose one.
      departmentId: draft.reportsToAgentId === company.ceoAgentId ? null : draft.departmentId,
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
        <div className="mx-auto w-full max-w-3xl">
          <OfficeHeading
            icon={<NetworkIcon />}
            tone="violet"
            title={<OfficeTitle>Organizational chart</OfficeTitle>}
            description={`${snapshot.agents.length} ${snapshot.agents.length === 1 ? "person" : "people"} at ${company.name}`}
            actions={
              <>
                {ceo !== null ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!props.canOperate}
                    onClick={() =>
                      void props.runCommand({
                        type: "task.create",
                        task: recommendHiresTask(company, ceo.id),
                      })
                    }
                  >
                    <UsersIcon />
                    Ask {ceo.name} who to hire
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.canOperate}
                  onClick={() => newReport(ceo)}
                >
                  <UserPlusIcon />
                  Add employee
                </Button>
              </>
            }
          />
        </div>

        {pendingHires.length > 0 ? (
          <section className={cn(OFFICE_PANEL, "mx-auto w-full max-w-3xl")}>
            <h2 className="flex px-1 pt-1">
              <OfficePill tone="amber">Hire requests: {pendingHires.length}</OfficePill>
            </h2>
            {hireRoots.map((hire) => (
              <HireBranch
                key={hire.id}
                hire={hire}
                pendingHires={pendingHires}
                snapshot={snapshot}
                disabled={!props.canOperate}
                runCommand={props.runCommand}
              />
            ))}
          </section>
        ) : null}

        <div
          className={cn(OFFICE_PANEL, "flex-row items-start justify-center gap-8 px-8 pt-8 pb-10")}
        >
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
          <div className={cn("h-6 w-px", CONNECTOR)} />
          <div className="flex items-start">
            {reports.map((report, index) => (
              <div key={report.id} className="flex flex-col items-center">
                {/* Each child draws its half of the bar that joins the siblings. */}
                <div className="flex h-px w-full">
                  <div className={cn("h-px flex-1", index > 0 && CONNECTOR)} />
                  <div className={cn("h-px flex-1", index < reports.length - 1 && CONNECTOR)} />
                </div>
                <div className="flex flex-col items-center px-4">
                  <div className={cn("h-6 w-px", CONNECTOR)} />
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
  readonly accent: Tone;
  readonly actions: OrgChartActions;
}) {
  const { agent, actions } = props;
  const accent = TONES[props.accent];
  const { snapshot } = actions;
  const isCeo = snapshot.company?.ceoAgentId === agent.id;
  const department = departmentLabel(snapshot.company?.departments ?? [], agent.departmentId);
  const face = faceFor(agent);
  const skills = agent.skillIds
    .map((id) => snapshot.skills.find((skill) => skill.id === id)?.name)
    .filter((name) => name !== undefined);
  const lessons = agent.memory.split("\n").filter((line) => line.trim().length > 0).length;
  const limit = limitProgress(
    snapshot.usage?.agents.find((row) => row.agentId === agent.id)?.tokens ?? 0,
    agent.monthlyTokenLimit,
  );
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
    <div className="relative w-56 pt-10">
      <div
        className={cn(
          "absolute top-0 left-1/2 z-10 -translate-x-1/2 rounded-full p-1 shadow-sm",
          accent.fill,
          agent.paused && "opacity-60 grayscale",
        )}
      >
        <div className="size-18 overflow-hidden rounded-full bg-background">
          {face !== null ? (
            <img
              src={face.url}
              alt={`${agent.name}'s face`}
              className="size-full object-cover"
              draggable={false}
            />
          ) : null}
        </div>
      </div>
      <div className={cn(OFFICE_CARD, "gap-0 overflow-hidden p-0")}>
        <div className={cn("h-12", accent.tint)} />
        <div className="flex flex-col items-center gap-1 px-4 pt-3 pb-4 text-center">
          <span className={cn("max-w-full truncate text-sm font-medium", accent.ink)}>
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
          <div className="flex flex-wrap justify-center gap-1 pt-2">
            {department !== null ? <OfficePill tone="gray">{department}</OfficePill> : null}
            {agent.paused ? (
              <OfficePill tone="amber">Paused</OfficePill>
            ) : working ? (
              <OfficePill tone="sky" variant="solid">
                Working
              </OfficePill>
            ) : null}
            {limit?.reached ? (
              <OfficePill tone="red">Limit reached</OfficePill>
            ) : limit?.nearing ? (
              <OfficePill tone="amber">{Math.round(limit.share * 100)}% of limit</OfficePill>
            ) : null}
          </div>
          {openCards > 0 || lessons > 0 ? (
            <div className="flex items-center justify-center gap-3 pt-2">
              {openCards > 0 ? (
                <OrgStat tone="indigo" icon={<ListTodoIcon />}>
                  {openCards} open
                </OrgStat>
              ) : null}
              {lessons > 0 ? (
                <OrgStat tone="teal" icon={<LightbulbIcon />}>
                  {lessons} {lessons === 1 ? "lesson" : "lessons"}
                </OrgStat>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-center gap-1 pt-2">
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

function OrgStat(props: {
  readonly tone: Tone;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground tabular-nums">
      <OfficeIconTile tone={props.tone}>{props.icon}</OfficeIconTile>
      {props.children}
    </span>
  );
}

interface HireRequestProps {
  readonly hire: BoardHire;
  readonly pendingHires: ReadonlyArray<BoardHire>;
  readonly snapshot: BoardSnapshot;
  readonly disabled: boolean;
  readonly runCommand: RunBoardCommand;
}

/** A hire request and, indented beneath it, the proposed hires who would report to them. */
function HireBranch(props: HireRequestProps) {
  const reports = props.pendingHires.filter((hire) => hire.reportsToHireId === props.hire.id);
  return (
    <>
      <HireRequest {...props} />
      {reports.length > 0 ? (
        <div className="ms-6 flex flex-col gap-3">
          {reports.map((report) => (
            <HireBranch key={report.id} {...props} hire={report} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function HireRequest(props: HireRequestProps) {
  const { hire, snapshot } = props;
  const requester = agentById(snapshot.agents, hire.requestedByAgentId);
  const manager = agentById(snapshot.agents, hire.reportsToAgentId);
  const pendingManager = props.pendingHires.find(
    (candidate) => candidate.id === hire.reportsToHireId,
  );
  const department = departmentLabel(snapshot.company?.departments ?? [], hire.departmentId);
  const skills = hire.skillIds
    .map((id) => snapshot.skills.find((skill) => skill.id === id)?.name)
    .filter((name) => name !== undefined);
  const decide = (approve: boolean) =>
    void props.runCommand({ type: "hire.decide", hire: { id: hire.id, approve } });
  return (
    <div className={OFFICE_CARD}>
      <div className="flex items-center gap-3">
        <OfficeIconTile tone="amber">
          <UserPlusIcon />
        </OfficeIconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base leading-snug font-medium">{hire.name}</span>
          <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
            {hire.title}
            {department !== null ? ` · ${department}` : ""}
            {manager !== null ? (
              <>
                {" · reports to "}
                <AgentName agent={manager} />
              </>
            ) : pendingManager !== undefined ? (
              ` · reports to ${pendingManager.name} (not hired yet)`
            ) : null}
            {requester !== null ? (
              <>
                {" · requested by "}
                <AgentName agent={requester} />
              </>
            ) : null}
          </span>
        </div>
      </div>
      {hire.reason ? <p className="text-sm">{hire.reason}</p> : null}
      {hire.instructions.trim() ? (
        <p className="line-clamp-4 text-xs whitespace-pre-wrap text-muted-foreground">
          {hire.instructions.trim()}
        </p>
      ) : null}
      {skills.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {skills.map((skill) => (
            <OfficePill key={skill} tone="gray">
              {skill}
            </OfficePill>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {pendingManager !== undefined ? (
          <span className="me-auto text-xs text-muted-foreground">
            Hire {pendingManager.name} first
          </span>
        ) : null}
        <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => decide(false)}>
          Decline
        </Button>
        <Button
          size="sm"
          disabled={props.disabled || pendingManager !== undefined}
          onClick={() => decide(true)}
        >
          Hire {hire.name}
        </Button>
      </div>
    </div>
  );
}
