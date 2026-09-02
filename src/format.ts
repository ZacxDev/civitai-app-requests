// Pure presentation helpers for the App Requests board. Kept framework-free so
// they're covered by fast node (*.test.ts) unit tests.

import type { SharedListItem } from '@civitai/blocks-react';

export type SortMode = 'top' | 'newest';

/** The one author label every row gets. Exported so tests pin the string, not a shape. */
export const AUTHOR_LABEL = 'A Civitai member';

/**
 * How to label the author of a request — UNIFORM for every row, including the
 * viewer's own.
 *
 * 🔴 Deliberately takes both ids and ignores both. Keeping the parameters is not
 * an oversight: it keeps the call site honest about what a label COULD depend on
 * if the platform ever grew a user lookup, and it keeps the "no branch on the
 * viewer" property visible right here rather than spread over the call sites.
 *
 * Why uniform. Real per-user identity is platform work, not app work: a listed
 * row carries `authorUserId` as a bare number, no message type resolves a user,
 * and the only identity scope is `user:read:self` — which reads the VIEWER, not
 * the author of a row. So the honest choices were a viewer/other split or one
 * label for everyone.
 *
 * 0.3.0 shipped the split and rendered `you` on the viewer's own rows. It read
 * badly for the reason self-reference usually does: the viewer's row looked like
 * a different KIND of row from everyone else's, in a board whose whole point is
 * that every request is equal until people vote. Uniform is also the shape that
 * survives identity landing later — every row gets a handle at once, rather than
 * "you" being special-cased forever.
 *
 * 🔴 This is a LABEL decision and nothing else. Own-post recognition comes from
 * the AFFORDANCES — edit and withdraw appear only on your own rows — which are
 * gated by {@link isOwnEntry}. The two must stay independent: a future change
 * that re-derives one from the other would either put `you` back on the card or
 * hand everyone the edit menu.
 */
export function authorLabel(
  _authorUserId: number,
  _viewerId: number | null | undefined,
): string {
  return AUTHOR_LABEL;
}

/**
 * True when the viewer authored the entry (drives the edit + withdraw
 * affordances, and the report-vs-own-actions split in the row menu).
 *
 * 🔴 Independent of {@link authorLabel} by design — see its doc. This is the
 * only thing in the app that distinguishes the viewer's rows, and it must keep
 * distinguishing them.
 */
export function isOwnEntry(
  authorUserId: number,
  viewerId: number | null | undefined,
): boolean {
  return viewerId != null && authorUserId === viewerId;
}

/**
 * Compact "time ago" label from a Date and a reference `now`. Deterministic —
 * `now` is injected so tests don't depend on the wall clock.
 */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const secs = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Cheap structural guard: is this shared row safe to sort + render? {@link
 * sortItems} reads `.createdAt.getTime()` / `.count` and the row renderer reads
 * `.value.title`, so a single malformed row (bad/missing field) would throw in
 * the sort `useMemo` / render and — because Retry re-fetches the SAME poisoned
 * row — brick the whole board unrecoverably. Filtering rows through this BEFORE
 * they reach state degrades one bad row to one MISSING row, not a dead board.
 */
export function isWellFormedItem(item: SharedListItem | null | undefined): boolean {
  return (
    item != null &&
    typeof item.key === 'string' &&
    item.value != null &&
    typeof item.value.title === 'string' &&
    item.createdAt instanceof Date &&
    !Number.isNaN(item.createdAt.getTime()) &&
    typeof item.count === 'number'
  );
}

/**
 * Order the board for display. The server returns entries newest-first; `newest`
 * preserves that, `top` re-sorts by vote count (descending), breaking ties by
 * recency (newer first) so the order is stable and intuitive. Pure + total — it
 * returns a new array and never mutates the input.
 */
export function sortItems(items: SharedListItem[], mode: SortMode): SharedListItem[] {
  const copy = items.slice();
  if (mode === 'newest') {
    return copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  return copy.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** Character-count hint text for the length-limited inputs. */
export function lengthHint(value: string, max: number): string {
  return `${value.length} / ${max}`;
}

/** True when the field is over its ceiling (drives the error state + disable). */
export function isOverLimit(value: string, max: number): boolean {
  return value.length > max;
}

export const TITLE_MAX = 200;
export const BODY_MAX = 4096;

// ---- lightweight client-side duplicate detection (vote-splitting nudge) ----

// Tiny English stop-word set + generic domain filler dropped before matching, so
// "the"/"a"/"app" don't manufacture spurious overlap between unrelated ideas.
const MATCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'that',
  'this', 'you', 'your', 'are', 'but', 'not', 'can', 'add', 'app', 'feature',
  'please', 'would', 'like', 'want', 'new', 'support',
]);

/** Normalize a title to a set of meaningful (>2-char, non-stopword) tokens. */
function matchTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !MATCH_STOPWORDS.has(w));
}

/**
 * Jaccard similarity (intersection / union) over the two titles' meaningful
 * token sets. 0 when either side has no meaningful tokens. Pure + symmetric.
 */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(matchTokens(a));
  const B = new Set(matchTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Below this token-overlap the "similar?" nudge stays quiet — tuned so a real
// near-duplicate ("Dark mode" vs "Dark mode toggle") trips it while merely
// topical titles don't. Deliberately a SOFT nudge (never blocks posting).
export const SIMILAR_THRESHOLD = 0.34;

/**
 * Find up to `limit` already-posted requests whose title is similar to `title`,
 * ranked most-similar first. Used to nudge (never block) the poster before they
 * create a vote-splitting duplicate. Short drafts (<4 chars) return nothing.
 * Pure — reads only the already-loaded board, no network.
 */
export function findSimilarRequests(
  title: string,
  items: SharedListItem[],
  limit = 3,
  threshold = SIMILAR_THRESHOLD,
): SharedListItem[] {
  const trimmed = title.trim();
  if (trimmed.length < 4) return [];
  return items
    .map((it) => ({ it, score: titleSimilarity(trimmed, it.value.title) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}
