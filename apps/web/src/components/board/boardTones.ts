import type { BoardTaskStatus } from "@t3tools/contracts";

export const TONES = {
  gray: {
    fill: "bg-muted-foreground/40",
    tint: "bg-muted",
    ink: "text-muted-foreground",
    solid: "bg-muted-foreground text-background",
  },
  indigo: {
    fill: "bg-indigo-500",
    tint: "bg-indigo-500/10 dark:bg-indigo-500/15",
    ink: "text-indigo-600 dark:text-indigo-400",
    solid: "bg-indigo-500 text-white",
  },
  sky: {
    fill: "bg-sky-500",
    tint: "bg-sky-500/10 dark:bg-sky-500/15",
    ink: "text-sky-600 dark:text-sky-400",
    solid: "bg-sky-600 text-white dark:bg-sky-500",
  },
  amber: {
    fill: "bg-amber-500",
    tint: "bg-amber-500/10 dark:bg-amber-500/15",
    ink: "text-amber-600 dark:text-amber-400",
    solid: "bg-amber-500 text-white",
  },
  red: {
    fill: "bg-red-500",
    tint: "bg-red-500/10 dark:bg-red-500/15",
    ink: "text-red-600 dark:text-red-400",
    solid: "bg-red-500 text-white",
  },
  emerald: {
    fill: "bg-emerald-500",
    tint: "bg-emerald-500/10 dark:bg-emerald-500/15",
    ink: "text-emerald-600 dark:text-emerald-400",
    solid: "bg-emerald-600 text-white",
  },
  teal: {
    fill: "bg-teal-500",
    tint: "bg-teal-500/10 dark:bg-teal-500/15",
    ink: "text-teal-600 dark:text-teal-400",
    solid: "bg-teal-600 text-white",
  },
  violet: {
    fill: "bg-violet-500",
    tint: "bg-violet-500/10 dark:bg-violet-500/15",
    ink: "text-violet-600 dark:text-violet-400",
    solid: "bg-violet-500 text-white",
  },
} as const;

export type Tone = keyof typeof TONES;

// Same hues as the sidebar's thread pills: sky is working, amber waits on a person.
export const COLUMN_TONES: Record<BoardTaskStatus, Tone> = {
  backlog: "gray",
  todo: "indigo",
  in_progress: "sky",
  review: "amber",
  blocked: "red",
  done: "emerald",
};
