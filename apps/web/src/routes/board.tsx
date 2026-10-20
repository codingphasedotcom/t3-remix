import type { BoardTaskId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { BoardPage } from "../components/board/BoardPage";

// Branded like every other route's ids: search types merge across routes, and a plain string
// here would widen `environmentId` for the pages that read it.
interface BoardSearch {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly card?: BoardTaskId;
}

const searchString = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;

export const Route = createFileRoute("/board")({
  validateSearch: (raw: Record<string, unknown>): BoardSearch => {
    const environmentId = searchString(raw.environmentId) as EnvironmentId | undefined;
    const projectId = searchString(raw.projectId) as ProjectId | undefined;
    const card = searchString(raw.card) as BoardTaskId | undefined;
    return {
      ...(environmentId === undefined ? {} : { environmentId }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(card === undefined ? {} : { card }),
    };
  },
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: BoardRoute,
});

function BoardRoute() {
  return <BoardPage {...Route.useSearch()} />;
}
