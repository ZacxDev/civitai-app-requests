import { describe, expect, it } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

import {
  filterRequests,
  isSubsequence,
  requestScore,
  tokenScore,
  SCORE_NONE,
  SCORE_PREFIX,
  SCORE_SUBSEQUENCE,
  SCORE_SUBSTRING,
  SCORE_WORD_START,
  TITLE_BONUS,
} from './search.js';

function item(title: string, body?: string, key = title): SharedListItem {
  return {
    key,
    authorUserId: 1,
    value: body === undefined ? { title } : { title, body },
    count: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    viewerVoted: false,
  };
}

describe('isSubsequence', () => {
  it('accepts characters in order with gaps', () => {
    expect(isSubsequence('dm', 'dark mode')).toBe(true);
    expect(isSubsequence('prmpt', 'prompt')).toBe(true);
  });

  it('rejects characters out of order', () => {
    expect(isSubsequence('md', 'dark mode')).toBe(true); // m…d IS in order here
    expect(isSubsequence('zx', 'dark mode')).toBe(false);
    expect(isSubsequence('edom', 'mode')).toBe(false);
  });

  it('treats the empty needle as always present', () => {
    expect(isSubsequence('', 'anything')).toBe(true);
  });
});

describe('tokenScore', () => {
  // Literal band values — never re-derived from the implementation.
  it('scores a prefix highest', () => {
    expect(tokenScore('dark', 'dark mode toggle')).toBe(SCORE_PREFIX);
    expect(tokenScore('dark', 'dark mode toggle')).toBe(1);
  });

  it('scores a word-start match below a prefix but above a mid-word one', () => {
    expect(tokenScore('mode', 'dark mode toggle')).toBe(SCORE_WORD_START);
    expect(tokenScore('mode', 'dark mode toggle')).toBe(0.9);
  });

  it('scores a mid-word substring lower still', () => {
    expect(tokenScore('ode', 'dark mode toggle')).toBe(SCORE_SUBSTRING);
    expect(tokenScore('ode', 'dark mode toggle')).toBe(0.75);
  });

  it('falls back to a subsequence match', () => {
    expect(tokenScore('dkm', 'dark mode toggle')).toBe(SCORE_SUBSEQUENCE);
    expect(tokenScore('dkm', 'dark mode toggle')).toBe(0.4);
  });

  it('scores nothing when the characters are not present in order', () => {
    expect(tokenScore('zzz', 'dark mode toggle')).toBe(SCORE_NONE);
    expect(tokenScore('zzz', 'dark mode toggle')).toBe(0);
  });

  it('scores an empty token as no match, not as a universal one', () => {
    expect(tokenScore('', 'dark mode toggle')).toBe(0);
  });
});

describe('requestScore', () => {
  it('adds the title bonus when every token is in the title', () => {
    // "dark" is a prefix of the title (1) and all tokens are in the title.
    expect(requestScore('dark', item('Dark mode toggle'))).toBe(SCORE_PREFIX + TITLE_BONUS);
    expect(requestScore('dark', item('Dark mode toggle'))).toBe(1.25);
  });

  it('withholds the title bonus when a token only matched the body', () => {
    const it0 = item('Dark mode toggle', 'switch the palette');
    // "palette" is only in the body, so no bonus and the mean is over both tokens.
    const score = requestScore('dark palette', it0);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0);
  });

  it('is AND semantics: adding an unmatched word removes the match entirely', () => {
    expect(requestScore('dark', item('Dark mode toggle'))).toBeGreaterThan(0);
    expect(requestScore('dark zzzz', item('Dark mode toggle'))).toBe(0);
  });

  it('ignores punctuation and case on both sides', () => {
    expect(requestScore('DARK-MODE!', item('dark mode'))).toBeGreaterThan(0);
  });

  it('returns 0 for an empty or whitespace query', () => {
    expect(requestScore('', item('Dark mode'))).toBe(0);
    expect(requestScore('   ', item('Dark mode'))).toBe(0);
  });

  it('handles a row with no body without throwing', () => {
    expect(requestScore('dark', item('Dark mode'))).toBeGreaterThan(0);
  });
});

describe('filterRequests', () => {
  const board = [
    item('Dark mode toggle', undefined, 'a'),
    item('Prompt library', 'save and share prompts', 'b'),
    item('Batch upscaler', undefined, 'c'),
  ];

  it('returns everything for an empty query — never an empty list', () => {
    expect(filterRequests('', board).map((i) => i.key)).toEqual(['a', 'b', 'c']);
    expect(filterRequests('   ', board).map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });

  it('returns a NEW array, never the caller\'s own', () => {
    expect(filterRequests('', board)).not.toBe(board);
  });

  it('filters to matching rows only', () => {
    expect(filterRequests('prompt', board).map((i) => i.key)).toEqual(['b']);
  });

  it('matches on the body too', () => {
    expect(filterRequests('share', board).map((i) => i.key)).toEqual(['b']);
  });

  it('🔴 PRESERVES the caller\'s order rather than re-ranking on relevance', () => {
    // The toolbar promises "Top" or "Newest"; search narrows that order, it does
    // not replace it. Here 'a' is a stronger match than 'c' but stays second
    // because the caller handed them in that order.
    const ordered = [item('Batch upscaler', undefined, 'c'), item('Upscale everything', undefined, 'a')];
    expect(filterRequests('upscal', ordered).map((i) => i.key)).toEqual(['c', 'a']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterRequests('zzzzz', board)).toEqual([]);
  });
});
