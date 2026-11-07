import type {
  BoardCompanyId,
  BoardInboxItem,
  BoardSkillRequestId,
  BoardSnapshot,
  BoardTaskId,
} from "@t3tools/contracts";
import { CheckIcon, InboxIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { AgentFace } from "./AgentAvatar";
import { agentById } from "./board.logic";
import { INBOX_LABELS, inboxKey } from "./boardInbox";
import { REMIX_CARD, RemixButton, RemixChip, RemixIconTile, type RemixTone } from "./RemixSurface";

const INBOX_TONES: Record<BoardInboxItem["kind"], RemixTone> = {
  review: "yellow",
  blocked: "pink",
  hire: "purple",
  skill: "teal",
  todo: "orange",
};

/** Everything waiting on the person, in every company, oldest first. */
export function InboxView(props: {
  readonly items: ReadonlyArray<BoardInboxItem>;
  readonly snapshot: BoardSnapshot;
  readonly onOpenTask: (companyId: BoardCompanyId, taskId: BoardTaskId) => void;
  readonly onOpenHires: (companyId: BoardCompanyId) => void;
  readonly canOperate: boolean;
  readonly onDecideSkill: (id: BoardSkillRequestId, approve: boolean) => Promise<unknown>;
}) {
  const manyCompanies = new Set(props.items.map((item) => item.companyId)).size > 1;
  if (props.items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <RemixIconTile tone="teal" size="lg">
              <InboxIcon />
            </RemixIconTile>
          </EmptyMedia>
          <EmptyTitle>Nothing waits on you</EmptyTitle>
          <EmptyDescription>
            Tasks to review, tasks an agent is stuck on, hire and skill requests, and your own
            to-dos show up here, from every company.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="mx-auto flex max-w-3xl flex-col gap-2 p-6">
        {props.items.map((item) => {
          // Faces come from the viewed company; another company's items go without one.
          const agent =
            item.companyId === props.snapshot.company?.id
              ? agentById(props.snapshot.agents, item.agentId)
              : null;
          const header = (
            <span className="flex min-w-0 items-center gap-2 text-xs text-(--remix-text-muted)">
              <RemixChip tone={INBOX_TONES[item.kind]}>{INBOX_LABELS[item.kind]}</RemixChip>
              {manyCompanies ? <span className="truncate">{item.companyName}</span> : null}
              <span className="ms-auto shrink-0 tabular-nums">
                {formatRelativeTimeLabel(item.since)}
              </span>
            </span>
          );
          const detail =
            item.detail !== null ? (
              <span className="flex min-w-0 items-start gap-2 text-sm text-(--remix-text-muted)">
                {agent !== null ? <AgentFace agent={agent} name={agent.name} size="xs" /> : null}
                <span className="line-clamp-2">{item.detail}</span>
              </span>
            ) : null;
          if (item.skillRequestId !== null) {
            return (
              <li key={inboxKey(item)}>
                <SkillRequestItem
                  id={item.skillRequestId}
                  title={item.title}
                  header={header}
                  detail={detail}
                  canOperate={props.canOperate}
                  onDecide={props.onDecideSkill}
                />
              </li>
            );
          }
          return (
            <li key={inboxKey(item)}>
              <button
                type="button"
                onClick={() =>
                  item.taskId === null
                    ? props.onOpenHires(item.companyId)
                    : props.onOpenTask(item.companyId, item.taskId)
                }
                className={cn(
                  REMIX_CARD,
                  "w-full cursor-pointer gap-2 p-4 text-start outline-none hover:bg-(--remix-paper-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                )}
              >
                {header}
                <span className="text-sm leading-snug font-semibold">{item.title}</span>
                {detail}
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}

/** A skill request is decided right here: the request says everything the decision needs. */
function SkillRequestItem(props: {
  readonly id: BoardSkillRequestId;
  readonly title: string;
  readonly header: ReactNode;
  readonly detail: ReactNode;
  readonly canOperate: boolean;
  readonly onDecide: (id: BoardSkillRequestId, approve: boolean) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await props.onDecide(props.id, approve);
    setBusy(false);
  };
  return (
    <div className={cn(REMIX_CARD, "gap-2 p-4")}>
      {props.header}
      <span className="text-sm leading-snug font-semibold">{props.title}</span>
      {props.detail}
      <div className="flex justify-end gap-2 pt-1">
        <RemixButton
          size="sm"
          disabled={!props.canOperate || busy}
          onClick={() => void decide(false)}
        >
          <XIcon />
          Decline
        </RemixButton>
        <RemixButton
          size="sm"
          variant="go"
          disabled={!props.canOperate || busy}
          onClick={() => void decide(true)}
        >
          <CheckIcon />
          Add skill
        </RemixButton>
      </div>
    </div>
  );
}
