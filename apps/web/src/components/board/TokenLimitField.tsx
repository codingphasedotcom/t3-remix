import { formatTokens } from "@t3tools/shared/usageFormat";
import { useState } from "react";

import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { limitProgress, parseTokenLimit } from "./board.logic";

/** A monthly token limit typed as "5M" or "250k", with how much of it is spent. */
export function TokenLimitField(props: {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  /** Tokens spent this month, when the board reported them. */
  readonly used: number | null;
  readonly disabled?: boolean;
  readonly onChange: (value: number | null) => void;
  readonly onValidityChange?: (valid: boolean) => void;
}) {
  const [text, setText] = useState(props.value === null ? "" : formatTokens(props.value));
  const parsed = parseTokenLimit(text);
  const progress = limitProgress(props.used ?? 0, parsed === "invalid" ? null : parsed);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        size="sm"
        value={text}
        disabled={props.disabled}
        placeholder="No limit"
        aria-invalid={parsed === "invalid"}
        onChange={(event) => {
          const next = parseTokenLimit(event.target.value);
          setText(event.target.value);
          props.onValidityChange?.(next !== "invalid");
          if (next !== "invalid") props.onChange(next);
        }}
      />
      <span className="text-xs text-muted-foreground">
        {parsed === "invalid"
          ? "Type a number of tokens, such as 5M or 250k."
          : props.used === null
            ? "Input plus output tokens per calendar month. Agents over it are not started."
            : `${formatTokens(props.used)} used this month${
                progress === null ? "" : ` (${Math.round(progress.share * 100)}%)`
              }. Agents over the limit are not started.`}
      </span>
    </div>
  );
}
