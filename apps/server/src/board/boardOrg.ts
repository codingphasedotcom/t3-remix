import type { BoardAgent, BoardAgentId, BoardCompany } from "@t3tools/contracts";

/** Everyone who reports to `managerId`, directly or through other managers. */
function reportsUnder(
  agents: ReadonlyArray<BoardAgent>,
  managerId: BoardAgentId,
): ReadonlyArray<BoardAgent> {
  const found: Array<BoardAgent> = [];
  const queue: Array<BoardAgentId> = [managerId];
  const seen = new Set<BoardAgentId>([managerId]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const agent of agents) {
      if (agent.reportsToAgentId !== current || seen.has(agent.id)) continue;
      seen.add(agent.id);
      found.push(agent);
      queue.push(agent.id);
    }
  }
  return found;
}

export function directReports(
  agents: ReadonlyArray<BoardAgent>,
  managerId: BoardAgentId,
): ReadonlyArray<BoardAgent> {
  return agents.filter((agent) => agent.reportsToAgentId === managerId);
}

/**
 * Agents `agent` may hand work to: itself and everyone beneath it. The CEO directs the whole
 * company, including anyone whose manager was removed.
 */
export function assignableBy(
  company: BoardCompany,
  agents: ReadonlyArray<BoardAgent>,
  agent: BoardAgent,
): ReadonlyArray<BoardAgent> {
  if (company.ceoAgentId === agent.id) return agents;
  return [agent, ...reportsUnder(agents, agent.id)];
}

/** Managers from `agent` up to the CEO, nearest first. */
export function chainOfCommand(
  agents: ReadonlyArray<BoardAgent>,
  agent: BoardAgent,
): ReadonlyArray<BoardAgent> {
  const chain: Array<BoardAgent> = [];
  const seen = new Set<BoardAgentId>([agent.id]);
  let managerId = agent.reportsToAgentId;
  while (managerId !== null && !seen.has(managerId)) {
    seen.add(managerId);
    const manager = agents.find((candidate) => candidate.id === managerId);
    if (manager === undefined) break;
    chain.push(manager);
    managerId = manager.reportsToAgentId;
  }
  return chain;
}

/** True when making `agentId` report to `managerId` would put it beneath itself. */
export function createsReportingCycle(
  agents: ReadonlyArray<BoardAgent>,
  agentId: BoardAgentId,
  managerId: BoardAgentId,
): boolean {
  if (agentId === managerId) return true;
  return reportsUnder(agents, agentId).some((agent) => agent.id === managerId);
}
