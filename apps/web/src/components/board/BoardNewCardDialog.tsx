import type { BoardAgentId, BoardSnapshot, BoardTaskStatus } from "@t3tools/contracts";
import { useState } from "react";

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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { AgentSelect } from "./AgentSelect";
import type { RunBoardCommand } from "./BoardPage";

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
  const [reviewerAgentId, setReviewerAgentId] = useState<BoardAgentId | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setAssigneeAgentId(null);
    setReviewerAgentId(null);
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
        assigneeAgentId,
        reviewerAgentId,
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
          <DialogTitle>New card</DialogTitle>
          <DialogDescription>
            Describe the outcome you want. The CEO plans it and delegates the work to the team; you
            review the result. Keep it in the backlog to start it later.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-card-title">Title</Label>
              <Input
                id="board-card-title"
                value={title}
                autoFocus
                placeholder="Add rate limiting to the public API"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-card-description">Description</Label>
              <Textarea
                id="board-card-description"
                value={description}
                rows={6}
                placeholder="What done looks like, constraints, links…"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label>Assignee</Label>
                <AgentSelect
                  agents={agents}
                  value={assigneeAgentId}
                  onChange={setAssigneeAgentId}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Reviewer</Label>
                <AgentSelect
                  agents={agents}
                  value={reviewerAgentId}
                  noneLabel="The board (you)"
                  onChange={setReviewerAgentId}
                />
              </div>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
          <Button
            variant="outline"
            size="sm"
            disabled={saving || title.trim().length === 0}
            onClick={() => void create("backlog")}
          >
            Add to backlog
          </Button>
          <Button
            size="sm"
            disabled={saving || title.trim().length === 0 || assigneeAgentId === null}
            onClick={() => void create("todo")}
          >
            Add and start
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
