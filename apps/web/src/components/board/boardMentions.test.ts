import type { BoardAgentId, BoardCompanyId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchMentionCandidates, mentionCandidates, mentionTriggerAt } from "./boardMentions";

const member = (id: string, name: string, title: string) => ({
  id: id as BoardAgentId,
  name,
  title,
  avatar: "",
});

const candidates = mentionCandidates([
  {
    id: "company-1" as BoardCompanyId,
    name: "Acme",
    members: [
      member("ceo", "Morgan", "CEO"),
      member("cto", "Grace", "CTO"),
      member("linus", "Linus", "Software engineer"),
      member("rita", "Rita", "Software engineer"),
      member("qa", "Margaret", "QA engineer"),
      member("intern", "Sam", ""),
    ],
  },
]);

describe("mentionCandidates", () => {
  it("names people by their job, adding the name only when a job is shared", () => {
    expect(candidates.map((candidate) => candidate.label)).toEqual([
      "CEO",
      "CTO",
      "Software engineer (Linus)",
      "Software engineer (Rita)",
      "QA engineer",
      "Sam",
    ]);
  });
});

describe("matchMentionCandidates", () => {
  it("ranks a job that starts with the query ahead of a later word or a name", () => {
    expect(matchMentionCandidates(candidates, "eng").map((candidate) => candidate.name)).toEqual([
      "Linus",
      "Rita",
      "Margaret",
    ]);
    expect(matchMentionCandidates(candidates, "qa").map((candidate) => candidate.name)).toEqual([
      "Margaret",
    ]);
    expect(matchMentionCandidates(candidates, "gra").map((candidate) => candidate.name)).toEqual([
      "Grace",
    ]);
  });

  it("lists everyone, up to the limit, before anything is typed", () => {
    expect(matchMentionCandidates(candidates, "", 3)).toHaveLength(3);
  });
});

describe("mentionTriggerAt", () => {
  it("finds the @word around the cursor", () => {
    expect(mentionTriggerAt("Ask @CT", 7)).toEqual({ start: 4, end: 7, query: "CT" });
    expect(mentionTriggerAt("Ask @CTO now", 6)).toEqual({ start: 4, end: 8, query: "C" });
    expect(mentionTriggerAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("ignores words that do not start with @, such as email addresses", () => {
    expect(mentionTriggerAt("mail me@example.com", 19)).toBeNull();
    expect(mentionTriggerAt("Ask the CTO", 11)).toBeNull();
  });
});
