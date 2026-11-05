import type { BoardTask, BoardTaskId } from "@t3tools/contracts";
import { HourglassIcon, XIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { boardStatusLabel } from "./board.logic";
import { COLUMN_TONES } from "./boardTones";
import { OFFICE_CARD, OfficeIconTile, OfficePill, statusPillVariant } from "./OfficeSurface";

/**
 * The tasks one task waits on before it starts, with a picker for another. Done and archived
 * tasks are not offered: waiting on them would not hold anything back.
 */
export function WaitsOnField(props: {
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly value: ReadonlyArray<BoardTaskId>;
  readonly onChange: (value: ReadonlyArray<BoardTaskId>) => void;
  /** The task being edited, which cannot wait on itself. */
  readonly self?: BoardTaskId;
  readonly disabled?: boolean;
  readonly onOpen?: (id: BoardTaskId) => void;
}) {
  const chosen = props.value.flatMap((id) => props.tasks.filter((task) => task.id === id));
  const offered = props.tasks.filter(
    (task) =>
      task.id !== props.self &&
      task.status !== "done" &&
      task.archivedAt === null &&
      !props.value.includes(task.id),
  );
  return (
    <div className="flex flex-col gap-2">
      {chosen.map((task) => (
        <div key={task.id} className={cn(OFFICE_CARD, "flex-row items-center gap-3 p-3 text-sm")}>
          <OfficeIconTile tone="amber">
            <HourglassIcon />
          </OfficeIconTile>
          {props.onOpen === undefined ? (
            <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
          ) : (
            <button
              type="button"
              className="min-w-0 flex-1 cursor-pointer truncate text-start font-medium hover:underline"
              onClick={() => props.onOpen?.(task.id)}
            >
              {task.title}
            </button>
          )}
          <OfficePill tone={COLUMN_TONES[task.status]} variant={statusPillVariant(task.status)}>
            {boardStatusLabel(task.status)}
          </OfficePill>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Stop waiting on ${task.title}`}
            disabled={props.disabled}
            onClick={() => props.onChange(props.value.filter((id) => id !== task.id))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {offered.length > 0 ? (
        <Select
          // A fresh picker after each choice, so it always reads as "add another".
          key={props.value.join(",")}
          value={null}
          {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
          onValueChange={(id) => {
            if (id !== null) props.onChange([...props.value, id as BoardTaskId]);
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              <span className="truncate text-muted-foreground">
                {chosen.length === 0 ? "Starts right away" : "Wait on another task too"}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {offered.map((task) => (
              <SelectItem key={task.id} value={task.id} label={task.title}>
                <span className="flex min-w-0 items-center justify-between gap-3">
                  <span className="truncate">{task.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {boardStatusLabel(task.status)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : chosen.length === 0 ? (
        <span className="text-xs text-muted-foreground">No other open tasks to wait on.</span>
      ) : null}
    </div>
  );
}
