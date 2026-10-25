import type { BoardCompanyWorkspace, EnvironmentId, ProjectId } from "@t3tools/contracts";

import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export type WorkspaceChoice =
  | { readonly type: "new" }
  | { readonly type: "existing"; readonly projectId: ProjectId | null };

function folderNameFor(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "company"
  );
}

/** What to send for a choice, or null while an existing project is still unpicked. */
export function workspaceInput(
  choice: WorkspaceChoice,
  companyName: string,
): BoardCompanyWorkspace | null {
  if (choice.type === "new") return { type: "new", folderName: folderNameFor(companyName) };
  return choice.projectId === null ? null : { type: "existing", projectId: choice.projectId };
}

/** Projects a company can call home: this environment's, without the scratch project. */
export function useCompanyProjects(environmentId: EnvironmentId) {
  return useProjects().filter(
    (project) => project.environmentId === environmentId && project.isScratch !== true,
  );
}

export function CompanyWorkspaceField(props: {
  readonly environmentId: EnvironmentId;
  readonly value: WorkspaceChoice;
  readonly onChange: (value: WorkspaceChoice) => void;
  readonly companyName: string;
}) {
  const projects = useCompanyProjects(props.environmentId);
  const selectedId = props.value.type === "existing" ? props.value.projectId : null;
  const selected = projects.find((project) => project.id === selectedId) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <Label>Where the team works</Label>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={props.value.type === "new" ? "outline" : "ghost"}
          onClick={() => props.onChange({ type: "new" })}
        >
          New project folder
        </Button>
        <Button
          size="sm"
          variant={props.value.type === "existing" ? "outline" : "ghost"}
          disabled={projects.length === 0}
          onClick={() => props.onChange({ type: "existing", projectId: projects[0]?.id ?? null })}
        >
          Existing project
        </Button>
      </div>
      {props.value.type === "new" ? (
        <span className="text-xs text-muted-foreground">
          Creates a project folder named “{folderNameFor(props.companyName)}”.
        </span>
      ) : (
        <>
          <Select
            value={selectedId ?? ""}
            onValueChange={(value) =>
              props.onChange({ type: "existing", projectId: value as ProjectId })
            }
          >
            <SelectTrigger size="sm">
              <SelectValue>{selected?.title ?? "Choose a project"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id} label={project.title}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{project.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {project.workspaceRoot}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <span className="text-xs text-muted-foreground">
            {selected === null
              ? "Add a folder as a project first to make it the company's home."
              : selected.workspaceRoot}
          </span>
        </>
      )}
    </div>
  );
}
