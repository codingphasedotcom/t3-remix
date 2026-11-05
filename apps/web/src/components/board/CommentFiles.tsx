import {
  MAX_BOARD_COMMENT_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  isProviderSendTurnSupportedImageMimeType,
  type ChatAttachment,
  type EnvironmentId,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { FileIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import type { ComposerFileAttachment, ComposerImageAttachment } from "../../composerDraftStore";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseAttachmentUpload,
  retryAttachmentUpload,
  startAttachmentUpload,
  useAttachmentUploadStore,
} from "../../lib/attachmentUploadQueue";
import { cn, randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { OFFICE_CARD } from "./OfficeSurface";

type DraftFile = ComposerImageAttachment | ComposerFileAttachment;

function draftFile(file: File): DraftFile | string {
  const id = randomUUID();
  const name = file.name.length > 0 ? file.name : "pasted image";
  if (isProviderSendTurnSupportedImageMimeType(file.type)) {
    if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return `${name} is larger than ${formatAttachmentSize(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)}.`;
    }
    return {
      type: "image",
      id,
      name,
      mimeType: file.type.toLowerCase(),
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
      file,
    };
  }
  if (file.size === 0) return `${name} is empty.`;
  if (file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
    return `${name} is larger than ${formatAttachmentSize(PROVIDER_SEND_TURN_MAX_FILE_BYTES)}.`;
  }
  return {
    type: "file",
    id,
    name,
    mimeType: file.type.length > 0 ? file.type : "application/octet-stream",
    sizeBytes: file.size,
    file,
  };
}

function forget(file: DraftFile) {
  if (file.type === "image") URL.revokeObjectURL(file.previewUrl);
}

/**
 * Files waiting to go out with a comment. Each uploads as soon as it is added, the way the chat
 * composer's do, so posting only waits for what is still on its way.
 */
export function useCommentDraftFiles(environmentId: EnvironmentId) {
  const [files, setFiles] = useState<ReadonlyArray<DraftFile>>([]);

  const add = (incoming: ReadonlyArray<File>) => {
    const room = MAX_BOARD_COMMENT_ATTACHMENTS - files.length;
    if (incoming.length > room) {
      toastManager.add({
        type: "warning",
        title: `A comment holds up to ${MAX_BOARD_COMMENT_ATTACHMENTS} files`,
      });
    }
    const added: Array<DraftFile> = [];
    for (const file of incoming.slice(0, Math.max(room, 0))) {
      const draft = draftFile(file);
      if (typeof draft === "string") {
        toastManager.add({ type: "error", title: "Could not attach the file", description: draft });
        continue;
      }
      startAttachmentUpload({ environmentId, image: draft });
      added.push(draft);
    }
    if (added.length > 0) setFiles((current) => [...current, ...added]);
  };

  const remove = (id: string) => {
    const file = files.find((candidate) => candidate.id === id);
    if (file === undefined) return;
    releaseAttachmentUpload(id);
    forget(file);
    setFiles((current) => current.filter((candidate) => candidate.id !== id));
  };

  const retry = (id: string) => {
    const file = files.find((candidate) => candidate.id === id);
    if (file !== undefined) retryAttachmentUpload({ environmentId, image: file });
  };

  /** The uploaded files, or null with a reason shown when one did not make it. */
  const collect = async (): Promise<ReadonlyArray<ChatAttachment> | null> => {
    if (files.length === 0) return [];
    await awaitAttachmentUploads(files.map((file) => file.id));
    const uploaded = getUploadedAttachments({ environmentId, images: files });
    if (uploaded === null) {
      toastManager.add({
        type: "error",
        title: "A file did not upload",
        description: "Retry it or remove it, then post again.",
      });
    }
    return uploaded;
  };

  /** After posting: the server holds the files now, so only this draft's state goes. */
  const clear = () => {
    for (const file of files) {
      releaseAttachmentUpload(file.id);
      forget(file);
    }
    setFiles([]);
  };

  return { files, add, remove, retry, collect, clear };
}

export function DraftFileChips(props: {
  readonly files: ReadonlyArray<DraftFile>;
  readonly disabled: boolean;
  readonly onRemove: (id: string) => void;
  readonly onRetry: (id: string) => void;
}) {
  const uploads = useAttachmentUploadStore((state) => state.uploadsByImageId);
  if (props.files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {props.files.map((file) => {
        const upload = uploads[file.id];
        return (
          <div
            key={file.id}
            className={cn(OFFICE_CARD, "flex-row items-center gap-2 p-1.5 pe-1 text-xs")}
          >
            {file.type === "image" ? (
              <img src={file.previewUrl} alt="" className="size-8 rounded-md object-cover" />
            ) : (
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="max-w-40 truncate">{file.name}</span>
            {upload?.status === "uploading" ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {Math.round(upload.progress * 100)}%
              </span>
            ) : upload?.status === "failed" ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={props.disabled}
                aria-label={`Retry ${file.name}: ${upload.reason}`}
                onClick={() => props.onRetry(file.id)}
              >
                <TriangleAlertIcon />
                Retry
              </Button>
            ) : null}
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={`Remove ${file.name}`}
              disabled={props.disabled}
              onClick={() => props.onRemove(file.id)}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** A posted comment's files: pictures as thumbnails, other files as links. */
export function CommentFiles(props: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}) {
  if (props.attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {props.attachments.map((attachment) => (
        <CommentFile
          key={attachment.id}
          environmentId={props.environmentId}
          attachment={attachment}
        />
      ))}
    </div>
  );
}

function CommentFile(props: {
  readonly environmentId: EnvironmentId;
  readonly attachment: ChatAttachment;
}) {
  const { attachment } = props;
  const image = attachment.type === "image";
  const url = useAssetUrlState(props.environmentId, {
    _tag: "attachment",
    attachmentId: attachment.id,
    fileName: attachment.name,
    mimeType: attachment.mimeType,
    ...(image ? { disposition: "inline" as const } : {}),
  });
  const href = url._tag === "Success" ? url.url : undefined;
  if (image) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-lg border border-border/60 bg-muted"
      >
        {href === undefined ? (
          <span className="flex size-24 items-center justify-center text-xs text-muted-foreground">
            {url._tag === "Failure" ? "Not available" : "Loading…"}
          </span>
        ) : (
          <img src={href} alt={attachment.name} className="max-h-48 max-w-64 object-contain" />
        )}
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(OFFICE_CARD, "flex-row items-center gap-2 p-2 text-xs hover:underline")}
    >
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="max-w-48 truncate font-medium">{attachment.name}</span>
      <span className="text-muted-foreground">{formatAttachmentSize(attachment.sizeBytes)}</span>
    </a>
  );
}
