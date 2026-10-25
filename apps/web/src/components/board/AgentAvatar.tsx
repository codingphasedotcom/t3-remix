import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { agentInitials } from "./board.logic";
import { faceFor } from "./faces";

type FaceAgent = { readonly id: string; readonly avatar: string };
type FaceSize = "xs" | "sm" | "lg";

function faceClassName(input: {
  readonly hasFace: boolean;
  readonly size: FaceSize;
  readonly muted: boolean;
}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
    input.size === "lg"
      ? "size-9 text-xs"
      : input.size === "xs"
        ? "size-5 text-3xs"
        : "size-6 text-3xs",
    input.hasFace
      ? "bg-muted ring-1 ring-border"
      : input.muted
        ? "bg-muted text-muted-foreground"
        : "bg-primary text-primary-foreground",
    input.muted && input.hasFace && "opacity-60 grayscale",
  );
}

function FaceContent(props: { readonly agent: FaceAgent | undefined; readonly name: string }) {
  const face = props.agent === undefined ? null : faceFor(props.agent);
  return face !== null ? (
    <img src={face.url} alt="" className="size-full object-cover" draggable={false} />
  ) : (
    agentInitials(props.name)
  );
}

/** A face on its own, for when the name sits right beside it. */
export function AgentFace(props: {
  readonly agent?: FaceAgent | undefined;
  readonly name: string;
  readonly size?: FaceSize;
  readonly muted?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={faceClassName({
        hasFace: props.agent !== undefined && faceFor(props.agent) !== null,
        size: props.size ?? "sm",
        muted: props.muted ?? false,
      })}
    >
      <FaceContent agent={props.agent} name={props.name} />
    </span>
  );
}

/** A face that names its person in a tooltip, for when the name isn't shown. */
export function AgentAvatar(props: {
  readonly agent?: FaceAgent | undefined;
  readonly name: string;
  readonly title: string;
  readonly muted?: boolean;
  readonly size?: FaceSize;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${props.title}: ${props.name}`}
            className={faceClassName({
              hasFace: props.agent !== undefined && faceFor(props.agent) !== null,
              size: props.size ?? "sm",
              muted: props.muted ?? false,
            })}
          >
            <FaceContent agent={props.agent} name={props.name} />
          </span>
        }
      />
      <TooltipPopup side="top">
        {props.title}: {props.name}
      </TooltipPopup>
    </Tooltip>
  );
}

/** An employee's face beside their name, which is how T3 Office names people. */
export function AgentName(props: {
  readonly agent: FaceAgent & { readonly name: string; readonly paused?: boolean };
  readonly size?: FaceSize;
  readonly className?: string;
  /** Replaces the plain name, such as "Grace · CTO". */
  readonly children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle",
        props.className,
      )}
    >
      <AgentFace
        agent={props.agent}
        name={props.agent.name}
        size={props.size ?? "xs"}
        muted={props.agent.paused ?? false}
      />
      <span className="min-w-0 truncate">{props.children ?? props.agent.name}</span>
    </span>
  );
}
