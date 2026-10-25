import type { BoardTaskStatus } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { TONES, type Tone } from "./boardTones";

// T3 Office's look, after the board: soft grey panels hold borderless white cards, panels are
// headed by uppercase pills, and colored icon tiles carry meaning at a glance. These live
// here, not in components/ui, so upstream T3 Code merges never touch them.

/** A soft grey area that holds white cards, like a board column. */
export const OFFICE_PANEL =
  "flex min-w-0 flex-col gap-3 rounded-3xl bg-foreground/4 p-3 dark:bg-foreground/2";

/** A borderless white card. Sits on a panel or directly on the page. */
export const OFFICE_CARD =
  "flex min-w-0 flex-col gap-3 rounded-2xl bg-card p-4 text-card-foreground shadow-xs dark:bg-foreground/6";

/** A soft grey block inside a white surface, such as a group of fields in a dialog. */
export const OFFICE_INSET =
  "flex min-w-0 flex-col gap-4 rounded-2xl bg-foreground/4 p-4 dark:bg-foreground/4";

type OfficePillVariant = "tint" | "solid" | "plain" | "live";

export function OfficePill(props: {
  readonly tone: Tone;
  /**
   * `plain` is a white pill for neutral labels. `solid` marks the status where work is live, and
   * `live` (primary, like a live board card) marks an agent working on this right now.
   */
  readonly variant?: OfficePillVariant;
  readonly children: ReactNode;
}) {
  const tone = TONES[props.tone];
  const variant = props.variant ?? "tint";
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-2xs font-semibold tracking-wide whitespace-nowrap uppercase tabular-nums",
        variant === "plain"
          ? "bg-card text-muted-foreground shadow-xs dark:bg-foreground/6"
          : variant === "solid"
            ? tone.solid
            : variant === "live"
              ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
              : cn(tone.tint, tone.ink),
      )}
    >
      {props.children}
    </span>
  );
}

/** How a task status's pill reads everywhere: in progress stands out, backlog stays neutral. */
export function statusPillVariant(status: BoardTaskStatus): OfficePillVariant {
  if (status === "in_progress") return "solid";
  if (status === "backlog") return "plain";
  return "tint";
}

export function OfficeIconTile(props: {
  readonly tone: Tone;
  readonly variant?: "tint" | "solid";
  readonly size?: "sm" | "lg";
  readonly children: ReactNode;
}) {
  const tone = TONES[props.tone];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        props.size === "lg"
          ? "size-10 rounded-xl [&_svg]:size-5"
          : "size-6 rounded-md [&_svg]:size-3.5",
        props.variant === "solid" ? tone.solid : cn(tone.tint, tone.ink),
      )}
    >
      {props.children}
    </span>
  );
}

/**
 * A page or dialog heading: a large icon tile beside the title. Dialogs pass their DialogTitle
 * and DialogDescription so the accessible names stay wired up.
 */
export function OfficeHeading(props: {
  readonly icon: ReactNode;
  readonly tone: Tone;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <OfficeIconTile tone={props.tone} size="lg">
        {props.icon}
      </OfficeIconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {props.title}
        {typeof props.description === "string" ? (
          <span className="text-sm text-muted-foreground">{props.description}</span>
        ) : (
          props.description
        )}
      </div>
      {props.actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
      )}
    </div>
  );
}

/** A pill-led grey block of related fields, for long dialogs. */
export function OfficeFieldGroup(props: {
  readonly label: string;
  readonly tone: Tone;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className={OFFICE_INSET}>
      <div className="flex items-center justify-between gap-3">
        <OfficePill tone={props.tone}>{props.label}</OfficePill>
        {props.action}
      </div>
      {props.children}
    </div>
  );
}

/** A soft rounded track for header controls such as the company picker and the page tabs. */
export const OFFICE_TRACK =
  "flex min-w-0 items-center gap-1 rounded-full bg-foreground/4 p-1 dark:bg-foreground/3";

export function OfficeTabs(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <nav aria-label={props.label} className={OFFICE_TRACK}>
      {props.children}
    </nav>
  );
}

/** The active tab is a raised white pill and its icon takes the page's tone. */
export function OfficeTab(props: {
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly tone: Tone;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
      className={cn(
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-4",
        props.active
          ? "bg-card text-foreground shadow-xs dark:bg-foreground/10"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("flex", props.active && TONES[props.tone].ink)}>{props.icon}</span>
      {props.children}
    </button>
  );
}

/** Large page title used with OfficeHeading outside dialogs. */
export function OfficeTitle(props: { readonly children: ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight text-foreground">{props.children}</h2>;
}
