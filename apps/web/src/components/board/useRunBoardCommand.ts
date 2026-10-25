import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";

import { boardCommand } from "../../state/board";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import type { RunBoardCommand } from "./BoardPage";

/** Runs a board command, telling the person why when the server refuses it. */
export function useRunBoardCommand(environmentId: EnvironmentId): RunBoardCommand {
  const command = useAtomCommand(boardCommand, { label: "board update" });
  return async (input) => {
    const result = await command({ environmentId, input });
    if (result._tag === "Success") return result.value;
    if (Cause.hasInterruptsOnly(result.cause)) return null;
    // The server says why it refused, such as a merge into a folder with uncommitted changes.
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "The board couldn't do that",
      ...(error instanceof Error ? { description: error.message } : {}),
    });
    return null;
  };
}
