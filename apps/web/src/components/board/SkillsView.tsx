import type { BoardSkill, BoardSkillId, BoardSnapshot } from "@t3tools/contracts";
import { PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { AgentName } from "./AgentAvatar";
import type { RunBoardCommand } from "./BoardPage";
import { SKILL_PRESETS } from "./board.logic";
import {
  OFFICE_CARD,
  OFFICE_INSET,
  OFFICE_PANEL,
  OfficeHeading,
  OfficeIconTile,
  OfficePill,
  OfficeTitle,
} from "./OfficeSurface";

interface SkillDraft {
  readonly id: BoardSkillId | null;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

const EMPTY_SKILL: SkillDraft = { id: null, name: "", description: "", instructions: "" };

export function SkillsView(props: {
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
}) {
  const { snapshot } = props;
  const company = snapshot.company;
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  if (company === null) return null;
  const missingPresets = SKILL_PRESETS.filter(
    (preset) => !snapshot.skills.some((skill) => skill.name === preset.name),
  );

  const remove = async (skill: BoardSkill) => {
    const message = `Delete the "${skill.name}" skill?\nAgents that have it lose it.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await props.runCommand({ type: "skill.delete", id: skill.id });
  };

  const addPresets = async () => {
    for (const preset of missingPresets) {
      await props.runCommand({ type: "skill.upsert", skill: { companyId: company.id, ...preset } });
    }
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-8">
        <OfficeHeading
          icon={<SparklesIcon />}
          tone="indigo"
          title={<OfficeTitle>Skill library</OfficeTitle>}
          description="A skill is a reusable playbook. Agents get the instructions of every skill you give them on each task they work."
          actions={
            <>
              {missingPresets.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.canOperate}
                  onClick={() => void addPresets()}
                >
                  Add starter skills
                </Button>
              ) : null}
              <Button size="sm" disabled={!props.canOperate} onClick={() => setDraft(EMPTY_SKILL)}>
                <PlusIcon />
                New skill
              </Button>
            </>
          }
        />
        <div className={OFFICE_PANEL}>
          <div className="flex px-1 pt-1">
            <OfficePill tone="indigo">Skills: {snapshot.skills.length}</OfficePill>
          </div>
          {snapshot.skills.length === 0 ? (
            <div className={cn(OFFICE_CARD, "text-sm text-muted-foreground")}>No skills yet</div>
          ) : null}
          {snapshot.skills.map((skill) => {
            const holders = snapshot.agents.filter((agent) => agent.skillIds.includes(skill.id));
            return (
              <div key={skill.id} className={cn(OFFICE_CARD, "flex-row items-start")}>
                <OfficeIconTile tone="indigo">
                  <SparklesIcon />
                </OfficeIconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-base leading-snug font-medium">{skill.name}</span>
                  {skill.description ? (
                    <span className="text-xs text-muted-foreground">{skill.description}</span>
                  ) : null}
                  <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                    {skill.instructions}
                  </p>
                  {holders.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {holders.map((agent) => (
                        <Badge key={agent.id} variant="secondary" size="sm">
                          <AgentName agent={agent} />
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${skill.name}`}
                    disabled={!props.canOperate}
                    onClick={() =>
                      setDraft({
                        id: skill.id,
                        name: skill.name,
                        description: skill.description,
                        instructions: skill.instructions,
                      })
                    }
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost-destructive"
                    aria-label={`Delete ${skill.name}`}
                    disabled={!props.canOperate}
                    onClick={() => void remove(skill)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogPopup className="max-w-xl">
          {draft !== null ? (
            <SkillForm
              key={draft.id ?? "new"}
              draft={draft}
              onSave={async (next) => {
                const saved = await props.runCommand({
                  type: "skill.upsert",
                  skill: {
                    ...(next.id === null ? {} : { id: next.id }),
                    companyId: company.id,
                    name: next.name.trim(),
                    description: next.description.trim(),
                    instructions: next.instructions,
                  },
                });
                if (saved !== null) setDraft(null);
              }}
              onCancel={() => setDraft(null)}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </ScrollArea>
  );
}

function SkillForm(props: {
  readonly draft: SkillDraft;
  readonly onSave: (draft: SkillDraft) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.draft);
  const [saving, setSaving] = useState(false);
  return (
    <>
      <DialogHeader>
        <OfficeHeading
          icon={<SparklesIcon />}
          tone="indigo"
          title={<DialogTitle>{draft.id === null ? "New skill" : "Edit skill"}</DialogTitle>}
          description={
            <DialogDescription>
              Write it like a playbook: when it applies, how to do the work well, and how to check
              it.
            </DialogDescription>
          }
        />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <div className={OFFICE_INSET}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-skill-name">Name</Label>
              <Input
                id="board-skill-name"
                value={draft.name}
                autoFocus
                placeholder="Stripe payments"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-skill-description">Summary</Label>
              <Input
                id="board-skill-description"
                value={draft.description}
                placeholder="One line on what this skill is for"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
          </div>
          <div className={OFFICE_INSET}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-skill-instructions">Instructions</Label>
              <Textarea
                id="board-skill-instructions"
                value={draft.instructions}
                rows={10}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
            </div>
          </div>
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button size="sm" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving || draft.name.trim().length === 0}
          onClick={async () => {
            setSaving(true);
            await props.onSave(draft);
            setSaving(false);
          }}
        >
          Save skill
        </Button>
      </DialogFooter>
    </>
  );
}
