import {
  BoardError,
  ChatAttachmentId,
  type ChatAttachment,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import {
  createAttachmentId,
  parseAttachmentFileExtension,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as AttachmentClaims from "../orchestration-v2/AttachmentClaims.ts";
import * as DocumentText from "../provider/DocumentText.ts";

/** Comment files live in the attachments folder under this owner, outside every thread. */
const BOARD_ATTACHMENT_OWNER = "board";

/**
 * The files people attach to board comments. The board keeps its own copy, and every agent
 * thread gets a copy of its own, because deleting a thread deletes the files its messages hold.
 */
export class BoardAttachments extends Context.Service<
  BoardAttachments,
  {
    /** Takes a comment's uploads into the board's keeping. */
    readonly claim: (
      attachments: ReadonlyArray<ChatAttachment>,
    ) => Effect.Effect<ReadonlyArray<ChatAttachment>, BoardError>;
    /** Copies kept files into a thread's own attachments; a file that has gone is skipped. */
    readonly copyToThread: (
      threadId: ThreadId,
      attachments: ReadonlyArray<ChatAttachment>,
    ) => Effect.Effect<ReadonlyArray<ChatAttachment>>;
    readonly remove: (attachments: ReadonlyArray<ChatAttachment>) => Effect.Effect<void>;
    /** Where a kept file is on this machine, for agents that open files by path. */
    readonly pathOf: (attachment: ChatAttachment) => string | null;
  }
>()("t3/board/BoardAttachments") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const claimContext = yield* Effect.context<
    FileSystem.FileSystem | ServerConfig.ServerConfig | DocumentText.DocumentText
  >();
  const pathOf = (attachment: ChatAttachment) =>
    resolveAttachmentPath({ attachmentsDir, attachment });

  const removePaths = (paths: ReadonlyArray<string>) =>
    Effect.forEach(
      paths,
      (path) =>
        fileSystem
          .remove(path, { force: true })
          .pipe(Effect.andThen(fileSystem.remove(`${path}.txt`, { force: true })), Effect.ignore),
      { discard: true },
    );

  const claim = Effect.fn("BoardAttachments.claim")(function* (
    attachments: ReadonlyArray<ChatAttachment>,
  ) {
    if (attachments.length === 0) return [];
    // Only fresh uploads: an id from a thread would make the board delete that thread's file.
    if (!attachments.every(AttachmentClaims.attachmentIsPendingUpload)) {
      return yield* new BoardError({ message: "Upload each file again, then post the comment." });
    }
    const claimed = yield* AttachmentClaims.claimPendingAttachments({
      threadId: BOARD_ATTACHMENT_OWNER,
      attachments,
    }).pipe(
      Effect.provide(claimContext),
      Effect.mapError((cause) => new BoardError({ message: cause.message, cause })),
    );
    // The board holds its copies now, so the uploads need not wait for the stale sweep.
    yield* removePaths(attachments.flatMap((attachment) => pathOf(attachment) ?? []));
    return claimed.attachments;
  });

  const copyOne = Effect.fn("BoardAttachments.copyOne")(function* (
    threadId: ThreadId,
    attachment: ChatAttachment,
  ) {
    const source = pathOf(attachment);
    const extension = parseAttachmentFileExtension(attachment.id) ?? undefined;
    const id = createAttachmentId(threadId, extension);
    if (source === null || id === null) return null;
    const copy: ChatAttachment = { ...attachment, id: ChatAttachmentId.make(id) };
    const target = pathOf(copy);
    if (target === null) return null;
    yield* fileSystem.copyFile(source, target);
    // Extracted document text rides along, so agents read a PDF without converting it again.
    if (yield* fileSystem.exists(`${source}.txt`)) {
      yield* fileSystem.copyFile(`${source}.txt`, `${target}.txt`).pipe(Effect.ignore);
    }
    return copy;
  });

  const copyToThread = Effect.fn("BoardAttachments.copyToThread")(function* (
    threadId: ThreadId,
    attachments: ReadonlyArray<ChatAttachment>,
  ) {
    const copies = yield* Effect.forEach(attachments, (attachment) =>
      copyOne(threadId, attachment).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not copy a board comment's file for an agent", {
            attachmentId: attachment.id,
            cause,
          }).pipe(Effect.as(null)),
        ),
      ),
    );
    return copies.filter((copy) => copy !== null);
  });

  const remove = Effect.fn("BoardAttachments.remove")(function* (
    attachments: ReadonlyArray<ChatAttachment>,
  ) {
    yield* removePaths(attachments.flatMap((attachment) => pathOf(attachment) ?? []));
  });

  return BoardAttachments.of({ claim, copyToThread, remove, pathOf });
});

export const layer = Layer.effect(BoardAttachments, make);
