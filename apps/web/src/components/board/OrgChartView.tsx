import type { BoardAgent, BoardHire, BoardSnapshot } from "@t3tools/contracts";
import { PencilIcon, Trash2Icon, UserPlusIcon } from "lucide-react";

import { requestConfirmDialog } from "../../confirmDialog";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { AgentAvatar } from "./AgentAvatar";
import { draftFromAgent, newEmployeeDraft, type AgentDraft } from "./AgentDialog";
import type { RunBoardCommand } from "./BoardPage";
import { agentById, orgChartRows } from "./board.logic";

export function OrgChartView(props: {
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  readonly onEditAgent: (draft: AgentDraft) => void;
}) {
  const { snapshot } = props;
  const company = snapshot.company;
  if (company === null) return null;
  const rows = orgChartRows(snapshot.agents, company.ceoAgentId);
  const pendingHires = snapshot.hires.filter((hire) => hire.status === "pending");
  const ceo = agentById(snapshot.agents, company.ceoAgentId);

  const remove = async (agent: BoardAgent) => {
    const message = `Remove ${agent.name} from ${company.name}?\nTheir reports move up to their manager and their cards become unassigned.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await props.runCommand({ type: "agent.delete", id: agent.id });
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-8">
        {pendingHires.length > 0 ? (
          <section className="flex flex-col gap-2">
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

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Org chart</h2>
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canOperate}
              onClick={() =>
                props.onEditAgent(newEmployeeDraft(company.ceoAgentId, ceo?.modelSelection ?? null))
              }
            >
              <UserPlusIcon />
              Add employee
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {rows.map(({ agent, depth }) => (
              <OrgRow
                key={agent.id}
                agent={agent}
                depth={depth}
                snapshot={snapshot}
                isCeo={agent.id === company.ceoAgentId}
                canOperate={props.canOperate}
                onAddReport={() =>
                  props.onEditAgent(newEmployeeDraft(agent.id, agent.modelSelection))
                }
                onEdit={() => props.onEditAgent(draftFromAgent(agent))}
                onRemove={() => void remove(agent)}
              />
            ))}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

function OrgRow(props: {
  readonly agent: BoardAgent;
  readonly depth: number;
  readonly snapshot: BoardSnapshot;
  readonly isCeo: boolean;
  readonly canOperate: boolean;
  readonly onAddReport: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const { agent, snapshot } = props;
  const skills = agent.skillIds
    .map((id) => snapshot.skills.find((skill) => skill.id === id)?.name)
    .filter((name) => name !== undefined);
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
    <div
      // The tree's depth is data, so it is an inline indent rather than a fixed class.
      style={{ marginInlineStart: `${props.depth * 1.75}rem` }}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5",
        props.depth > 0 && "border-dashed",
      )}
    >
      <AgentAvatar
        name={agent.name}
        title={agent.title || "Agent"}
        size="lg"
        muted={agent.paused}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {props.isCeo ? "CEO" : agent.title || "Employee"} · {agent.modelSelection.model}
          </span>
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
              {openCards} open {openCards === 1 ? "card" : "cards"}
            </Badge>
          ) : null}
        </div>
        {skills.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {skills.map((skill) => (
              <Badge key={skill} variant="secondary" size="sm">
                {skill}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Add a report under ${agent.name}`}
          disabled={!props.canOperate}
          onClick={props.onAddReport}
        >
          <UserPlusIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Edit ${agent.name}`}
          disabled={!props.canOperate}
          onClick={props.onEdit}
        >
          <PencilIcon />
        </Button>
        {props.isCeo ? null : (
          <Button
            size="icon-sm"
            variant="ghost-destructive"
            aria-label={`Remove ${agent.name}`}
            disabled={!props.canOperate}
            onClick={props.onRemove}
          >
            <Trash2Icon />
          </Button>
        )}
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
