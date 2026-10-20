import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { agentInitials } from "./board.logic";

export function AgentAvatar(props: {
  readonly name: string;
  readonly title: string;
  readonly muted?: boolean;
  readonly size?: "sm" | "lg";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${props.title}: ${props.name}`}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
              props.size === "lg" ? "size-9 text-xs" : "size-6 text-3xs",
              props.muted ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            {agentInitials(props.name)}
          </span>
        }
      />
      <TooltipPopup side="top">
        {props.title}: {props.name}
      </TooltipPopup>
    </Tooltip>
  );
}
