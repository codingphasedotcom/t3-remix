import type { BoardAgentId, BoardCompanyId } from "@t3tools/contracts";

/** An employee someone can @mention, from a chat or a card. */
export interface MentionCandidate {
  readonly agentId: BoardAgentId;
  readonly companyId: BoardCompanyId;
  readonly companyName: string;
  readonly name: string;
  readonly title: string;
  readonly avatar: string;
  /** What the mention says: the job, plus the name when two people share it. */
  readonly label: string;
}

interface MentionCompany {
  readonly id: BoardCompanyId;
  readonly name: string;
  readonly members: ReadonlyArray<{
    readonly id: BoardAgentId;
    readonly name: string;
    readonly title: string;
    readonly avatar: string;
  }>;
}

export function mentionCandidates(
  companies: ReadonlyArray<MentionCompany>,
): ReadonlyArray<MentionCandidate> {
  return companies.flatMap((company) =>
    company.members.map((member) => {
      const job = member.title.trim();
      const shared = company.members.some(
        (other) => other.id !== member.id && other.title.trim().toLowerCase() === job.toLowerCase(),
      );
      return {
        agentId: member.id,
        companyId: company.id,
        companyName: company.name,
        name: member.name,
        title: job,
        avatar: member.avatar,
        label: job.length === 0 ? member.name : shared ? `${job} (${member.name})` : job,
      };
    }),
  );
}

/** Candidates whose job, then name, matches what follows the @, best matches first. */
export function matchMentionCandidates(
  candidates: ReadonlyArray<MentionCandidate>,
  query: string,
  limit = 8,
): ReadonlyArray<MentionCandidate> {
  const wanted = query.trim().toLowerCase();
  if (wanted.length === 0) return candidates.slice(0, limit);
  const rank = (candidate: MentionCandidate): number | null => {
    const job = candidate.title.toLowerCase();
    const name = candidate.name.toLowerCase();
    if (job.startsWith(wanted)) return 0;
    if (job.split(/\s+/).some((word) => word.startsWith(wanted))) return 1;
    if (name.startsWith(wanted)) return 2;
    if (job.includes(wanted)) return 3;
    return name.includes(wanted) ? 4 : null;
  };
  return candidates
    .flatMap((candidate) => {
      const score = rank(candidate);
      return score === null ? [] : [{ candidate, score }];
    })
    .toSorted((left, right) => left.score - right.score)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** The @word the cursor is in, if any: where it starts and ends, and what follows the @. */
export function mentionTriggerAt(
  text: string,
  cursor: number,
): { readonly start: number; readonly end: number; readonly query: string } | null {
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start -= 1;
  if (text[start] !== "@") return null;
  let end = cursor;
  while (end < text.length && !/\s/.test(text[end] ?? "")) end += 1;
  return { start, end, query: text.slice(start + 1, cursor) };
}
