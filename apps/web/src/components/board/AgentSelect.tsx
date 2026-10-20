import type { BoardAgent, BoardAgentId } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const NOBODY = "__nobody__";

export function AgentSelect(props: {
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly value: BoardAgentId | null;
  readonly onChange: (value: BoardAgentId | null) => void;
  readonly disabled?: boolean;
}) {
  const current = props.agents.find((agent) => agent.id === props.value) ?? null;
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
              ? "Nobody"
              : `${current.name}${current.role ? ` · ${current.role}` : ""}`}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={NOBODY} label="Nobody">
          Nobody
        </SelectItem>
        {props.agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id} label={agent.name}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{agent.name}</span>
              {agent.role ? (
                <span className="truncate text-xs text-muted-foreground">{agent.role}</span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
