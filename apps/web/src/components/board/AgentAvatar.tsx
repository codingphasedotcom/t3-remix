import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { agentInitials } from "./board.logic";
import { faceFor } from "./faces";

export function AgentAvatar(props: {
  readonly agent?: { readonly id: string; readonly avatar: string } | undefined;
  readonly name: string;
  readonly title: string;
  readonly muted?: boolean;
  readonly size?: "sm" | "lg";
}) {
  const face = props.agent === undefined ? null : faceFor(props.agent);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${props.title}: ${props.name}`}
            className={cn(
              "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
              props.size === "lg" ? "size-9 text-xs" : "size-6 text-3xs",
              face !== null
                ? "bg-muted ring-1 ring-border"
                : props.muted
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground",
              props.muted && face !== null && "opacity-60 grayscale",
            )}
          >
            {face !== null ? (
              <img src={face.url} alt="" className="size-full" draggable={false} />
            ) : (
              agentInitials(props.name)
            )}
          </span>
        }
      />
      <TooltipPopup side="top">
        {props.title}: {props.name}
      </TooltipPopup>
    </Tooltip>
  );
}
