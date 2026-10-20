import type { BoardAgent, BoardAgentId } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const NOBODY = "__nobody__";

export function AgentSelect(props: {
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly value: BoardAgentId | null;
  readonly onChange: (value: BoardAgentId | null) => void;
  readonly disabled?: boolean;
  /** What "no agent" means here, such as "The board (you)" for a reviewer. */
  readonly noneLabel?: string;
}) {
  const current = props.agents.find((agent) => agent.id === props.value) ?? null;
  const noneLabel = props.noneLabel ?? "Nobody";
  return (
    <Select
      value={props.value ?? NOBODY}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
      onValueChange={(value) =>
        props.onChange(value === NOBODY || value === null ? null : (value as BoardAgentId))
      }
    >
      <SelectTrigger size="sm">
        <SelectValue>
          <span className="truncate">
            {current === null
              ? noneLabel
              : `${current.name}${current.title ? ` · ${current.title}` : ""}`}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={NOBODY} label={noneLabel}>
          {noneLabel}
        </SelectItem>
        {props.agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id} label={agent.name}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">
                {agent.name}
                {agent.paused ? " (paused)" : ""}
              </span>
              {agent.title ? (
                <span className="truncate text-xs text-muted-foreground">{agent.title}</span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
