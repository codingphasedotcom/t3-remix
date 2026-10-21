import { UserRoundIcon } from "lucide-react";

import { ContextChip, ContextChipLabel } from "./ContextChip";

/** A company employee someone @mentioned by their job. */
export function EmployeeContextChip(props: { label: string; copyMarkdown?: string }) {
  return (
    <ContextChip
      kind="employee"
      aria-label={`Employee, ${props.label}`}
      data-markdown-copy={props.copyMarkdown}
    >
      <UserRoundIcon />
      <ContextChipLabel>{props.label}</ContextChipLabel>
    </ContextChip>
  );
}
