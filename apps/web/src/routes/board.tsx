import type { BoardCompanyId, BoardTaskId, EnvironmentId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { BoardPage, type BoardTab } from "../components/board/BoardPage";

// Branded like every other route's ids: search types merge across routes, and a plain string
// here would widen `environmentId` for the pages that read it.
export interface BoardSearch {
  readonly environmentId?: EnvironmentId;
  readonly company?: BoardCompanyId;
  readonly card?: BoardTaskId;
  readonly tab?: BoardTab;
}

const BOARD_TABS: ReadonlyArray<BoardTab> = [
  "board",
  "inbox",
  "dashboard",
  "timeline",
  "worktrees",
  "org",
  "skills",
  "routines",
];

const searchString = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;

export const Route = createFileRoute("/board")({
  validateSearch: (raw: Record<string, unknown>): BoardSearch => {
    const environmentId = searchString(raw.environmentId) as EnvironmentId | undefined;
    const company = searchString(raw.company) as BoardCompanyId | undefined;
    const card = searchString(raw.card) as BoardTaskId | undefined;
    const tab = BOARD_TABS.find((candidate) => candidate === raw.tab);
    return {
      ...(environmentId === undefined ? {} : { environmentId }),
      ...(company === undefined ? {} : { company }),
      ...(card === undefined ? {} : { card }),
      ...(tab === undefined || tab === "board" ? {} : { tab }),
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
