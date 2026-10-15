import { describe, expect, it } from 'vitest';

import { horizonModeFor, horizonNote, LOAD_MORE_MAX_PAGES, PAGE_SIZE } from './disclosure.js';

describe('paging', () => {
  it('pages 25 at a time and one Load more reaches at most 8 pages', () => {
    expect(PAGE_SIZE).toBe(25);
    expect(LOAD_MORE_MAX_PAGES).toBe(8);
  });
});

describe('horizonModeFor', () => {
  it('discloses a search under either order', () => {
    expect(horizonModeFor('newest', true)).toBe('search');
    expect(horizonModeFor('top', true)).toBe('search');
  });

  it('🔴 discloses NOTHING without a query — under either order that IS the server order', () => {
    // Top used to carry "Ranked across the first N requests" because it was a
    // client-side ranking over a bounded scan. The store now ranks the whole
    // board by the vote tally, so the loaded rows ARE the top rows. Keeping the
    // old note would be noise, and noise trains people to ignore the note that
    // matters.
    expect(horizonModeFor('top', false)).toBeNull();
    expect(horizonModeFor('newest', false)).toBeNull();
  });
});

describe('horizonNote', () => {
  it('says nothing when the whole board was loaded', () => {
    expect(horizonNote({ mode: 'search', loaded: 12, partial: false })).toBeNull();
  });

  // 🔴 LITERAL STRINGS. The copy IS the honesty contract, so a reworded note has
  // to be a deliberate act that shows up in the diff — not something that
  // silently drifts while a test re-derives it from the implementation.
  it('warns that a search cannot see past the loaded rows', () => {
    expect(horizonNote({ mode: 'search', loaded: 200, partial: true })).toBe(
      "Searching the first 200 requests — the board is larger, so a match further down won't appear.",
    );
  });

  it('reports the ACTUAL loaded count, not a theoretical cap', () => {
    expect(horizonNote({ mode: 'search', loaded: 37, partial: true })).toContain('first 37 requests');
  });
});
