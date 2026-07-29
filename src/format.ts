// Pure presentation helpers for the App Requests board. Kept framework-free so
// they're covered by fast node (*.test.ts) unit tests.

import type { SharedListItem } from '@civitai/blocks-react';

export type SortMode = 'top' | 'newest';

/**
 * How to label the author of a request. The block can't resolve usernames (no
 * catalog lookup for arbitrary user ids), so we show `you` for the viewer and
 * `user #N` for everyone else — matching what the shared API exposes
 * (`authorUserId`, a number).
 */
export function authorLabel(authorUserId: number, viewerId: number | null | undefined): string {
  if (viewerId != null && authorUserId === viewerId) return 'you';
  return `user #${authorUserId}`;
}

/** True when the viewer authored the entry (drives the withdraw affordance). */
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
