import type {
  BoardCompany,
  BoardCompanyId,
  BoardSnapshot,
  EnvironmentId,
} from "@t3tools/contracts";
import { CopyIcon } from "lucide-react";
import { useState } from "react";

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
import type { RunBoardCommand } from "./BoardPage";
import {
  CompanyWorkspaceField,
  workspaceInput,
  type WorkspaceChoice,
} from "./CompanyWorkspaceField";
import { RemixFieldGroup, RemixHeading, RemixButton } from "./RemixSurface";

export function CloneCompanyDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly runCommand: RunBoardCommand;
  readonly onCloned: (companyId: BoardCompanyId) => void;
}) {
  const company = props.snapshot.company;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        {props.open && company !== null ? <CloneForm {...props} company={company} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function CloneForm(props: {
  readonly company: BoardCompany;
  readonly environmentId: EnvironmentId;
  readonly snapshot: BoardSnapshot;
  readonly runCommand: RunBoardCommand;
  readonly onCloned: (companyId: BoardCompanyId) => void;
}) {
  const source = props.company;
  const [name, setName] = useState(`${source.name} copy`);
  const [mission, setMission] = useState(source.mission);
  const [workspace, setWorkspace] = useState<WorkspaceChoice>({ type: "new" });
  const [includeMemory, setIncludeMemory] = useState(false);
  const [busy, setBusy] = useState(false);
  const home = workspaceInput(workspace, name);
  const canClone = name.trim().length > 0 && home !== null && !busy;
  const people = props.snapshot.agents.length;
  const skills = props.snapshot.skills.length;

  const clone = async () => {
    if (home === null) return;
    setBusy(true);
    const result = await props.runCommand({
      type: "company.clone",
      company: {
        sourceCompanyId: source.id,
        name: name.trim(),
        mission: mission.trim(),
        workspace: home,
        includeMemory,
      },
    });
    setBusy(false);
    if (result?.company !== undefined) props.onCloned(result.company.id);
  };

  return (
    <>
      <DialogHeader>
        <RemixHeading
          icon={<CopyIcon />}
          tone="teal"
          title={<DialogTitle>Clone {source.name}</DialogTitle>}
          description={
            <DialogDescription>Start a new company with the same team</DialogDescription>
          }
        />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <RemixFieldGroup label="Company" tone="teal">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-clone-company-name">Name</Label>
              <Input
                id="board-clone-company-name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-clone-company-mission">Mission</Label>
              <Textarea
                id="board-clone-company-mission"
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
          <RemixFieldGroup label="What comes along" tone="purple">
            <p className="text-sm text-foreground">
              {people} {people === 1 ? "employee" : "employees"}, {source.departments.length}{" "}
              {source.departments.length === 1 ? "department" : "departments"}, {skills}{" "}
              {skills === 1 ? "skill" : "skills"}, who reports to whom, and the board settings.
              Tasks, routines, and history stay with {source.name}.
            </p>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="board-clone-memory">Copy what they remember</Label>
                <span className="text-xs text-muted-foreground">
                  The company&apos;s memory and each employee&apos;s lessons. Leave it off when the
                  new company does different work.
                </span>
              </div>
              <Switch
                id="board-clone-memory"
                className="mt-1"
                checked={includeMemory}
                onCheckedChange={setIncludeMemory}
              />
            </div>
          </RemixFieldGroup>
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose render={<RemixButton />}>Cancel</DialogClose>
        <RemixButton variant="go" disabled={!canClone} onClick={() => void clone()}>
          <CopyIcon />
          {busy ? "Cloning…" : "Clone company"}
        </RemixButton>
      </DialogFooter>
    </>
  );
}
