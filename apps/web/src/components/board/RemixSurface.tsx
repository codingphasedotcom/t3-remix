import "./remix.css";

import type { BoardTaskStatus } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  CircleCheckIcon,
  EyeIcon,
  LightbulbIcon,
  ListTodoIcon,
  PlayIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RemixClouds } from "./RemixArt";

// T3 Remix's cartoon look: outlined stickers on a sky-blue page. Colors come from remix.css.
// These live in the board folder, not components/ui, so upstream T3 Code merges never touch them.

export type RemixTone =
  | "blue"
  | "yellow"
  | "pink"
  | "green"
  | "purple"
  | "orange"
  | "teal"
  | "red"
  | "gray";

export const REMIX_COLUMN_TONES: Record<BoardTaskStatus, RemixTone> = {
  backlog: "purple",
  todo: "orange",
  in_progress: "blue",
  review: "yellow",
  blocked: "pink",
  done: "green",
};

export const REMIX_COLUMN_ICONS: Record<BoardTaskStatus, LucideIcon> = {
  backlog: LightbulbIcon,
  todo: ListTodoIcon,
  in_progress: PlayIcon,
  review: EyeIcon,
  blocked: AlertTriangleIcon,
  done: CircleCheckIcon,
};

/** The pale page with clouds rolling along its bottom edge. */
export function RemixPage(props: { readonly children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col bg-(--remix-page) text-(--remix-text)">
      <RemixClouds />
      {props.children}
    </div>
  );
}

/** An outlined, toned container such as a board column or a dashboard panel. */
export const REMIX_SHELL =
  "flex min-w-0 flex-col rounded-(--remix-shell-radius) border border-(--remix-card-line) bg-(--tone-shell) shadow-(--remix-card-lift)";

/** The paler well inside a shell that holds its cards. */
export const REMIX_WELL = "flex min-w-0 flex-col rounded-(--remix-well-radius) bg-(--tone-wash)";

/** An outlined white card. Inside a toned shell, pair it with `border-(--tone)`. */
export const REMIX_CARD =
  "flex min-w-0 flex-col gap-3 rounded-xl border border-(--remix-card-line) bg-(--remix-surface) p-4 text-(--remix-text)";

/** A soft tinted block inside a white surface, such as a group of details in a panel. */
export const REMIX_INSET = "flex min-w-0 flex-col gap-4 rounded-xl bg-(--remix-inset) p-4";

/** A speech-bubble label: column and panel titles. */
export function RemixBubble(props: {
  readonly tone: RemixTone;
  readonly size?: "sm" | "md";
  readonly children: ReactNode;
}) {
  return (
    <span
      data-remix-tone={props.tone}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-xl border-2 border-(--remix-ink) bg-(--tone) font-semibold whitespace-nowrap text-(--tone-on) tabular-nums shadow-(--remix-lift)",
        // The tail: a turned square whose two outlined sides make the point.
        "after:absolute after:rotate-45 after:border-r-2 after:border-b-2 after:border-(--remix-ink) after:bg-(--tone) after:content-['']",
        "before:absolute before:top-1 before:right-1.5 before:h-1 before:w-2.5 before:-rotate-12 before:rounded-full before:bg-white/55 before:content-['']",
        props.size === "sm"
          ? "h-7 px-2.5 text-xs before:hidden after:-bottom-1 after:left-2.5 after:size-2.5"
          : "h-8 px-3 text-sm after:-bottom-1.5 after:left-3 after:size-3",
      )}
    >
      {props.children}
    </span>
  );
}

/** A small rounded label, such as Mission or Working. `paper` is a white chip for neutral labels. */
export function RemixChip(props: {
  readonly tone: RemixTone;
  readonly variant?: "fill" | "wash" | "paper";
  readonly children: ReactNode;
}) {
  return (
    <span
      data-remix-tone={props.tone}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border-(length:--remix-line-thin) border-(--remix-ink) px-2 text-xs font-semibold whitespace-nowrap tabular-nums",
        props.variant === "wash"
          ? "bg-(--tone-wash) text-(--remix-text)"
          : props.variant === "paper"
            ? "bg-(--remix-surface) text-(--remix-text)"
            : "bg-(--tone) text-(--tone-on)",
      )}
    >
      {props.children}
    </span>
  );
}

export function RemixIconTile(props: {
  readonly tone: RemixTone;
  readonly size?: "sm" | "md" | "lg";
  readonly children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      data-remix-tone={props.tone}
      className={cn(
        "flex shrink-0 items-center justify-center bg-(--tone) text-(--tone-on)",
        props.size === "lg"
          ? "size-9 rounded-xl border-2 border-(--remix-ink) shadow-(--remix-lift) [&_svg]:size-4"
          : props.size === "md"
            ? "size-7 rounded-lg border-(length:--remix-line-thin) border-(--remix-ink) [&_svg]:size-3.5"
            : "size-5 rounded-md shadow-(--remix-tile-shade) [&_svg]:size-3",
      )}
    >
      {props.children}
    </span>
  );
}

type RemixButtonVariant = "paper" | "go" | "active";

/**
 * A softly outlined button that presses down slightly. `go` is the page's main action and `active`
 * marks the selected tab or option.
 */
export function RemixButton({
  variant = "paper",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  readonly variant?: RemixButtonVariant;
  readonly size?: "sm" | "md" | "icon";
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-(--remix-card-line) font-semibold whitespace-nowrap shadow-(--remix-card-lift) outline-none transition-[translate,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-inset active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-55 [&_svg]:shrink-0",
        size === "sm"
          ? "h-6 px-2 text-xs [&_svg]:size-3"
          : size === "icon"
            ? "size-8 [&_svg]:size-3.5"
            : "h-8 px-3 text-sm [&_svg]:size-3.5",
        variant === "go"
          ? "bg-(--remix-spray) text-(--remix-ink) hover:bg-(--remix-spray-hover) focus-visible:ring-(--remix-ink)"
          : variant === "active"
            ? "bg-(--remix-blue) text-white focus-visible:ring-white/90"
            : "bg-(--remix-surface) text-(--remix-text) hover:bg-(--remix-paper-hover) focus-visible:ring-(--remix-blue)",
        className,
      )}
    />
  );
}

/**
 * A page tab: a paper button, or the blue one when it is the page you're on. Inside a narrow
 * `@container` the label drops to icon-only so the tabs never run under the header's actions.
 * `iconOnly` tabs always hide the label and name themselves in a tooltip instead.
 */
export function RemixTab(props: {
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly badge?: ReactNode;
  readonly iconOnly?: boolean;
  readonly onClick: () => void;
}) {
  const tabProps = {
    variant: props.active ? ("active" as const) : ("paper" as const),
    "aria-current": props.active ? ("page" as const) : undefined,
    onClick: props.onClick,
  };
  const content = (
    <>
      {props.icon}
      <span className={props.iconOnly === true ? "sr-only" : "@max-3xl:sr-only"}>
        {props.label}
      </span>
      {props.badge}
    </>
  );
  if (props.iconOnly !== true) return <RemixButton {...tabProps}>{content}</RemixButton>;
  return (
    <Tooltip>
      <TooltipTrigger render={<RemixButton {...tabProps} />}>{content}</TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * A page or dialog heading: a large icon tile beside the title. Dialogs pass their DialogTitle
 * and DialogDescription so the accessible names stay wired up.
 */
export function RemixHeading(props: {
  readonly icon: ReactNode;
  readonly tone: RemixTone;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <RemixIconTile tone={props.tone} size="lg">
        {props.icon}
      </RemixIconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {props.title}
        {typeof props.description === "string" ? (
          <span className="text-sm opacity-75">{props.description}</span>
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

/** Large page title used with RemixHeading outside dialogs. */
export function RemixTitle(props: { readonly children: ReactNode }) {
  return <h2 className="text-xl font-semibold">{props.children}</h2>;
}

/** A toned block of related fields, led by its label, for long dialogs. */
export function RemixFieldGroup(props: {
  readonly label: string;
  readonly tone: RemixTone;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div
      data-remix-tone={props.tone}
      className="flex min-w-0 flex-col gap-4 rounded-xl border-(length:--remix-line-thin) border-(--tone-shell) bg-(--tone-wash) p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <RemixChip tone={props.tone}>{props.label}</RemixChip>
        {props.action}
      </div>
      {props.children}
    </div>
  );
}
