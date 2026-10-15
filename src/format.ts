// Pure presentation helpers for the App Requests board. Kept framework-free so
// they're covered by fast node (*.test.ts) unit tests.

import type { RequestItem, SortMode } from './platform/index.js';

export type { SortMode };

/** The one author label every row gets. Exported so tests pin the string, not a shape. */
export const AUTHOR_LABEL = 'A Civitai member';

/**
 * How to label the author of a request — UNIFORM for every row, including the
 * viewer's own.
 *
 * 🔴 Deliberately takes the row and ignores it. Keeping the parameter is not an
 * oversight: it keeps the call site honest about what a label COULD depend on if
 * the board ever showed authors, and it keeps the "no branch on the viewer"
 * property visible right here rather than spread over the call sites.
 *
 * Why uniform. The document store hands an app no author identity at all unless
 * the collection declares `showAuthor` (then a USERNAME, never an id), and this
 * board's `requests` collection does not — so the honest choices were a
 * viewer/other split (`author.isViewer`) or one label for everyone.
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
export function authorLabel(_item: RequestItem): string {
  return AUTHOR_LABEL;
}

/**
 * True when the viewer authored the entry (drives the edit + withdraw
 * affordances, and the report-vs-own-actions split in the row menu).
 *
 * It reads the server's `author.isViewer` (mapped onto `own` in
 * `src/platform/requests.ts`) — the store decides it against the block token's
 * subject, so it is right on every device and needs no viewer id here.
 *
 * 🔴 Independent of {@link authorLabel} by design — see its doc. This is the
 * only thing in the app that distinguishes the viewer's rows, and it must keep
 * distinguishing them.
 */
export function isOwnEntry(item: RequestItem): boolean {
  return item.own === true;
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
export function isWellFormedItem(item: RequestItem | null | undefined): boolean {
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

/** Code-point order, the store's own key order (`<`, not `localeCompare`). */
function byKeyDesc(a: RequestItem, b: RequestItem): number {
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

/**
 * Order the LOADED rows for display, in the same order the server ranked them.
 *
 * The server already returns each page in the active order (`-mark:vote` or
 * `-createdAt`, ties broken by key in the same direction — see
 * `src/platform/requests.ts`). This re-applies that exact order client-side so
 * that an optimistic tally change re-ranks a row immediately, and so a row
 * merged in from a later page lands where the server would have put it. The
 * tie-break is the server's (key, descending) — a different one here would let
 * the board disagree with the page boundary it was given.
 *
 * Pure + total — it returns a new array and never mutates the input.
 */
export function sortItems(items: RequestItem[], mode: SortMode): RequestItem[] {
  const copy = items.slice();
  if (mode === 'newest') {
    return copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byKeyDesc(a, b));
  }
  return copy.sort((a, b) => b.count - a.count || byKeyDesc(a, b));
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
  items: RequestItem[],
  limit = 3,
  threshold = SIMILAR_THRESHOLD,
): RequestItem[] {
  const trimmed = title.trim();
  if (trimmed.length < 4) return [];
  return items
    .map((it) => ({ it, score: titleSimilarity(trimmed, it.value.title) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}
