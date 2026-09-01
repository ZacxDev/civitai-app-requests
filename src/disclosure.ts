// The board's scan horizon, and the copy that admits to it.
//
// Kept out of App.tsx so it is framework-free and unit-testable with LITERAL
// expected strings — the copy is the contract here, and a test that re-derived
// it from this function would assert nothing.

/** How many entries per list page. */
export const PAGE_SIZE = 25;

/**
 * The server's `list()` is newest-first only — there is NO server-side rank or
 * search. To make "Top" and the search box honest across pages the board
 * bounded-scans, paging forward until the cursor is exhausted OR this many pages
 * have been pulled. When the cap binds, the UI says so.
 */
export const TOP_SCAN_MAX_PAGES = 8;

/** The number of rows a full scan can cover. */
export const SCAN_HORIZON = TOP_SCAN_MAX_PAGES * PAGE_SIZE;

export type HorizonMode = 'rank' | 'search' | 'both';

/**
 * The honest disclosure for a client-side order or filter that cannot see the
 * whole board.
 *
 * 🔴 The ranking and the search share ONE horizon and ONE voice — the pattern
 * the previous version established for "Top" is reused rather than a second one
 * being invented for search. `partial` means the server still has a cursor, i.e.
 * rows exist that were never loaded; when it is false there is nothing to
 * disclose and this returns `null`.
 */
export function horizonNote(opts: {
  mode: HorizonMode;
  loaded: number;
  partial: boolean;
}): string | null {
  if (!opts.partial) return null;
  switch (opts.mode) {
    case 'rank':
      return `Ranked across the first ${opts.loaded} requests — the board is larger.`;
    case 'search':
      return `Searching the first ${opts.loaded} requests — the board is larger, so a match further down won't appear.`;
    case 'both':
      return `Ranked and searched across the first ${opts.loaded} requests — the board is larger, so a match further down won't appear.`;
  }
}

/** Which disclosure applies, given the active order and whether a query is set. */
export function horizonModeFor(sort: 'top' | 'newest', searching: boolean): HorizonMode | null {
  if (searching && sort === 'top') return 'both';
  if (searching) return 'search';
  if (sort === 'top') return 'rank';
  // A "Newest" board with no query is the server's own order over the rows it
  // gave us — there is no client-side narrowing to admit to.
  return null;
}
