import type {
  BoardAgentId,
  BoardCompanyId,
  BoardSkillId,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RuntimeMode,
} from "@t3tools/contracts";
import { useState } from "react";

import { useProjects } from "../../state/entities";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ModelField, PermissionsField, useModelChoices } from "./AgentDialog";
import type { RunBoardCommand } from "./BoardPage";
import { FACES, unusedFaceKey } from "./faces";
import {
  COMPANY_TEMPLATES,
  DEFAULT_CEO_INSTRUCTIONS,
  EMPLOYEE_PRESETS,
  SKILL_PRESETS,
} from "./board.logic";

function folderNameFor(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "company"
  );
}

export function CompanyDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly runCommand: RunBoardCommand;
  readonly onCreated: (companyId: BoardCompanyId) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        {props.open ? <CompanyForm {...props} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function CompanyForm(props: {
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly runCommand: RunBoardCommand;
  readonly onCreated: (companyId: BoardCompanyId) => void;
}) {
  const projects = useProjects().filter(
    (project) => project.environmentId === props.environmentId && project.isScratch !== true,
  );
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [workspace, setWorkspace] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState<ProjectId | null>(projects[0]?.id ?? null);
  const [ceoName, setCeoName] = useState("Morgan");
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("full-access");
  const [templateId, setTemplateId] = useState("software");
  const [progress, setProgress] = useState<string | null>(null);
  const choices = useModelChoices(props.environmentId, null);
  const selection = model ?? choices.defaultModel;
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const template = COMPANY_TEMPLATES.find((candidate) => candidate.id === templateId);
  const canCreate =
    name.trim().length > 0 &&
    ceoName.trim().length > 0 &&
    selection !== null &&
    (workspace === "new" || project !== null) &&
    progress === null;

  const create = async () => {
    if (selection === null) return;
    setProgress("Creating the company…");
    const created = await props.runCommand({
      type: "company.create",
      company: {
        name: name.trim(),
        mission: mission.trim(),
        workspace:
          workspace === "new" || project === null
            ? { type: "new", folderName: folderNameFor(name) }
            : { type: "existing", projectId: project.id },
        ceo: {
          name: ceoName.trim(),
          avatar: FACES[0]?.key ?? "",
          instructions: DEFAULT_CEO_INSTRUCTIONS,
          modelSelection: selection,
          runtimeMode,
        },
      },
    });
    const company = created?.company;
    if (company === undefined) {
      setProgress(null);
      return;
    }
    const team = template?.team ?? [];
    if (team.length > 0) {
      setProgress("Writing the starter skills…");
      const skillIds = new Map<string, BoardSkillId>();
      for (const preset of SKILL_PRESETS) {
        const result = await props.runCommand({
          type: "skill.upsert",
          skill: { companyId: company.id, ...preset },
        });
        if (result?.skill !== undefined) skillIds.set(preset.name, result.skill.id);
      }
      setProgress("Hiring the team…");
      const agentIds = new Map<string, BoardAgentId>();
      // Template hires each get a different face from the CEO and from each other.
      const faces: Array<{ readonly id: string; readonly avatar: string }> = [
        { id: "ceo", avatar: FACES[0]?.key ?? "" },
      ];
      if (company.ceoAgentId !== null) agentIds.set("CEO", company.ceoAgentId);
      for (const member of team) {
        const preset = EMPLOYEE_PRESETS.find((candidate) => candidate.title === member.title);
        if (preset === undefined) continue;
        const avatar = unusedFaceKey(faces, `${company.id}:${member.title}`);
        faces.push({ id: member.title, avatar });
        const result = await props.runCommand({
          type: "agent.upsert",
          agent: {
            companyId: company.id,
            name: preset.name,
            title: preset.title,
            avatar,
            reportsToAgentId: agentIds.get(member.reportsTo) ?? company.ceoAgentId,
            skillIds: preset.skills.flatMap((skill) => skillIds.get(skill) ?? []),
            instructions: preset.instructions,
            modelSelection: selection,
            runtimeMode,
          },
        });
        if (result?.agent !== undefined) agentIds.set(member.title, result.agent.id);
      }
    }
    setProgress(null);
    props.onCreated(company.id);
    props.onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New company</DialogTitle>
        <DialogDescription>
          A company has a CEO who takes your cards and delegates them to employees. Each company has
          its own board, org chart, and skills.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-company-name">Company name</Label>
              <Input
                id="board-company-name"
                value={name}
                autoFocus
                placeholder="Acme Labs"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-company-ceo">CEO name</Label>
              <Input
                id="board-company-ceo"
                value={ceoName}
                onChange={(event) => setCeoName(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-company-mission">Mission</Label>
            <Textarea
              id="board-company-mission"
              value={mission}
              rows={3}
              placeholder="Build the simplest invoicing app for freelancers."
              onChange={(event) => setMission(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Where the team works</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={workspace === "new" ? "secondary" : "outline"}
                onClick={() => setWorkspace("new")}
              >
                New project folder
              </Button>
              <Button
                size="sm"
                variant={workspace === "existing" ? "secondary" : "outline"}
                disabled={projects.length === 0}
                onClick={() => setWorkspace("existing")}
              >
                Existing project
              </Button>
            </div>
            {workspace === "new" ? (
              <span className="text-xs text-muted-foreground">
                Creates a project folder named “{folderNameFor(name)}”.
              </span>
            ) : (
              <Select
                value={projectId ?? ""}
                onValueChange={(value) => setProjectId(value as ProjectId)}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{project?.title ?? "Choose a project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id} label={candidate.title}>
                      {candidate.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <Label>Model for the team</Label>
              <ModelField
                environmentId={props.environmentId}
                projectId={null}
                value={model}
                onChange={setModel}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Permissions</Label>
              <PermissionsField value={runtimeMode} onChange={setRuntimeMode} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Starting team</Label>
            <div className="grid grid-cols-2 gap-2">
              {COMPANY_TEMPLATES.map((candidate) => (
                <Button
                  key={candidate.id}
                  size="sm-multiline"
                  variant={candidate.id === templateId ? "secondary" : "outline"}
                  onClick={() => setTemplateId(candidate.id)}
                >
                  <span className="flex flex-col items-start text-start">
                    <span>{candidate.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {candidate.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        {progress !== null ? (
          <span className="me-auto text-xs text-muted-foreground">{progress}</span>
        ) : null}
        <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
        <Button size="sm" disabled={!canCreate} onClick={() => void create()}>
          Create company
        </Button>
      </DialogFooter>
    </>
  );
}
