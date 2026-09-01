import { describe, expect, it } from 'vitest';

import {
  horizonModeFor,
  horizonNote,
  PAGE_SIZE,
  SCAN_HORIZON,
  TOP_SCAN_MAX_PAGES,
} from './disclosure.js';

describe('the scan horizon', () => {
  it('is the page size times the page cap', () => {
    expect(PAGE_SIZE).toBe(25);
    expect(TOP_SCAN_MAX_PAGES).toBe(8);
    expect(SCAN_HORIZON).toBe(200);
  });
});

describe('horizonModeFor', () => {
  it('discloses a ranking when Top is active', () => {
    expect(horizonModeFor('top', false)).toBe('rank');
  });

  it('discloses a search when a query is active under Newest', () => {
    expect(horizonModeFor('newest', true)).toBe('search');
  });

  it('discloses both when a query narrows a ranked board', () => {
    expect(horizonModeFor('top', true)).toBe('both');
  });

  it('🔴 discloses NOTHING for Newest with no query — that IS the server order', () => {
    // Inventing a disclosure here would be noise, and noise trains people to
    // ignore the note that matters.
    expect(horizonModeFor('newest', false)).toBeNull();
  });
});

describe('horizonNote', () => {
  it('says nothing when the whole board was loaded', () => {
    expect(horizonNote({ mode: 'rank', loaded: 12, partial: false })).toBeNull();
    expect(horizonNote({ mode: 'search', loaded: 12, partial: false })).toBeNull();
    expect(horizonNote({ mode: 'both', loaded: 12, partial: false })).toBeNull();
  });

  // 🔴 LITERAL STRINGS. The copy IS the honesty contract, so a reworded note has
  // to be a deliberate act that shows up in the diff — not something that
  // silently drifts while a test re-derives it from the implementation.
  it('names the ranked window verbatim', () => {
    expect(horizonNote({ mode: 'rank', loaded: 200, partial: true })).toBe(
      'Ranked across the first 200 requests — the board is larger.',
    );
  });

  it('warns that a search cannot see past the horizon', () => {
    expect(horizonNote({ mode: 'search', loaded: 200, partial: true })).toBe(
      "Searching the first 200 requests — the board is larger, so a match further down won't appear.",
    );
  });

  it('combines both when a query narrows a ranked board', () => {
    expect(horizonNote({ mode: 'both', loaded: 200, partial: true })).toBe(
      "Ranked and searched across the first 200 requests — the board is larger, so a match further down won't appear.",
    );
  });

  it('reports the ACTUAL loaded count, not the theoretical cap', () => {
    // A board that stopped short of the cap for any reason must not claim 200.
    expect(horizonNote({ mode: 'rank', loaded: 37, partial: true })).toContain('first 37 requests');
  });

  it('every partial note admits the board is larger', () => {
    for (const mode of ['rank', 'search', 'both'] as const) {
      expect(horizonNote({ mode, loaded: 9, partial: true })).toContain('the board is larger');
    }
  });
});
