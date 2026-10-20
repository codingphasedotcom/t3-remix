/** Anything with an id and an optional chosen face: an agent, or a hire not saved yet. */
interface FaceOwner {
  readonly id: string;
  readonly avatar: string;
}

const FACE_URLS = import.meta.glob<string>("./faces/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface Face {
  readonly key: string;
  readonly url: string;
}

export const FACES: ReadonlyArray<Face> = Object.entries(FACE_URLS)
  .map(([path, url]) => ({ key: path.slice("./faces/".length, -".svg".length), url }))
  .toSorted((left, right) => left.key.localeCompare(right.key));

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** The agent's chosen face, or a stable one picked from its id when it has none. */
export function faceFor(agent: FaceOwner): Face | null {
  const chosen = FACES.find((face) => face.key === agent.avatar);
  if (chosen !== undefined) return chosen;
  return FACES[hashString(agent.id) % FACES.length] ?? null;
}

/** A face nobody in the company wears yet, so a new hire is easy to tell apart. */
export function unusedFaceKey(agents: ReadonlyArray<FaceOwner>, seed: string): string {
  const taken = new Set(agents.map((agent) => faceFor(agent)?.key));
  const free = FACES.filter((face) => !taken.has(face.key));
  const pool = free.length > 0 ? free : FACES;
  return pool[hashString(seed) % pool.length]?.key ?? "";
}
