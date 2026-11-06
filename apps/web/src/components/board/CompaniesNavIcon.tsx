import { Building2Icon } from "lucide-react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useBoardInbox } from "./boardInbox";

/** The sidebar's Companies icon, with a count of what waits on the person. */
export function CompaniesNavIcon() {
  const waiting = useBoardInbox(usePrimaryEnvironmentId()).length;
  return (
    <span className="relative flex">
      <Building2Icon />
      {waiting > 0 ? (
        <span className="absolute -end-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-3xs leading-none font-semibold text-warning-foreground tabular-nums">
          {waiting > 9 ? "9+" : waiting}
          <span className="sr-only"> waiting on you</span>
        </span>
      ) : null}
    </span>
  );
}
