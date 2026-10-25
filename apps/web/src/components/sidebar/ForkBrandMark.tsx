import { T3Wordmark } from "../T3Wordmark";
import "./forkBrand.css";

/**
 * A fork's own name in the sidebar header, such as "T3 Remix": black on the fork's lime, like
 * its app icon. T3 Code itself keeps upstream's wordmark.
 */
export function ForkBrandMark(props: { readonly name: string }) {
  const rest = props.name.replace(/^T3\s*/, "");
  return (
    <span
      data-fork-brand
      className="inline-flex min-w-0 items-baseline gap-1 rounded-xs px-1.5 py-1 text-sm font-bold tracking-tight"
    >
      <T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />
      <span className="truncate [text-box:trim-both_cap_alphabetic]">{rest}</span>
    </span>
  );
}
