import type { BoardSkill, BoardSkillId, BoardSnapshot, EnvironmentId } from "@t3tools/contracts";
import {
  CheckIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
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
import { useModelChoices } from "./AgentDialog";
import type { RunBoardCommand } from "./BoardPage";
import { SKILL_PRESETS, installedSkillsFor, type InstalledSkill } from "./board.logic";
import {
  REMIX_CARD,
  REMIX_INSET,
  REMIX_SHELL,
  RemixBubble,
  RemixButton,
  RemixChip,
  RemixHeading,
  RemixIconTile,
  RemixTitle,
} from "./RemixSurface";

interface SkillDraft {
  readonly id: BoardSkillId | null;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

const EMPTY_SKILL: SkillDraft = { id: null, name: "", description: "", instructions: "" };

export function SkillsView(props: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
  /** The company's project folder, where project skills are found. */
  readonly cwd: string | null;
}) {
  const { snapshot } = props;
  const company = snapshot.company;
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const installed = installedSkillsFor(
    useModelChoices(props.environmentId, company?.projectId ?? null).instanceEntries,
    props.cwd,
  );
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-1 pb-14">
        <div className={cn(REMIX_CARD, "p-3 shadow-(--remix-card-lift)")}>
          <RemixHeading
            icon={<SparklesIcon />}
            tone="purple"
            title={<RemixTitle>Skill library</RemixTitle>}
            description="A skill is a reusable playbook. Agents get the instructions of every skill you give them on each task they work."
            actions={
              <>
                {missingPresets.length > 0 ? (
                  <RemixButton disabled={!props.canOperate} onClick={() => void addPresets()}>
                    Add starter skills
                  </RemixButton>
                ) : null}
                <RemixButton
                  variant="go"
                  disabled={!props.canOperate}
                  onClick={() => setDraft(EMPTY_SKILL)}
                >
                  <PlusIcon />
                  New skill
                </RemixButton>
              </>
            }
          />
        </div>
        <div data-remix-tone="purple" className={cn(REMIX_SHELL, "gap-2.5 p-2.5 pb-3")}>
          <div className="flex pb-1">
            <RemixBubble tone="purple" size="sm">
              Skills: {snapshot.skills.length}
            </RemixBubble>
          </div>
          {snapshot.skills.length === 0 ? (
            <div className={cn(REMIX_CARD, "text-sm text-(--remix-text-muted)")}>No skills yet</div>
          ) : null}
          {snapshot.skills.map((skill) => {
            const holders = snapshot.agents.filter((agent) => agent.skillIds.includes(skill.id));
            return (
              <div
                key={skill.id}
                className={cn(
                  REMIX_CARD,
                  "flex-row items-start border-(--tone) shadow-(--tone-lift)",
                )}
              >
                <RemixIconTile tone="purple">
                  <SparklesIcon />
                </RemixIconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm leading-snug font-semibold">
                      {skill.name}
                    </span>
                    {skill.installedPath !== null ? (
                      <RemixChip tone="teal" variant="wash">
                        Installed
                      </RemixChip>
                    ) : null}
                  </span>
                  {skill.description ? (
                    <span className="line-clamp-2 text-xs text-(--remix-text-muted)">
                      {skill.description}
                    </span>
                  ) : null}
                  {skill.installedPath !== null ? (
                    <span className="truncate font-mono text-xs text-(--remix-text-muted)">
                      {skill.installedPath}
                    </span>
                  ) : (
                    <p className="line-clamp-3 whitespace-pre-wrap text-xs text-(--remix-text-muted)">
                      {skill.instructions}
                    </p>
                  )}
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
                  {/* An installed skill is edited where it is installed. */}
                  {skill.installedPath === null ? (
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
                  ) : null}
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
        <InstalledSkills
          skills={installed}
          library={snapshot.skills}
          canOperate={props.canOperate}
          onAdd={(skill) =>
            props.runCommand({
              type: "skill.upsert",
              skill: {
                companyId: company.id,
                name: skill.name,
                description: skill.description,
                instructions: "",
                installedPath: skill.paths[0]!,
              },
            })
          }
        />
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

/** A long list gets a filter; most people have a handful of skills, some have hundreds. */
const FILTER_FROM = 8;

function InstalledSkills(props: {
  readonly skills: ReadonlyArray<InstalledSkill>;
  readonly library: ReadonlyArray<BoardSkill>;
  readonly canOperate: boolean;
  readonly onAdd: (skill: InstalledSkill) => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const wanted = query.trim().toLowerCase();
  const shown =
    wanted.length === 0
      ? props.skills
      : props.skills.filter(
          (skill) =>
            skill.name.toLowerCase().includes(wanted) ||
            skill.description.toLowerCase().includes(wanted),
        );
  const inLibrary = new Set(props.library.map((skill) => skill.installedPath));
  return (
    <>
      <div className={cn(REMIX_CARD, "p-3 shadow-(--remix-card-lift)")}>
        <RemixHeading
          icon={<PackageIcon />}
          tone="teal"
          title={<RemixTitle>Installed skills</RemixTitle>}
          description="Skills your coding agents already have on the computer this company runs on. Add one to the library, then give it to agents like any other skill."
        />
      </div>
      <div data-remix-tone="teal" className={cn(REMIX_SHELL, "gap-2.5 p-2.5 pb-3")}>
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <RemixBubble tone="teal" size="sm">
            Installed: {props.skills.length}
          </RemixBubble>
          {props.skills.length >= FILTER_FROM ? (
            <Input
              type="search"
              size="sm"
              className="ms-auto w-56"
              aria-label="Filter installed skills"
              placeholder="Filter skills"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
        </div>
        {props.skills.length === 0 ? (
          <div className={cn(REMIX_CARD, "text-sm text-(--remix-text-muted)")}>
            No installed skills found. Skills you install for Claude Code, Codex, and your other
            agents show up here.
          </div>
        ) : shown.length === 0 ? (
          <div className={cn(REMIX_CARD, "text-sm text-(--remix-text-muted)")}>
            No installed skill matches “{query.trim()}”.
          </div>
        ) : null}
        {shown.map((skill) => {
          const added = skill.paths.some((path) => inLibrary.has(path));
          return (
            <div
              key={skill.name}
              className={cn(
                REMIX_CARD,
                "flex-row items-center gap-3 border-(--tone) py-3 shadow-(--tone-lift)",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold">{skill.name}</span>
                {skill.description ? (
                  <span className="line-clamp-2 text-xs text-(--remix-text-muted)">
                    {skill.description}
                  </span>
                ) : null}
                <span className="truncate text-xs text-(--remix-text-muted)">
                  {skill.providers.join(", ")}
                </span>
              </div>
              <RemixButton
                size="sm"
                disabled={!props.canOperate || added || adding === skill.name}
                onClick={async () => {
                  setAdding(skill.name);
                  await props.onAdd(skill);
                  setAdding(null);
                }}
              >
                {added ? <CheckIcon /> : <PlusIcon />}
                {added ? "In library" : "Add"}
              </RemixButton>
            </div>
          );
        })}
      </div>
    </>
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
        <RemixHeading
          icon={<SparklesIcon />}
          tone="purple"
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
          <div className={REMIX_INSET}>
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
          <div className={REMIX_INSET}>
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
        <RemixButton onClick={props.onCancel}>Cancel</RemixButton>
        <RemixButton
          variant="go"
          disabled={saving || draft.name.trim().length === 0}
          onClick={async () => {
            setSaving(true);
            await props.onSave(draft);
            setSaving(false);
          }}
        >
          Save skill
        </RemixButton>
      </DialogFooter>
    </>
  );
}
