import { useAtomValue } from "@effect/atom-react";
import type {
  BoardAgent,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  RuntimeMode,
} from "@t3tools/contracts";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { AgentAvatar, type RunBoardCommand } from "./BoardPage";

interface AgentPreset {
  readonly name: string;
  readonly role: string;
  readonly instructions: string;
}

const AGENT_PRESETS: ReadonlyArray<AgentPreset> = [
  {
    name: "Lead",
    role: "Tech lead",
    instructions:
      'You plan and delegate. Read the card, inspect the codebase, and split the work into small, independently verifiable subtasks with clear done criteria. Create them with board_create_task in "todo", assign each to the best-suited teammate, and set a reviewer. Then move your own card to "blocked" until the subtasks are done. When you resume, check the combined result and move your card to "review". Do not implement large changes yourself.',
  },
  {
    name: "Builder",
    role: "Software engineer",
    instructions:
      "You implement cards end to end: read the relevant code first, make focused changes that match the codebase's style, add or update tests, and run the checks that cover your change. Commit your work on the card's branch with a clear message. Comment what you changed and how you verified it before moving the card to \"review\".",
  },
  {
    name: "Reviewer",
    role: "Code reviewer",
    instructions:
      "You review completed cards. Check the diff for correctness bugs, missing edge cases, missing tests, and changes outside the card's scope. Run the tests. Approve only work you would merge. When requesting changes, list each one concretely so the builder can act without asking.",
  },
  {
    name: "QA",
    role: "QA engineer",
    instructions:
      'You verify behavior. Exercise the change the way a user would, write regression tests for anything you break, and report reproducible failures as comments with exact steps. Move the card to "blocked" with a comment if the feature cannot be verified.',
  },
];

interface AgentDraft {
  readonly id: BoardAgent["id"] | null;
  readonly name: string;
  readonly role: string;
  readonly instructions: string;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
}

const EMPTY_DRAFT: AgentDraft = {
  id: null,
  name: "",
  role: "",
  instructions: "",
  modelSelection: null,
  runtimeMode: "full-access",
};

export function BoardTeamDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly canOperate: boolean;
  readonly runCommand: RunBoardCommand;
}) {
  const [draft, setDraft] = useState<AgentDraft | null>(null);

  const remove = async (agent: BoardAgent) => {
    const message = `Remove ${agent.name} from the team?\nTheir cards become unassigned.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await props.runCommand({ type: "agent.delete", id: agent.id });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setDraft(null);
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {draft === null ? "Team" : draft.id === null ? "New agent" : "Edit agent"}
          </DialogTitle>
          <DialogDescription>
            {draft === null
              ? "Agents are shared by every board in this environment. Only people can add agents; agents can only assign work to the team you give them."
              : "Standing instructions are added to every card this agent works or reviews."}
          </DialogDescription>
        </DialogHeader>
        {draft === null ? (
          <>
            <DialogPanel>
              <div className="flex flex-col gap-2">
                {props.agents.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    No agents yet. Start from a preset or create your own.
                  </span>
                ) : null}
                {props.agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <AgentAvatar name={agent.name} title="Agent" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{agent.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          agent.role,
                          agent.modelSelection.model,
                          runtimeModeConfig[agent.runtimeMode].label,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${agent.name}`}
                      disabled={!props.canOperate}
                      onClick={() =>
                        setDraft({
                          id: agent.id,
                          name: agent.name,
                          role: agent.role,
                          instructions: agent.instructions,
                          modelSelection: agent.modelSelection,
                          runtimeMode: agent.runtimeMode,
                        })
                      }
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-destructive"
                      aria-label={`Remove ${agent.name}`}
                      disabled={!props.canOperate}
                      onClick={() => void remove(agent)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <div className="mt-2 flex flex-wrap gap-2">
                  {AGENT_PRESETS.map((preset) => (
                    <Button
                      key={preset.name}
                      size="sm"
                      variant="outline"
                      disabled={!props.canOperate}
                      onClick={() => setDraft({ ...EMPTY_DRAFT, ...preset })}
                    >
                      <PlusIcon />
                      {preset.role}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!props.canOperate}
                    onClick={() => setDraft(EMPTY_DRAFT)}
                  >
                    <PlusIcon />
                    Custom agent
                  </Button>
                </div>
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <AgentForm
            key={draft.id ?? "new"}
            draft={draft}
            environmentId={props.environmentId}
            projectId={props.projectId}
            runCommand={props.runCommand}
            onDone={() => setDraft(null)}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function AgentForm(props: {
  readonly draft: AgentDraft;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly runCommand: RunBoardCommand;
  readonly onDone: () => void;
}) {
  const [draft, setDraft] = useState(props.draft);
  const [saving, setSaving] = useState(false);
  const settings = useEnvironmentSettings(props.environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(props.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const project =
    useProjects().find(
      (candidate) =>
        candidate.environmentId === props.environmentId && candidate.id === props.projectId,
    ) ?? null;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      props.projectId,
    ),
  );
  const selection =
    draft.modelSelection ?? scheduledTaskDefaultModel(settings, project, instanceEntries);
  const activeInstanceId =
    selection?.instanceId ?? instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = selection?.model ?? "";
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    activeInstanceId,
    activeModel,
  );
  const canSave = draft.name.trim().length > 0 && selection !== null && !saving;

  const save = async () => {
    if (selection === null) return;
    setSaving(true);
    const saved = await props.runCommand({
      type: "agent.upsert",
      agent: {
        ...(draft.id === null ? {} : { id: draft.id }),
        name: draft.name.trim(),
        role: draft.role.trim(),
        instructions: draft.instructions,
        modelSelection: selection,
        runtimeMode: draft.runtimeMode,
      },
    });
    setSaving(false);
    if (saved) props.onDone();
  };

  return (
    <>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-agent-name">Name</Label>
              <Input
                id="board-agent-name"
                value={draft.name}
                autoFocus
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-agent-role">Role</Label>
              <Input
                id="board-agent-role"
                value={draft.role}
                placeholder="Backend engineer"
                onChange={(event) => setDraft({ ...draft, role: event.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <Label>Model</Label>
              <ProviderModelPicker
                environmentId={props.environmentId}
                disabled={saving}
                activeInstanceId={activeInstanceId}
                model={activeModel}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                isComposerOwned={false}
                triggerClassName="min-w-0 max-w-none shrink-0"
                onInstanceModelChange={(instanceId, model) =>
                  setDraft({ ...draft, modelSelection: { instanceId, model } })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Permissions</Label>
              <Select
                value={draft.runtimeMode}
                onValueChange={(value) => setDraft({ ...draft, runtimeMode: value as RuntimeMode })}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{runtimeModeConfig[draft.runtimeMode].label}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {runtimeModeOptions.map((mode) => (
                    <SelectItem key={mode} value={mode} label={runtimeModeConfig[mode].label}>
                      <span className="flex flex-col">
                        <span>{runtimeModeConfig[mode].label}</span>
                        <span className="text-xs text-muted-foreground">
                          {runtimeModeConfig[mode].description}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
          {draft.runtimeMode !== "full-access" ? (
            <span className="text-xs text-muted-foreground">
              Board agents run unattended. With this mode they pause in their thread until you
              approve each prompt.
            </span>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-agent-instructions">Standing instructions</Label>
            <Textarea
              id="board-agent-instructions"
              value={draft.instructions}
              rows={8}
              placeholder="How this agent works, what it owns, what it must never do."
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button size="sm" variant="outline" onClick={props.onDone}>
          Back
        </Button>
        <Button size="sm" disabled={!canSave} onClick={() => void save()}>
          {draft.id === null ? "Add to team" : "Save agent"}
        </Button>
      </DialogFooter>
    </>
  );
}
