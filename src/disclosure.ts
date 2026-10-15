// The board's search horizon, and the copy that admits to it.
//
// Kept out of App.tsx so it is framework-free and unit-testable with LITERAL
// expected strings — the copy is the contract here, and a test that re-derived
// it from this function would assert nothing.

/** How many entries per list page. */
export const PAGE_SIZE = 25;

/**
 * How many pages one "Load more" pulls before stopping. Ranking no longer needs
 * a scan — the server orders the whole board (`-mark:vote`) — so this bounds
 * only how far one click reaches for the SEARCH box, which still filters the
 * rows the board has loaded.
 */
export const LOAD_MORE_MAX_PAGES = 8;

export type HorizonMode = 'search';

/**
 * The honest disclosure for a client-side filter that cannot see the whole
 * board.
 *
 * 🔴 Search runs over the LOADED rows only. `partial` means the server still has
 * a cursor, i.e. rows exist that were never loaded; when it is false there is
 * nothing to disclose and this returns `null`.
 *
 * Ranking used to need the same admission ("Ranked across the first N
 * requests"), because the legacy store could only list newest-first and Top was
 * a client-side ranking over a bounded scan. The document store sorts by the
 * vote tally server-side, so the first page IS the top of the board and there
 * is no ranking horizon left to admit to.
 */
export function horizonNote(opts: {
  mode: HorizonMode;
  loaded: number;
  partial: boolean;
}): string | null {
  if (!opts.partial) return null;
  return `Searching the first ${opts.loaded} requests — the board is larger, so a match further down won't appear.`;
}

/** Which disclosure applies: only an active search can miss rows. */
export function horizonModeFor(_sort: 'top' | 'newest', searching: boolean): HorizonMode | null {
  return searching ? 'search' : null;
}
