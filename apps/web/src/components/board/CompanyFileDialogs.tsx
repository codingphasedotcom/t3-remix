import {
  BoardCompanyFile,
  type BoardCompany,
  type BoardCompanyId,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { DownloadIcon, FileUpIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

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
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { ModelField, useModelChoices } from "./AgentDialog";
import type { RunBoardCommand } from "./BoardPage";
import {
  CompanyWorkspaceField,
  workspaceInput,
  type WorkspaceChoice,
} from "./CompanyWorkspaceField";
import { RemixButton, RemixFieldGroup, RemixHeading } from "./RemixSurface";

const decodeCompanyFile = Schema.decodeUnknownOption(Schema.fromJsonString(BoardCompanyFile));

const fileNameFor = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company"
  }.t3company.json`;

function download(fileName: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Saves the company's team as a file to take to another computer or share. */
export function ExportCompanyDialog(props: {
  readonly company: BoardCompany | null;
  readonly onClose: () => void;
  readonly runCommand: RunBoardCommand;
}) {
  const [includeMemory, setIncludeMemory] = useState(false);
  const [busy, setBusy] = useState(false);
  const company = props.company;

  const save = async () => {
    if (company === null) return;
    setBusy(true);
    const result = await props.runCommand({
      type: "company.export",
      id: company.id,
      includeMemory,
    });
    setBusy(false);
    if (result?.companyFile === undefined) return;
    download(fileNameFor(company.name), `${JSON.stringify(result.companyFile, null, 2)}\n`);
    props.onClose();
  };

  return (
    <Dialog open={company !== null} onOpenChange={(open) => (open ? null : props.onClose())}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <RemixHeading
            icon={<DownloadIcon />}
            tone="blue"
            title={<DialogTitle>Export {company?.name}</DialogTitle>}
            description={
              <DialogDescription>Save the team as a file to import anywhere</DialogDescription>
            }
          />
        </DialogHeader>
        <DialogPanel>
          <RemixFieldGroup label="What the file holds" tone="blue">
            <p className="text-sm text-foreground">
              Departments, every employee with their instructions, skills, and model, who reports to
              whom, routines, and the board settings. Tasks and history stay here. Installed skills
              match by name where the file is imported, and come along as their SKILL.md for
              computers that don&apos;t have them.
            </p>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="board-export-memory">Include what they remember</Label>
                <span className="text-xs text-muted-foreground">
                  The company&apos;s memory and each employee&apos;s lessons. Leave it off for a
                  file you share.
                </span>
              </div>
              <Switch
                id="board-export-memory"
                className="mt-1"
                checked={includeMemory}
                onCheckedChange={setIncludeMemory}
              />
            </div>
          </RemixFieldGroup>
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose render={<RemixButton />}>Cancel</DialogClose>
          <RemixButton variant="go" disabled={busy} onClick={() => void save()}>
            <DownloadIcon />
            {busy ? "Saving…" : "Save file"}
          </RemixButton>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Starts a company from a file someone exported. */
export function ImportCompanyDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly runCommand: RunBoardCommand;
  readonly onImported: (companyId: BoardCompanyId) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        {props.open ? <ImportForm {...props} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function ImportForm(props: {
  readonly environmentId: EnvironmentId;
  readonly runCommand: RunBoardCommand;
  readonly onImported: (companyId: BoardCompanyId) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<BoardCompanyFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceChoice>({ type: "new" });
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = useModelChoices(props.environmentId, null);
  const missingModel = (file?.agents ?? []).filter(
    (agent) =>
      !choices.instanceEntries.some(
        (entry) => entry.instanceId === agent.modelSelection.instanceId,
      ),
  );
  const fallback = model ?? choices.defaultModel;
  const home = workspaceInput(workspace, name);
  const canImport =
    file !== null &&
    name.trim().length > 0 &&
    home !== null &&
    (missingModel.length === 0 || fallback !== null) &&
    !busy;

  const pick = async (picked: File | undefined) => {
    if (picked === undefined) return;
    const decoded = decodeCompanyFile(await picked.text());
    if (Option.isNone(decoded)) {
      setFile(null);
      setProblem(`${picked.name} isn't a T3 Remix company file.`);
      return;
    }
    setProblem(null);
    setFile(decoded.value);
    setName(decoded.value.name);
    setMission(decoded.value.mission);
  };

  const importFile = async () => {
    if (file === null || home === null) return;
    setBusy(true);
    const result = await props.runCommand({
      type: "company.import",
      company: {
        file,
        name: name.trim(),
        mission: mission.trim(),
        workspace: home,
        ...(missingModel.length > 0 && fallback !== null
          ? { fallbackModelSelection: fallback }
          : {}),
      },
    });
    setBusy(false);
    if (result?.company === undefined) return;
    const missing = result.missingSkills ?? [];
    if (missing.length > 0) {
      toastManager.add({
        type: "info",
        title: `${count(missing.length, "skill isn't", "skills aren't")} installed here`,
        description: `${missing.join(", ")} came along from the file. Install ${missing.length === 1 ? "it" : "them"} to use the original.`,
      });
    }
    props.onImported(result.company.id);
  };

  return (
    <>
      <DialogHeader>
        <RemixHeading
          icon={<UploadIcon />}
          tone="teal"
          title={<DialogTitle>Import a company</DialogTitle>}
          description={<DialogDescription>Start a company from a file</DialogDescription>}
        />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <RemixFieldGroup label="File" tone="teal">
            <input
              ref={picker}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void pick(event.target.files?.[0])}
            />
            <div className="flex flex-wrap items-center gap-3">
              <RemixButton onClick={() => picker.current?.click()}>
                <FileUpIcon />
                {file === null ? "Choose file" : "Choose another"}
              </RemixButton>
              {file !== null ? (
                <span className="text-sm text-foreground">
                  {count(file.agents.length, "employee", "employees")},{" "}
                  {count(file.skills.length, "skill", "skills")},{" "}
                  {count(file.routines.length, "routine", "routines")}
                </span>
              ) : null}
            </div>
            {problem !== null ? <p className="text-sm text-destructive">{problem}</p> : null}
          </RemixFieldGroup>
          {file !== null ? (
            <>
              <RemixFieldGroup label="Company" tone="yellow">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="board-import-company-name">Name</Label>
                  <Input
                    id="board-import-company-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="board-import-company-mission">Mission</Label>
                  <Textarea
                    id="board-import-company-mission"
                    value={mission}
                    rows={3}
                    onChange={(event) => setMission(event.target.value)}
                  />
                </div>
              </RemixFieldGroup>
              <RemixFieldGroup label="Workspace" tone="green">
                <CompanyWorkspaceField
                  environmentId={props.environmentId}
                  value={workspace}
                  onChange={setWorkspace}
                  companyName={name}
                />
              </RemixFieldGroup>
              {missingModel.length > 0 ? (
                <RemixFieldGroup label="Model" tone="blue">
                  <div className="flex flex-col gap-2">
                    <Label>
                      For {missingModel.map((agent) => agent.name).join(", ")}: their model
                      isn&apos;t set up here
                    </Label>
                    <ModelField
                      environmentId={props.environmentId}
                      projectId={null}
                      value={model}
                      onChange={setModel}
                    />
                  </div>
                </RemixFieldGroup>
              ) : null}
            </>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose render={<RemixButton />}>Cancel</DialogClose>
        <RemixButton variant="go" disabled={!canImport} onClick={() => void importFile()}>
          <UploadIcon />
          {busy ? "Importing…" : "Import company"}
        </RemixButton>
      </DialogFooter>
    </>
  );
}
