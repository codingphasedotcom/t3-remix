import { BoardError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";

export interface BoardMergeResult {
  /** The branch the task's branch went into. */
  readonly into: string;
  /** The task's branch had nothing the checkout lacked, so nothing changed. */
  readonly alreadyMerged: boolean;
}

/**
 * Merges a task's branch into the branch the project folder has checked out, as a person would
 * at a terminal. A dirty checkout is refused rather than mixed into the merge, and a conflict is
 * backed out so the folder is left as it was.
 */
export const makeMergeTaskBranch = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  return Effect.fn("BoardShip.mergeTaskBranch")(function* (input: {
    readonly projectRoot: string;
    readonly branch: string;
    /** The ref the task started from; anything but HEAD has to be the checked-out branch. */
    readonly baseRef: string | null;
    readonly message: string;
  }) {
    const run = (operation: string, args: ReadonlyArray<string>) =>
      git.execute({
        operation: `BoardShip.${operation}`,
        cwd: input.projectRoot,
        args,
        allowNonZeroExit: true,
      });
    const refuse = (message: string) => Effect.fail(new BoardError({ message }));

    const merge = Effect.gen(function* () {
      const head = yield* run("currentBranch", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const into = head.stdout.trim();
      if (head.exitCode !== 0 || into.length === 0) {
        return yield* refuse("The project folder has no branch checked out to merge into.");
      }
      if (input.baseRef !== null && input.baseRef !== "HEAD" && input.baseRef !== into) {
        return yield* refuse(
          `This task started from ${input.baseRef}, but the project folder has ${into} checked out. Switch it to ${input.baseRef}, then merge.`,
        );
      }
      const contained = yield* run("isAncestor", [
        "merge-base",
        "--is-ancestor",
        input.branch,
        "HEAD",
      ]);
      if (contained.exitCode === 0) return { into, alreadyMerged: true } satisfies BoardMergeResult;
      // Git can merge around unrelated edits, but backing out of a conflict could lose them.
      const status = yield* run("status", ["status", "--porcelain", "--untracked-files=no"]);
      if (status.stdout.trim().length > 0) {
        return yield* refuse(
          `The project folder has uncommitted changes on ${into}. Commit or stash them, then merge.`,
        );
      }
      const merged = yield* run("merge", ["merge", "--no-edit", "-m", input.message, input.branch]);
      if (merged.exitCode === 0) return { into, alreadyMerged: false } satisfies BoardMergeResult;
      if (`${merged.stdout}\n${merged.stderr}`.includes("CONFLICT")) {
        yield* run("abortMerge", ["merge", "--abort"]);
        return yield* refuse(
          `${input.branch} conflicts with ${into}, so nothing was merged. Comment on the task to have its agent merge ${into} into its branch, or open a pull request.`,
        );
      }
      const reason = merged.stderr.trim().split("\n")[0] ?? "";
      return yield* refuse(
        `Git could not merge ${input.branch} into ${into}${reason.length > 0 ? `: ${reason}` : "."}`,
      );
    });

    // Upstream branch changes in this checkout take the same lease, keyed by the real path.
    const leaseKey = yield* fileSystem
      .realPath(input.projectRoot)
      .pipe(Effect.orElseSucceed(() => input.projectRoot));
    return yield* withWorkspaceLease(leaseKey, merge);
  });
});
