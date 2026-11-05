// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ChatAttachmentId, ThreadId, type ChatAttachment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as BoardAttachments from "./BoardAttachments.ts";

const layer = BoardAttachments.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-board-files-" })),
  Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  Layer.provideMerge(NodeServices.layer),
);

const stageUpload = Effect.fn("test.stageUpload")(function* (
  type: ChatAttachment["type"],
  name: string,
) {
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const id = createPendingAttachmentId(type === "file" ? "pdf" : undefined);
  const bytes = `contents of ${name}`;
  const path = NodePath.join(attachmentsDir, `${id}.${type === "file" ? "pdf" : "png"}`);
  NodeFS.mkdirSync(attachmentsDir, { recursive: true });
  NodeFS.writeFileSync(path, bytes);
  // Text already extracted at upload, so nothing has to parse the fake PDF.
  if (type === "file") NodeFS.writeFileSync(`${path}.txt`, `text of ${name}`);
  return {
    type,
    id: ChatAttachmentId.make(id),
    name,
    mimeType: type === "file" ? "application/pdf" : "image/png",
    sizeBytes: bytes.length,
  } as ChatAttachment;
});

it.effect("keeps a comment's files and gives each thread a copy it may delete", () =>
  Effect.gen(function* () {
    const files = yield* BoardAttachments.BoardAttachments;
    const picture = yield* stageUpload("image", "checkout.png");
    const spec = yield* stageUpload("file", "spec.pdf");
    const uploadPath = files.pathOf(picture)!;

    const kept = yield* files.claim([picture, spec]);
    assert.deepEqual(
      kept.map((file) => parseThreadSegmentFromAttachmentId(file.id)),
      ["board", "board"],
    );
    assert.isFalse(NodeFS.existsSync(uploadPath));

    const thread = ThreadId.make("board-thread:7f3c");
    const copies = yield* files.copyToThread(thread, kept);
    assert.lengthOf(copies, 2);
    for (const [index, copy] of copies.entries()) {
      assert.equal(parseThreadSegmentFromAttachmentId(copy.id), "board-thread-7f3c");
      assert.equal(NodeFS.readFileSync(files.pathOf(copy)!, "utf8"), `contents of ${copy.name}`);
      assert.notEqual(files.pathOf(copy), files.pathOf(kept[index]!));
    }
    assert.isTrue(files.pathOf(copies[1]!)!.endsWith(".pdf"));
    assert.equal(
      NodeFS.readFileSync(`${files.pathOf(copies[1]!)!}.txt`, "utf8"),
      "text of spec.pdf",
    );

    // A thread deleting its copies leaves the board's.
    yield* files.remove(copies);
    assert.isTrue(NodeFS.existsSync(files.pathOf(kept[0]!)!));
    assert.isFalse(NodeFS.existsSync(files.pathOf(copies[0]!)!));

    // Only fresh uploads can be attached: a thread's file would be deleted with the task.
    const reused = yield* files.claim([copies[0]!]).pipe(Effect.flip);
    assert.include(reused.message, "Upload each file again");
  }).pipe(Effect.provide(layer)),
);
