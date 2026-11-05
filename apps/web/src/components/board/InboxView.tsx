import type {
  BoardCompanyId,
  BoardInboxItem,
  BoardSnapshot,
  BoardTaskId,
} from "@t3tools/contracts";
import { InboxIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { AgentFace } from "./AgentAvatar";
import { agentById } from "./board.logic";
import type { Tone } from "./boardTones";
import { INBOX_LABELS, inboxKey } from "./boardInbox";
import { OFFICE_CARD, OfficeIconTile, OfficePill } from "./OfficeSurface";

const INBOX_TONES: Record<BoardInboxItem["kind"], Tone> = {
  review: "violet",
  blocked: "red",
  hire: "indigo",
  todo: "amber",
};

/** Everything waiting on the person, in every company, oldest first. */
export function InboxView(props: {
  readonly items: ReadonlyArray<BoardInboxItem>;
  readonly snapshot: BoardSnapshot;
  readonly onOpenTask: (companyId: BoardCompanyId, taskId: BoardTaskId) => void;
  readonly onOpenHires: (companyId: BoardCompanyId) => void;
}) {
  const manyCompanies = new Set(props.items.map((item) => item.companyId)).size > 1;
  if (props.items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <OfficeIconTile tone="teal" size="lg">
              <InboxIcon />
            </OfficeIconTile>
          </EmptyMedia>
          <EmptyTitle>Nothing waits on you</EmptyTitle>
          <EmptyDescription>
            Tasks to review, tasks an agent is stuck on, hire requests, and your own to-dos show up
            here, from every company.
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
                  OFFICE_CARD,
                  "w-full cursor-pointer gap-2 p-4 text-start outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                )}
              >
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <OfficePill tone={INBOX_TONES[item.kind]}>{INBOX_LABELS[item.kind]}</OfficePill>
                  {manyCompanies ? <span className="truncate">{item.companyName}</span> : null}
                  <span className="ms-auto shrink-0 tabular-nums">
                    {formatRelativeTimeLabel(item.since)}
                  </span>
                </span>
                <span className="text-base leading-snug font-medium">{item.title}</span>
                {item.detail !== null ? (
                  <span className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
                    {agent !== null ? (
                      <AgentFace agent={agent} name={agent.name} size="xs" />
                    ) : null}
                    <span className="line-clamp-2">{item.detail}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
