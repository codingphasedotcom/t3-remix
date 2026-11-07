import type {
  BoardAgent,
  BoardCompany,
  BoardCompanyFile,
  BoardRoutine,
  BoardSettings,
  BoardSkill,
  ServerProvider,
} from "@t3tools/contracts";

/** A skill installed for one of the coding agents on this computer, by its SKILL.md. */
export interface InstalledSkill {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}

/** Every enabled skill of the enabled providers, once per name, as seen from `cwd`. */
export function installedSkills(
  providers: ReadonlyArray<ServerProvider>,
  cwd: string | null,
): ReadonlyArray<InstalledSkill> {
  const byName = new Map<string, InstalledSkill>();
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const workspace =
      cwd === null ? undefined : provider.workspaceSnapshots?.find((entry) => entry.cwd === cwd);
    for (const skill of workspace?.skills ?? provider.skills) {
      const key = skill.name.toLowerCase();
      if (!skill.enabled || byName.has(key)) continue;
      byName.set(key, {
        name: skill.name,
        description: skill.description ?? skill.shortDescription ?? "",
        path: skill.path,
      });
    }
  }
  return [...byName.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

/** The company as a file. `skillInstructions` holds each installed skill's SKILL.md. */
export function companyFile(input: {
  readonly company: BoardCompany;
  readonly agents: ReadonlyArray<BoardAgent>;
  readonly skills: ReadonlyArray<BoardSkill>;
  readonly skillInstructions: ReadonlyMap<string, string>;
  readonly routines: ReadonlyArray<BoardRoutine>;
  readonly settings: BoardSettings;
  readonly includeMemory: boolean;
}): BoardCompanyFile {
  const memory = (value: string) => (input.includeMemory ? value : "");
  return {
    format: "t3-remix-company",
    version: 1,
    name: input.company.name,
    mission: input.company.mission,
    memory: memory(input.company.memory),
    departments: input.company.departments,
    skills: input.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions:
        skill.installedPath === null
          ? skill.instructions
          : (input.skillInstructions.get(skill.id) ?? ""),
      installed: skill.installedPath !== null,
    })),
    agents: input.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      title: agent.title,
      avatar: agent.avatar,
      departmentId: agent.departmentId,
      reportsToAgentId: agent.reportsToAgentId,
      ceo: agent.id === input.company.ceoAgentId,
      skillIds: agent.skillIds,
      instructions: agent.instructions,
      memory: memory(agent.memory),
      modelSelection: agent.modelSelection,
      runtimeMode: agent.runtimeMode,
      monthlyTokenLimit: agent.monthlyTokenLimit,
    })),
    routines: input.routines.map((routine) => ({
      title: routine.title,
      description: routine.description,
      assigneeAgentId: routine.assigneeAgentId,
      assignedToUser: routine.assignedToUser,
      everyDays: routine.everyDays,
      enabled: routine.enabled,
    })),
    settings: {
      autoDispatch: input.settings.autoDispatch,
      maxConcurrentRuns: input.settings.maxConcurrentRuns,
      useWorktrees: input.settings.useWorktrees,
      baseRef: input.settings.baseRef,
      monthlyTokenLimit: input.settings.monthlyTokenLimit,
    },
  };
}

/** Why a company file can't be imported, or null when it can. */
export function companyFileProblem(file: BoardCompanyFile): string | null {
  if (file.departments.length === 0) return "The file has no departments.";
  if (file.agents.filter((agent) => agent.ceo).length !== 1) {
    return "The file needs exactly one CEO.";
  }
  const ids = new Set(file.agents.map((agent) => agent.id));
  if (ids.size !== file.agents.length) return "Two employees in the file share an id.";
  const managers = new Map(file.agents.map((agent) => [agent.id, agent.reportsToAgentId]));
  for (const agent of file.agents) {
    const seen = new Set([agent.id]);
    let manager = agent.reportsToAgentId;
    while (manager !== null && manager !== undefined && ids.has(manager)) {
      if (seen.has(manager)) return `${agent.name}'s managers report to each other in a loop.`;
      seen.add(manager);
      manager = managers.get(manager) ?? null;
    }
  }
  return null;
}
