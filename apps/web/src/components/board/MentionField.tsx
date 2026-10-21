import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";

import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Popover, PopoverPopup } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { faceFor } from "./faces";
import { matchMentionCandidates, mentionTriggerAt, type MentionCandidate } from "./boardMentions";

const MAX_SUGGESTIONS = 6;

/** A text field where typing @ suggests employees by job. */
export function MentionField(props: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly candidates: ReadonlyArray<MentionCandidate>;
  readonly onMention?: (candidate: MentionCandidate) => void;
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
}) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // Escape closes the list for that @word only; typing a new @ opens it again.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const trigger = cursor === null ? null : mentionTriggerAt(props.value, cursor);
  const matches =
    trigger === null || trigger.start === dismissedStart
      ? []
      : matchMentionCandidates(props.candidates, trigger.query, MAX_SUGGESTIONS);
  const active = Math.min(highlighted, matches.length - 1);

  const select = (candidate: MentionCandidate) => {
    if (trigger === null) return;
    const inserted = `@${candidate.label} `;
    const caret = trigger.start + inserted.length;
    props.onChange(
      `${props.value.slice(0, trigger.start)}${inserted}${props.value.slice(trigger.end)}`,
    );
    props.onMention?.(candidate);
    setCursor(caret);
    setHighlighted(0);
    requestAnimationFrame(() => fieldRef.current?.setSelectionRange(caret, caret));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const candidate = matches[active];
    if (candidate === undefined || trigger === null) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((active + step + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      select(candidate);
    } else if (event.key === "Escape") {
      // Closes the list without letting the dialog around the field close too.
      event.preventDefault();
      event.stopPropagation();
      setDismissedStart(trigger.start);
    }
  };

  const fieldProps = {
    ref: fieldRef,
    id: props.id,
    value: props.value,
    placeholder: props.placeholder,
    autoFocus: props.autoFocus,
    "aria-autocomplete": "list" as const,
    "aria-expanded": matches.length > 0,
    onChange: (event: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
      props.onChange(event.currentTarget.value);
      setCursor(event.currentTarget.selectionStart);
      setHighlighted(0);
    },
    onSelect: (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setCursor(event.currentTarget.selectionStart),
    onBlur: () => setCursor(null),
    onKeyDown,
  };

  return (
    <Popover
      open={matches.length > 0}
      onOpenChange={(open) => {
        if (!open && trigger !== null) setDismissedStart(trigger.start);
      }}
    >
      {props.multiline ? <Textarea {...fieldProps} rows={props.rows} /> : <Input {...fieldProps} />}
      <PopoverPopup
        anchor={fieldRef}
        align="start"
        padding="compact"
        initialFocus={false}
        finalFocus={false}
      >
        <div role="listbox" aria-label="Employees" className="flex min-w-56 flex-col">
          {matches.map((candidate, index) => {
            const face = faceFor({ id: candidate.agentId, avatar: candidate.avatar });
            return (
              <div
                key={candidate.agentId}
                role="option"
                aria-selected={index === active}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  index === active && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(candidate)}
              >
                {face !== null ? (
                  <img
                    src={face.url}
                    alt=""
                    className="size-5 shrink-0 rounded-full bg-muted ring-1 ring-border"
                    draggable={false}
                  />
                ) : null}
                <span className="truncate font-medium">{candidate.label}</span>
                <span className="ms-auto truncate text-xs text-muted-foreground">
                  {candidate.name}
                </span>
              </div>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
