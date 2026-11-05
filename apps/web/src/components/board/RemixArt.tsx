import type { BoardTaskStatus } from "@t3tools/contracts";
import { useId, type ReactNode } from "react";

import { cn } from "../../lib/utils";

// Sticker-style drawings for T3 Remix: flat fills under a thick ink outline. All are static so
// they never repaint, and all are decorative, so screen readers skip them.

const INK = "stroke-(--remix-ink)";

function Art(props: {
  readonly viewBox: string;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <svg
      aria-hidden
      viewBox={props.viewBox}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", props.className)}
    >
      {props.children}
    </svg>
  );
}

function GearArt(props: { readonly className?: string | undefined }) {
  return (
    <Art viewBox="0 0 48 48" className={props.className}>
      <path
        d="M20.3 8.4L20.7 3.3L27.3 3.3L27.7 8.4L32.4 10.4L36.3 7.0L41.0 11.7L37.6 15.6L39.6 20.3L44.7 20.7L44.7 27.3L39.6 27.7L37.6 32.4L41.0 36.3L36.3 41.0L32.4 37.6L27.7 39.6L27.3 44.7L20.7 44.7L20.3 39.6L15.6 37.6L11.7 41.0L7.0 36.3L10.4 32.4L8.4 27.7L3.3 27.3L3.3 20.7L8.4 20.3L10.4 15.6L7.0 11.7L11.7 7.0L15.6 10.4Z"
        strokeWidth={3}
        className={cn("fill-(--remix-blue)", INK)}
      />
      <circle cx={24} cy={24} r={7} strokeWidth={3} className={cn("fill-(--remix-glass)", INK)} />
      <path d="M13 18a12 12 0 0 1 6-6" strokeWidth={2.5} className="stroke-white/80" />
    </Art>
  );
}

function MagnifierArt(props: { readonly className?: string | undefined }) {
  return (
    <Art viewBox="0 0 48 48" className={props.className}>
      <path d="M31 31 42 42" strokeWidth={10} className={INK} />
      <path d="M31 31 42 42" strokeWidth={4.5} className="stroke-(--remix-yellow)" />
      <circle cx={20} cy={20} r={15} strokeWidth={3} className={cn("fill-(--remix-blue)", INK)} />
      <circle
        cx={20}
        cy={20}
        r={10}
        strokeWidth={2.5}
        className={cn("fill-(--remix-glass)", INK)}
      />
      <path d="M14 18a6.5 6.5 0 0 1 5-5" strokeWidth={2.5} className="stroke-white" />
    </Art>
  );
}

function WarningArt(props: { readonly className?: string | undefined }) {
  return (
    <Art viewBox="0 0 48 48" className={props.className}>
      <path
        d="M24 5 44.5 41.5H3.5Z"
        strokeWidth={3.5}
        className={cn("fill-(--remix-yellow)", INK)}
      />
      <path d="M24 18v11" strokeWidth={4.5} className={INK} />
      <circle cx={24} cy={35.5} r={2.6} className="fill-(--remix-ink)" />
      <path d="M17 24.5 20.5 18.5" strokeWidth={2.5} className="stroke-white/80" />
    </Art>
  );
}

function CheckArt(props: { readonly className?: string | undefined }) {
  return (
    <Art viewBox="0 0 48 48" className={props.className}>
      <circle cx={24} cy={24} r={20} strokeWidth={3} className={cn("fill-(--remix-green)", INK)} />
      <path d="M15 24.5 21.5 31 33.5 17.5" strokeWidth={9} className={INK} />
      <path d="M15 24.5 21.5 31 33.5 17.5" strokeWidth={4.5} className="stroke-white" />
      <path d="M11.5 18a14 14 0 0 1 6-7" strokeWidth={2.5} className="stroke-white/70" />
    </Art>
  );
}

function BulbArt(props: { readonly className?: string | undefined }) {
  return (
    <Art viewBox="0 0 48 48" className={props.className}>
      <path
        d="M17.5 33.5c0-4-5.5-6.5-5.5-13.5a12 12 0 0 1 24 0c0 7-5.5 9.5-5.5 13.5Z"
        strokeWidth={3}
        className={cn("fill-(--remix-yellow)", INK)}
      />
      <rect
        x={17.5}
        y={33.5}
        width={13}
        height={9}
        rx={3}
        strokeWidth={3}
        className={cn("fill-(--remix-purple)", INK)}
      />
      <path d="M17.5 38h13" strokeWidth={2.5} className={INK} />
      <path d="M17 18a7 7 0 0 1 4.5-5" strokeWidth={2.5} className="stroke-white" />
      <path d="M4 12 7 13.5M44 12 41 13.5M24 1.5V4" strokeWidth={3} className={INK} />
    </Art>
  );
}

function ClipboardArt(props: { readonly className?: string | undefined }) {
  return (
    <Art viewBox="0 0 48 48" className={props.className}>
      <rect
        x={8}
        y={7}
        width={32}
        height={38}
        rx={6}
        strokeWidth={3}
        className={cn("fill-white", INK)}
      />
      <rect
        x={16}
        y={3}
        width={16}
        height={9}
        rx={3}
        strokeWidth={3}
        className={cn("fill-(--remix-orange)", INK)}
      />
      <path d="M14.5 22.5 17 25l4-4.5M14.5 33.5 17 36l4-4.5" strokeWidth={3} className={INK} />
      <path d="M25 23h9M25 34h9" strokeWidth={3} className="stroke-(--remix-orange)" />
    </Art>
  );
}

const COLUMN_ART: Record<BoardTaskStatus, typeof GearArt> = {
  backlog: BulbArt,
  todo: ClipboardArt,
  in_progress: GearArt,
  review: MagnifierArt,
  blocked: WarningArt,
  done: CheckArt,
};

export function ColumnArt(props: {
  readonly status: BoardTaskStatus;
  readonly className?: string | undefined;
}) {
  const Drawing = COLUMN_ART[props.status];
  return <Drawing className={props.className} />;
}

/** The empty In progress column: a rocket lifting off a cloud. */
export function RocketArt(props: { readonly className?: string | undefined }) {
  const puffs = [
    { cx: 70, cy: 150, r: 20 },
    { cx: 96, cy: 140, r: 26 },
    { cx: 126, cy: 146, r: 22 },
    { cx: 148, cy: 154, r: 15 },
  ];
  return (
    <Art viewBox="0 0 220 180" className={props.className}>
      <path d="M28 120c10-30 34-46 58-50" strokeWidth={3} strokeDasharray="7 9" className={INK} />
      <path d="M150 128c22-6 40-20 52-42" strokeWidth={3} strokeDasharray="7 9" className={INK} />
      <g transform="translate(120 74) rotate(38)">
        <path
          d="M-12 36Q0 76 12 36Z"
          strokeWidth={3}
          className={cn("fill-(--remix-orange)", INK)}
        />
        <path d="M-6 38Q0 60 6 38Z" className="fill-(--remix-yellow)" />
        <path
          d="M-22 4-40 30-38 42-20 30ZM22 4 40 30 38 42 20 30Z"
          strokeWidth={3}
          className={cn("fill-(--remix-pink)", INK)}
        />
        <path
          d="M0-58C20-42 27-12 22 36H-22C-27-12-20-42 0-58Z"
          strokeWidth={3}
          className={cn("fill-white", INK)}
        />
        <path
          d="M0-58C11-49 17-38 20-26H-20C-17-38-11-49 0-58Z"
          strokeWidth={3}
          className={cn("fill-(--remix-pink)", INK)}
        />
        <circle cx={0} cy={2} r={11} strokeWidth={3} className={cn("fill-(--remix-blue)", INK)} />
        <path d="M-5-2a6 6 0 0 1 4-4" strokeWidth={2.5} className="stroke-white" />
        <path d="M-8 36h16" strokeWidth={3} className={INK} />
      </g>
      {puffs.map((puff) => (
        <circle key={`o${puff.cx}`} {...puff} strokeWidth={6} className={INK} />
      ))}
      {puffs.map((puff) => (
        <circle key={`f${puff.cx}`} {...puff} className="fill-white" />
      ))}
      <path d="M60 172h100" strokeWidth={3} className={INK} />
    </Art>
  );
}

/** Rolling clouds along the bottom of the page. The tiles repeat at any width. */
export function RemixClouds() {
  // Pattern ids go into url(#…), so keep only characters that need no escaping there.
  const id = `remix-clouds-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-32 w-full">
      <defs>
        <pattern id={`${id}-far`} width={300} height={128} patternUnits="userSpaceOnUse" x={-90}>
          <circle cx={0} cy={112} r={58} className="fill-(--remix-cloud-far)" />
          <circle cx={92} cy={96} r={50} className="fill-(--remix-cloud-far)" />
          <circle cx={180} cy={114} r={62} className="fill-(--remix-cloud-far)" />
          <circle cx={300} cy={112} r={58} className="fill-(--remix-cloud-far)" />
        </pattern>
        <pattern id={`${id}-near`} width={360} height={128} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={140} r={60} className="fill-(--remix-cloud)" />
          <circle cx={84} cy={132} r={44} className="fill-(--remix-cloud)" />
          <circle cx={168} cy={146} r={66} className="fill-(--remix-cloud)" />
          <circle cx={262} cy={134} r={46} className="fill-(--remix-cloud)" />
          <circle cx={360} cy={140} r={60} className="fill-(--remix-cloud)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-far)`} />
      <rect width="100%" height="100%" fill={`url(#${id}-near)`} />
    </svg>
  );
}
