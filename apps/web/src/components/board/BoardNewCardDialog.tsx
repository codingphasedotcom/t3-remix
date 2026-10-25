import type { BoardAgentId, BoardSnapshot, BoardTaskStatus } from "@t3tools/contracts";
import { ClipboardPlusIcon, FileIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { AgentSelect } from "./AgentSelect";
import type { RunBoardCommand } from "./BoardPage";
import { mentionCandidates, type MentionCandidate } from "./boardMentions";
import { FilePicker } from "./FilePicker";
import { MentionField } from "./MentionField";
import { OFFICE_CARD, OFFICE_INSET, OfficeHeading, OfficeIconTile } from "./OfficeSurface";

export function BoardNewCardDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly snapshot: BoardSnapshot;
  readonly runCommand: RunBoardCommand;
}) {
  return props.open ? <NewCardForm {...props} /> : null;
}

function NewCardForm(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly snapshot: BoardSnapshot;
  readonly runCommand: RunBoardCommand;
}) {
  const company = props.snapshot.company;
  const agents = props.snapshot.agents;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // The board hands work to the CEO, who delegates it down the org chart.
  const [assigneeAgentId, setAssigneeAgentId] = useState<BoardAgentId | null>(
    company?.ceoAgentId ?? null,
  );
  const [assignedToUser, setAssignedToUser] = useState(false);
  // The first person @mentioned takes the card, unless an assignee was already picked.
  const [assigneeFollowsMention, setAssigneeFollowsMention] = useState(true);
  const [reviewerAgentId, setReviewerAgentId] = useState<BoardAgentId | null>(null);
  const [files, setFiles] = useState<ReadonlyArray<string>>([]);
  const [saving, setSaving] = useState(false);
  const candidates = company === null ? [] : mentionCandidates([{ ...company, members: agents }]);
  const onMention = (candidate: MentionCandidate) => {
    if (!assigneeFollowsMention) return;
    setAssigneeAgentId(candidate.agentId);
    setAssignedToUser(false);
    setAssigneeFollowsMention(false);
  };

  const reset = () => {
    setTitle("");
    setDescription("");
    setAssigneeAgentId(null);
    setAssignedToUser(false);
    setAssigneeFollowsMention(true);
    setReviewerAgentId(null);
    setFiles([]);
  };

  const create = async (status: BoardTaskStatus) => {
    if (title.trim().length === 0 || company === null) return;
    setSaving(true);
    const created = await props.runCommand({
      type: "task.create",
      task: {
        companyId: company.id,
        title: title.trim(),
        description,
        status,
        assigneeAgentId: assignedToUser ? null : assigneeAgentId,
        assignedToUser,
        reviewerAgentId: assignedToUser ? null : reviewerAgentId,
        ...(files.length > 0 ? { files } : {}),
      },
    });
    setSaving(false);
    if (created === null) return;
    reset();
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <OfficeHeading
            icon={<ClipboardPlusIcon />}
            tone="indigo"
            title={<DialogTitle>New task</DialogTitle>}
            description={
              <DialogDescription>
                Describe the outcome you want. The CEO plans it and delegates the work to the team;
                you review the result. Save it as an idea to start it later.
              </DialogDescription>
            }
          />
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <div className={OFFICE_INSET}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="board-card-title">Title</Label>
                <MentionField
                  id="board-card-title"
                  value={title}
                  autoFocus
                  placeholder="Add rate limiting to the public API"
                  candidates={candidates}
                  onMention={onMention}
                  onChange={setTitle}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="board-card-description">Description</Label>
                <MentionField
                  id="board-card-description"
                  multiline
                  value={description}
                  rows={6}
                  placeholder="What done looks like, constraints, links… Type @ to mention a role."
                  candidates={candidates}
                  onMention={onMention}
                  onChange={setDescription}
                />
              </div>
            </div>
            <div className={cn(OFFICE_INSET, "gap-2")}>
              <Label>Files</Label>
              <FilePicker onAdd={(paths) => setFiles([...new Set([...files, ...paths])])}>
                {files.map((file) => (
                  <div key={file} className={cn(OFFICE_CARD, "flex-row items-center gap-3 p-3")}>
                    <OfficeIconTile tone="gray">
                      <FileIcon />
                    </OfficeIconTile>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{file}</span>
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={`Remove ${file}`}
                      onClick={() => setFiles(files.filter((candidate) => candidate !== file))}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </FilePicker>
              <span className="text-xs text-muted-foreground">
                Agents use the files where they are on this computer; nothing is uploaded.
              </span>
            </div>
            <div className={cn(OFFICE_INSET, "grid grid-cols-2 gap-3")}>
              <div className="flex flex-col gap-2">
                <Label>Assignee</Label>
                <AgentSelect
                  agents={agents}
                  value={assigneeAgentId}
                  you={{
                    selected: assignedToUser,
                    onSelect: () => {
                      setAssignedToUser(true);
                      setAssigneeFollowsMention(false);
                    },
                  }}
                  onChange={(agentId) => {
                    setAssigneeAgentId(agentId);
                    setAssignedToUser(false);
                    setAssigneeFollowsMention(false);
                  }}
                />
              </div>
              {/* No agent touches a card you keep, so nobody reviews it but you. */}
              {assignedToUser ? null : (
                <div className="flex flex-col gap-2">
                  <Label>Reviewer</Label>
                  <AgentSelect
                    agents={agents}
                    value={reviewerAgentId}
                    noneLabel="The board (you)"
                    onChange={setReviewerAgentId}
                  />
                </div>
              )}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
          <Button
            variant="outline"
            size="sm"
            disabled={saving || title.trim().length === 0}
            onClick={() => void create("backlog")}
          >
            Save as idea
          </Button>
          <Button
            size="sm"
            disabled={
              saving || title.trim().length === 0 || (assigneeAgentId === null && !assignedToUser)
            }
            onClick={() => void create("todo")}
          >
            {assignedToUser ? "Add to To do" : "Add and start"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
