import { useAtomValue } from "@effect/atom-react";
import { MAX_AGENT_MEMORY_CHARS } from "@t3tools/contracts";
import type {
  BoardAgent,
  BoardAgentId,
  BoardDepartmentId,
  BoardSkillId,
  BoardSnapshot,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  RuntimeMode,
} from "@t3tools/contracts";
import { CrownIcon, UserRoundIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { AgentName } from "./AgentAvatar";
import type { RunBoardCommand } from "./BoardPage";
import { EMPLOYEE_PRESETS, departmentNamed } from "./board.logic";
import { FACES, faceFor } from "./faces";
import { OFFICE_CARD, OfficeFieldGroup, OfficeHeading } from "./OfficeSurface";
import { TokenLimitField } from "./TokenLimitField";

export interface AgentDraft {
  readonly id: BoardAgentId | null;
  readonly name: string;
  readonly title: string;
  readonly avatar: string;
  readonly departmentId: BoardDepartmentId | null;
  readonly reportsToAgentId: BoardAgentId | null;
  readonly skillIds: ReadonlyArray<BoardSkillId>;
  readonly instructions: string;
  readonly memory: string;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly paused: boolean;
  readonly monthlyTokenLimit: number | null;
}

export function draftFromAgent(agent: BoardAgent): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    avatar: faceFor(agent)?.key ?? "",
    departmentId: agent.departmentId,
    reportsToAgentId: agent.reportsToAgentId,
    skillIds: agent.skillIds,
    instructions: agent.instructions,
    memory: agent.memory,
    modelSelection: agent.modelSelection,
    runtimeMode: agent.runtimeMode,
    paused: agent.paused,
    monthlyTokenLimit: agent.monthlyTokenLimit,
  };
}

/** A new employee under `manager`, in the manager's department and on its model. */
export function newEmployeeDraft(manager: BoardAgent | null): AgentDraft {
  return {
    id: null,
    name: "",
    title: "",
    avatar: "",
    departmentId: manager?.departmentId ?? null,
    reportsToAgentId: manager?.id ?? null,
    skillIds: [],
    instructions: "",
    memory: "",
    modelSelection: manager?.modelSelection ?? null,
    runtimeMode: "full-access",
    paused: false,
    monthlyTokenLimit: null,
  };
}

/** Model choices for an environment, with the default a new agent should start on. */
export function useModelChoices(environmentId: EnvironmentId, projectId: ProjectId | null) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const project =
    useProjects().find(
      (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
    ) ?? null;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, projectId);
  return {
    settings,
    providers,
    instanceEntries,
    defaultModel: scheduledTaskDefaultModel(settings, project, instanceEntries),
  };
}

export function ModelField(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly value: ModelSelection | null;
  readonly disabled?: boolean;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const choices = useModelChoices(props.environmentId, props.projectId);
  const selection = props.value ?? choices.defaultModel;
  const activeInstanceId =
    selection?.instanceId ?? choices.instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = selection?.model ?? "";
  return (
    <ProviderModelPicker
      environmentId={props.environmentId}
      disabled={props.disabled ?? false}
      activeInstanceId={activeInstanceId}
      model={activeModel}
      lockedProvider={null}
      instanceEntries={choices.instanceEntries}
      modelOptionsByInstance={getCustomModelOptionsByInstance(
        choices.settings,
        choices.providers,
        activeInstanceId,
        activeModel,
      )}
      isComposerOwned={false}
      triggerClassName="min-w-0 max-w-none shrink-0"
      onInstanceModelChange={(instanceId, model) => props.onChange({ instanceId, model })}
    />
  );
}

export function PermissionsField(props: {
  readonly value: RuntimeMode;
  readonly onChange: (mode: RuntimeMode) => void;
}) {
  return (
    <Select value={props.value} onValueChange={(value) => props.onChange(value as RuntimeMode)}>
      <SelectTrigger size="sm">
        <SelectValue>{runtimeModeConfig[props.value].label}</SelectValue>
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
  );
}

export function AgentDialog(props: {
  readonly draft: AgentDraft | null;
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly runCommand: RunBoardCommand;
}) {
  return (
    <Dialog
      open={props.draft !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        {props.draft !== null ? (
          <AgentForm key={props.draft.id ?? "new"} {...props} draft={props.draft} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function AgentForm(props: {
  readonly draft: AgentDraft;
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly runCommand: RunBoardCommand;
}) {
  const { snapshot } = props;
  const company = snapshot.company;
  const [draft, setDraft] = useState(props.draft);
  const [saving, setSaving] = useState(false);
  const [limitValid, setLimitValid] = useState(true);
  const choices = useModelChoices(props.environmentId, company?.projectId ?? null);
  const isCeo = company !== null && draft.id !== null && company.ceoAgentId === draft.id;
  const selection = draft.modelSelection ?? choices.defaultModel;
  // A manager cannot report to itself or to anyone beneath it.
  const below = new Set<BoardAgentId>();
  if (draft.id !== null) {
    const queue: Array<BoardAgentId> = [draft.id];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const agent of snapshot.agents) {
        if (agent.reportsToAgentId === current && !below.has(agent.id)) {
          below.add(agent.id);
          queue.push(agent.id);
        }
      }
    }
  }
  const managers = snapshot.agents.filter((agent) => agent.id !== draft.id && !below.has(agent.id));
  const manager = managers.find((agent) => agent.id === draft.reportsToAgentId) ?? null;
  const departments = company?.departments ?? [];
  const department = departments.find((candidate) => candidate.id === draft.departmentId) ?? null;
  const canSave =
    company !== null &&
    draft.name.trim().length > 0 &&
    department !== null &&
    selection !== null &&
    limitValid &&
    !saving;

  const applyPreset = (title: string) => {
    const preset = EMPLOYEE_PRESETS.find((candidate) => candidate.title === title);
    if (preset === undefined) return;
    setDraft({
      ...draft,
      title: preset.title,
      name: draft.name.trim().length > 0 ? draft.name : preset.name,
      departmentId: departmentNamed(departments, preset.department) ?? draft.departmentId,
      instructions: preset.instructions,
      skillIds: snapshot.skills
        .filter((skill) => preset.skills.includes(skill.name))
        .map((skill) => skill.id),
    });
  };

  const save = async () => {
    if (company === null || selection === null) return;
    setSaving(true);
    const saved = await props.runCommand({
      type: "agent.upsert",
      agent: {
        ...(draft.id === null ? {} : { id: draft.id }),
        companyId: company.id,
        name: draft.name.trim(),
        title: draft.title.trim(),
        avatar: draft.avatar,
        ...(department === null ? {} : { departmentId: department.id }),
        reportsToAgentId: isCeo ? null : draft.reportsToAgentId,
        skillIds: draft.skillIds,
        instructions: draft.instructions,
        memory: draft.memory,
        modelSelection: selection,
        runtimeMode: draft.runtimeMode,
        paused: draft.paused,
        monthlyTokenLimit: draft.monthlyTokenLimit,
      },
    });
    setSaving(false);
    if (saved !== null) props.onClose();
  };

  return (
    <>
      <DialogHeader>
        <OfficeHeading
          icon={isCeo ? <CrownIcon /> : <UserRoundIcon />}
          tone="indigo"
          title={
            <DialogTitle>
              {isCeo ? "Edit CEO" : draft.id === null ? "Add employee" : `Edit ${props.draft.name}`}
            </DialogTitle>
          }
          description={
            <DialogDescription>
              {isCeo
                ? "The CEO takes the board's tasks and delegates them to the company."
                : "Employees work the tasks their manager assigns, using their skills and instructions."}
            </DialogDescription>
          }
        />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <OfficeFieldGroup label="Identity" tone="indigo">
            {draft.id === null ? (
              <div className="flex flex-wrap gap-2">
                {EMPLOYEE_PRESETS.map((preset) => (
                  <Button
                    key={preset.title}
                    size="xs"
                    variant={draft.title === preset.title ? "default" : "outline"}
                    onClick={() => applyPreset(preset.title)}
                  >
                    {preset.title}
                  </Button>
                ))}
              </div>
            ) : null}
            <FacePicker
              value={draft.avatar}
              name={draft.name}
              onChange={(avatar) => setDraft({ ...draft, avatar })}
            >
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
                <Label htmlFor="board-agent-title">Role</Label>
                <Input
                  id="board-agent-title"
                  value={isCeo ? "CEO" : draft.title}
                  disabled={isCeo}
                  placeholder="Backend engineer"
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label>Department</Label>
                <Select
                  value={draft.departmentId ?? ""}
                  onValueChange={(value) =>
                    setDraft({ ...draft, departmentId: (value as BoardDepartmentId) || null })
                  }
                >
                  <SelectTrigger size="sm">
                    <SelectValue>{department?.name ?? "Choose a department"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {departments.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id} label={candidate.name}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label>Reports to</Label>
                {isCeo ? (
                  <span className="flex min-h-8 items-center text-sm text-muted-foreground sm:min-h-7">
                    The board (you)
                  </span>
                ) : (
                  <Select
                    value={draft.reportsToAgentId ?? ""}
                    onValueChange={(value) =>
                      setDraft({ ...draft, reportsToAgentId: (value as BoardAgentId) || null })
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue>
                        {manager === null ? (
                          "Choose a manager"
                        ) : (
                          <AgentName agent={manager}>
                            {manager.name}
                            {manager.title ? ` · ${manager.title}` : ""}
                          </AgentName>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {managers.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id} label={agent.name}>
                          <AgentName agent={agent}>
                            {agent.name}
                            {agent.title ? ` · ${agent.title}` : ""}
                          </AgentName>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                )}
              </div>
            </FacePicker>
          </OfficeFieldGroup>
          <OfficeFieldGroup label="Model" tone="sky">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Label>Model</Label>
                <ModelField
                  environmentId={props.environmentId}
                  projectId={company?.projectId ?? null}
                  value={draft.modelSelection}
                  disabled={saving}
                  onChange={(modelSelection) => setDraft({ ...draft, modelSelection })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label>Permissions</Label>
                <PermissionsField
                  value={draft.runtimeMode}
                  onChange={(runtimeMode) => setDraft({ ...draft, runtimeMode })}
                />
              </div>
            </div>
            {draft.runtimeMode !== "full-access" ? (
              <span className="text-xs text-muted-foreground">
                Board agents run unattended. With this mode they pause in their thread until you
                approve each prompt.
              </span>
            ) : null}
          </OfficeFieldGroup>
          <OfficeFieldGroup label="Skills" tone="violet">
            {snapshot.skills.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                The company has no skills yet. Add them on the Skills tab.
              </span>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {snapshot.skills.map((skill) => {
                  const checked = draft.skillIds.includes(skill.id);
                  return (
                    <label
                      key={skill.id}
                      className={cn(
                        OFFICE_CARD,
                        "cursor-pointer flex-row items-start gap-3 p-3 hover:shadow-md",
                      )}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        onCheckedChange={(next) =>
                          setDraft({
                            ...draft,
                            skillIds:
                              next === true
                                ? [...draft.skillIds, skill.id]
                                : draft.skillIds.filter((id) => id !== skill.id),
                          })
                        }
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">{skill.name}</span>
                        {skill.description ? (
                          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                            {skill.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </OfficeFieldGroup>
          <OfficeFieldGroup label="Limits" tone="amber">
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <TokenLimitField
                id="board-agent-token-limit"
                label="Monthly token limit"
                value={draft.monthlyTokenLimit}
                used={
                  snapshot.usage === null || draft.id === null
                    ? null
                    : (snapshot.usage.agents.find((row) => row.agentId === draft.id)?.tokens ?? 0)
                }
                onChange={(monthlyTokenLimit) => setDraft({ ...draft, monthlyTokenLimit })}
                onValidityChange={setLimitValid}
              />
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="board-agent-paused">Paused</Label>
                  <span className="text-xs text-muted-foreground">
                    Paused agents keep their tasks but are not started
                  </span>
                </div>
                <Switch
                  id="board-agent-paused"
                  checked={draft.paused}
                  onCheckedChange={(paused) => setDraft({ ...draft, paused })}
                />
              </div>
            </div>
          </OfficeFieldGroup>
          <OfficeFieldGroup label="Instructions" tone="gray">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-agent-instructions">Standing instructions</Label>
              <Textarea
                id="board-agent-instructions"
                value={draft.instructions}
                rows={6}
                placeholder="What this agent owns, how it works, what it must never do"
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="board-agent-memory">Memory</Label>
                <MemoryCount length={draft.memory.length} limit={MAX_AGENT_MEMORY_CHARS} />
              </div>
              <Textarea
                id="board-agent-memory"
                value={draft.memory}
                rows={5}
                placeholder="Lessons this agent writes down between tasks appear here. You can edit or clear them."
                onChange={(event) => setDraft({ ...draft, memory: event.target.value })}
              />
            </div>
          </OfficeFieldGroup>
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button size="sm" variant="outline" onClick={props.onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSave} onClick={() => void save()}>
          {draft.id === null ? "Add to company" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A soft grey block of related fields on a white dialog, led by a small pill. */
export function MemoryCount(props: { readonly length: number; readonly limit: number }) {
  return (
    <span
      className={
        props.length > props.limit
          ? "text-xs tabular-nums text-destructive"
          : "text-xs tabular-nums text-muted-foreground"
      }
    >
      {props.length.toLocaleString()} / {props.limit.toLocaleString()}
    </span>
  );
}

/** The face beside the fields it belongs to, so the dialog reads like a profile card. */
function FacePicker(props: {
  readonly value: string;
  readonly name: string;
  readonly onChange: (key: string) => void;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = FACES.find((face) => face.key === props.value) ?? FACES[0];
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-start gap-2">
          <Label>Face</Label>
          <span className="inline-flex size-20 overflow-hidden rounded-full bg-card shadow-sm">
            {current !== undefined ? (
              <img src={current.url} alt="" className="size-full object-cover" draggable={false} />
            ) : null}
          </span>
          <Button size="xs" variant="outline" onClick={() => setOpen(!open)}>
            {open ? "Done" : "Change face"}
          </Button>
        </div>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">{props.children}</div>
      </div>
      {open ? (
        <div
          role="radiogroup"
          aria-label={`Face for ${props.name || "this agent"}`}
          className={cn(OFFICE_CARD, "grid grid-cols-8 gap-2 p-3")}
        >
          {FACES.map((face) => (
            <button
              key={face.key}
              type="button"
              role="radio"
              aria-checked={face.key === current?.key}
              aria-label={face.key}
              className={
                face.key === current?.key
                  ? "overflow-hidden rounded-full bg-muted ring-2 ring-primary"
                  : "overflow-hidden rounded-full bg-muted hover:ring-2 hover:ring-foreground/20"
              }
              onClick={() => props.onChange(face.key)}
            >
              <img src={face.url} alt="" className="size-full object-cover" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
